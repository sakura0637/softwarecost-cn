import db from '../../../utils/db'
import { readBody, createError } from 'h3'
import { requirePerm } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:edit')

  const id = Number(event.context.params!.id)
  if (!id || isNaN(id)) throw createError({ statusCode: 400, statusMessage: '无效 ID' })

  const body = await readBody(event)
  const name = String(body.name || '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: '站点名称为必填' })

  const parentId = body.parent_id === null || body.parent_id === '' || body.parent_id === undefined ? null : Number(body.parent_id)
  const level = parentId ? 2 : 1

  if (parentId) {
    if (parentId === id) throw createError({ statusCode: 400, statusMessage: '父站点不能指向自身' })
    const p = await db.prepare('SELECT id FROM stations WHERE id = ? AND id <> ?').get(parentId, id)
    if (!p) throw createError({ statusCode: 400, statusMessage: '父站点不存在' })
  }

  try {
    await db
      .prepare('UPDATE stations SET parent_id = ?, name = ?, level = ?, type = ?, is_summary = ?, sort_order = ?, remark = ?, source = ? WHERE id = ?')
      .run(
        parentId,
        name,
        level,
        String(body.type || '').trim() || null,
        body.is_summary ? true : false,
        Number(body.sort_order || 0),
        String(body.remark || '').trim() || null,
        'manual',
        id
      )
    return { ok: true }
  } catch (e: any) {
    if (e?.code === '23505' || String(e?.message || '').includes('uq_station_name'))
      throw createError({ statusCode: 409, statusMessage: '同一父级下已存在同名站点' })
    throw e
  }
})
