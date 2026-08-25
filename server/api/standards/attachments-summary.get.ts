import db from '../../utils/db'

// 各标准附件计数（公开）。返回 { counts: { [standardId]: 附件数 } }，供前端「是否含附件」筛选。
export default defineEventHandler(() => {
  const rows = db
    .prepare('SELECT standard_id, COUNT(*) AS cnt FROM standard_attachments GROUP BY standard_id')
    .all() as { standard_id: string; cnt: number }[]
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.standard_id] = r.cnt
  return { counts }
})
