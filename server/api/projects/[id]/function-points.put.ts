import db from '../../../utils/db'
import { getAuthUser } from '../../../utils/auth'
import { computeUFP } from '../../../utils/pricing'
import { readBody, createError } from 'h3'

// 功能点/模块保存（全量覆盖）
// 四层模块：level 1~3 为模块层级（不起 UFP，由子节点汇总），level 4 为功能点（按类型/复杂度计算 UFP）
//
// 父子关系用前端的稳定 key 传递（_key / parentKey），而不是数据库 id ——
// 因为本接口是「先全删再重插」，id 每次都会变，直接用 id 会导致层级关系错乱。
export default defineEventHandler(async (event) => {
  const user = await getAuthUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: '未登录' })

  const id = Number(event.context.params!.id)
  const project =
    user.role === 'admin'
      ? await db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
      : await db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, user.id)
  if (!project) throw createError({ statusCode: 404, statusMessage: '项目不存在' })

  const body = await readBody(event)
  const fps = Array.isArray(body.functionPoints) ? body.functionPoints : []

  await db.prepare('DELETE FROM function_points WHERE project_id = ?').run(id)

  const keyToId = new Map<string, number>()
  await db.transaction(async () => {
    // 第一遍：按序插入，记录 前端 _key → 新 id
    for (let i = 0; i < fps.length; i++) {
      const fp = fps[i] || {}
      const level = [1, 2, 3, 4].includes(Number(fp.level)) ? Number(fp.level) : 4
      const isLeaf = level === 4
      const type = isLeaf ? String(fp.type || '').toUpperCase() : ''
      const complexity = ['低', '中', '高'].includes(fp.complexity) ? fp.complexity : '中'
      // 模块层级不计自身 UFP；功能点层按 IFPUG/NESMA 权重计算
      const ufp = isLeaf ? computeUFP(type, complexity) : 0

      const r = await db
        .prepare(
          `INSERT INTO function_points
             (project_id, seq, name, type, complexity, ret, det, ufp, note, source, level)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          i + 1,
          String(fp.name || '未命名').slice(0, 255),
          type,
          complexity,
          Number(fp.ret) || 0,
          Number(fp.det) || 0,
          ufp,
          String(fp.note || '').slice(0, 1000),
          fp.source === 'manual' ? 'manual' : 'ai',
          level
        )
      if (fp._key != null) keyToId.set(String(fp._key), r.lastID)
    }

    // 第二遍：回填 parent_id
    for (const fp of fps) {
      if (!fp || fp._key == null || !fp.parentKey) continue
      const childId = keyToId.get(String(fp._key))
      const parentId = keyToId.get(String(fp.parentKey))
      if (childId && parentId && childId !== parentId) {
        await db.prepare('UPDATE function_points SET parent_id = ? WHERE id = ?').run(parentId, childId)
      }
    }
  })

  await db.prepare('UPDATE projects SET updated_at = now() WHERE id = ?').run(id)
  return {
    ok: true,
    functionPoints: await db
      .prepare('SELECT * FROM function_points WHERE project_id = ? ORDER BY seq')
      .all(id),
  }
})
