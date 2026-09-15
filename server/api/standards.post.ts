import db from '../utils/db'
import { requirePerm } from '../utils/auth'
import { createError, readBody } from 'h3'
import { logOperation } from '../utils/logOperation'

// 新增标准（需 standards:create 权限，系统管理员默认拥有）
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'standards:create')
  const b = await readBody(event)
  if (!b?.id || !b?.name) throw createError({ statusCode: 400, statusMessage: 'id 与 name 必填' })
  if (await db.prepare('SELECT 1 FROM standards WHERE id = ?').get(b.id)) {
    throw createError({ statusCode: 409, statusMessage: '该 id 已存在' })
  }
  await db.prepare(
    'INSERT INTO standards (id, category, name, code, region, level, org, summary, params, param_values) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(
    b.id, b.category || '', b.name, b.code || '', b.region || '', b.level || 'industry',
    b.org || '', b.summary || '', JSON.stringify(b.params || []), JSON.stringify(b.paramValues || {})
  )
  // 标准库决定计价档位与费率 —— 改了钱就会变，必须留痕。
  // params / param_values 是 JSON 大字段，写日志时会被自动替换成占位符（见 logOperation HEAVY_FIELDS），
  // 因此这类记录的「撤销删除」会被明确拦住（快照不完整），不会写坏 JSON 列。
  await logOperation({
    event,
    module: 'standards',
    entityType: 'standards',
    entityId: b.id,
    action: 'create',
    after: await db.prepare('SELECT * FROM standards WHERE id = ?').get(b.id),
    remark: '新增造价标准（/standards 页单条录入）'
  })
  return { ok: true }
})
