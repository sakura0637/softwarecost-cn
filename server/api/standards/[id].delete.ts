import db, { STANDARD_UPLOAD_DIR } from '../../utils/db'
import { requirePerm } from '../../utils/auth'
import { createError, getRouterParam } from 'h3'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

// 删除标准（需 standards:delete 权限）。级联删除其附件元数据与实际文件
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'standards:delete')
  const id = getRouterParam(event, 'id')!
  if (!(await db.prepare('SELECT 1 FROM standards WHERE id = ?').get(id))) {
    throw createError({ statusCode: 404, statusMessage: '标准不存在' })
  }
  const atts = await db.prepare('SELECT stored_name FROM standard_attachments WHERE standard_id = ?').all(id) as { stored_name: string }[]
  for (const a of atts) {
    try {
      await unlink(join(STANDARD_UPLOAD_DIR, a.stored_name))
    } catch {
      /* 文件已不存在，忽略 */
    }
  }
  await db.prepare('DELETE FROM standard_attachments WHERE standard_id = ?').run(id)
  await db.prepare('DELETE FROM standards WHERE id = ?').run(id)
  return { ok: true }
})
