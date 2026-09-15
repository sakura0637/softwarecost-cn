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
  // 上限说明（2026-09-15 重新定标）：本接口做过查找记忆化后，定额法 8452 行实测仅 ~40ms
  // （优化前 1042ms），计算本身已不是瓶颈。原 3000 行上限会挡住「全选站点」这种正常用法
  // （设备库全量 10,288 行、有效 8,452 行），故放宽到 20,000 行。
  // 这里**不是性能闸门，只是防住异常客户端**；真正的体量约束是请求体大小
  // （8452 行 ≈ 1.79MB，见 nuxt.config.ts 里 /api/om/** 的 body.maxSize）。
  const MAX_ITEMS = 20000
  if (items.length > MAX_ITEMS) {
    throw createError({
      statusCode: 400,
      statusMessage:
        `单次测算最多 ${MAX_ITEMS.toLocaleString('zh-CN')} 行，` +
        `当前 ${items.length.toLocaleString('zh-CN')} 行，请减少站点范围后分批处理`,
    })
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
