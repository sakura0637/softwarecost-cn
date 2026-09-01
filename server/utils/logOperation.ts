import db from './db'
import { getAuthUser } from './auth'

// 操作记录：审计站点/设备/站点-设备对照的 create/update/delete。
// - update：只记录真正发生变化的字段（old / new）
// - create / delete：记录整行快照（一边为 undefined）
// changes 统一为 [{ field, label, old, new }]，前端逐行渲染。

type EntityType = 'station' | 'device' | 'station_device'
type Action = 'create' | 'update' | 'delete'

const FIELD_LABELS: Record<EntityType, Record<string, string>> = {
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

function normalize(v: any): any {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v === 'boolean') return v
  if (typeof v === 'object') return JSON.parse(JSON.stringify(v))
  return v
}

export async function logOperation(opts: {
  event: any
  entityType: EntityType
  entityId: number
  action: Action
  before?: any   // 变更前整行（update / delete 时提供）
  after?: any    // 变更后整行（create / update 时提供）
  remark?: string
}): Promise<void> {
  let operatorId: number | null = null
  let operatorName: string | null = null
  const u = await getAuthUser(opts.event)
  if (u) {
    operatorId = u.id
    try {
      const row = await db.prepare('SELECT username FROM users WHERE id = ?').get(u.id)
      operatorName = (row && (row as any).username) || null
    } catch { /* 取不到用户名不阻断主流程 */ }
  }

  const labels = FIELD_LABELS[opts.entityType] || {}
  let changes: any[] = []

  if (opts.action === 'update' && opts.before && opts.after) {
    const keys = new Set([...Object.keys(opts.before), ...Object.keys(opts.after)])
    for (const k of keys) {
      const oldV = normalize(opts.before[k])
      const newV = normalize(opts.after[k])
      if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
        changes.push({ field: k, label: labels[k] || k, old: oldV, new: newV })
      }
    }
  } else {
    // create / delete：整行快照
    const row = opts.action === 'create' ? opts.after : opts.before
    if (row) {
      for (const k of Object.keys(row)) {
        const val = normalize(row[k])
        changes.push({
          field: k,
          label: labels[k] || k,
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
        'admin/devices',
        opts.entityType,
        opts.entityId,
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
