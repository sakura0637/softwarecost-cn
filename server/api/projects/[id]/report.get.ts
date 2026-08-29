import db from '../../../utils/db'
import { getAuthUser } from '../../../utils/auth'
import { getQuery, setHeader, createError } from 'h3'
import * as XLSX from 'xlsx'

// 项目测算报告
//   默认返回 JSON（项目信息 + 功能点 + 已保存的测算结果）
//   ?format=xlsx 导出 Excel：测算汇总 / 测算过程 / 功能点明细 / 调整因子 四个工作表

/** 按 parent_id 组织成树并展平，附带层级深度（用于导出缩进） */
function flattenTree(rows: any[]): any[] {
  const byParent = new Map<any, any[]>()
  for (const r of rows) {
    const p = r.parent_id ?? null
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p)!.push(r)
  }
  const out: any[] = []
  const visited = new Set<any>()
  const walk = (parentId: any, depth: number) => {
    for (const r of byParent.get(parentId) || []) {
      if (visited.has(r.id)) continue // 防御自引用/成环
      visited.add(r.id)
      out.push({ ...r, _depth: depth })
      walk(r.id, depth + 1)
    }
  }
  walk(null, 0)
  // 兜底：父节点已不存在的孤立行，避免数据丢失
  for (const r of rows) {
    if (!visited.has(r.id)) out.push({ ...r, _depth: 0 })
  }
  return out
}

/** 递归汇总子孙中「功能点层（level 4）」的 UFP */
function subtreeUfp(rows: any[], id: any): number {
  const children = rows.filter((r) => r.parent_id === id)
  return children.reduce(
    (s, c) => s + (Number(c.level) === 4 ? Number(c.ufp) || 0 : subtreeUfp(rows, c.id)),
    0
  )
}

export default defineEventHandler(async (event) => {
  const user = await getAuthUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: '未登录' })

  const id = Number(event.context.params!.id)
  const project: any =
    user.role === 'admin'
      ? await db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
      : await db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, user.id)
  if (!project) throw createError({ statusCode: 404, statusMessage: '项目不存在' })

  const functionPoints = (await db
    .prepare('SELECT * FROM function_points WHERE project_id = ? ORDER BY seq')
    .all(id)) as any[]

  let result: any = null
  try {
    if (project.result_json) result = JSON.parse(project.result_json)
  } catch {
    result = null
  }

  const q = getQuery(event)
  const wantXlsx = String(q.format || '').toLowerCase() === 'xlsx'
  if (!wantXlsx) return { project, functionPoints, result }

  // ---------------- Excel ----------------
  const tree = flattenTree(functionPoints)
  const leafTotal = functionPoints
    .filter((r) => Number(r.level) === 4)
    .reduce((s, r) => s + (Number(r.ufp) || 0), 0)

  // Sheet1 测算汇总
  const summary: Record<string, any>[] = [
    { 项目: '项目名称', 内容: project.name || '' },
    { 项目: '功能点方法', 内容: String(project.method || '').toUpperCase() },
    { 项目: '项目状态', 内容: project.status || '' },
    { 项目: '计价标准', 内容: result ? `${result.standardName}（${result.standardCode}）` : '未测算' },
    { 项目: '标准类别', 内容: result?.category || '' },
    { 项目: '取费城市', 内容: result?.city || '（使用标准自带费率）' },
    { 项目: '基准生产率(人时/功能点)', 内容: result?.pdr ?? '' },
    { 项目: '生产率分位', 内容: result?.pdrLabel || '' },
    { 项目: '人月折算系数(人时/人月)', 内容: result?.hm ?? '' },
    { 项目: '人月费率(元/人月)', 内容: result?.rate ?? '' },
    { 项目: '功能点单价(元/功能点)', 内容: result?.fpPrice ?? '' },
    { 项目: '功能点合计(UFP)', 内容: leafTotal },
    { 项目: '功能点条目数', 内容: functionPoints.filter((r) => Number(r.level) === 4).length },
    { 项目: '工作量(人月)', 内容: result?.workMonths ?? '' },
    { 项目: '工期(月)', 内容: result?.durationMonths ?? '（未指定投入人数）' },
    { 项目: '测算造价(元)', 内容: result?.cost ?? '' },
    { 项目: '折合(万元)', 内容: result?.cost != null ? +(result.cost / 10000).toFixed(2) : '' },
    { 项目: '测算时间', 内容: result?.generatedAt || '' },
  ]

  // Sheet2 测算过程
  const steps: Record<string, any>[] = (result?.steps || []).map((s: any) => ({
    步骤: s.label,
    数值: s.value,
    单位: s.unit || '',
    计算公式: s.formula,
  }))

  // Sheet3 功能点明细（带层级缩进）
  const detail: Record<string, any>[] = tree.map((r, i) => {
    const lv = Number(r.level)
    const isLeaf = lv === 4
    return {
      序号: i + 1,
      层级: lv,
      名称: '　'.repeat(r._depth) + (r.name || ''),
      类型: isLeaf ? r.type || '' : '',
      复杂度: isLeaf ? r.complexity || '' : '',
      RET: isLeaf ? r.ret ?? '' : '',
      DET: isLeaf ? r.det ?? '' : '',
      UFP: isLeaf ? Number(r.ufp) || 0 : subtreeUfp(functionPoints, r.id),
      来源: r.source === 'manual' ? '手动' : 'AI',
    }
  })

  // Sheet4 调整因子
  const f = result?.factors || {}
  const factorRows: Record<string, any>[] = [
    { 因子: '规模变更因子 CF', 取值: f.cf ?? 1, 说明: '估算早期1.39 / 中期1.21 / 晚期1.10 / 交付后1.00' },
    { 因子: '复用系数', 取值: f.reuse ?? 1, 说明: '高0.3333 / 中0.6667 / 低1.0' },
    { 因子: '应用类型（SWF）', 取值: f.appType ?? 1, 说明: '业务处理1.0 ~ 流程控制2.0' },
    { 因子: '软件完整性级别（SWF）', 取值: f.integrityLevel ?? 1, 说明: '无明确1.0 / AB级1.1 / A级1.3' },
    { 因子: '非功能性特征合计（SWF）', 取值: f.nfSum ?? '未启用', 说明: '性能+兼容+可靠+可移植，每项±1' },
    { 因子: '非功能性调整因子', 取值: f.nfFactor ?? 1, 说明: '公式 = 合计 × 0.025 + 1（0.90~1.10）' },
    { 因子: '开发平台（RDF）', 取值: f.platform ?? 1, 说明: 'C1.5 / Python1.2 / Java1.0 / PHP0.8' },
    { 因子: '开发团队背景（RDF）', 取值: f.team ?? 1, 说明: '本行业0.8 / 相关1.0 / 无1.2' },
    { 因子: '投入人数', 取值: f.teamSize ?? '未指定', 说明: '仅用于估算工期' },
  ]
  if (result?.filled?.length) {
    factorRows.push({ 因子: '参数补齐说明', 取值: '', 说明: result.filled.join('；') })
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), '测算汇总')
  if (steps.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(steps), '测算过程')
  else XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 提示: '尚未测算，请先保存测算结果' }]), '测算过程')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), '功能点明细')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(factorRows), '调整因子')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const filename = `造价测算_${project.name || id}.xlsx`
  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(
    event,
    'Content-Disposition',
    `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`
  )
  return buf
})
