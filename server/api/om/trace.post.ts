import { loadOmParams, calcOm, type OmEngine, type OmItemInput } from '../../utils/omCalculator'
import { traceOmRow } from '../../utils/omTrace'

interface Body {
  engine?: OmEngine
  wage_base_id?: number | null
  /** 要追溯的清单行（页面上那一行的当前输入） */
  item?: OmItemInput
}

// 单行追溯（无状态）：给一行清单，返回它「怎么算出来的」完整推导链。
//
// 为什么单独开一个接口、而不是塞进测算响应里：
// 测算可能一次 8,452 行，把每行的推导链都序列化回去，响应体会从 0.7MB 涨到数 MB，
// 而用户一次只会点开一行看。按行按需追溯（外部文档给的目标是 < 200ms）体验更好。
//
// ⚠️ 这里刻意**重新用 calcOm 算这一行**，而不是让前端把算好的数字回传过来拼算式 ——
// 追溯展示的每一步必须来自真正算钱的那段代码，否则追溯面板会变成一份「事后手写的解释」，
// 一旦引擎改了就会与金额脱节，反而误导人。
export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as Body | null
  const item = body?.item
  if (!item || typeof item !== 'object') {
    throw createError({ statusCode: 400, statusMessage: '缺少要追溯的清单行' })
  }
  const engine: OmEngine = body?.engine === 'quota' ? 'quota' : 'c1'

  const params = await loadOmParams(body?.wage_base_id ?? null)
  const result = calcOm(engine, [item], params)
  const row = result.items[0]
  if (!row) {
    throw createError({ statusCode: 400, statusMessage: '该行无法计算，请检查数量与取费类别' })
  }

  return { trace: traceOmRow(engine, row, params) }
})
