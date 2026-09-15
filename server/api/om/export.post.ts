import { loadOmParams, calcOm, type OmEngine, type OmItemInput, type OmParams } from '../../utils/omCalculator'
import { buildOmWorkbook } from '../../utils/omExport'
import { currentOperatorName } from '../../utils/logOperation'
import db from '../../utils/db'
import { setHeader } from 'h3'

interface Body {
  engine?: OmEngine
  wage_base_id?: number | null
  mgmt_service_rate?: number | null
  items?: OmItemInput[]
  /** 项目/测算名称，作为导出表头 */
  project_name?: string | null
  /** 清单来源中文名（设备价格库 / 示例清单） */
  source_label?: string | null
  /** 站点范围描述 */
  site_label?: string | null
  /**
   * 存档编号：给了就**用存档里的参数快照导出**，而不是当前参数。
   * 这是「可复现」的一环 —— 导出的必须就是当初存档的那套数，
   * 否则一旦后台参数被改过，导出的文件就和存档对不上，等于两份凭证打架。
   */
  project_id?: number | null
}

function parseJson(v: any): any {
  if (v == null) return null
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return null }
}

// 运维测算导出 Excel。
//
// 为什么导出要放在后端算：前端把自己的金额写进 Excel 是可以的，但那样「导出的数」与
// 「算钱的数」就成了两套来源 —— 只要引擎改过而前端没同步，导出文件就会静默偏离。
// 这里**复用同一个 calcOm**（与测算、追溯同源），导出只是它的一个视图。
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as Body

  let engine: OmEngine
  let items: OmItemInput[]
  let params: OmParams
  let mgmtServiceRate: number | null = null
  let projectName = String(body?.project_name || '运维费用测算')
  let sourceLabel = body?.source_label || null
  let siteLabel = body?.site_label || null
  let paramVersion = '当前生效参数'

  if (body?.project_id) {
    // —— 存档导出：参数取快照，清单取快照 ——
    const row = (await db.prepare('SELECT * FROM om_projects WHERE id = ?').get(Number(body.project_id))) as any
    if (!row) throw createError({ statusCode: 404, statusMessage: '存档不存在' })
    const snap = parseJson(row.params_snapshot)
    const snapItems = parseJson(row.items_snapshot)
    if (!snap?.params || !Array.isArray(snapItems) || !snapItems.length) {
      throw createError({ statusCode: 400, statusMessage: '该存档没有参数快照（可能是旧版本保存的），无法按当时的参数导出' })
    }
    engine = row.engine === 'quota' ? 'quota' : 'c1'
    items = snapItems
    params = snap.params as OmParams
    mgmtServiceRate = row.mgmt_service_rate == null ? null : Number(row.mgmt_service_rate)
    projectName = String(row.name || projectName)
    sourceLabel = row.source_label || sourceLabel
    siteLabel = row.site_label || siteLabel
    paramVersion = `存档 #${row.id}（参数快照 ${String(snap.takenAt || '').slice(0, 10)}）`
  } else {
    // —— 即时导出：参数取当前生效值 ——
    engine = body?.engine === 'quota' ? 'quota' : 'c1'
    items = Array.isArray(body?.items) ? body!.items! : []
    if (!items.length) {
      throw createError({ statusCode: 400, statusMessage: '设备清单为空，请先录入或载入清单后再导出' })
    }
    const MAX_ITEMS = 20000
    if (items.length > MAX_ITEMS) {
      throw createError({
        statusCode: 400,
        statusMessage: `单次导出最多 ${MAX_ITEMS.toLocaleString('zh-CN')} 行，当前 ${items.length.toLocaleString('zh-CN')} 行`,
      })
    }
    params = await loadOmParams(body?.wage_base_id ?? null)
    mgmtServiceRate = body?.mgmt_service_rate ?? null
  }

  const result = calcOm(engine, items, params, { mgmtServiceRate })
  const operatorName = await currentOperatorName(event)

  const buf = buildOmWorkbook(result, params, {
    projectName,
    sourceLabel,
    siteLabel,
    operatorName,
    createdAt: new Date(),
    paramVersion,
  })

  // 文件名带时间戳，避免多次导出在下载目录里互相覆盖
  const stamp = new Date()
    .toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    .replace(/[/:\s]/g, (s) => (s === ' ' ? '_' : '-'))
  const safeName = projectName.replace(/[\\/:*?"<>|]/g, '').slice(0, 40)
  const fileName = `${safeName}_${engine === 'c1' ? 'C1工作量法' : '定额单价法'}_${stamp}.xlsx`

  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(
    event,
    'Content-Disposition',
    `attachment; filename="om_estimate.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`
  )
  return buf
})
