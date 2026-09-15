<script setup lang="ts">
// 运维费用测算（双引擎，可切换）
//   C.1 工作量法：数量 ×（单位工作量 × 工作量因子）×（人天单价 × 价格因子）
//   定额单价法：数量 × 定额值(元/月) × 12 × 类别系数（按功能点计价的条目再乘点位数）
// 所有系数/费率/基准/定额都来自后台【数据维护 → 运维参数】，本页只读不写死。
// 注意：/api/om/* 需要 om:view 权限，服务端只认 Authorization 头（不读 cookie），
// 因此这里必须用 useAuth() 的 api() 发请求，不能用裸 $fetch —— 否则会 401「未登录」。
//
// 性能：设备库单个管理处最多约 1,400 行，若整表渲染，每行还挂着 5~7 个 v-model 控件，
// 浏览器要维护上万个双向绑定 → 页面卡死。故：
//   ① 表格分页，只渲染当前页（默认 100 行）；
//   ② 切引擎不重新请求网络 —— 取数接口一次就把两法的匹配结果都返回了，
//      页面本地重映射即可（实测一次匹配 1,400 行仅 15ms，瓶颈从来不在后端）。
import { useAuth } from '~/composables/useAuth'
// 大数组用 shallowRef：结果与原始设备行都是「整体替换、从不改内部字段」，
// 深度响应式会为 8000+ 条 × 十几个字段逐个建 Proxy，白白拖慢首屏。
import { shallowRef } from 'vue'

useHead({ title: '运维费用测算 · 水网数智造价系统' })

const { api } = useAuth()

type Engine = 'c1' | 'quota'
/** 清单来源：sample = 源表《C1取费对照表》示例；devices = 本系统「设备价格库」真实台账 */
type Source = 'sample' | 'devices'

interface Row {
  station: string
  sheet_no: number | null
  category: string
  no: string
  name: string
  unit: string
  qty: number
  category_ref: string
  workload: number | null
  quota_ref: string
  quota_value: number | null
  /** 硬件/软件：留空则以定额库中该条目的类别为准（源表实测口径） */
  kind: string
  /** 按功能点计价的条目（PLC应用系统 / UNITY PRO）必填 */
  point_count: number | null
  billable: boolean
  note: string
  /** 设备库来源专用：该行是否已匹配到取费参数（未匹配则高亮待确认） */
  matched?: boolean
  /** 设备库来源专用：完整路径「管理处 · 子站」，用于 hover 提示 */
  full?: string
}

interface SiteSubNode { name: string; count: number }
interface SiteNode { station: string; count: number; subsites: SiteSubNode[] }

const engine = ref<Engine>('c1')
const source = ref<Source>('sample')
const wageBaseId = ref<number | null>(null)
const rows = ref<Row[]>([])
const scaleByStation = ref(true)
const mgmtEnabled = ref(false)
const mgmtRate = ref<number | null>(null)
/** 项目/测算名称：导出的表头与存档记录都用它 */
const projectName = ref('')

const params = ref<any>(null)
const sample = ref<any>(null)
/** 计算结果：只整体替换，用 shallowRef 省掉上万次 Proxy 包装 */
const result = shallowRef<any>(null)
const unresolved = ref<any[]>([])
const loading = ref(false)
const calculating = ref(false)
const exporting = ref(false)
const errorMsg = ref('')

// ── 设备库来源：站点筛选 ────────────────────────────────────
const siteTree = ref<SiteNode[]>([])
const siteReady = ref(false)
const showSitePicker = ref(false)
/** 选中的叶子站点，key = `管理处::子站`；默认全选 */
const selectedSites = ref<string[]>([])
/** 取数接口的原始设备行（两法匹配结果都在），切引擎时本地重映射用；只读大数组 → shallowRef */
const deviceRaw = shallowRef<any[]>([])
const siteLabel = ref('')

// ── 分页（只渲染当前页，解决大清单卡顿）──────────────────────
const PAGE_SIZES = [50, 100, 200, 500]
const page = ref(1)
const pageSize = ref(100)
const pageStart = computed(() => (page.value - 1) * pageSize.value)
const totalRows = computed(() => rows.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / pageSize.value)))
const pagedRows = computed(() => rows.value.slice(pageStart.value, pageStart.value + pageSize.value))

watch([totalRows, pageSize], () => {
  if (page.value > totalPages.value) page.value = totalPages.value
})

// ── 数据装载 ───────────────────────────────────────────────
async function loadParams() {
  try {
    const q = wageBaseId.value ? `?wage_base_id=${wageBaseId.value}` : ''
    params.value = await api(`/api/om/params${q}`)
    if (wageBaseId.value == null && params.value?.wage?.id) wageBaseId.value = params.value.wage.id
    // 管理服务费率默认取后台 mgmt_service 组的第一条（低档 10%）
    const mg = (params.value?.rates || []).find((x: any) => x.group_key === 'mgmt_service')
    if (mg && mgmtRate.value == null) mgmtRate.value = Number(mg.rate)
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage || e?.message || '参数加载失败'
  }
}

/** 站点树（管理处 → 子站 + 各自设备行数）；首次进设备库时载入并默认全选 */
async function loadSiteTree() {
  if (siteReady.value) return
  const meta: any = await api('/api/om/devices')
  siteTree.value = meta.stationTree || []
  selectedSites.value = [...allLeafKeys.value]
  siteReady.value = true
}

// 按当前来源载入清单，载完立即测算
async function loadData() {
  loading.value = true
  errorMsg.value = ''
  page.value = 1
  // 重新载入清单即脱离存档上下文（否则页面上还挂着「已载入存档 #x」的提示，会误导对账）
  loadedArchive.value = null
  try {
    if (source.value === 'devices') {
      await loadSiteTree()
      await loadFromDevices()
    } else {
      await loadFromSample()
    }
    await calculate()
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage || e?.message || '清单载入失败'
  } finally {
    loading.value = false
  }
}

/** 来源一：源表《C1取费对照表》示例清单（用于校验引擎口径） */
async function loadFromSample() {
  if (!sample.value) sample.value = await api('/api/om/sample')
  rows.value = sample.value.items.map((it: any) => ({
    station: it.station || '',
    sheet_no: it.sheet_no,
    category: it.category,
    no: it.no,
    name: it.name,
    unit: it.unit || '',
    qty: (Number(it.qty) || 0) * (scaleByStation.value ? Number(it.station_qty) || 1 : 1),
    category_ref: it.category_ref || '',
    workload: it.billable ? it.workload : null,
    quota_ref: it.name,
    quota_value: null,
    kind: '',
    point_count: null,
    billable: !!it.billable,
    note: it.billable ? '' : it.note,
    matched: true,
  }))
}

/** 来源二：本系统「设备价格库」真实设备台账（按所选站点取数，数量即台账数量，不做站点放大） */
async function loadFromDevices() {
  if (!selectedSites.value.length) {
    deviceRaw.value = []
    rows.value = []
    siteLabel.value = '未选择任何站点'
    return
  }
  const isAll = isAllSites.value
  const res: any = await api('/api/om/devices', {
    method: 'POST',
    body: { all: isAll, sites: isAll ? [] : selectedSites.value, engine: engine.value },
  })
  deviceRaw.value = res.items || []
  if (res.stationTree?.length) siteTree.value = res.stationTree
  siteLabel.value = res.siteLabel || ''
  applyDeviceRows()
}

/** 把接口原始设备行映射成清单行（切引擎时本地重映射，不再请求网络） */
function applyDeviceRows() {
  const eng = engine.value
  const isQuota = eng === 'quota'
  rows.value = deviceRaw.value.map((it: any) => {
    // 两法各自的匹配结果接口都给了，这里按当前引擎挑；matched 也按当前引擎重算
    const matched = isQuota ? !!it.quota_ref : !!it.c1_category
    return {
      station: it.subsite || it.station || '',
      sheet_no: null,
      category: it.category || '',
      no: String(it.seq ?? ''),
      name: it.name || '',
      unit: it.unit || '',
      qty: Number(it.qty) || 0,
      category_ref: isQuota ? '' : (it.c1_category || ''),
      workload: null,
      quota_ref: isQuota ? (it.quota_ref || '') : '',
      quota_value: null,
      kind: '',
      point_count: null,
      // 未匹配的行仍按「应计费」提交 → 引擎会按 0 计入并列入下方待确认清单，
      // 不会被静默丢掉（这是「宁可留待人工确认，也不擅自判不计费」的口径）
      billable: true,
      note: matched ? '' : '未匹配取费参数，待确认',
      matched,
      full: `${it.station || ''} · ${it.subsite || ''}`,
    }
  })
}

function clearRows() {
  rows.value = []
  result.value = null
  unresolved.value = []
  deviceRaw.value = []
  siteLabel.value = ''
  loadedArchive.value = null
  page.value = 1
}

function addRow() {
  rows.value.unshift({
    station: engine.value === 'c1' ? '指挥调度中心' : '',
    sheet_no: 1, category: '', no: '', name: '', unit: '', qty: 1,
    category_ref: '', workload: null, quota_ref: '', quota_value: null,
    kind: '', point_count: null, billable: true, note: '', matched: true,
  })
  page.value = 1
  calculate()
}

function delRow(i: number) {
  rows.value.splice(i, 1)
  // 结果是按清单顺序一一对应的，删行后必须重算，否则金额列会错位
  calculate()
}

// ── 站点筛选 ───────────────────────────────────────────────
const leafKey = (station: string, sub: string) => `${station}::${sub}`
const splitKey = (k: string): [string, string] => {
  const i = k.indexOf('::')
  return i < 0 ? [k, ''] : [k.slice(0, i), k.slice(i + 2)]
}

const allLeafKeys = computed(() => siteTree.value.flatMap((n) => n.subsites.map((s) => leafKey(n.station, s.name))))
const allRowsCount = computed(() => siteTree.value.reduce((a, n) => a + n.count, 0))
const isAllSites = computed(() => allLeafKeys.value.length > 0 && selectedSites.value.length === allLeafKeys.value.length)
const isNoSite = computed(() => selectedSites.value.length === 0)

/** 已选站点覆盖的设备行数（与取数结果一致） */
const selectedRowsCount = computed(() => {
  if (isAllSites.value) return allRowsCount.value
  let n = 0
  for (const k of selectedSites.value) {
    const [st, sub] = splitKey(k)
    const node = siteTree.value.find((t) => t.station === st)
    if (node) n += node.subsites.find((s) => s.name === sub)?.count || 0
  }
  return n
})

const isSubChecked = (station: string, sub: string) => selectedSites.value.includes(leafKey(station, sub))
function isGroupChecked(station: string): boolean {
  const node = siteTree.value.find((n) => n.station === station)
  return !!node && node.subsites.length > 0 && node.subsites.every((s) => isSubChecked(station, s.name))
}
function isGroupIndeterminate(station: string): boolean {
  const node = siteTree.value.find((n) => n.station === station)
  if (!node || !node.subsites.length) return false
  const n = node.subsites.filter((s) => isSubChecked(station, s.name)).length
  return n > 0 && n < node.subsites.length
}

function toggleSub(station: string, sub: string, checked: boolean) {
  const k = leafKey(station, sub)
  const i = selectedSites.value.indexOf(k)
  if (checked && i < 0) selectedSites.value = [...selectedSites.value, k]
  else if (!checked && i >= 0) selectedSites.value = selectedSites.value.filter((x) => x !== k)
}

function toggleGroup(station: string, checked: boolean) {
  const node = siteTree.value.find((n) => n.station === station)
  if (!node) return
  const set = new Set(selectedSites.value)
  for (const s of node.subsites) {
    const k = leafKey(station, s.name)
    if (checked) set.add(k)
    else set.delete(k)
  }
  selectedSites.value = [...set]
}

function toggleAllSites(checked: boolean) {
  selectedSites.value = checked ? [...allLeafKeys.value] : []
}

/** 筛选弹窗「确定」→ 按新选择重新取数 */
async function applySiteSelection() {
  showSitePicker.value = false
  await loadData()
}

/** 打开弹窗时把「已选」与当前筛选对齐（这里就是全量树，无需额外处理） */
function openSitePicker() {
  if (!siteReady.value) loadSiteTree()
  showSitePicker.value = true
}

/** 每行的站点显示：管理处 + 子站（同名子站跨处时能区分） */
function rowStation(r: Row): string {
  return r.full || r.station
}

// ── 计算 ───────────────────────────────────────────────────
/** 清单行 → 计算接口的 item。用字段白名单，不回传整行（否则 8452 行的请求体会被撑大） */
function rowToItem(r: Row, i: number) {
  return {
    name: r.name || `第 ${i + 1} 行`,
    station: r.station,
    category: r.category,
    sheet_no: r.sheet_no,
    unit: r.unit,
    qty: Number(r.qty) || 0,
    category_ref: r.category_ref,
    workload: r.workload,
    quota_ref: r.quota_ref,
    quota_value: r.quota_value,
    kind: r.kind || undefined,
    point_count: r.point_count,
    billable: r.billable,
    note: r.note,
  }
}

// 提交给后端的清单负载。**字段白名单**：绝不把整行原样回传 ——
// 8452 行时请求体已约 1.79MB，回传多余字段会直接撞上请求体上限。
function buildPayload() {
  return {
    engine: engine.value,
    wage_base_id: wageBaseId.value,
    mgmt_service_rate: mgmtEnabled.value ? Number(mgmtRate.value) || 0 : 0,
    items: rows.value.map(rowToItem),
  }
}

async function calculate() {
  if (!rows.value.length) {
    result.value = null
    unresolved.value = []
    return
  }
  calculating.value = true
  errorMsg.value = ''
  try {
    const res: any = await api('/api/om/calculate', { method: 'POST', body: buildPayload() })
    result.value = res.result
    unresolved.value = res.unresolved || []
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage || e?.message || '计算失败'
  } finally {
    calculating.value = false
  }
}

// ── 导出 Excel ────────────────────────────────────────────────
// 刻意**不在前端拼 Excel**：导出复用后端同一个 calcOm（与测算、追溯同源），
// 否则引擎改过而前端没同步时，导出文件会静默偏离系统里的数。
// 导出的工作簿含 4 个 sheet：费用汇总 / 设备明细 / 未匹配清单 / 参数与出处，
// 页脚带参数版本、导出时间、导出人 —— 收到文件的人不必再登录系统就能核对每个数字。
async function exportExcel() {
  if (!rows.value.length) {
    errorMsg.value = '设备清单为空，请先录入或载入清单后再导出'
    return
  }
  exporting.value = true
  errorMsg.value = ''
  try {
    const blob: any = await api('/api/om/export', {
      method: 'POST',
      body: {
        ...buildPayload(),
        project_name: projectName.value || '运维费用测算',
        source_label: source.value === 'devices' ? '设备价格库' : '示例清单',
        site_label: source.value === 'devices' ? siteLabel.value : '',
      },
      responseType: 'blob',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(projectName.value || '运维费用测算').replace(/[\\/:*?"<>|]/g, '')}_${
      engine.value === 'c1' ? 'C1工作量法' : '定额单价法'
    }_${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage || e?.message || '导出失败'
  } finally {
    exporting.value = false
  }
}

// ── 测算存档：保存 / 载入 / 复现 / 导出 / 删除 ─────────────────
// 为什么要有「复现」：参数表是覆盖式修改的，改过之后没人说得清「当初那个金额是怎么来的」。
// 存档把当时生效的整套参数快照下来，复现时用快照重算一遍 —— 能对上，才说明这个金额站得住。
const archives = ref<any[]>([])
const archiveLoading = ref(false)
const savingArchive = ref(false)
const archiveName = ref('')
const reproLoading = ref(false)
const reproResult = ref<any>(null)
const showRepro = ref(false)
/** 当前清单是否来自某个存档（用于提示，避免「以为还在看设备库数据」） */
const loadedArchive = ref<any>(null)

/** 存档清单行 → 页面 Row。与 rowToItem 严格互逆 —— 不互逆的话「载入存档」会悄悄丢字段，
 *  表现为金额与存档对不上，而且极难查。 */
function itemToRow(it: any): Row {
  return {
    station: it.station || '',
    sheet_no: it.sheet_no ?? null,
    category: it.category || '',
    no: '',
    name: it.name || '',
    unit: it.unit || '',
    qty: Number(it.qty) || 0,
    category_ref: it.category_ref || '',
    workload: it.workload ?? null,
    quota_ref: it.quota_ref || '',
    quota_value: it.quota_value ?? null,
    kind: it.kind || '',
    point_count: it.point_count ?? null,
    billable: it.billable !== false,
    note: it.note || '',
  }
}

async function loadArchives() {
  archiveLoading.value = true
  try {
    const res: any = await api('/api/om/projects?page_size=50')
    archives.value = res.items || []
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage || e?.message || '读取存档列表失败'
  } finally {
    archiveLoading.value = false
  }
}

async function saveArchive() {
  if (!rows.value.length) {
    errorMsg.value = '设备清单为空，无法保存存档'
    return
  }
  const name = archiveName.value.trim()
  if (!name) {
    errorMsg.value = '请先填写存档名称'
    return
  }
  savingArchive.value = true
  errorMsg.value = ''
  try {
    await api('/api/om/projects', {
      method: 'POST',
      body: {
        name,
        ...buildPayload(),
        source_label: source.value === 'devices' ? '设备价格库' : '示例清单',
        site_label: source.value === 'devices' ? siteLabel.value : '',
      },
    })
    archiveName.value = ''
    await loadArchives()
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage || e?.message || '保存存档失败'
  } finally {
    savingArchive.value = false
  }
}

async function loadArchive(a: any) {
  errorMsg.value = ''
  try {
    const res: any = await api(`/api/om/projects/${a.id}?items=1`)
    if (!res.items?.length) {
      errorMsg.value = '该存档没有清单快照（可能是旧版本保存的），无法载入'
      return
    }
    engine.value = res.project.engine === 'quota' ? 'quota' : 'c1'
    wageBaseId.value = res.project.wageBaseId
    const mr = res.project.mgmtServiceRate
    mgmtEnabled.value = mr != null && Number(mr) > 0
    mgmtRate.value = mr == null ? null : Number(mr)
    rows.value = res.items.map(itemToRow)
    projectName.value = res.project.name
    loadedArchive.value = res.project
    page.value = 1
    await calculate()
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage || e?.message || '载入存档失败'
  }
}

async function reproduceArchive(id: number) {
  reproLoading.value = true
  reproResult.value = null
  showRepro.value = true
  try {
    reproResult.value = await api(`/api/om/projects/${id}/reproduce`, { method: 'POST' })
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage || e?.message || '复现失败'
    showRepro.value = false
  } finally {
    reproLoading.value = false
  }
}

/** 导出存档：带 project_id 让后端**用存档的参数快照**导出，
 *  而不是当前参数 —— 否则后台改过参数后，导出的文件会和存档对不上。 */
async function exportArchive(a: any) {
  exporting.value = true
  errorMsg.value = ''
  try {
    const blob: any = await api('/api/om/export', {
      method: 'POST',
      body: { project_id: a.id },
      responseType: 'blob',
    })
    const url = URL.createObjectURL(blob)
    const el = document.createElement('a')
    el.href = url
    el.download = `${String(a.name || '存档').replace(/[\\/:*?"<>|]/g, '')}_${
      a.engine === 'c1' ? 'C1工作量法' : '定额单价法'
    }_存档${a.id}.xlsx`
    el.click()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage || e?.message || '导出失败'
  } finally {
    exporting.value = false
  }
}

async function deleteArchive(a: any) {
  if (!confirm(`确定删除存档《${a.name}》？\n存档是历史凭证，删除后连同参数快照一起不可恢复。`)) return
  try {
    await api(`/api/om/projects/${a.id}`, { method: 'DELETE' })
    if (loadedArchive.value?.id === a.id) loadedArchive.value = null
    await loadArchives()
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage || e?.message || '删除失败'
  }
}

// ── 单行追溯：点一行，看这笔钱是怎么算出来的 ────────────────────
// 借鉴外部设计文档的「追溯抽屉」。刻意**把这一行重新发给后端算**，
// 而不是在前端拿已经算好的数字拼算式 —— 推导链必须由真正算钱的引擎给出，
// 否则面板就成了一份「事后手写的解释」，引擎一改就与金额脱节。
const showTrace = ref(false)
const traceLoading = ref(false)
const traceData = ref<any>(null)
const traceRow = ref<Row | null>(null)

async function openTrace(i: number) {
  const r = rows.value[i]
  if (!r) return
  traceRow.value = r
  traceData.value = null
  showTrace.value = true
  traceLoading.value = true
  try {
    const res: any = await api('/api/om/trace', {
      method: 'POST',
      body: { engine: engine.value, wage_base_id: wageBaseId.value, item: rowToItem(r, i) },
    })
    traceData.value = res.trace
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage || e?.message || '追溯失败'
    showTrace.value = false
  } finally {
    traceLoading.value = false
  }
}

/** 追溯链上的数字显示：最多 6 位小数、去掉多余的 0 */
const tnum = (n: any, d = 6) => {
  const v = Number(n)
  if (!isFinite(v)) return '—'
  return String(Number(v.toFixed(d)))
}

function switchEngine(v: Engine) {
  if (engine.value === v) return
  engine.value = v
  if (source.value === 'devices') {
    // 两法匹配结果取数时已一并返回 → 本地重映射即可，省掉一次网络往返与重算
    if (deviceRaw.value.length) {
      applyDeviceRows()
      page.value = 1
      calculate()
    }
    return
  }
  // 示例清单：换引擎后原清单的引用字段不通用，清空结果并提示重算
  if (rows.value.length) {
    rows.value = rows.value.map((r) => ({
      ...r,
      category_ref: v === 'c1' ? (r.category_ref || '') : '',
      workload: v === 'c1' ? r.workload : null,
      quota_ref: v === 'quota' ? (r.quota_ref || r.name) : '',
      quota_value: null,
      kind: '',
    }))
    calculate()
  }
}

/** 切换清单来源：清空旧清单，设备库来源自动取站点树并全选 */
function switchSource(v: Source) {
  if (source.value === v) return
  source.value = v
  clearRows()
  if (v === 'devices') loadData()
}

watch(wageBaseId, () => { loadParams().then(() => rows.value.length && calculate()) })

// ── 格式化 ─────────────────────────────────────────────────
const fmt = (n: any) => (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const wan = (n: any) => ((Number(n) || 0) / 10000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** 费率显示：0.12 → 12%，0.105 → 10.5%，1 → 100%（不能用「去掉末尾 0」的写法，否则 100 会被截成 1） */
const pct = (n: any) => `${Number(((Number(n) || 0) * 100).toFixed(2))}%`

const c1Options = computed(() => (params.value?.c1 || []).map((x: any) => x.category))
const quotaOptions = computed(() => (params.value?.quota || []).map((x: any) => x.name))

// 汇总行（按分类小计，便于和源表核对）
const grouped = computed(() => {
  if (!result.value) return []
  const m = new Map<string, { category: string; count: number; amount: number }>()
  for (const it of result.value.items) {
    const k = it.category || it.station || '未分类'
    const cur = m.get(k) || { category: k, count: 0, amount: 0 }
    cur.count += 1
    cur.amount += Number(it.amount) || 0
    m.set(k, cur)
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount)
})

// 设备库来源的命中统计（本地按当前引擎算，与清单完全一致）
const deviceStats = computed(() => {
  if (source.value !== 'devices') return null
  const isQuota = engine.value === 'quota'
  const hit = (it: any) => (isQuota ? !!it.quota_ref : !!it.c1_category)
  const total = deviceRaw.value.length
  const matched = deviceRaw.value.filter(hit).length
  return {
    total, matched, unmatched: total - matched,
    quotaHit: deviceRaw.value.filter((x) => x.quota_ref).length,
    c1Hit: deviceRaw.value.filter((x) => x.c1_category).length,
  }
})

const engineHint = computed(() =>
  engine.value === 'c1'
    ? '数量 ×（单位工作量 × 工作量因子）×（人天单价 × 价格因子）'
    : '数量 × 定额值(元/月) × 12 × 类别系数'
)

// 说明面板里的实际参数（跟着后台改，页面文字自动同步）
// 注意：工作量因子 / 价格因子 / 取费系数这几项只有引擎算过才有确切值（它们由后台因子按
// 连乘/加权规则组合而来，前端不复现算法，免得写出与引擎不一致的数字）→ 未测算时返回 null，
// 模板里显示「—」并提示「测算后显示实际取值」。
const help = computed(() => {
  const p = params.value || {}
  const m = result.value?.meta
  return {
    hasResult: !!m,
    monthlyWage: Number(p.wage?.monthly_wage) || 0,
    workDays: Number(p.wage?.work_days) || 21.75,
    dailyRate: Number(p.dailyRate) || 0,
    workloadFactor: m ? m.workloadFactor : null,
    staffCoef: m ? m.staffCoef : null,
    priceFactor: m ? m.priceFactor : null,
    hardCoef: m ? m.hardCoef : null,
    softCoef: m ? m.softCoef : null,
    monthFactor: Number(m?.monthFactor ?? p.quotaVars?.months ?? 12),
    quotaWage: Number(m?.quotaVars?.month_wage ?? p.quotaVars?.month_wage ?? p.quotaWage?.monthly_wage) || 0,
    wageRatio: m?.quotaVars?.wage_ratio ?? p.quotaVars?.wage_ratio ?? 1,
    fpCoef: m?.quotaVars?.fp_coef ?? p.quotaVars?.fp_coef ?? 1,
  }
})

const showHelp = ref(false)

onMounted(loadParams)
// 存档列表随页面一起载入：它是「这个数是怎么来的」的凭证，不该藏在需要额外点击的入口后面
onMounted(loadArchives)
</script>

<template>
  <div class="container-custom py-8">
    <!-- 标题 -->
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">运维费用测算</h1>
        <p class="mt-1 text-sm text-gray-500">{{ engineHint }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button class="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50" @click="showHelp = !showHelp">
          {{ showHelp ? '收起说明' : '测算说明' }}
        </button>
        <button class="btn-outline !px-4 !py-2 !text-sm" :disabled="loading" @click="loadData">
          {{ loading ? '载入中…' : (source === 'devices' ? '载入设备库清单' : '载入示例清单') }}
        </button>
        <button class="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50" @click="clearRows">
          清空
        </button>
        <button class="btn-primary !px-5 !py-2 !text-sm" :disabled="calculating" @click="calculate">
          {{ calculating ? '计算中…' : '开始测算' }}
        </button>
        <button
          class="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          :disabled="exporting || !rows.length"
          :title="rows.length ? '导出含明细、未匹配清单与全部参数出处的 Excel' : '请先载入或录入清单'"
          @click="exportExcel"
        >
          {{ exporting ? '导出中…' : '导出 Excel' }}
        </button>
      </div>
    </div>

    <p v-if="errorMsg" class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{{ errorMsg }}</p>

    <!-- 存档上下文提示：载入存档后必须明确告知，避免误以为还在看设备库/示例清单的数据 -->
    <p v-if="loadedArchive" class="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs leading-relaxed text-blue-700">
      当前清单载自存档 <b>#{{ loadedArchive.id }}《{{ loadedArchive.name }}》</b>
      <span class="text-blue-500">
        （{{ loadedArchive.engineLabel }} · 保存人 {{ loadedArchive.operatorName || '—' }} · {{ String(loadedArchive.createdAt || '').slice(0, 19).replace('T', ' ') }}）
      </span>
      —— 参数已按该存档的快照复现，因此这里的金额可能与用当前参数现算的不同。
      <button class="ml-1 underline hover:no-underline" @click="reproduceArchive(loadedArchive.id)">看差异</button>
    </p>

    <!-- 引擎 + 基数 -->
    <div class="card mb-5 !p-4">
      <div class="flex flex-wrap items-center gap-x-8 gap-y-3">
        <!-- 清单来源：示例 = 源表对照表；设备库 = 本系统真实台账 -->
        <div class="flex items-center gap-2">
          <span class="text-sm text-gray-500">清单来源</span>
          <div class="inline-flex rounded-lg bg-gray-100 p-0.5">
            <button
              class="rounded-md px-3 py-1.5 text-sm font-medium transition"
              :class="source === 'sample' ? 'bg-white text-primary shadow-sm' : 'text-gray-500'"
              @click="switchSource('sample')"
            >
              示例清单
            </button>
            <button
              class="rounded-md px-3 py-1.5 text-sm font-medium transition"
              :class="source === 'devices' ? 'bg-white text-primary shadow-sm' : 'text-gray-500'"
              @click="switchSource('devices')"
            >
              设备价格库
            </button>
          </div>
        </div>

        <!-- 站点筛选 -->
        <div v-if="source === 'devices'" class="flex items-center gap-2">
          <button class="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50" @click="openSitePicker">
            选择站点
            <span class="ml-1 text-xs text-gray-400">
              {{ isAllSites ? '全部' : (isNoSite ? '未选' : selectedSites.length + ' 个子站') }}
            </span>
          </button>
          <span class="max-w-[16rem] truncate text-xs text-gray-400" :title="siteLabel">已选 {{ selectedRowsCount.toLocaleString('zh-CN') }} 行</span>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-sm text-gray-500">测算引擎</span>
          <div class="inline-flex rounded-lg bg-gray-100 p-0.5">
            <button
              class="rounded-md px-4 py-1.5 text-sm font-medium transition"
              :class="engine === 'c1' ? 'bg-white text-primary shadow-sm' : 'text-gray-500'"
              @click="switchEngine('c1')"
            >
              C.1 工作量法
            </button>
            <button
              class="rounded-md px-4 py-1.5 text-sm font-medium transition"
              :class="engine === 'quota' ? 'bg-white text-primary shadow-sm' : 'text-gray-500'"
              @click="switchEngine('quota')"
            >
              定额单价法
            </button>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-sm text-gray-500">人工成本基数</span>
          <select v-model.number="wageBaseId" class="rounded-lg border border-gray-200 px-3 py-1.5 text-sm">
            <option v-for="w in (params?.wageBases || [])" :key="w.id" :value="w.id">{{ w.label }}</option>
          </select>
          <span v-if="params?.dailyRate" class="text-xs text-gray-400">
            人天单价 <b class="text-gray-700">{{ fmt(params.dailyRate) }}</b> 元
          </span>
        </div>

        <label
          class="flex items-center gap-2 text-sm"
          :class="source === 'devices' ? 'text-gray-300' : 'text-gray-600'"
          :title="source === 'devices' ? '设备库的数量就是各站实际台账数量，无需再放大' : ''"
        >
          <input
            v-model="scaleByStation"
            type="checkbox"
            :disabled="source === 'devices'"
            class="h-4 w-4 rounded border-gray-300"
            @change="source === 'sample' && rows.length && loadData()"
          >
          数量按站点数放大
        </label>

        <div class="flex items-center gap-2 text-sm text-gray-600">
          <label class="flex items-center gap-2">
            <input v-model="mgmtEnabled" type="checkbox" class="h-4 w-4 rounded border-gray-300" @change="rows.length && calculate()">
            叠加运行维护管理服务费
          </label>
          <select
            v-model.number="mgmtRate"
            :disabled="!mgmtEnabled"
            class="rounded-lg border border-gray-200 px-2 py-1 text-xs disabled:opacity-40"
            @change="rows.length && calculate()"
          >
            <option v-for="r in (params?.rates || []).filter((x: any) => x.group_key === 'mgmt_service')" :key="r.id" :value="Number(r.rate)">
              {{ r.name }}（{{ pct(r.rate) }}）
            </option>
          </select>
        </div>

        <div class="ml-auto flex items-center gap-4 text-xs text-gray-400">
          <span>清单 <b class="text-gray-700">{{ rows.length }}</b> 行</span>
          <NuxtLink to="/admin/data" class="text-primary hover:underline">前往参数维护 →</NuxtLink>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <!-- 设备清单 -->
      <div class="xl:col-span-2">
        <div class="card !p-0">
          <div class="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <div class="flex items-center gap-3">
              <h2 class="text-base font-semibold text-gray-800">设备清单</h2>
              <span v-if="source === 'devices' && deviceStats" class="text-xs text-gray-400">
                共 <b class="text-gray-700">{{ deviceStats.total.toLocaleString('zh-CN') }}</b> 行 ·
                已匹配 <b class="text-emerald-600">{{ deviceStats.matched.toLocaleString('zh-CN') }}</b> ·
                待确认 <b :class="deviceStats.unmatched ? 'text-amber-600' : 'text-gray-700'">{{ deviceStats.unmatched.toLocaleString('zh-CN') }}</b>
                <span class="ml-1 text-gray-300">（待确认行按 0 计入，见下方提示）</span>
              </span>
            </div>
            <div class="flex items-center gap-2">
              <button class="text-sm text-primary hover:underline" @click="addRow">+ 新增一行</button>
            </div>
          </div>
          <div class="table-scroll">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th class="px-3 py-2 font-medium">站点</th>
                  <th class="px-3 py-2 font-medium">设备名称</th>
                  <th class="px-3 py-2 font-medium">单位</th>
                  <th class="px-3 py-2 text-right font-medium">数量</th>
                  <template v-if="engine === 'c1'">
                    <th class="px-3 py-2 font-medium">C.1 设备类别</th>
                    <th class="px-3 py-2 text-right font-medium">单位工作量</th>
                  </template>
                  <template v-else>
                    <th class="px-3 py-2 font-medium">定额条目</th>
                    <th class="px-3 py-2 text-right font-medium">定额值</th>
                    <th class="px-3 py-2 font-medium">类别</th>
                    <th class="px-3 py-2 text-right font-medium">点位数</th>
                  </template>
                  <th class="px-3 py-2 text-right font-medium">金额(元)</th>
                  <th class="sticky right-0 bg-gray-50 px-3 py-2 text-center font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!rows.length">
                  <td :colspan="engine === 'c1' ? 8 : 10" class="px-4 py-12 text-center text-sm text-gray-400">
                    <template v-if="source === 'devices'">
                      {{ isNoSite ? '尚未选择站点，请点上方「选择站点」勾选要测算的站点。' : '所选站点暂无设备，或清单尚未载入。' }}
                    </template>
                    <template v-else>还没有清单。上方「清单来源」可切到「设备价格库」按站点载入真实台账，也可点右上角「载入示例清单」看效果，或「新增一行」手工录入。</template>
                  </td>
                </tr>
                <tr
                  v-for="(r, li) in pagedRows"
                  :key="pageStart + li"
                  class="border-b border-gray-50 hover:bg-gray-50/60"
                  :class="{ 'bg-gray-50/40 text-gray-400': !r.billable, 'bg-amber-50/50': r.billable && r.matched === false }"
                >
                  <td class="px-3 py-1.5">
                    <span
                      v-if="source === 'devices'"
                      class="block w-32 truncate text-xs text-gray-600"
                      :title="rowStation(r)"
                    >{{ r.station }}</span>
                    <select v-else v-model="r.station" class="w-32 rounded border border-transparent bg-transparent px-1 py-1 text-xs hover:border-gray-200 focus:border-primary focus:bg-white">
                      <option value="">—</option>
                      <option v-for="s in (params?.stations || [])" :key="s.code" :value="s.name">{{ s.name }}</option>
                    </select>
                  </td>
                  <td class="px-3 py-1.5">
                    <input v-model="r.name" class="w-full min-w-[9rem] rounded border border-transparent bg-transparent px-1 py-1 text-xs hover:border-gray-200 focus:border-primary focus:bg-white" :title="r.name">
                  </td>
                  <td class="px-3 py-1.5">
                    <input v-model="r.unit" class="w-12 rounded border border-transparent bg-transparent px-1 py-1 text-xs hover:border-gray-200 focus:border-primary focus:bg-white">
                  </td>
                  <td class="px-3 py-1.5 text-right">
                    <input v-model.number="r.qty" type="number" step="any" class="w-16 rounded border border-transparent bg-transparent px-1 py-1 text-right text-xs hover:border-gray-200 focus:border-primary focus:bg-white">
                  </td>
                  <template v-if="engine === 'c1'">
                    <td class="px-3 py-1.5">
                      <input v-model="r.category_ref" list="c1-options" class="w-36 rounded border border-transparent bg-transparent px-1 py-1 text-xs hover:border-gray-200 focus:border-primary focus:bg-white">
                    </td>
                    <td class="px-3 py-1.5 text-right">
                      <input v-model.number="r.workload" type="number" step="any" placeholder="自动" class="w-20 rounded border border-transparent bg-transparent px-1 py-1 text-right text-xs hover:border-gray-200 focus:border-primary focus:bg-white">
                    </td>
                  </template>
                  <template v-else>
                    <td class="px-3 py-1.5">
                      <input v-model="r.quota_ref" list="quota-options" class="w-40 rounded border border-transparent bg-transparent px-1 py-1 text-xs hover:border-gray-200 focus:border-primary focus:bg-white">
                    </td>
                    <td class="px-3 py-1.5 text-right">
                      <input v-model.number="r.quota_value" type="number" step="any" placeholder="自动" class="w-20 rounded border border-transparent bg-transparent px-1 py-1 text-right text-xs hover:border-gray-200 focus:border-primary focus:bg-white">
                    </td>
                    <td class="px-3 py-1.5">
                      <select v-model="r.kind" class="w-16 rounded border border-transparent bg-transparent px-1 py-1 text-xs hover:border-gray-200 focus:border-primary focus:bg-white">
                        <option value="">按定额库</option>
                        <option value="硬件">硬件</option>
                        <option value="软件">软件</option>
                      </select>
                    </td>
                    <td class="px-3 py-1.5 text-right">
                      <input
                        v-model.number="r.point_count"
                        type="number"
                        step="1"
                        placeholder="按功能点"
                        class="w-20 rounded border border-transparent bg-transparent px-1 py-1 text-right text-xs hover:border-gray-200 focus:border-primary focus:bg-white"
                        :class="result?.items?.[pageStart + li]?.usedPointCount !== undefined && !result.items[pageStart + li].usedPointCount ? 'border-amber-300' : ''"
                        title="按功能点计价的条目（PLC应用系统 / UNITY PRO）必填，否则该行按 0 计"
                      >
                    </td>
                  </template>
                  <td class="px-3 py-1.5 text-right font-mono text-xs text-gray-700">
                    <span v-if="!r.billable" class="text-[11px] text-gray-400">不计费</span>
                    <span v-else>{{ result?.items?.[pageStart + li] ? fmt(result.items[pageStart + li].amount) : '—' }}</span>
                  </td>
                  <td class="sticky right-0 bg-white px-3 py-1.5 text-center whitespace-nowrap">
                    <button class="text-xs text-primary hover:underline" title="看这笔钱是怎么算出来的" @click="openTrace(pageStart + li)">追溯</button>
                    <button class="ml-2 text-xs text-red-500 hover:underline" @click="delRow(pageStart + li)">删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 分页条：只渲染当前页，是设备库大清单不卡的关键 -->
          <div v-if="totalRows > 0" class="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-2.5 text-xs text-gray-500">
            <div class="flex items-center gap-3">
              <span>共 <b class="text-gray-700">{{ totalRows.toLocaleString('zh-CN') }}</b> 行，第 {{ page }} / {{ totalPages }} 页</span>
              <label class="flex items-center gap-1">
                每页
                <select v-model.number="pageSize" class="rounded border border-gray-200 px-1 py-0.5 text-xs">
                  <option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ n }}</option>
                </select>
                行
              </label>
            </div>
            <div class="flex items-center gap-1">
              <button class="rounded border border-gray-200 px-2 py-1 disabled:opacity-40" :disabled="page <= 1" @click="page = 1">首页</button>
              <button class="rounded border border-gray-200 px-2 py-1 disabled:opacity-40" :disabled="page <= 1" @click="page--">上一页</button>
              <span class="px-2">{{ pageStart + 1 }}–{{ Math.min(pageStart + pageSize, totalRows) }}</span>
              <button class="rounded border border-gray-200 px-2 py-1 disabled:opacity-40" :disabled="page >= totalPages" @click="page++">下一页</button>
              <button class="rounded border border-gray-200 px-2 py-1 disabled:opacity-40" :disabled="page >= totalPages" @click="page = totalPages">末页</button>
            </div>
          </div>

          <datalist id="c1-options"><option v-for="c in c1Options" :key="c" :value="c" /></datalist>
          <datalist id="quota-options"><option v-for="c in quotaOptions" :key="c" :value="c" /></datalist>
        </div>

        <p v-if="unresolved.length" class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          有 <b>{{ unresolved.length.toLocaleString('zh-CN') }}</b> 行没匹配上取费参数（本行按 0 元计入，不影响其它行）：
          <span v-for="u in unresolved.slice(0, 8)" :key="u.index" class="mr-2">第{{ u.index }}行「{{ u.ref || u.name }}」</span>
          <span v-if="unresolved.length > 8">…等</span>
          <br>处理办法：在【数据维护 → 运维参数 → C.1 单位工作量基准 / 定额单价库】补一条，或在该行直接手填数值即可。
        </p>
      </div>

      <!-- 费用汇总 -->
      <div class="xl:col-span-1">
        <div class="card !p-5">
          <h2 class="mb-4 text-base font-semibold text-gray-800">费用汇总</h2>

          <div v-if="!result" class="py-10 text-center text-sm text-gray-400">
            {{ rows.length ? '点「开始测算」出结果' : '等待清单' }}
          </div>

          <template v-else>
            <div class="mb-4 rounded-lg bg-primary/5 px-4 py-3">
              <div class="text-xs text-gray-500">{{ result.meta.engineLabel }} · 运维费用合计</div>
              <div class="mt-1 text-2xl font-bold text-primary">{{ wan(result.total) }} <span class="text-sm font-normal">万元</span></div>
              <div class="mt-1 text-xs text-gray-400">{{ fmt(result.total) }} 元</div>
            </div>

            <dl class="space-y-2 text-sm">
              <div class="flex items-start justify-between gap-2">
                <dt class="text-gray-600">
                  {{ engine === 'c1' ? '人工费（明细合计）' : '直接运维费（明细合计）' }}
                  <span class="block text-[11px] text-gray-400">{{ engine === 'c1' ? '各明细行金额之和' : '各明细行金额之和' }}</span>
                </dt>
                <dd class="shrink-0 font-mono text-gray-800">{{ fmt(result.laborCost) }}</dd>
              </div>
              <div v-for="l in result.otherDirect" :key="l.key" class="flex items-start justify-between gap-2 pl-3">
                <dt class="text-xs text-gray-500">
                  {{ l.label }}
                  <span class="block text-[11px] text-gray-400">计费基数：{{ l.base }} × {{ pct(l.rate) }}</span>
                </dt>
                <dd class="shrink-0 font-mono text-xs text-gray-600">{{ fmt(l.amount) }}</dd>
              </div>
              <div v-if="result.mgmtService" class="flex items-start justify-between gap-2 pl-3">
                <dt class="text-xs text-gray-500">
                  {{ result.mgmtService.label }}
                  <span class="block text-[11px] text-gray-400">计费基数：{{ result.mgmtService.base }} × {{ pct(result.mgmtService.rate) }}</span>
                </dt>
                <dd class="shrink-0 font-mono text-xs text-gray-600">{{ fmt(result.mgmtService.amount) }}</dd>
              </div>
              <div class="flex items-center justify-between border-t border-gray-100 pt-2">
                <dt class="text-gray-600">直接费小计<span class="block text-[11px] text-gray-400">人工费 + 其他直接费</span></dt>
                <dd class="font-mono font-medium text-gray-800">{{ fmt(result.directSubtotal) }}</dd>
              </div>
              <div v-if="result.mgmtService" class="flex items-center justify-between">
                <dt class="text-gray-600">直接费<span class="block text-[11px] text-gray-400">直接费小计 + 管理服务费</span></dt>
                <dd class="font-mono font-medium text-gray-800">{{ fmt(result.directTotal) }}</dd>
              </div>
              <div v-for="l in result.indirect" :key="l.key" class="flex items-start justify-between gap-2 pl-3">
                <dt class="text-xs text-gray-500">
                  {{ l.label }}
                  <span class="block text-[11px] text-gray-400">计费基数：{{ l.base }} × {{ pct(l.rate) }}</span>
                </dt>
                <dd class="shrink-0 font-mono text-xs text-gray-600">{{ fmt(l.amount) }}</dd>
              </div>
              <div v-if="result.tax" class="flex items-start justify-between gap-2">
                <dt class="text-gray-600">
                  {{ result.tax.label }}
                  <span class="block text-[11px] text-gray-400">计费基数：{{ result.tax.base }} × {{ pct(result.tax.rate) }}</span>
                </dt>
                <dd class="shrink-0 font-mono text-gray-800">{{ fmt(result.tax.amount) }}</dd>
              </div>
              <div v-if="result.spare" class="flex items-start justify-between gap-2">
                <dt class="text-gray-600">
                  {{ result.spare.label }}
                  <span class="block text-[11px] text-gray-400">计费基数：{{ result.spare.base }} × {{ pct(result.spare.rate) }}</span>
                </dt>
                <dd class="shrink-0 font-mono text-gray-800">{{ fmt(result.spare.amount) }}</dd>
              </div>
              <div v-for="l in (result.extra || [])" :key="l.key" class="flex items-start justify-between gap-2">
                <dt class="text-gray-600">
                  {{ l.label }}
                  <span class="block text-[11px] text-gray-400">计费基数：{{ l.base }} × {{ pct(l.rate) }}</span>
                </dt>
                <dd class="shrink-0 font-mono text-gray-800">{{ fmt(l.amount) }}</dd>
              </div>
              <div class="flex items-center justify-between border-t-2 border-gray-200 pt-2">
                <dt class="font-semibold text-gray-800">合计</dt>
                <dd class="font-mono font-bold text-primary">{{ fmt(result.total) }}</dd>
              </div>
            </dl>

            <div class="mt-5 border-t border-gray-100 pt-4">
              <h3 class="mb-2 text-xs font-semibold text-gray-500">本次生效的关键参数</h3>
              <dl class="space-y-1 text-xs">
                <div class="flex justify-between"><dt class="text-gray-400">人天单价</dt><dd class="text-gray-700">{{ fmt(result.meta.dailyRate) }} 元</dd></div>
                <template v-if="engine === 'c1'">
                  <div class="flex justify-between"><dt class="text-gray-400">工作量因子</dt><dd class="text-gray-700">{{ result.meta.workloadFactor }}</dd></div>
                  <div class="flex justify-between"><dt class="text-gray-400">人员配备系数</dt><dd class="text-gray-700">{{ result.meta.staffCoef }}</dd></div>
                  <div class="flex justify-between"><dt class="text-gray-400">生效价格因子</dt><dd class="text-gray-700">{{ result.meta.priceFactor.toFixed(4) }}</dd></div>
                  <div class="flex justify-between"><dt class="text-gray-400">合计修正工作量</dt><dd class="text-gray-700">{{ fmt(result.totalPersonDays) }} 人天</dd></div>
                </template>
                <template v-else>
                  <div class="flex justify-between"><dt class="text-gray-400">硬件取费系数</dt><dd class="text-gray-700">{{ result.meta.hardCoef }}</dd></div>
                  <div class="flex justify-between"><dt class="text-gray-400">软件取费系数</dt><dd class="text-gray-700">{{ result.meta.softCoef }}</dd></div>
                  <div class="flex justify-between"><dt class="text-gray-400">年·月换算</dt><dd class="text-gray-700">×{{ result.meta.monthFactor }}</dd></div>
                  <div class="flex justify-between"><dt class="text-gray-400">定额法人工费</dt><dd class="text-gray-700">{{ fmt(result.meta.quotaVars?.month_wage) }} 元/月</dd></div>
                  <div class="flex justify-between"><dt class="text-gray-400">运维单价调整系数</dt><dd class="text-gray-700">{{ result.meta.quotaVars?.wage_ratio }}</dd></div>
                  <div class="flex justify-between"><dt class="text-gray-400">功能点调整系数</dt><dd class="text-gray-700">{{ result.meta.quotaVars?.fp_coef }}</dd></div>
                </template>
              </dl>
              <p class="mt-2 text-[11px] leading-relaxed text-gray-400">{{ result.meta.wageBaseLabel }}</p>
            </div>
          </template>
        </div>

        <!-- 分类小计 -->
        <div v-if="grouped.length" class="card mt-5 !p-5">
          <h3 class="mb-3 text-sm font-semibold text-gray-800">按分类小计</h3>
          <div class="table-scroll !max-h-[320px]">
            <table class="w-full text-xs">
              <thead class="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th class="px-2 py-1.5 font-medium">分类</th>
                  <th class="px-2 py-1.5 text-right font-medium">条数</th>
                  <th class="px-2 py-1.5 text-right font-medium">金额(元)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="g in grouped" :key="g.category" class="border-b border-gray-50">
                  <td class="px-2 py-1.5 text-gray-600" :title="g.category">{{ g.category }}</td>
                  <td class="px-2 py-1.5 text-right text-gray-500">{{ g.count }}</td>
                  <td class="px-2 py-1.5 text-right font-mono text-gray-700">{{ fmt(g.amount) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- ── 测算存档（可复现）────────────────────────────────── -->
    <div class="card mt-5 !p-6">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-base font-semibold text-gray-800">测算存档</h2>
          <p class="mt-1 text-xs leading-relaxed text-gray-500">
            保存时会把<b>当时生效的一整套参数</b>连同清单一起快照下来。参数表是覆盖式修改的，
            不存快照，事后再也说不清「这个金额当初是怎么来的」。
            点<b>复现</b>会用存档里的快照重算一遍做校验，并给出「若改用当前参数会差多少、是哪个参数造成的」。
          </p>
        </div>
        <button
          class="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          :disabled="archiveLoading"
          @click="loadArchives"
        >
          {{ archiveLoading ? '读取中…' : '刷新列表' }}
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="archiveName"
          type="text"
          maxlength="120"
          placeholder="存档名称，例如：2026年10管理处全量-C1法"
          class="w-72 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
        >
        <button
          class="btn-primary !px-4 !py-1.5 !text-sm"
          :disabled="savingArchive || !rows.length"
          :title="rows.length ? '保存当前清单与当前参数快照' : '请先载入或录入清单'"
          @click="saveArchive"
        >
          {{ savingArchive ? '保存中…' : '保存当前测算' }}
        </button>
        <span class="text-xs text-gray-400">
          当前清单 {{ rows.length.toLocaleString('zh-CN') }} 行；保存时会用服务端重新计算金额（不采信页面上的数字）
        </span>
      </div>

      <p v-if="!archiveLoading && !archives.length" class="mt-4 text-xs text-gray-400">
        暂无存档。填个名称点「保存当前测算」，以后就能随时复现这次的口径。
      </p>

      <div v-else-if="archives.length" class="mt-4 table-scroll !max-h-[360px]">
        <table class="w-full text-xs">
          <thead class="bg-gray-50 text-left text-gray-500">
            <tr>
              <th class="px-2 py-1.5 font-medium">存档名称</th>
              <th class="px-2 py-1.5 font-medium">引擎</th>
              <th class="px-2 py-1.5 text-right font-medium">清单行数</th>
              <th class="px-2 py-1.5 text-right font-medium">未匹配</th>
              <th class="px-2 py-1.5 text-right font-medium">金额(元)</th>
              <th class="px-2 py-1.5 font-medium">保存人</th>
              <th class="px-2 py-1.5 font-medium">保存时间</th>
              <th class="px-2 py-1.5 text-center font-medium">参数快照</th>
              <th class="px-2 py-1.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in archives" :key="a.id" class="border-b border-gray-50 hover:bg-gray-50/60">
              <td class="px-2 py-1.5 text-gray-700">
                <span class="text-gray-400">#{{ a.id }}</span>
                <span class="ml-1 font-medium">{{ a.name }}</span>
                <span v-if="a.siteLabel" class="block text-[11px] text-gray-400" :title="a.siteLabel">{{ a.siteLabel }}</span>
              </td>
              <td class="px-2 py-1.5 text-gray-600">{{ a.engineLabel }}</td>
              <td class="px-2 py-1.5 text-right text-gray-600">{{ a.itemCount == null ? '—' : a.itemCount.toLocaleString('zh-CN') }}</td>
              <td class="px-2 py-1.5 text-right" :class="a.unresolvedCount ? 'text-amber-600' : 'text-gray-400'">
                {{ a.unresolvedCount == null ? '—' : a.unresolvedCount }}
              </td>
              <td class="px-2 py-1.5 text-right font-mono text-gray-800">{{ a.totalAmount == null ? '—' : fmt(a.totalAmount) }}</td>
              <td class="px-2 py-1.5 text-gray-600">{{ a.operatorName || '—' }}</td>
              <td class="whitespace-nowrap px-2 py-1.5 text-gray-500">{{ a.createdAt }}</td>
              <td class="px-2 py-1.5 text-center">
                <span :class="a.hasSnapshot ? 'text-emerald-600' : 'text-amber-600'">{{ a.hasSnapshot ? '有' : '无' }}</span>
              </td>
              <td class="whitespace-nowrap px-2 py-1.5">
                <button class="text-primary hover:underline" @click="reproduceArchive(a.id)">复现</button>
                <button class="ml-2 text-primary hover:underline" @click="loadArchive(a)">载入</button>
                <button class="ml-2 text-primary hover:underline" :disabled="!a.hasSnapshot" @click="exportArchive(a)">导出</button>
                <button class="ml-2 text-red-500 hover:underline" @click="deleteArchive(a)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── 测算说明（可折叠）────────────────────────────────── -->
    <div v-if="showHelp" class="card mt-5 !p-6">
      <h2 class="mb-1 text-lg font-semibold text-gray-900">运维费用是怎么算出来的</h2>
      <p class="mb-5 text-sm text-gray-500">
        本页有两套算法，口径来自两本源表，可随时切换对照。所有数字都取自后台
        <NuxtLink to="/admin/data" class="text-primary hover:underline">数据维护 → 运维参数</NuxtLink>，
        代码里没有写死任何常数 —— 后台改完，这里重算即生效。
      </p>
      <p v-if="!help.hasResult" class="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
        下面公式里带具体数值的地方，要<b>测算过一次</b>才会显示本次实际取值（现在显示「—」）。
        先点上方「载入设备库清单」或「载入示例清单」，再回来看就是真实数字了。
      </p>

      <!-- C.1 -->
      <div class="rounded-xl border" :class="engine === 'c1' ? 'border-primary/30 bg-primary/[0.03]' : 'border-gray-200'">
        <div class="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
          <h3 class="text-sm font-semibold text-gray-800">一、C.1 工作量法</h3>
          <span class="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">按「干这些活需要多少人工」算钱</span>
          <span v-if="engine === 'c1'" class="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">当前使用</span>
        </div>
        <div class="space-y-3 px-4 py-3 text-sm leading-relaxed text-gray-600">
          <p>
            <b class="text-gray-800">一句话：</b>先算出这些设备一年需要多少「人天」（一个人干一天算 1 人天），
            再乘上一个人一天的成本，就是人工费；最后按国家规定的取费结构加上各项费用。
          </p>
          <div>
            <div class="mb-1 font-medium text-gray-700">第 1 步 · 每一行设备的金额</div>
            <div class="rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700">
              单行金额 = 数量 × 修正工作量 × 修正单价
            </div>
            <ul class="mt-2 ml-4 list-disc space-y-1 text-xs">
              <li>
                <b>修正工作量</b> = 单位工作量 × 工作量因子 {{ help.workloadFactor ?? '—' }}
                <span class="text-gray-400">
                  —— 单位工作量是该类设备「每台每年需要多少维护人天」，取自国标《GB/T 28827.7》配套的
                  《中国软件行业基准数据》附录 C.1，在后台「C.1 单位工作量基准」按设备类别维护；
                  工作量因子是后台「调整因子」里若干因子连乘的结果。
                </span>
              </li>
              <li>
                <b>人天单价</b> = 月工资 ÷ 月计薪天数 = {{ fmt(help.monthlyWage) }} ÷ {{ help.workDays }} =
                <b class="text-gray-800">{{ fmt(help.dailyRate) }}</b> 元/人天
                <span class="text-gray-400">—— 工资基数在后台「人工成本基数」维护，不同年份/地区的标准可并存、下拉切换。</span>
              </li>
              <li>
                <b>价格因子</b> = 人员配备系数 {{ help.staffCoef ?? '—' }} × 服务周期系数 × 服务频率系数 × 生存周期系数
                = <b class="text-gray-800">{{ help.priceFactor != null ? help.priceFactor.toFixed(4) : '—' }}</b>
                <span class="text-gray-400">
                  —— 前一项是后台「调整因子」里按服务等级加权得来；后三项同样是后台因子连乘。
                  若设备的站点类型不同（管理处监控中心 / 泵站 / 闸站…），还会再乘该站点类型的「服务时间系数」。
                </span>
              </li>
              <li>
                <b>修正单价</b> = 人天单价 {{ fmt(help.dailyRate) }} × 价格因子
                {{ help.priceFactor != null ? help.priceFactor.toFixed(4) : '—' }} =
                {{ help.priceFactor != null ? fmt(help.dailyRate * help.priceFactor) : '—' }} 元
              </li>
            </ul>
          </div>
          <div>
            <div class="mb-1 font-medium text-gray-700">第 2 步 · 把明细行汇总成总费用</div>
            <ol class="ml-4 list-decimal space-y-1 text-xs">
              <li>把上面每一行的金额相加 = <b>人工费</b>（费用汇总里的「人工费（明细合计）」）。</li>
              <li>加<b>其他直接费</b>：规费、直接非人力成本、措施项目费。每一项都以「人工费」或「人天」为计费基数，乘以各自费率 —— 基数和费率都写在后台「费率项」里，页面上每行都会注明「计费基数：XX × 费率」。</li>
              <li><b>直接费小计</b> = 人工费 + 其他直接费。</li>
              <li>若勾选了「叠加运行维护管理服务费」，则再按直接费小计乘该费率（源表附表5）。加完后叫 <b>直接费</b>。</li>
              <li>加<b>间接费（企业管理费）</b> = 直接费 × 费率。</li>
              <li>加<b>利润</b> =（间接费 + 直接费）× 利润率。</li>
              <li>加<b>税金</b> =（间接费 + 直接费）× 税率。</li>
              <li><b>合计</b> = 直接费 + 间接费 + 利润 + 税金。</li>
            </ol>
          </div>
        </div>
      </div>

      <!-- 定额 -->
      <div class="mt-4 rounded-xl border" :class="engine === 'quota' ? 'border-primary/30 bg-primary/[0.03]' : 'border-gray-200'">
        <div class="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
          <h3 class="text-sm font-semibold text-gray-800">二、定额单价法</h3>
          <span class="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">按「每台每月多少钱」的行业定额算钱</span>
          <span v-if="engine === 'quota'" class="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">当前使用</span>
        </div>
        <div class="space-y-3 px-4 py-3 text-sm leading-relaxed text-gray-600">
          <p>
            <b class="text-gray-800">一句话：</b>照 2008 年行业设备维护定额，查出「这类设备一台一个月多少钱」，
            按台账数量乘一年 12 个月，再按设备是硬件还是软件调整。
          </p>
          <div>
            <div class="mb-1 font-medium text-gray-700">第 1 步 · 每一行设备的金额</div>
            <div class="rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700">
              单行金额 = 数量 × 定额值(元/台·月) × {{ help.monthFactor }} 个月 × 类别系数
            </div>
            <ul class="mt-2 ml-4 list-disc space-y-1 text-xs">
              <li>
                <b>定额值</b>：在后台「定额单价库」按设备名维护，共 349 条。
                <span class="text-gray-400">
                  其中一部分不是固定数字，而是由后台参数算出来的（例如「月工资 ÷ 176 工时 × 功能点系数」），
                  所以改了工资基数或调整系数，这些定额值会自动跟着变 —— 后台里每条都有一句中文的「计算说明」。
                </span>
              </li>
              <li>
                <b>类别系数</b>：硬件 {{ help.hardCoef ?? '—' }}，软件 {{ help.softCoef ?? '—' }}。
                <span class="text-gray-400">
                  类别以「定额条目自带的类别」为准，不是按设备名猜的 —— 源表 7,851 条公式逐条反查确认，
                  只有 PLC应用系统 / UNITY PRO 两类走软件系数，其余（含名字里带"系统"的）都走硬件系数。
                </span>
              </li>
              <li>
                <b>点位数</b>：PLC应用系统、UNITY PRO 这两类是按功能点计价的，必须填点位数；
                没填时该行按 0 元计并提示，不会静默算错。
              </li>
              <li>
                定额法使用自己的工资锚点：<b>{{ fmt(help.quotaWage) }} 元/月</b>、
                运维单价调整系数 <b>{{ help.wageRatio }}</b>、功能点调整系数 <b>{{ help.fpCoef }}</b>
                <span class="text-gray-400">（与 C.1 法的人天单价基数分开维护，两法不串用）。</span>
              </li>
            </ul>
          </div>
          <div>
            <div class="mb-1 font-medium text-gray-700">第 2 步 · 把明细行汇总成总费用</div>
            <ol class="ml-4 list-decimal space-y-1 text-xs">
              <li>明细行金额相加 = <b>直接运维费</b>（费用汇总里的「直接运维费（明细合计）」）。</li>
              <li>加<b>其他直接费</b>后得到 <b>直接费小计</b>（同 C.1 法的第 2 步）。</li>
              <li>加<b>税金</b> = 直接费 × 税率。</li>
              <li>加<b>备品备件费</b> =（直接费 + 税金）× 费率 —— 注意它的计费基数含税金，这是源表口径。</li>
              <li><b>合计</b> = 直接费 + 税金 + 备品备件费。</li>
            </ol>
            <p class="mt-2 ml-4 text-xs text-gray-400">
              注：源表里还列了「措施项目费」和「暂列金」，但它们在实际公式中并未被引用，
              为忠实还原源表口径，系统将其标记为「不参与计算」。
            </p>
          </div>
        </div>
      </div>

      <!-- 数据来源 -->
      <div class="mt-4 rounded-xl border border-gray-200 px-4 py-3 text-sm leading-relaxed text-gray-600">
        <h3 class="mb-2 text-sm font-semibold text-gray-800">三、数据是从哪来的</h3>
        <ul class="ml-4 list-disc space-y-1 text-xs">
          <li>
            <b>设备台账</b>：把「清单来源」切到「设备价格库」，就会从本系统设备价格库读取真实台账
            （<span class="text-gray-500">devices / stations / station_devices 三表</span>），
            可点「选择站点」按管理处、子站任意勾选，也可一键全选。
            <span class="text-amber-600">各管理处的「全站设备汇总」行已自动排除，不会重复计价。</span>
          </li>
          <li>
            <b>取费参数</b>：全部存在后台「数据维护 → 运维参数」的 7 张表里 ——
            人工成本基数、调整因子、费率项、C.1 单位工作量基准、定额单价库、站点类型、设备取费映射。
            <NuxtLink to="/admin/data" class="text-primary hover:underline">去维护 →</NuxtLink>
          </li>
          <li>
            <b>自动匹配</b>：载入设备库时，系统会先按设备名自动匹配定额条目、按「设备取费映射」给出 C.1 类别。
            匹配只是<b>初值</b>，每一行都可以手工改。没匹配上的行会淡黄高亮并计入「待确认」，
            按 0 元计入结果（宁可留给人判断，也不擅自给出可能错的取费）。
          </li>
          <li>
            <b>口径来源</b>：两套算法分别对照《参照国标进行测算（结合配套实际）》和
            《设备台账__数据对齐版》两本源表逐单元格实现，源表里的公式、基数、费率都已逐条核对过。
          </li>
        </ul>
      </div>

      <!-- 精度与舍入：与源表 Excel 对账时最容易引起「算错了」争议的地方，先把规则说清 -->
      <div class="mt-4 rounded-xl border border-gray-200 px-4 py-3 text-sm leading-relaxed text-gray-600">
        <h3 class="mb-2 text-sm font-semibold text-gray-800">四、精度与舍入（怎么和 Excel 对账）</h3>
        <ul class="ml-4 list-disc space-y-1 text-xs">
          <li>参数取值按数据库原始精度参与计算，中间不做截断。</li>
          <li>逐行金额由「数量 × 单价」直接得出，仅在<b>展示</b>时保留 2 位小数（四舍五入），与 Excel 单元格的显示口径一致。</li>
          <li>汇总金额<b>先按原始精度加总、最后一次性舍入</b> —— 即「先加总后舍入」，与 Excel 的 SUM 行为一致。</li>
          <li>
            因此本系统与源表 Excel 的差异只可能落在浮点末位（分/角以下），不会出现「逐行先舍入再相加」
            造成的系统性偏差。逐行对账时建议容差取
            <b>±0.05 元/行</b>；超出这个范围的差异一定不是舍入问题，要查明原因。
          </li>
        </ul>
      </div>

      <!-- 单行追溯 -->
      <div class="mt-4 rounded-xl border border-primary/20 bg-primary/[0.03] px-4 py-3 text-sm leading-relaxed text-gray-600">
        <h3 class="mb-2 text-sm font-semibold text-gray-800">五、想知道某一行的钱具体怎么来的？</h3>
        <p class="text-xs">
          明细表每一行的「操作」列都有<b>追溯</b>按钮，点开就是这一行的完整推导链：
          单位工作量取自哪个 C.1 类别、工作量因子由哪几个因子连乘、人天单价怎么折算、
          定额条目是固定值还是推导式现算、类别系数为什么取硬件还是软件……
          每一步都标明出处，并列出该行依赖的权威来源。
          <span class="text-gray-500">
            追溯的每一步都由真正算钱的引擎给出（不是在页面上另拼一套算式），所以它和金额永远对得上；
            后台改完参数重新测算，追溯内容会同步变化。
          </span>
        </p>
      </div>
    </div>

    <!-- ── 站点筛选弹窗 ─────────────────────────────────────── -->
    <div
      v-if="showSitePicker"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      @click.self="showSitePicker = false"
    >
      <div class="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
        <div class="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h3 class="text-lg font-semibold text-gray-900">选择要测算的站点</h3>
            <p class="mt-0.5 text-xs text-gray-400">按管理处 / 子站勾选；各管理处的「全站设备汇总」已自动排除，不会重复计价。</p>
          </div>
          <button class="text-gray-400 hover:text-gray-600" @click="showSitePicker = false">✕</button>
        </div>

        <!-- 全选 -->
        <div class="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-6 py-2.5">
          <label class="flex items-center gap-2 text-sm font-medium text-gray-800">
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-gray-300"
              :checked="isAllSites"
              @change="toggleAllSites(($event.target as HTMLInputElement).checked)"
            >
            全选
            <span class="text-xs font-normal text-gray-400">
              {{ siteTree.length }} 个管理处 · {{ allLeafKeys.length }} 个子站 · 共 {{ allRowsCount.toLocaleString('zh-CN') }} 行设备
            </span>
          </label>
          <span class="text-xs text-gray-500">
            已选 <b class="text-gray-800">{{ selectedSites.length }}</b> 个子站 ·
            <b class="text-gray-800">{{ selectedRowsCount.toLocaleString('zh-CN') }}</b> 行设备
          </span>
        </div>

        <div class="min-h-0 flex-1 overflow-auto px-6 py-4">
          <div v-if="!siteTree.length" class="py-10 text-center text-sm text-gray-400">站点加载中…</div>
          <div v-for="g in siteTree" :key="g.station" class="mb-4">
            <label class="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-gray-300"
                :checked="isGroupChecked(g.station)"
                :indeterminate="isGroupIndeterminate(g.station)"
                @change="toggleGroup(g.station, ($event.target as HTMLInputElement).checked)"
              >
              {{ g.station }}
              <span class="text-xs font-normal text-gray-400">{{ g.count.toLocaleString('zh-CN') }} 行 · {{ g.subsites.length }} 个子站</span>
            </label>
            <div class="ml-5 mt-1 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
              <label v-for="s in g.subsites" :key="s.name" class="flex items-center gap-1.5 text-xs text-gray-600">
                <input
                  type="checkbox"
                  class="h-3.5 w-3.5 rounded border-gray-300"
                  :checked="isSubChecked(g.station, s.name)"
                  @change="toggleSub(g.station, s.name, ($event.target as HTMLInputElement).checked)"
                >
                <span class="truncate" :title="s.name">{{ s.name }}</span>
                <span class="shrink-0 text-gray-300">{{ s.count }}</span>
              </label>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between border-t border-gray-100 px-6 py-4">
          <button
            class="text-xs text-gray-400 hover:text-gray-600"
            @click="selectedSites = []"
          >清空选择</button>
          <div class="flex gap-3">
            <button class="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100" @click="showSitePicker = false">
              取消
            </button>
            <button
              class="rounded-lg border border-primary bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90 disabled:opacity-50"
              :disabled="isNoSite"
              @click="applySiteSelection"
            >
              确定并载入（{{ selectedRowsCount.toLocaleString('zh-CN') }} 行）
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── 单行追溯抽屉：点一个金额，看它怎么来的 ──────────────── -->
    <div
      v-if="showTrace"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      @click.self="showTrace = false"
    >
      <div class="flex max-h-[86vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
        <div class="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-4">
          <div class="min-w-0">
            <h3 class="text-lg font-semibold text-gray-900">这一行的钱是怎么算出来的</h3>
            <p class="mt-0.5 truncate text-xs text-gray-500" :title="traceRow?.name || ''">
              {{ traceRow?.name }}<span v-if="traceRow?.station">　·　{{ traceRow.station }}</span>
            </p>
          </div>
          <button class="shrink-0 text-gray-400 hover:text-gray-600" @click="showTrace = false">✕</button>
        </div>

        <div class="min-h-0 flex-1 overflow-auto px-6 py-4">
          <div v-if="traceLoading" class="py-12 text-center text-sm text-gray-400">正在读取后台参数并逐步还原…</div>

          <template v-else-if="traceData">
            <p
              v-if="traceData.warn"
              class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700"
            >{{ traceData.warn }}</p>

            <div class="mb-4 rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs leading-relaxed text-gray-700">
              {{ traceData.formula }}
            </div>

            <ol class="space-y-3">
              <li
                v-for="(s, si) in traceData.steps"
                :key="si"
                class="border-l-2 pl-3"
                :class="s.final ? 'border-primary' : 'border-gray-200'"
              >
                <div class="text-sm" :class="s.final ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'">
                  {{ s.label }}
                </div>
                <div class="mt-0.5 font-mono text-xs leading-relaxed text-gray-600">{{ s.detail }}</div>
                <div v-if="s.from" class="mt-0.5 text-[11px] text-gray-400">出处：{{ s.from }}</div>
              </li>
            </ol>

            <div v-if="traceData.refs && traceData.refs.length" class="mt-5 rounded-xl border border-gray-200 px-4 py-3">
              <h4 class="mb-2 text-sm font-semibold text-gray-800">本行金额依赖的权威出处</h4>
              <ul class="ml-4 list-disc space-y-1 text-xs leading-relaxed text-gray-600">
                <li v-for="(r, ri) in traceData.refs" :key="ri">
                  {{ r.text }}<span class="text-gray-400">（{{ r.from }}）</span>
                </li>
              </ul>
            </div>

            <p class="mt-4 text-[11px] leading-relaxed text-gray-400">
              每一步的乘数都与上表金额同源 —— 追溯面板不另算一套，后台改完参数重新测算即同步变化。
              数值按原始精度参与计算，逐行金额仅在展示时保留 2 位小数；汇总为先加总后舍入（与 Excel 的 SUM 一致）。
            </p>
          </template>
        </div>

        <div class="flex items-center gap-3 border-t border-gray-100 px-6 py-4">
          <NuxtLink to="/admin/data" class="mr-auto text-xs text-primary hover:underline">去「数据维护 → 运维参数」改参数 →</NuxtLink>
          <button class="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100" @click="showTrace = false">
            关闭
          </button>
        </div>
      </div>
    </div>

    <!-- ── 复现弹窗：能不能算回同一个数 / 今天再算会差多少 ────── -->
    <div
      v-if="showRepro"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      @click.self="showRepro = false"
    >
      <div class="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
        <div class="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-4">
          <div class="min-w-0">
            <h3 class="text-lg font-semibold text-gray-900">存档复现</h3>
            <p class="mt-0.5 truncate text-xs text-gray-500">
              <template v-if="reproResult">#{{ reproResult.id }}《{{ reproResult.name }}》 · {{ reproResult.itemCount.toLocaleString('zh-CN') }} 行</template>
              <template v-else>正在用存档中的参数快照重算…</template>
            </p>
          </div>
          <button class="shrink-0 text-gray-400 hover:text-gray-600" @click="showRepro = false">✕</button>
        </div>

        <div class="min-h-0 flex-1 overflow-auto px-6 py-4">
          <div v-if="reproLoading" class="py-12 text-center text-sm text-gray-400">正在读取快照并重算…</div>

          <template v-else-if="reproResult">
            <div
              v-if="!reproResult.hasSnapshot"
              class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700"
            >
              这个存档没有参数快照（很可能是启用快照功能之前保存的），无法复现当时的口径。
              它只记录了金额，无法回答「当时用的是哪套参数」。
            </div>

            <template v-else>
              <!-- ① 能不能算回来 -->
              <div
                class="mb-4 rounded-lg border px-4 py-3 text-sm"
                :class="reproResult.reproducible ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'"
              >
                <b>{{ reproResult.reproducible ? '✓ 可复现：用存档参数重算，金额与存档完全一致' : '✗ 复现不一致，请核查' }}</b>
                <div class="mt-1 text-xs leading-relaxed">
                  存档金额 {{ fmt(reproResult.storedTotal) }} 元；快照重算
                  {{ fmt(reproResult.snapshotTotal) }} 元。
                  <template v-if="reproResult.snapshotItemDrift > 0">
                    另有 {{ reproResult.snapshotItemDrift }} 行明细金额对不上（逐行误差 &gt; 0.01 元）。
                  </template>
                  <template v-else-if="reproResult.snapshotItemDrift < 0">
                    存档明细未留存完整行数据，无法逐行比对（仅比对了总额）。
                  </template>
                  <template v-else>逐行明细也全部一致。</template>
                </div>
              </div>

              <!-- ② 今天再算会差多少 -->
              <h4 class="mb-2 text-sm font-semibold text-gray-800">若改用【当前参数】重算同一份清单</h4>
              <div class="mb-4 overflow-hidden rounded-lg border border-gray-200">
                <table class="w-full text-xs">
                  <thead class="bg-gray-50 text-left text-gray-500">
                    <tr>
                      <th class="px-3 py-2 font-medium">口径</th>
                      <th class="px-3 py-2 text-right font-medium">金额(元)</th>
                      <th class="px-3 py-2 text-right font-medium">与存档差额</th>
                      <th class="px-3 py-2 text-right font-medium">差额比例</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr class="border-t border-gray-100">
                      <td class="px-3 py-2 text-gray-700">存档金额（当时的口径）</td>
                      <td class="px-3 py-2 text-right font-mono text-gray-800">{{ fmt(reproResult.storedTotal) }}</td>
                      <td class="px-3 py-2 text-right text-gray-400">—</td>
                      <td class="px-3 py-2 text-right text-gray-400">—</td>
                    </tr>
                    <tr class="border-t border-gray-100 bg-gray-50/50">
                      <td class="px-3 py-2 text-gray-700">用存档快照重算（校验）</td>
                      <td class="px-3 py-2 text-right font-mono text-gray-800">{{ fmt(reproResult.snapshotTotal) }}</td>
                      <td class="px-3 py-2 text-right font-mono" :class="Math.abs(reproResult.snapshotTotal - reproResult.storedTotal) < 0.01 ? 'text-emerald-600' : 'text-red-600'">
                        {{ fmt(reproResult.snapshotTotal - reproResult.storedTotal) }}
                      </td>
                      <td class="px-3 py-2 text-right text-gray-400">—</td>
                    </tr>
                    <tr class="border-t border-gray-100">
                      <td class="px-3 py-2 text-gray-700">用当前参数重算</td>
                      <td class="px-3 py-2 text-right font-mono text-gray-800">{{ fmt(reproResult.currentTotal) }}</td>
                      <td class="px-3 py-2 text-right font-mono" :class="Math.abs(reproResult.drift) < 0.01 ? 'text-gray-400' : 'text-amber-600'">
                        {{ reproResult.drift > 0 ? '+' : '' }}{{ fmt(reproResult.drift) }}
                      </td>
                      <td class="px-3 py-2 text-right" :class="Math.abs(reproResult.drift) < 0.01 ? 'text-gray-400' : 'text-amber-600'">
                        {{ reproResult.driftPct > 0 ? '+' : '' }}{{ reproResult.driftPct.toFixed(2) }}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-if="reproResult.currentUnresolved > 0" class="mb-4 text-xs text-amber-600">
                注意：用当前参数重算时有 {{ reproResult.currentUnresolved }} 行未匹配到取费参数（按 0 计），
                也会拉低金额 —— 差额不一定全是费率变化造成的。
              </p>

              <!-- ③ 是哪个参数造成的 -->
              <h4 class="mb-2 text-sm font-semibold text-gray-800">
                存档参数 与 当前参数 的差异
                <span class="ml-1 font-normal text-gray-400">
                  （共 {{ reproResult.paramChanges.total }} 处<template v-if="reproResult.paramChanges.total > reproResult.paramChanges.items.length">，仅显示前 {{ reproResult.paramChanges.items.length }} 处</template>）
                </span>
              </h4>
              <p v-if="!reproResult.paramChanges.total" class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                参数没有任何变化 —— 当前参数与存档时完全一致。
              </p>
              <div v-else class="table-scroll !max-h-[280px]">
                <table class="w-full text-xs">
                  <thead class="bg-gray-50 text-left text-gray-500">
                    <tr>
                      <th class="px-2 py-1.5 font-medium">参数表</th>
                      <th class="px-2 py-1.5 font-medium">条目</th>
                      <th class="px-2 py-1.5 font-medium">变动</th>
                      <th class="px-2 py-1.5 font-medium">存档时</th>
                      <th class="px-2 py-1.5 font-medium">当前</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(c, ci) in reproResult.paramChanges.items" :key="ci" class="border-b border-gray-50">
                      <td class="px-2 py-1.5 text-gray-500">{{ c.tableLabel }}</td>
                      <td class="px-2 py-1.5 text-gray-700">
                        <span :title="c.key">{{ c.key.length > 30 ? c.key.slice(0, 30) + '…' : c.key }}</span>
                      </td>
                      <td class="px-2 py-1.5">
                        <span v-if="c.type === 'changed'" class="text-gray-600">{{ c.label }}</span>
                        <span v-else-if="c.type === 'added'" class="text-emerald-600">新增（当时没有）</span>
                        <span v-else class="text-amber-600">停用/删除（当时参与计算）</span>
                      </td>
                      <td class="px-2 py-1.5 font-mono text-gray-500">
                        {{ c.type === 'changed' ? (c.old === null ? '—' : c.old) : (c.type === 'removed' ? '参与计算' : '—') }}
                      </td>
                      <td class="px-2 py-1.5 font-mono text-gray-800">
                        {{ c.type === 'changed' ? (c.new === null ? '—' : c.new) : (c.type === 'added' ? '参与计算' : '—') }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p class="mt-4 text-[11px] leading-relaxed text-gray-400">
                快照里的参数表行数：{{ JSON.stringify(reproResult.snapshotCounts || {}) }}。
                复现用的是存档时点那一整套参数（含被停用的项），与当前参数无关；
                这条链路和页面上的「追溯」同源 —— 都由真正算钱的引擎现算，不另写一套。
              </p>
            </template>
          </template>
        </div>

        <div class="flex items-center gap-3 border-t border-gray-100 px-6 py-4">
          <NuxtLink to="/admin/logs" class="mr-auto text-xs text-primary hover:underline">
            看参数是谁什么时候改的（审计日志）→
          </NuxtLink>
          <button class="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100" @click="showRepro = false">
            关闭
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
