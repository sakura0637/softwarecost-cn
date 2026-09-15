import db from './db'
import { createError } from 'h3'
import { getAuthUser } from './auth'
import { getTableConf } from '../config/dataTables'
import { getColumns } from './adminData'
import { ACTION_LABELS, HEAVY_PLACEHOLDER, BATCH_ENTITY_ID } from '../config/audit'

// 撤销一条操作记录：按原 action 反向还原数据。
//   create → 删除该行
//   update → 用 changes 里的 old 值覆盖业务字段
//   delete → 用 changes 里的整行快照重新插入（保留原主键）
//
// 【2026-09-15 泛化】原实现只认设备三表（TABLE_OF 硬编码 + entity_type 白名单）。
// 现在数据维护的 15 张参数表也走这里 —— 「把工资基数改错了」「导入把单价库覆盖了」
// 这类事故必须能在界面上点一下退回去，而不是让主人去手写 SQL。
//
// 两处越界保护：
//   1) 大字段（result_json / params_snapshot 等）在写日志时就被替换成占位文字，
//      快照里拿到的是占位符而非真值 → **不允许**用这种快照做 delete 撤销（会写坏 JSON 列）。
//   2) 外键冲突交给数据库判定（23503）后转成 409，而不是自己维护一张「谁引用谁」的表。

/** 设备三表：实体类型 → 真实表名（它们不在 dataTables 注册表里） */
// ⚠️ key 集合必须与 config/audit.ts 的 DEVICE_ENTITY_TYPES 完全一致
// （不一致会出现「撤销支持但审计页不给按钮」或反之）—— 由 scripts/check_audit.ts 断言。
const DEVICE_TABLE_OF: Record<string, string> = {
  station: 'stations',
  device: 'devices',
  station_device: 'station_devices'
}

/** 不允许通过撤销反向写入的系统字段 */
const SKIP_FIELDS = new Set(['id', 'created_at', 'updated_at'])

export async function loadOperationLog(id: number): Promise<any> {
  if (!id || isNaN(id)) throw createError({ statusCode: 400, statusMessage: '无效 ID' })
  const log = (await db.prepare('SELECT * FROM operation_logs WHERE id = ?').get(id)) as any
  if (!log) throw createError({ statusCode: 404, statusMessage: '操作记录不存在' })
  return log
}

function parseChanges(v: any): any[] {
  try {
    const c = typeof v === 'string' ? JSON.parse(v) : v
    return Array.isArray(c) ? c : []
  } catch {
    return []
  }
}

/** PG 错误码 → 人话。23503 = 外键约束（还被人引用着），23505 = 唯一键冲突 */
function pgErrorTo409(e: any): never {
  const code = e?.code
  if (code === '23503') {
    throw createError({ statusCode: 409, statusMessage: '该记录仍被其它数据引用（外键约束），请先解除引用再撤销' })
  }
  if (code === '23505') {
    throw createError({ statusCode: 409, statusMessage: '已存在相同主键/唯一键的记录，无法撤销（请手动处理）' })
  }
  throw createError({ statusCode: 500, statusMessage: `撤销失败：${e?.message || e}` })
}

export async function revertOperation(event: any, log: any): Promise<{ ok: true; message: string }> {
  const entityType: string = log.entity_type
  const action: string = log.action
  const entityId: string = String(log.entity_id)
  const logId = Number(log.id)

  if (action === 'revert') throw createError({ statusCode: 400, statusMessage: '撤销操作不可再撤销' })

  // 批量操作（Excel 整表导入等）没有「一行数据」可以回退，entity_id 存的是批次标记。
  // 覆盖导入会先清空整表，恢复它等于恢复一整张表 —— 必须人工介入，不能给一键回退。
  if (entityId === BATCH_ENTITY_ID) {
    throw createError({
      statusCode: 409,
      statusMessage: '这是批量导入的汇总记录，没有单行快照，无法一键撤销。请用「数据维护 → 导入」重新导入正确版本的文件。'
    })
  }

  const conf = getTableConf(entityType)
  const table = conf ? entityType : DEVICE_TABLE_OF[entityType]
  if (!table) throw createError({ statusCode: 400, statusMessage: `不支持的实体类型：${entityType}` })
  const pk = conf?.pk || 'id'

  // 防重复撤销：检查是否已存在针对此日志的撤销记录
  const dup = (await db
    .prepare("SELECT id FROM operation_logs WHERE action = 'revert' AND entity_type = ? AND entity_id = ? AND remark LIKE ? LIMIT 1")
    .get(entityType, entityId, `撤销 #${logId} 的%`)) as any
  if (dup) throw createError({ statusCode: 409, statusMessage: '该操作已被撤销，请勿重复撤销' })

  const changes = parseChanges(log.changes)
  let summary = ''

  if (action === 'create') {
    // ── 反向：删除这条新建的记录 ──
    if (entityType === 'device') {
      const ref = (await db.prepare('SELECT COUNT(*) AS c FROM station_devices WHERE device_id = ?').get(entityId)) as any
      if (Number(ref.c) > 0) {
        throw createError({ statusCode: 409, statusMessage: `该设备已被 ${ref.c} 条站点-设备对照引用，请先解除引用再撤销` })
      }
    } else if (entityType === 'station') {
      const child = (await db.prepare('SELECT COUNT(*) AS c FROM stations WHERE parent_id = ?').get(entityId)) as any
      const link = (await db.prepare('SELECT COUNT(*) AS c FROM station_devices WHERE subsite_id = ?').get(entityId)) as any
      if (Number(child.c) > 0 || Number(link.c) > 0) {
        throw createError({ statusCode: 409, statusMessage: '该站点有子站或被站点-设备对照引用，无法删除' })
      }
    }
    try {
      const r = await db.prepare(`DELETE FROM "${table}" WHERE "${pk}" = ?`).run(entityId)
      if ((r.changes ?? 0) === 0) throw createError({ statusCode: 409, statusMessage: '该记录已不存在（可能已被删除），无需撤销' })
    } catch (e: any) {
      if (e?.statusCode) throw e
      pgErrorTo409(e)
    }
    summary = '已删除该新增记录'
  } else if (action === 'update') {
    // ── 反向：把业务字段还原成 old 值 ──
    const oldMap: Record<string, any> = {}
    for (const c of changes) {
      if (!c?.field || SKIP_FIELDS.has(c.field)) continue
      if (c.old === HEAVY_PLACEHOLDER) continue // 大字段没有真值，跳过而不是写坏它
      oldMap[c.field] = c.old
    }
    const cols = Object.keys(oldMap)
    if (cols.length === 0) throw createError({ statusCode: 400, statusMessage: '该记录无业务字段可撤销' })

    const hasUpdatedAt = await tableHasColumn(table, 'updated_at')
    const setters = cols.map((c) => `"${c}" = ?`).join(', ') + (hasUpdatedAt ? ', updated_at = now()' : '')
    const params = cols.map((c) => (oldMap[c] === undefined ? null : oldMap[c]))
    try {
      const r = await db.prepare(`UPDATE "${table}" SET ${setters} WHERE "${pk}" = ?`).run(...params, entityId)
      if ((r.changes ?? 0) === 0) throw createError({ statusCode: 409, statusMessage: '该记录已不存在（可能已被删除），无法还原字段' })
    } catch (e: any) {
      if (e?.statusCode) throw e
      pgErrorTo409(e)
    }
    summary = `已把 ${cols.length} 个字段还原为修改前的值`
  } else if (action === 'delete') {
    // ── 反向：用整行快照重新插入 ──
    const oldMap: Record<string, any> = {}
    for (const c of changes) {
      if (!c?.field || SKIP_FIELDS.has(c.field)) continue
      if (c.old === HEAVY_PLACEHOLDER) {
        throw createError({
          statusCode: 409,
          statusMessage: `该记录含大字段（${c.label || c.field}）未记入日志，快照不完整，无法还原。请手动重建。`
        })
      }
      oldMap[c.field] = c.old
    }
    const cols = Object.keys(oldMap)
    if (cols.length === 0) throw createError({ statusCode: 400, statusMessage: '该删除记录无快照可恢复' })

    const exists = await db.prepare(`SELECT 1 FROM "${table}" WHERE "${pk}" = ? LIMIT 1`).get(entityId)
    if (exists) throw createError({ statusCode: 409, statusMessage: '同主键的记录已存在，无法撤销删除（请手动处理）' })

    // 设备三表的额外前置校验（给出比外键报错更好懂的提示）
    if (entityType === 'device') {
      const d = (await db.prepare('SELECT id FROM devices WHERE name = ? AND category = ?').get(oldMap.name, oldMap.category)) as any
      if (d) throw createError({ statusCode: 409, statusMessage: '同名设备已存在，无法撤销删除（请手动新建）' })
    } else if (entityType === 'station') {
      if (oldMap.parent_id) {
        const p = (await db.prepare('SELECT id FROM stations WHERE id = ?').get(oldMap.parent_id)) as any
        if (!p) throw createError({ statusCode: 409, statusMessage: '原上级管理处已不存在，无法撤销删除' })
      }
    } else if (entityType === 'station_device') {
      const ref = (await db.prepare('SELECT id FROM stations WHERE id = ? AND level = 2').get(oldMap.subsite_id)) as any
      const dev = (await db.prepare('SELECT id FROM devices WHERE id = ?').get(oldMap.device_id)) as any
      if (!ref || !dev) throw createError({ statusCode: 409, statusMessage: '原子站或设备已不存在，无法撤销删除' })
    }

    const placeholders = cols.map(() => '?').join(', ')
    const params = cols.map((c) => (oldMap[c] === undefined ? null : oldMap[c]))
    try {
      await db
        .prepare(`INSERT INTO "${table}" ("${pk}", ${cols.map((c) => `"${c}"`).join(', ')}) VALUES (?, ${placeholders})`)
        .run(entityId, ...params)
    } catch (e: any) {
      pgErrorTo409(e)
    }
    // 自增主键：把序列推进到 >= 当前最大 id，避免后续自增撞主键
    if (conf?.pkAuto !== false) {
      try {
        await db
          .prepare(`SELECT setval(pg_get_serial_sequence(?, ?), GREATEST(COALESCE((SELECT max("${pk}") FROM "${table}"), 1), ?))`)
          .run(table, pk, Number(entityId) || 1)
      } catch {
        /* 非序列主键（如 standards 的文本 id），无需处理 */
      }
    }
    summary = '已按快照恢复该行'
  } else {
    throw createError({ statusCode: 400, statusMessage: `不支持撤销的动作：${action}` })
  }

  // 写撤销审计记录（不递归调用 logOperation，避免自己记自己）
  const u = await getAuthUser(event)
  let operatorName: string | null = null
  if (u) {
    const row = (await db.prepare('SELECT username FROM users WHERE id = ?').get(u.id)) as any
    operatorName = (row && row.username) || null
  }
  await db
    .prepare(
      "INSERT INTO operation_logs (module, entity_type, entity_id, action, operator_id, operator_name, changes, remark, created_at) VALUES (?, ?, ?, 'revert', ?, ?, ?, ?, now())"
    )
    .run(
      log.module || 'admin/devices',
      entityType,
      entityId,
      u ? u.id : null,
      operatorName,
      JSON.stringify(changes),
      `撤销 #${logId} 的${ACTION_LABELS[action] || action}操作`
    )

  return { ok: true, message: summary }
}

/** 表是否有某列（不同表审计字段不一致，如 standards 没有 updated_at） */
const colCache = new Map<string, string[]>()
async function tableHasColumn(table: string, col: string): Promise<boolean> {
  let cols = colCache.get(table)
  if (!cols) {
    try {
      cols = (await getColumns(table)).map((c) => c.name)
    } catch {
      cols = []
    }
    colCache.set(table, cols)
  }
  return cols.includes(col)
}
