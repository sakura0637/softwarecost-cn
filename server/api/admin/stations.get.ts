import db from '../../utils/db'
import { requirePerm } from '../../utils/auth'

// 站点/子站列表（自关联单表）。返回扁平结构，前端按 parent_id 构建层级树。
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:view')

  const rows = await db
    .prepare(
      `SELECT s.id, s.parent_id, s.name, s.level, s.type, s.is_summary, s.sort_order, s.remark, s.source,
              p.name AS parent_name,
              (SELECT COUNT(*) FROM stations c WHERE c.parent_id = s.id) AS child_count,
              (SELECT COUNT(*) FROM station_devices l WHERE l.subsite_id = s.id) AS link_count
       FROM stations s
       LEFT JOIN stations p ON p.id = s.parent_id
       ORDER BY s.level, s.sort_order, s.id`
    )
    .all()

  return { items: rows }
})
