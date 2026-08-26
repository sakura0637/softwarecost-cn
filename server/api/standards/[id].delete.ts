import db, { STANDARD_UPLOAD_DIR } from '../../utils/db'
import { getUserId } from '../../utils/auth'
import { createError, getRouterParam } from 'h3'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

// 删除标准（仅管理员）。级联删除其附件元数据与实际文件
export default defineEventHandler(async (event) => {
  const u = await getAuthUser(event)
  if (!u) throw createError({ statusCode: 401, statusMessage: '请先登录' })
  if (u.role !== 'admin') throw createError({ statusCode: 403, statusMessage: '仅管理员可管理标准' })
  const id = getRouterParam(event, 'id')!
  if (!db.prepare('SELECT 1 FROM standards WHERE id = ?').get(id)) {
    throw createError({ statusCode: 404, statusMessage: '标准不存在' })
  }
  const atts = db.prepare('SELECT stored_name FROM standard_attachments WHERE standard_id = ?').all(id) as { stored_name: string }[]
  for (const a of atts) {
    try {
      await unlink(join(STANDARD_UPLOAD_DIR, a.stored_name))
    } catch {
      /* 文件已不存在，忽略 */
    }
  }
  db.prepare('DELETE FROM standard_attachments WHERE standard_id = ?').run(id)
  db.prepare('DELETE FROM standards WHERE id = ?').run(id)
  return { ok: true }
})
