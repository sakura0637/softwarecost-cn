import { requirePerm } from '../../../../utils/auth'
import { loadOperationLog, revertOperation } from '../../../../utils/revertOperation'
import { REVERT_PERM_BY_MODULE, REVERT_PERM_FALLBACK } from '../../../../config/audit'

// 撤销一条操作记录（全局审计入口）。
// ⚠️ 权限按**被撤销记录所属模块**动态判定，而不是一律要求某一个权限码：
//   设备三表的记录要 devices:edit、参数表要 data:edit …… 否则「谁都不能改的东西」
//   就变成「有审计页查看权的人都能回退」，等于把最危险的写操作留在最弱的门槛后面。
export default defineEventHandler(async (event) => {
  const id = Number(event.context.params!.id)
  const log = await loadOperationLog(id)
  await requirePerm(event, REVERT_PERM_BY_MODULE[log.module] || REVERT_PERM_FALLBACK)
  return revertOperation(event, log)
})
