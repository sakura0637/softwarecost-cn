import { reproduceOmArchive } from '../../../../utils/omSnapshot'

// 复现存档：用存档里的参数快照重算，验证能否得到同一个金额；再与当前参数对比给出差异。
// 语义是**只读**（不改任何数据），故在 permissions.ts 里显式登记为 om:view ——
// 否则按 METHOD_ACTION 的默认映射，POST 会被判成 om:create，普通用户直接 403。
export default defineEventHandler(async (event) => {
  const id = Number((event as any).context.params?.id)
  if (!id || Number.isNaN(id)) throw createError({ statusCode: 400, statusMessage: '无效的存档编号' })

  const res = await reproduceOmArchive(id)
  if (!res) throw createError({ statusCode: 404, statusMessage: '存档不存在' })
  return res
})
