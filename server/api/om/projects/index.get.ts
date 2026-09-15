import db from '../../../utils/db'
import { getQuery } from 'h3'

// 测算存档列表（不含快照本体，列表只需要摘要）。
// ⚠️ 刻意不 SELECT params_snapshot / items_snapshot / result_json：
//    一个 8452 行的存档三样加起来有数 MB，若列表一并带出，页面一打开就卡死。
const ENGINE_LABELS: Record<string, string> = { c1: 'C.1 工作量法', quota: '定额单价法' }

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const page = Math.max(1, Number(q.page) || 1)
  const pageSize = Math.min(100, Math.max(5, Number(q.page_size) || 20))

  const total = Number(((await db.prepare('SELECT COUNT(*) AS c FROM om_projects').get()) as any)?.c ?? 0)
  const rows = (await db
    .prepare(
      `SELECT id, name, engine, year, remark, source_label, site_label,
              item_count, unresolved_count, total_amount, operator_name, wage_base_id,
              (params_snapshot IS NOT NULL AND items_snapshot IS NOT NULL) AS has_snapshot,
              to_char(created_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS') AS created_at
       FROM om_projects
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(pageSize, (page - 1) * pageSize)) as any[]

  return {
    total,
    page,
    pageSize,
    items: rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      engine: r.engine,
      engineLabel: ENGINE_LABELS[r.engine] || r.engine,
      year: r.year,
      remark: r.remark,
      sourceLabel: r.source_label,
      siteLabel: r.site_label,
      itemCount: r.item_count == null ? null : Number(r.item_count),
      unresolvedCount: r.unresolved_count == null ? null : Number(r.unresolved_count),
      totalAmount: r.total_amount == null ? null : Number(r.total_amount),
      operatorName: r.operator_name,
      wageBaseId: r.wage_base_id == null ? null : Number(r.wage_base_id),
      hasSnapshot: !!r.has_snapshot,
      createdAt: r.created_at,
    })),
  }
})
