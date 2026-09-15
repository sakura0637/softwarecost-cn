import db, { STANDARD_UPLOAD_DIR } from '../../../utils/db'
import { getUserId } from '../../../utils/auth'
import { createError, getRouterParam, readMultipartFormData } from 'h3'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { logOperation } from '../../../utils/logOperation'

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

  // 附件是「记日志但不提供撤销」的实体：磁盘文件已落地，快照只有元数据，删了无法还原。
  // 审计页据此不渲染撤销按钮（见 config/audit.ts NON_REVERTIBLE_ENTITIES）。
  await logOperation({
    event,
    module: 'standards',
    entityType: 'standard_attachments',
    entityId: info.lastID,
    action: 'create',
    changes: [
      { field: '文件名', label: '文件名', new: original },
      { field: '所属标准', label: '所属标准', new: standardId },
      { field: '大小', label: '大小', new: `${(file.data.length / 1024).toFixed(1)} KB` }
    ],
    remark: '上传标准附件'
  })

  return { ok: true, id: info.lastID }
})
