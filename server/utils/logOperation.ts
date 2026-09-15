import db from './db'
import { getAuthUser } from './auth'
import { getTableConf, labelFor } from '../config/dataTables'
import { DEFAULT_OPERATION_MODULE, HEAVY_PLACEHOLDER } from '../config/audit'

// 操作审计：记录 create / update / delete 三类写操作。
//
// 【2026-09-15 泛化】原实现只服务设备三表，module 写死 'admin/devices'、标签写死一张小表。
// 现在参数表（数据维护的 15 张表）也走同一条链路 —— 「谁在什么时候把工资基数从 A 改成 B」
// 必须留痕，否则测算金额变了却没人知道原因，这是对账时最说不清的一类问题。
//
// 标签从 `dataTables.ts` 的 labelFor 取（唯一事实源），不再另抄一份中文标签表。
// - update：只记录**真正变了**的字段（old / new）
// - create / delete：记录整行快照（一边为 undefined）
// changes 统一为 [{ field, label, old, new, truncated? }]，前端逐行渲染。

export type LogAction = 'create' | 'update' | 'delete'

/** 设备三表的列中文名（它们不在 dataTables 注册表里，标签单独维护） */
const ENTITY_FIELD_LABELS: Record<string, Record<string, string>> = {
  device: {
    category: '分类', subcategory: '子分类', name: '设备名称',
    brand_model: '品牌型号', unit: '单位', unit_price: '单价', remark: '备注'
  },
  station: {
    name: '站点名称', type: '类型', is_summary: '是否汇总',
    sort_order: '排序', remark: '备注', parent_id: '上级站点'
  },
  station_device: {
    subsite_id: '子站', device_id: '设备', qty: '数量', remark: '备注'
  }
}

/** 数值型大字段：整行快照时直接跳过，只留一个占位说明 */
const HEAVY_FIELDS = new Set(['result_json', 'params_snapshot', 'items_snapshot', 'values', 'params', 'param_values'])
const MAX_TEXT = 2000

/**
 * 单值规整。
 * ⚠️ 必须截断超长文本 —— 存档表的快照列有数 MB，若原样写进 operation_logs，
 *    一次编辑就能把审计表撑爆，之后查日志会慢到不可用。
 */
function normalize(v: any): any {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v === 'boolean' || typeof v === 'number') return v
  if (typeof v === 'string') {
    return v.length > MAX_TEXT ? v.slice(0, MAX_TEXT) + `…（已截断，原长 ${v.length} 字）` : v
  }
  if (typeof v === 'object') {
    const s = JSON.stringify(v)
    return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + `…（已截断，原长 ${s.length} 字）` : v
  }
  return v
}

function fieldValue(row: any, k: string): any {
  if (HEAVY_FIELDS.has(k)) return HEAVY_PLACEHOLDER
  return normalize(row[k])
}

/** 实体类型 → 中文名。数据维护的表直接用表配置里的 label。 */
export function entityTypeLabel(t: string): string {
  const special: Record<string, string> = { station: '站点', device: '设备', station_device: '站点-设备对照' }
  if (special[t]) return special[t]
  const conf = getTableConf(t)
  return conf ? conf.label : t
}

function colLabel(entityType: string, col: string): string {
  const special = ENTITY_FIELD_LABELS[entityType]?.[col]
  if (special) return special
  if (getTableConf(entityType)) return labelFor(entityType, col)
  return col
}

/**
 * 取当前操作者用户名（登录用户）。取不到返回 null。
 * 供审计记录与导出页脚共用 —— 两处口径必须一致，否则「谁改的」和「谁导的」可能对不上。
 */
export async function currentOperatorName(event: any): Promise<string | null> {
  const u = await getAuthUser(event)
  if (!u) return null
  try {
    const row = await db.prepare('SELECT username FROM users WHERE id = ?').get(u.id)
    return (row && (row as any).username) || null
  } catch {
    return null
  }
}

export async function logOperation(opts: {
  event: any
  /** 归属模块，用于审计页按模块筛选，如 'admin/devices' / 'admin/data' / 'om' */
  module?: string
  entityType: string
  /** 主键值。⚠️ 允许字符串 —— standards 表主键是文本，强转数字会变 NaN 导致日志静默丢失 */
  entityId: string | number
  action: LogAction
  /** 变更前整行（update / delete 时提供） */
  before?: any
  /** 变更后整行（create / update 时提供） */
  after?: any
  /**
   * 直接给定变更明细，跳过 before/after 自动比对。
   * 用于「一次操作改变多行」的场景 —— 例如 Excel 批量导入：逐行写日志会刷出上千条，
   * 这里只留一条批次记录，把关键结论写进 changes。
   */
  changes?: Array<{ field: string; label?: string; old?: any; new?: any }>
  remark?: string
}): Promise<void> {
  const u = await getAuthUser(opts.event)
  const operatorId = u ? u.id : null
  const operatorName = await currentOperatorName(opts.event)

  let changes: any[] = []

  if (opts.changes) {
    changes = opts.changes.map((c) => ({
      field: c.field,
      label: c.label || c.field,
      old: normalize(c.old),
      new: normalize(c.new)
    }))
    if (changes.length === 0) return
  } else if (opts.action === 'update' && opts.before && opts.after) {
    const keys = new Set([...Object.keys(opts.before), ...Object.keys(opts.after)])
    for (const k of keys) {
      const oldV = fieldValue(opts.before, k)
      const newV = fieldValue(opts.after, k)
      if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
        changes.push({ field: k, label: colLabel(opts.entityType, k), old: oldV, new: newV })
      }
    }
    // 没有任何业务字段变化就不落库，避免「点开又保存」刷出一堆空记录
    if (changes.length === 0) return
  } else {
    // create / delete：整行快照
    const row = opts.action === 'create' ? opts.after : opts.before
    if (row) {
      for (const k of Object.keys(row)) {
        const val = fieldValue(row, k)
        changes.push({
          field: k,
          label: colLabel(opts.entityType, k),
          old: opts.action === 'create' ? undefined : val,
          new: opts.action === 'create' ? val : undefined
        })
      }
    }
  }

  try {
    await db
      .prepare("INSERT INTO operation_logs (module, entity_type, entity_id, action, operator_id, operator_name, changes, remark, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, now())")
      .run(
        opts.module || DEFAULT_OPERATION_MODULE,
        opts.entityType,
        String(opts.entityId),
        opts.action,
        operatorId,
        operatorName,
        JSON.stringify(changes),
        opts.remark ?? null
      )
  } catch (e) {
    // 写日志失败绝不能阻断业务写操作
    console.error('[operation_logs] 写入失败（已忽略）:', e)
  }
}
