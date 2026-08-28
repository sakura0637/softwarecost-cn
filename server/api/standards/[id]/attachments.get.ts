import db from '../../../utils/db'
import { getRouterParam } from 'h3'

// 列出某标准的全部附件（公开）
export default defineEventHandler(async (event) => {
  const standardId = getRouterParam(event, 'id')!
  const items = await db
    .prepare(
      'SELECT id, file_name, file_size, mime_type, uploaded_at FROM standard_attachments WHERE standard_id = ? ORDER BY uploaded_at DESC'
    )
    .all(standardId)
  return { items }
})
