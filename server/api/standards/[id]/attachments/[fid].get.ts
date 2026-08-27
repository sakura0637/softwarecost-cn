import db, { STANDARD_UPLOAD_DIR } from '../../../../utils/db'
import { createError, getQuery, getRouterParam, setResponseHeaders } from 'h3'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// 下载 / 预览标准附件（公开）。
// 默认 attachment（强制下载）；加 ?preview=1 时改为 inline，浏览器内联渲染（PDF/图片可直接预览）。
export default defineEventHandler(async (event) => {
  const fid = getRouterParam(event, 'fid')!
  const row = await db.prepare('SELECT * FROM standard_attachments WHERE id = ?').get(fid) as any
  if (!row) throw createError({ statusCode: 404, statusMessage: '文件不存在' })

  const filePath = join(STANDARD_UPLOAD_DIR, row.stored_name)
  const data = await readFile(filePath)

  const preview = getQuery(event).preview === '1'
  const disposition = preview
    ? `inline; filename="${encodeURIComponent(row.file_name)}"; filename*=UTF-8''${encodeURIComponent(row.file_name)}`
    : `attachment; filename="${encodeURIComponent(row.file_name)}"; filename*=UTF-8''${encodeURIComponent(row.file_name)}`

  setResponseHeaders(event, {
    'Content-Type': row.mime_type || 'application/octet-stream',
    'Content-Disposition': disposition,
    'Content-Length': String(data.length),
    'Cache-Control': 'no-store',
  })
  return data
})
