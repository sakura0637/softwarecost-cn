import db from '../../../utils/db'
import { getQuery } from 'h3'

// 存档详情。
// - 默认只回摘要与快照元信息（轻量）；
// - 需要把存档清单载回测算页时，带 ?items=1 才回 items_snapshot（8452 行约 1.5MB，非必要不传）。
const ENGINE_LABELS: Record<string, string> = { c1: 'C.1 工作量法', quota: '定额单价法' }

function parseJson(v: any): any {
  if (v == null) return null
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return null }
}

export default defineEventHandler(async (event) => {
  const id = Number((event as any).context.params?.id)
  if (!id || Number.isNaN(id)) throw createError({ statusCode: 400, statusMessage: '无效的存档编号' })

  const row = (await db.prepare('SELECT * FROM om_projects WHERE id = ?').get(id)) as any
  if (!row) throw createError({ statusCode: 404, statusMessage: '存档不存在' })

  const withItems = String(getQuery(event).items || '') === '1'
  const snap = parseJson(row.params_snapshot)
  const items = withItems ? parseJson(row.items_snapshot) : null

  return {
    project: {
      id: Number(row.id),
      name: row.name,
      engine: row.engine,
      engineLabel: ENGINE_LABELS[row.engine] || row.engine,
      year: row.year,
      remark: row.remark,
      sourceLabel: row.source_label,
      siteLabel: row.site_label,
      mgmtServiceRate: row.mgmt_service_rate == null ? null : Number(row.mgmt_service_rate),
      itemCount: row.item_count == null ? null : Number(row.item_count),
      unresolvedCount: row.unresolved_count == null ? null : Number(row.unresolved_count),
      totalAmount: row.total_amount == null ? null : Number(row.total_amount),
      operatorName: row.operator_name,
      wageBaseId: row.wage_base_id == null ? null : Number(row.wage_base_id),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      hasSnapshot: !!(snap && row.items_snapshot),
    },
    snapshot: snap
      ? {
          takenAt: snap.takenAt,
          version: snap.version,
          counts: snap.counts,
          /** 快照时生效的人工成本基数（月工资 / 月计薪天数 / 出处），对账时最先看的两个数 */
          wage: snap.params?.wage
            ? {
                label: `${snap.params.wage.year ?? ''}年 ${snap.params.wage.industry ?? ''}`.trim(),
                monthlyWage: Number(snap.params.wage.monthly_wage),
                workDays: Number(snap.params.wage.work_days),
                source: snap.params.wage.source ?? null,
              }
            : null,
        }
      : null,
    items,
  }
})
