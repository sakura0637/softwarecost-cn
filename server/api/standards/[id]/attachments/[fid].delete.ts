import db, { STANDARD_UPLOAD_DIR } from '../../../../utils/db'
import { getUserId } from '../../../../utils/auth'
import { createError, getRouterParam } from 'h3'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

// 删除标准附件（需登录）：删磁盘文件 + 删库记录，二者任一缺失都不阻断对方
export default defineEventHandler(async (event) => {
  const userId = await getUserId(event)
  if (!userId) throw createError({ statusCode: 401, statusMessage: '请先登录' })

  const fid = getRouterParam(event, 'fid')!
  const row = db.prepare('SELECT * FROM standard_attachments WHERE id = ?').get(fid) as any
  if (!row) throw createError({ statusCode: 404, statusMessage: '文件不存在' })

  try {
    await unlink(join(STANDARD_UPLOAD_DIR, row.stored_name))
  } catch {
    // 磁盘文件已不存在也可继续删除数据库记录
  }
  db.prepare('DELETE FROM standard_attachments WHERE id = ?').run(fid)
  return { ok: true }
})
