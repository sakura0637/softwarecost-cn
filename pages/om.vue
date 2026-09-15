<script setup lang="ts">
// 运维费用测算（双引擎，可切换）
//   C.1 工作量法：数量 × (单位工作量 × 工作量因子) × (人天单价 × 价格因子)
//   定额单价法：数量 × 定额值(元/月) × 12 × 类别系数(硬件/软件)
// 所有系数/费率/基准/定额都来自后台【数据维护 → 运维参数】，本页只读不写死。
useHead({ title: '运维费用测算 · 水网数智造价系统' })

type Engine = 'c1' | 'quota'

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
}

const engine = ref<Engine>('c1')
const wageBaseId = ref<number | null>(null)
const rows = ref<Row[]>([])
const scaleByStation = ref(true)
const mgmtEnabled = ref(false)
const mgmtRate = ref<number | null>(null)

const params = ref<any>(null)
const sample = ref<any>(null)
const result = ref<any>(null)
const unresolved = ref<any[]>([])
const loading = ref(false)
const calculating = ref(false)
const errorMsg = ref('')

// ── 数据装载 ───────────────────────────────────────────────
async function loadParams() {
  try {
    const q = wageBaseId.value ? `?wage_base_id=${wageBaseId.value}` : ''
    params.value = await $fetch(`/api/om/params${q}`)
    if (wageBaseId.value == null && params.value?.wage?.id) wageBaseId.value = params.value.wage.id
    // 管理服务费率默认取后台 mgmt_service 组的第一条（低档 10%）
    const mg = (params.value?.rates || []).find((x: any) => x.group_key === 'mgmt_service')
    if (mg && mgmtRate.value == null) mgmtRate.value = Number(mg.rate)
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage || e?.message || '参数加载失败'
  }
}

async function loadSample() {
  loading.value = true
  errorMsg.value = ''
  try {
    if (!sample.value) sample.value = await $fetch('/api/om/sample')
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
    }))
    await calculate()
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage || e?.message || '示例载入失败'
  } finally {
    loading.value = false
  }
}

function clearRows() {
  rows.value = []
  result.value = null
  unresolved.value = []
}

function addRow() {
  rows.value.unshift({
    station: engine.value === 'c1' ? '指挥调度中心' : '',
    sheet_no: 1, category: '', no: '', name: '', unit: '', qty: 1,
    category_ref: '', workload: null, quota_ref: '', quota_value: null,
    kind: '', point_count: null, billable: true, note: '',
  })
}

function delRow(i: number) {
  rows.value.splice(i, 1)
}

// ── 计算 ───────────────────────────────────────────────────
async function calculate() {
  if (!rows.value.length) {
    result.value = null
    return
  }
  calculating.value = true
  errorMsg.value = ''
  try {
    const payload = {
      engine: engine.value,
      wage_base_id: wageBaseId.value,
      mgmt_service_rate: mgmtEnabled.value ? Number(mgmtRate.value) || 0 : 0,
      items: rows.value.map((r, i) => ({
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
      })),
    }
    const res: any = await $fetch('/api/om/calculate', { method: 'POST', body: payload })
    result.value = res.result
    unresolved.value = res.unresolved || []
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage || e?.message || '计算失败'
  } finally {
    calculating.value = false
  }
}

function switchEngine(v: Engine) {
  if (engine.value === v) return
  engine.value = v
  // 换引擎后原清单的引用字段不通用，清空结果并提示重算
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

watch(wageBaseId, () => { loadParams().then(() => rows.value.length && calculate()) })

// ── 格式化 ─────────────────────────────────────────────────
const fmt = (n: any) => (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const wan = (n: any) => ((Number(n) || 0) / 10000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const label = (t: string, c: string) => {
  const map: Record<string, string> = {
    engine: '适用引擎', unit: '取值类型', calc: '计算方式',
    hardware: '硬件', software: '软件',
  }
  if (t === 'engine') return map[c] || c
  if (t === 'unit') return map[c] || c
  if (t === 'calc') return map[c] || c
  return c
}

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

const engineHint = computed(() =>
  engine.value === 'c1'
    ? '数量 ×（单位工作量 × 工作量因子）×（人天单价 × 价格因子）'
    : '数量 × 定额值(元/月) × 12 × 类别系数'
)

onMounted(loadParams)
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
        <button class="btn-outline !px-4 !py-2 !text-sm" :disabled="loading" @click="loadSample">
          {{ loading ? '载入中…' : '载入示例清单' }}
        </button>
        <button class="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50" @click="clearRows">
          清空
        </button>
        <button class="btn-primary !px-5 !py-2 !text-sm" :disabled="calculating" @click="calculate">
          {{ calculating ? '计算中…' : '开始测算' }}
        </button>
      </div>
    </div>

    <p v-if="errorMsg" class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{{ errorMsg }}</p>

    <!-- 引擎 + 基数 -->
    <div class="card mb-5 !p-4">
      <div class="flex flex-wrap items-center gap-x-8 gap-y-3">
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

        <label class="flex items-center gap-2 text-sm text-gray-600">
          <input v-model="scaleByStation" type="checkbox" class="h-4 w-4 rounded border-gray-300" @change="rows.length && loadSample()">
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
              {{ r.name }}（{{ (Number(r.rate) * 100).toFixed(1) }}%）
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
            <h2 class="text-base font-semibold text-gray-800">设备清单</h2>
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
                    还没有清单。点右上角「载入示例清单」看效果，或「新增一行」手工录入。
                  </td>
                </tr>
                <tr v-for="(r, i) in rows" :key="i" class="border-b border-gray-50 hover:bg-gray-50/60" :class="{ 'bg-gray-50/40 text-gray-400': !r.billable }">
                  <td class="px-3 py-1.5">
                    <select v-model="r.station" class="w-32 rounded border border-transparent bg-transparent px-1 py-1 text-xs hover:border-gray-200 focus:border-primary focus:bg-white">
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
                        :class="result?.items?.[i]?.usedPointCount !== undefined && !result.items[i].usedPointCount ? 'border-amber-300' : ''"
                        title="按功能点计价的条目（PLC应用系统 / UNITY PRO）必填，否则该行按 0 计"
                      >
                    </td>
                  </template>
                  <td class="px-3 py-1.5 text-right font-mono text-xs text-gray-700">
                    <span v-if="!r.billable" class="text-[11px] text-gray-400">不计费</span>
                    <span v-else>{{ result?.items?.[i] ? fmt(result.items[i].amount) : '—' }}</span>
                  </td>
                  <td class="sticky right-0 bg-white px-3 py-1.5 text-center">
                    <button class="text-xs text-red-500 hover:underline" @click="delRow(i)">删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <datalist id="c1-options"><option v-for="c in c1Options" :key="c" :value="c" /></datalist>
          <datalist id="quota-options"><option v-for="c in quotaOptions" :key="c" :value="c" /></datalist>
        </div>

        <p v-if="unresolved.length" class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          有 <b>{{ unresolved.length }}</b> 行没匹配上参数（按 0 计入）：
          <span v-for="u in unresolved.slice(0, 6)" :key="u.index" class="mr-2">第{{ u.index }}行「{{ u.ref || u.name }}」</span>
          <span v-if="unresolved.length > 6">…</span>
          <br>在【数据维护 → 运维参数 → C.1 单位工作量基准 / 定额单价库】补一条，或在该行直接手填数值即可。
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
              <div class="flex items-center justify-between">
                <dt class="text-gray-600">{{ engine === 'c1' ? '人工费（明细合计）' : '直接运维费（明细合计）' }}</dt>
                <dd class="font-mono text-gray-800">{{ fmt(result.laborCost) }}</dd>
              </div>
              <div v-for="l in result.otherDirect" :key="l.key" class="flex items-center justify-between pl-3">
                <dt class="text-xs text-gray-500">{{ l.label }}<span class="ml-1 text-[10px] text-gray-300">×{{ l.rate }}</span></dt>
                <dd class="font-mono text-xs text-gray-600">{{ fmt(l.amount) }}</dd>
              </div>
              <div v-if="result.mgmtService" class="flex items-center justify-between pl-3">
                <dt class="text-xs text-gray-500">{{ result.mgmtService.label }}<span class="ml-1 text-[10px] text-gray-300">×{{ result.mgmtService.rate }}</span></dt>
                <dd class="font-mono text-xs text-gray-600">{{ fmt(result.mgmtService.amount) }}</dd>
              </div>
              <div class="flex items-center justify-between border-t border-gray-100 pt-2">
                <dt class="text-gray-600">{{ result.mgmtService ? '直接费' : '直接费小计' }}</dt>
                <dd class="font-mono font-medium text-gray-800">{{ fmt(result.directTotal) }}</dd>
              </div>
              <div v-for="l in result.indirect" :key="l.key" class="flex items-center justify-between pl-3">
                <dt class="text-xs text-gray-500">{{ l.label }}<span class="ml-1 text-[10px] text-gray-300">×{{ l.rate }}</span></dt>
                <dd class="font-mono text-xs text-gray-600">{{ fmt(l.amount) }}</dd>
              </div>
              <div v-if="result.tax" class="flex items-center justify-between">
                <dt class="text-gray-600">{{ result.tax.label }}<span class="ml-1 text-[10px] text-gray-300">×{{ result.tax.rate }}</span></dt>
                <dd class="font-mono text-gray-800">{{ fmt(result.tax.amount) }}</dd>
              </div>
              <div v-if="result.spare" class="flex items-center justify-between">
                <dt class="text-gray-600">{{ result.spare.label }}<span class="ml-1 text-[10px] text-gray-300">×{{ result.spare.rate }}</span></dt>
                <dd class="font-mono text-gray-800">{{ fmt(result.spare.amount) }}</dd>
              </div>
              <div v-for="l in (result.extra || [])" :key="l.key" class="flex items-center justify-between">
                <dt class="text-gray-600">{{ l.label }}<span class="ml-1 text-[10px] text-gray-300">×{{ l.rate }}</span></dt>
                <dd class="font-mono text-gray-800">{{ fmt(l.amount) }}</dd>
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
  </div>
</template>
