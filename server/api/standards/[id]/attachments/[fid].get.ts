import db, { STANDARD_UPLOAD_DIR } from '../../../../utils/db'
import { createError, getRouterParam, setResponseHeaders } from 'h3'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// 下载标准附件（公开）。按 id 取 stored_name 落盘文件，原文件名作下载名。
export default defineEventHandler(async (event) => {
  const fid = getRouterParam(event, 'fid')!
  const row = db.prepare('SELECT * FROM standard_attachments WHERE id = ?').get(fid) as any
  if (!row) throw createError({ statusCode: 404, statusMessage: '文件不存在' })

  const filePath = join(STANDARD_UPLOAD_DIR, row.stored_name)
  const data = await readFile(filePath)

  setResponseHeaders(event, {
    'Content-Type': row.mime_type || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(row.file_name)}"; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
    'Content-Length': String(data.length),
    'Cache-Control': 'no-store',
  })
  return data
})
