import db, { STANDARD_UPLOAD_DIR } from '../../utils/db'
import { requirePerm } from '../../utils/auth'
import { createError, getRouterParam } from 'h3'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { logOperation } from '../../utils/logOperation'

// 删除标准（需 standards:delete 权限）。级联删除其附件元数据与实际文件
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'standards:delete')
  const id = getRouterParam(event, 'id')!
  if (!(await db.prepare('SELECT 1 FROM standards WHERE id = ?').get(id))) {
    throw createError({ statusCode: 404, statusMessage: '标准不存在' })
  }
  const before = await db.prepare('SELECT * FROM standards WHERE id = ?').get(id)
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
  // 注意：整行快照里 params / param_values 是占位符，所以这条记录的「撤销删除」会被拦住，
  // 提示人工重建（见 utils/revertOperation.ts）—— 有附件文件的标准本来就无法自动还原。
  await logOperation({
    event,
    module: 'standards',
    entityType: 'standards',
    entityId: id,
    action: 'delete',
    before,
    remark: `删除造价标准（级联删除 ${atts.length} 个附件）`
  })
  return { ok: true }
})
