import db from '../../utils/db'
import { readBody, createError } from 'h3'
import { requirePerm } from '../../utils/auth'

// 新增站点/子站。parent_id 为空=新建管理处(level=1)；指定 parent=新建子站(level=2)。
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:edit')

  const body = await readBody(event)
  const name = String(body.name || '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: '站点名称为必填' })

  const parentId = body.parent_id === null || body.parent_id === '' || body.parent_id === undefined ? null : Number(body.parent_id)
  const level = parentId ? 2 : 1

  if (parentId) {
    const p = await db.prepare('SELECT id FROM stations WHERE id = ?').get(parentId)
    if (!p) throw createError({ statusCode: 400, statusMessage: '父站点不存在' })
  }

  try {
    const info = await db
      .prepare('INSERT INTO stations (parent_id, name, level, type, is_summary, sort_order, remark, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        parentId,
        name,
        level,
        String(body.type || '').trim() || null,
        body.is_summary ? true : false,
        Number(body.sort_order || 0),
        String(body.remark || '').trim() || null,
        'manual'
      )
    return { ok: true, id: Number(info.lastID) }
  } catch (e: any) {
    if (e?.code === '23505' || String(e?.message || '').includes('uq_station_name'))
      throw createError({ statusCode: 409, statusMessage: '同一父级下已存在同名站点' })
    throw e
  }
})
