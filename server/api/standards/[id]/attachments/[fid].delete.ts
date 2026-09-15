import db, { STANDARD_UPLOAD_DIR } from '../../../../utils/db'
import { getUserId } from '../../../../utils/auth'
import { createError, getRouterParam } from 'h3'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { logOperation } from '../../../../utils/logOperation'

// 删除标准附件（需登录）：删磁盘文件 + 删库记录，二者任一缺失都不阻断对方
export default defineEventHandler(async (event) => {
  const userId = await getUserId(event)
  if (!userId) throw createError({ statusCode: 401, statusMessage: '请先登录' })

  const fid = getRouterParam(event, 'fid')!
  const row = await db.prepare('SELECT * FROM standard_attachments WHERE id = ?').get(fid) as any
  if (!row) throw createError({ statusCode: 404, statusMessage: '文件不存在' })

  try {
    await unlink(join(STANDARD_UPLOAD_DIR, row.stored_name))
  } catch {
    // 磁盘文件已不存在也可继续删除数据库记录
  }
  await db.prepare('DELETE FROM standard_attachments WHERE id = ?').run(fid)

  // 不可撤销：磁盘文件已删，快照只有元数据（见 config/audit.ts NON_REVERTIBLE_ENTITIES）
  await logOperation({
    event,
    module: 'standards',
    entityType: 'standard_attachments',
    entityId: fid,
    action: 'delete',
    changes: [
      { field: '文件名', label: '文件名', old: row.file_name },
      { field: '所属标准', label: '所属标准', old: row.standard_id },
      { field: '大小', label: '大小', old: row.file_size != null ? `${(Number(row.file_size) / 1024).toFixed(1)} KB` : '—' }
    ],
    remark: '删除标准附件（磁盘文件一并删除，不可恢复）'
  })

  return { ok: true }
})
