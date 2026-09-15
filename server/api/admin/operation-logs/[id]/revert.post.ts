import { requirePerm } from '../../../../utils/auth'
import { loadOperationLog, revertOperation } from '../../../../utils/revertOperation'

// 撤销一条操作记录（设备模块入口，权限口径保持 devices:edit 不变，避免影响既有设备页）。
// 参数表的撤销走 /api/admin/logs/:id/revert（admin-logs:edit）。
// 反向还原的具体逻辑在 utils/revertOperation.ts，两个入口共用同一实现。
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:edit')
  const id = Number(event.context.params!.id)
  const log = await loadOperationLog(id)
  return revertOperation(event, log)
})
