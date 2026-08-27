import db, { STANDARD_UPLOAD_DIR } from '../../../utils/db'
import { getUserId } from '../../../utils/auth'
import { createError, getRouterParam, readMultipartFormData } from 'h3'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// 上传标准附件（需登录）。文件落盘到 data/uploads/standards/，元数据入 standard_attachments 表。
export default defineEventHandler(async (event) => {
  const userId = await getUserId(event)
  if (!userId) throw createError({ statusCode: 401, statusMessage: '请先登录' })

  const standardId = getRouterParam(event, 'id')!
  const parts = await readMultipartFormData(event)
  const file = parts?.find((p) => p.name === 'file')
  if (!file || !file.data || !file.filename) {
    throw createError({ statusCode: 400, statusMessage: '缺少文件' })
  }

  // 安全文件名：保留原始扩展名，主体用时间戳+随机串，杜绝路径穿越与重名覆盖
  const original = file.filename
  const ext = (original.split('.').pop() || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)
  const safeBase = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const storedName = ext ? `${safeBase}.${ext}` : safeBase

  await writeFile(join(STANDARD_UPLOAD_DIR, storedName), file.data)

  const info = await db
    .prepare(
      'INSERT INTO standard_attachments (standard_id, file_name, stored_name, file_size, mime_type) VALUES (?, ?, ?, ?, ?)'
    )
    .run(standardId, original, storedName, file.data.length, file.type || 'application/octet-stream')

  return { ok: true, id: info.lastID }
})
