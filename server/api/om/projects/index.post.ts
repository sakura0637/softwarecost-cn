import { readBody } from 'h3'
import { getAuthUser } from '../../../utils/auth'
import { currentOperatorName, logOperation } from '../../../utils/logOperation'
import { saveOmArchive } from '../../../utils/omSnapshot'
import type { OmEngine, OmItemInput } from '../../../utils/omCalculator'

interface Body {
  name?: string
  engine?: OmEngine
  wage_base_id?: number | null
  mgmt_service_rate?: number | null
  items?: OmItemInput[]
  source_label?: string | null
  site_label?: string | null
  remark?: string | null
}

// 保存测算存档：把「当时生效的整套参数 + 清单」一起快照下来，供事后复现与对账。
// 金额由服务端重算 —— 存档是拿去对账的凭证，里面的数必须是本系统算出来的。
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as Body
  const name = String(body?.name || '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: '请填写存档名称' })
  if (name.length > 120) throw createError({ statusCode: 400, statusMessage: '存档名称过长（最多 120 字）' })

  const items = Array.isArray(body?.items) ? body!.items! : []
  if (!items.length) throw createError({ statusCode: 400, statusMessage: '设备清单为空，无法保存存档' })

  const engine: OmEngine = body?.engine === 'quota' ? 'quota' : 'c1'
  const u = await getAuthUser(event)

  const { id, total } = await saveOmArchive({
    name,
    engine,
    wageBaseId: body?.wage_base_id ?? null,
    mgmtServiceRate: body?.mgmt_service_rate ?? null,
    items,
    sourceLabel: body?.source_label ?? null,
    siteLabel: body?.site_label ?? null,
    remark: body?.remark ?? null,
    userId: u ? u.id : null,
    operatorName: await currentOperatorName(event),
  })

  // 留痕：存档是拿去对账的凭证，「谁什么时候按哪套参数存了多少钱」必须可回溯。
  // 只记结论性字段，不记快照本身（大字段会拖垮审计表）。
  await logOperation({
    event,
    module: 'om',
    entityType: 'om_projects',
    entityId: id,
    action: 'create',
    changes: [
      { field: '存档名称', label: '存档名称', new: name },
      { field: '计价方式', label: '计价方式', new: engine === 'quota' ? '定额单价法' : 'C.1 工作量法' },
      { field: '清单行数', label: '清单行数', new: `${items.length} 行` },
      { field: '测算金额', label: '测算金额', new: `${Number(total).toFixed(2)} 元` },
      { field: '清单来源', label: '清单来源', new: body?.source_label || '示例清单' }
    ],
    remark: '保存运维测算存档（含当时生效的整套参数快照）'
  })

  return { id, total, ok: true }
})
