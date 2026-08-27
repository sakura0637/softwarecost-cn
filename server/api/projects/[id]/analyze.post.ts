import db from '../../../utils/db'
import { getUserId } from '../../../utils/auth'
import { computeUFP } from '../../../utils/pricing'
import { createError } from 'h3'

function cleanJSON(text: string): any {
  let s = (text || '').trim()
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const obj = JSON.parse(s)
  return obj.functionPoints || obj.function_points || obj.data || []
}

export default defineEventHandler(async (event) => {
  const userId = await getUserId(event)
  if (!userId) throw createError({ statusCode: 401, statusMessage: '未登录' })

  const id = Number(event.context.params!.id)
  const project = await db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(id, userId)
  if (!project) throw createError({ statusCode: 404, statusMessage: '项目不存在' })

  const rawText = project.raw_text || ''
  if (!rawText || rawText.length < 10) {
    throw createError({ statusCode: 400, statusMessage: '请先上传需求文档或粘贴需求文本' })
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: '后端未配置 DEEPSEEK_API_KEY，请在环境变量中设置后重启'
    })
  }

  const prompt = `你是一名资深软件造价工程师，精通 IFPUG/NESMA 功能点分析法。
请根据以下软件需求描述，识别所有功能点，并严格只输出一个 JSON 对象（不要任何解释、不要 markdown 代码块）：
{
  "functionPoints": [
    {"name":"功能项名称","type":"ILF|EIF|EI|EO|EQ","complexity":"低|中|高","ret":<整数>,"det":<整数>,"note":"简要说明"}
  ]
}
要求：
1. type 必须是 ILF、EIF、EI、EO、EQ 之一
2. 若是 ILF/EIF，ret 为记录元素类型(RET)数、det 为数据元素类型(DET)数；若是 EI/EO/EQ，det 为 DET 数、ret 填 0
3. complexity 依据业务规模判断为 低/中/高
4. 仅输出上述 JSON，不要多余文字

需求描述：
${rawText.slice(0, 12000)}`

  let data: any
  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.2
      })
    })
    data = await resp.json()
  } catch (e: any) {
    throw createError({ statusCode: 502, statusMessage: '调用 DeepSeek 失败: ' + e.message })
  }

  const content = data?.choices?.[0]?.message?.content
  if (!content) {
    throw createError({ statusCode: 502, statusMessage: 'DeepSeek 返回异常: ' + JSON.stringify(data).slice(0, 200) })
  }

  let fps: any[]
  try {
    fps = cleanJSON(content)
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'AI 返回内容无法解析为功能点 JSON' })
  }
  if (!Array.isArray(fps) || fps.length === 0) {
    throw createError({ statusCode: 502, statusMessage: 'AI 未识别出任何功能点' })
  }

  // 清空旧识别结果，写入新结果
  await db.prepare('DELETE FROM function_points WHERE project_id = ?').run(id)
  const ins = db.prepare(
    'INSERT INTO function_points (project_id, seq, name, type, complexity, ret, det, ufp, note, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  await db.transaction(async () => {
    for (let i = 0; i < fps.length; i++) {
      const fp = fps[i]
      const type = String(fp.type || '').toUpperCase()
      const complexity = ['低', '中', '高'].includes(fp.complexity) ? fp.complexity : '中'
      const ufp = computeUFP(type, complexity)
      await ins.run(
        id,
        i + 1,
        String(fp.name || '未命名功能项').slice(0, 255),
        type,
        complexity,
        Number(fp.ret) || 0,
        Number(fp.det) || 0,
        ufp,
        String(fp.note || '').slice(0, 1000),
        'ai'
      )
    }
  })

  await db.prepare("UPDATE projects SET status = 'analyzed', updated_at = now() WHERE id = ?").run(id)

  return { ok: true, count: fps.length, functionPoints: await db.prepare('SELECT * FROM function_points WHERE project_id = ? ORDER BY seq').all(id) }
})
