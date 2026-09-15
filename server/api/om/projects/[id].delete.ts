import db from '../../../utils/db'
import { logOperation } from '../../../utils/logOperation'

// 删除测算存档（连带快照）。存档是历史凭证，删掉不可恢复，故权限要求 om:delete。
// 留痕只记「名称 + 行数 + 金额」，**不记快照本身** —— 那几 MB 的 JSON 若写进日志表会把审计页拖垮
// （logOperation 对 result_json / params_snapshot 这类大字段本来也只写占位符）。
export default defineEventHandler(async (event) => {
  const id = Number((event as any).context.params?.id)
  if (!id || Number.isNaN(id)) throw createError({ statusCode: 400, statusMessage: '无效的存档编号' })

  const before = await db.prepare('SELECT id, name, engine, item_count, total_amount FROM om_projects WHERE id = ?').get(id)
  if (!before) throw createError({ statusCode: 404, statusMessage: '存档不存在' })

  const r = await db.prepare('DELETE FROM om_projects WHERE id = ?').run(id)
  if (!r.changes) throw createError({ statusCode: 404, statusMessage: '存档不存在' })

  const b = before as any
  await logOperation({
    event,
    module: 'om',
    entityType: 'om_projects',
    entityId: id,
    action: 'delete',
    changes: [
      { field: '存档名称', label: '存档名称', old: b.name },
      { field: '计价方式', label: '计价方式', old: b.engine === 'quota' ? '定额单价法' : 'C.1 工作量法' },
      { field: '清单行数', label: '清单行数', old: b.item_count != null ? `${b.item_count} 行` : '—' },
      { field: '测算金额', label: '测算金额', old: b.total_amount != null ? `${Number(b.total_amount).toFixed(2)} 元` : '—' }
    ],
    remark: '删除运维测算存档（含参数快照，不可恢复）'
  })

  return { ok: true }
})
