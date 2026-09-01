import db from '../../../utils/db'
import { readBody, createError } from 'h3'
import { requirePerm } from '../../../utils/auth'
import { logOperation } from '../../../utils/logOperation'

// 编辑设备主数据。改单价后合价自动随 数量×单价 变化（不落地）；
// 返回 affected = 被多少条站点对照引用（前端提示“改价将影响 N 个子站合价”）。
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:edit')

  const id = Number(event.context.params!.id)
  if (!id || isNaN(id)) throw createError({ statusCode: 400, statusMessage: '无效 ID' })

  const body = await readBody(event)
  const name = String(body.name || '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: '设备名称为必填' })

  const before = await db.prepare('SELECT * FROM devices WHERE id = ?').get(id)
  if (!before) throw createError({ statusCode: 404, statusMessage: '设备不存在' })

  await db
    .prepare('UPDATE devices SET category = ?, subcategory = ?, name = ?, brand_model = ?, unit = ?, unit_price = ?, remark = ?, source = ? WHERE id = ?')
    .run(
      String(body.category || '').trim() || null,
      String(body.subcategory || '').trim() || null,
      name,
      String(body.brand_model || '').trim() || null,
      String(body.unit || '').trim() || null,
      body.unit_price === '' || body.unit_price === null || body.unit_price === undefined ? null : Number(body.unit_price),
      String(body.remark || '').trim() || null,
      'manual',
      id
    )

  const after = await db.prepare('SELECT * FROM devices WHERE id = ?').get(id)
  await logOperation({ event, entityType: 'device', entityId: id, action: 'update', before, after })
  const affected = Number((await db.prepare('SELECT COUNT(*) AS c FROM station_devices WHERE device_id = ?').get(id) as { c: any }).c)
  return { ok: true, affected }
})
