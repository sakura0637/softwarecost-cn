// 数据维护：注册表元信息（前端左树 + 编辑表单用）。GET → data:view
import { registry } from '../../../utils/adminData'

export default defineEventHandler(async () => {
  return registry()
})
