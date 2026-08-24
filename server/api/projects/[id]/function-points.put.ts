import db from '../../../utils/db'
import { getUserId } from '../../../utils/auth'
import { computeUFP } from '../../../utils/pricing'
import { readBody, createError } from 'h3'

export default defineEventHandler(async (event) => {
  const userId = await getUserId(event)
  if (!userId) throw createError({ statusCode: 401, statusMessage: '未登录' })

  const id = Number(event.context.params!.id)
  const project = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(id, userId)
  if (!project) throw createError({ statusCode: 404, statusMessage: '项目不存在' })

  const body = await readBody(event)
  const fps = Array.isArray(body.functionPoints) ? body.functionPoints : []

  db.prepare('DELETE FROM function_points WHERE project_id = ?').run(id)
  const ins = db.prepare(
    'INSERT INTO function_points (project_id, seq, name, type, complexity, ret, det, ufp, note, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const tx = db.transaction((list: any[]) => {
    list.forEach((fp, i) => {
      const type = String(fp.type || '').toUpperCase()
      const complexity = ['低', '中', '高'].includes(fp.complexity) ? fp.complexity : '中'
      const ufp = computeUFP(type, complexity)
      ins.run(
        id,
        i + 1,
        String(fp.name || '未命名功能项').slice(0, 255),
        type,
        complexity,
        Number(fp.ret) || 0,
        Number(fp.det) || 0,
        ufp,
        String(fp.note || '').slice(0, 1000),
        fp.source === 'manual' ? 'manual' : 'ai'
      )
    })
  })
  tx(fps)

  db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(id)
  return {
    ok: true,
    functionPoints: db
      .prepare('SELECT * FROM function_points WHERE project_id = ? ORDER BY seq')
      .all(id)
  }
})
