import { loadOmParams, calcOm, type OmEngine, type OmItemInput } from '../../utils/omCalculator'

interface Body {
  engine?: OmEngine
  wage_base_id?: number | null
  /** 运行维护管理服务费率（源表附表5）；不传/传 0 表示不叠加 */
  mgmt_service_rate?: number | null
  items?: OmItemInput[]
}

// 运维费用测算（无状态）：前端传设备清单 + 引擎，后端按参数表现算并返回分解结果。
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as Body
  const engine: OmEngine = body?.engine === 'quota' ? 'quota' : 'c1'
  const items = Array.isArray(body?.items) ? body!.items! : []

  if (!items.length) {
    throw createError({ statusCode: 400, statusMessage: '设备清单为空，请先录入或载入示例' })
  }
  if (items.length > 3000) {
    throw createError({ statusCode: 400, statusMessage: '单次测算最多 3000 行，请分批处理' })
  }

  const params = await loadOmParams(body?.wage_base_id ?? null)
  const result = calcOm(engine, items, params, {
    mgmtServiceRate: body?.mgmt_service_rate ?? null,
  })

  // 未匹配上的清单行摘要，前端高亮提示（参数表里补一条即可消除）
  const unresolved = result.items
    .map((it, i) => ({ ...it, index: i + 1 }))
    .filter((it) => !it.resolved)
    .slice(0, 50)
    .map((it) => ({
      index: it.index,
      name: it.name,
      ref: engine === 'c1' ? it.category_ref : it.quota_ref,
      warn: it.warn,
    }))

  return { result, unresolved }
})
