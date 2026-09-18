import db from '../../../utils/db'
import { getAuthUser } from '../../../utils/auth'
import { resolveUfpProfile } from '../../../utils/pricingParams'
import { classifyComplexity, ufpWeightOf } from '@/shared/ufp'
import { createError } from 'h3'

function cleanJSON(text: string): any {
  let s = (text || '').trim()
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const obj = JSON.parse(s)
  return obj.functionPoints || obj.function_points || obj.data || []
}

export default defineEventHandler(async (event) => {
  const user = await getAuthUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: '未登录' })

  const id = Number(event.context.params!.id)
  const project = user.role === 'admin'
    ? await db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
    : await db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, user.id)
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
    {"name":"功能项名称","type":"ILF|EIF|EI|EO|EQ","ret":<整数>,"det":<整数>,"ftr":<整数>,"note":"简要说明"}
  ]
}
要求：
1. type 必须是 ILF、EIF、EI、EO、EQ 之一
2. ret（记录元素类型数 RET）与 det（数据元素类型数 DET）都要尽量如实估计：
   - ILF/EIF：ret 为该逻辑文件的记录元素类型数，det 为数据元素类型数
   - EI/EO/EQ：det 为数据元素类型数，ret 填 0
3. ftr（引用文件类型数 FTR）只对 EI/EO/EQ 有意义：本次事务读写了几个内部逻辑文件/外部接口文件；
   ILF/EIF 的 ftr 填 0
4. 不要输出 complexity（复杂度）字段 —— 复杂度由系统按 RET / DET / FTR 查标准矩阵自动判定，
   你只需要把 ret / det / ftr 三个计数数准，数不准会直接导致功能点数错。
5. 仅输出上述 JSON，不要多余文字

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

  // 功能点方法与复杂度判定矩阵：按项目所选标准从库中解析（接口层的唯一取数出口）
  const profile = await resolveUfpProfile((project as any).standard_id)

  // 清空旧识别结果，写入新结果
  await db.prepare('DELETE FROM function_points WHERE project_id = ?').run(id)
  const ins = db.prepare(
    'INSERT INTO function_points (project_id, seq, name, type, complexity, ret, det, ftr, ufp, note, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const unweighted = new Set<string>()
  await db.transaction(async () => {
    for (let i = 0; i < fps.length; i++) {
      const fp = fps[i]
      const type = String(fp.type || '').toUpperCase()
      const ret = Number(fp.ret) || 0
      const det = Number(fp.det) || 0
      const ftr = Number(fp.ftr) || 0
      // ⚠️ 复杂度不再由 AI 拍脑袋，改由 RET/DET/FTR 查标准矩阵判定（判定不出来才退回'中'）
      const complexity = classifyComplexity(profile.rules, type, ret, det, ftr) ?? '中'
      const w = ufpWeightOf(profile, type, complexity)
      if (w == null) unweighted.add(type)
      await ins.run(
        id,
        i + 1,
        String(fp.name || '未命名功能项').slice(0, 255),
        type,
        complexity,
        ret,
        det,
        ftr,
        w ?? 0,
        String(fp.note || '').slice(0, 1000),
        'ai'
      )
    }
  })

  await db.prepare("UPDATE projects SET status = 'analyzed', updated_at = now() WHERE id = ?").run(id)

  return {
    ok: true,
    count: fps.length,
    // 让调用方知道这次用的是哪套算法，以及有没有「该类型在这套算法里没有权值」的情况
    ufp: {
      method: profile.method,
      methodLabel: profile.methodLabel,
      methodSource: profile.methodSource,
      rulesSource: profile.rulesSource,
      standardId: profile.standardId,
      unweightedTypes: [...unweighted],
    },
    functionPoints: await db.prepare('SELECT * FROM function_points WHERE project_id = ? ORDER BY seq').all(id),
  }
})
