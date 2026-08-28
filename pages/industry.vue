<script setup lang="ts">
// 行业基准数据分析 —— CSBMK / CSBSG 双基准源并列对比
// 图表数据：/api/parameters（estimation_parameters，含 CSBMK-2025 / CSBSG-2021 参数集）
// 总览数据：/api/estimation-benchmarks（各标准核心计量参数）
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'

interface ParamValue { label: string; factor: number | string; desc?: string }
interface ParamRow {
  id: number
  standardId: string
  standardCode: string
  standardName: string
  edition: string
  region: string
  org: string
  category: string
  paramCategory: string
  paramName: string
  paramType: string
  unit: string
  values: ParamValue[]
  description: string
  seq: number
}
interface Benchmark {
  id: string
  standardCode: string
  standardName: string
  edition: string
  region: string
  level: string
  org: string
  category: string
  pdr: { all?: Record<string, number>; gov?: Record<string, number> } | null
  hm: number | null
  rate: number | null
  source: string
}

const params = ref<ParamRow[]>([])
const benchmarks = ref<Benchmark[]>([])
const loading = ref(false)

const SID_CSBMK = 'csbmk-2025'
const SID_CSBSG = 'csbsg-2021'

const SOURCES = [
  { sid: SID_CSBMK, label: 'CSBMK 2025', org: '北京软件造价评估技术创新联盟', color: '#2563eb' },
  { sid: SID_CSBSG, label: 'CSBSG 2021', org: '中国软件行业协会软件造价分会', color: '#f59e0b' },
]

function findParam(sid: string, name: string): ParamRow | undefined {
  return params.value.find((p) => p.standardId === sid && p.paramName === name)
}
function factorOf(p: ParamRow | undefined, label: string): number | null {
  if (!p) return null
  const hit = p.values.find((v) => v.label === label)
  if (!hit) return null
  const n = Number(hit.factor)
  return Number.isFinite(n) ? n : null
}

// ---------- 各参数取数 ----------
const csbmkProd = computed(() => findParam(SID_CSBMK, '软件开发生产率（全行业分位）'))
const csbsgProd = computed(() => findParam(SID_CSBSG, '软件开发生产率（全行业分位）'))
const csbmkDomain = computed(() => findParam(SID_CSBMK, '软件开发生产率（分业务领域 P50）'))
const csbsgDomain = computed(() => findParam(SID_CSBSG, '软件开发生产率（分行业 P50）'))
const csbmkWl = computed(() => findParam(SID_CSBMK, '各工程活动工作量分布'))
const csbsgWl = computed(() => findParam(SID_CSBSG, '各工程活动工作量分布'))
const csbmkMaintProd = computed(() => findParam(SID_CSBMK, '应用软件运维生产率（分位）'))
const csbmkMaintRatio = computed(() => findParam(SID_CSBMK, '年度运维费用占软件开发费用比例'))
const csbmkFactors = computed(() => findParam(SID_CSBMK, '调整因子类别'))
const csbsgFactors = computed(() => findParam(SID_CSBSG, '调整因子类别'))
const csbmkUfp = computed(() => findParam(SID_CSBMK, '功能点取值（UFP权重）'))

const PCT = ['P10', 'P25', 'P50', 'P75', 'P90']
const WORKLOAD_COLORS = ['#2563eb', '#0891b2', '#059669', '#f59e0b', '#dc2626']

// ---------- 图表 ----------
const chartEls: Record<string, any> = {}
const chartInst: Record<string, any> = {}
let ec: any = null
const setRef = (key: string) => (el: any) => {
  if (el) chartEls[key] = el
  else delete chartEls[key]
}

const axisBase = {
  axisLabel: { fontSize: 11 },
  axisLine: { lineStyle: { color: '#d1d5db' } },
}
const splitBase = { splitLine: { lineStyle: { color: '#f3f4f6' } } }

function barSeriesOf(p: ParamRow | undefined, name: string, color: string) {
  return {
    name,
    type: 'bar',
    barMaxWidth: 28,
    itemStyle: { color, borderRadius: [4, 4, 0, 0] },
    data: p ? p.values.map((v) => ({ label: v.label, val: Number(v.factor) })) : [],
  }
}

const chartOptions = computed<Record<string, any>>(() => {
  const opts: Record<string, any> = {}

  // 1) 产品开发生产率分位对比（两套基准源类别一致，做分组柱状）
  opts.prodPct = {
    tooltip: { trigger: 'axis', valueFormatter: (v: any) => (v == null ? '-' : `${v} 人时/功能点`) },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 20, right: 24, top: 32, bottom: 48, containLabel: true },
    xAxis: { type: 'category', data: PCT, ...axisBase },
    yAxis: {
      type: 'value',
      name: '人时/功能点',
      nameTextStyle: { fontSize: 11, color: '#6b7280' },
      axisLabel: { fontSize: 11 },
      ...splitBase,
    },
    series: [
      { ...barSeriesOf(csbmkProd.value, 'CSBMK 2025', '#2563eb'), data: PCT.map((p) => factorOf(csbmkProd.value, p)) },
      { ...barSeriesOf(csbsgProd.value, 'CSBSG 2021', '#f59e0b'), data: PCT.map((p) => factorOf(csbsgProd.value, p)) },
    ],
  }

  // 2) 分业务领域生产率（两套基准源领域划分不同，分别成图）
  const domainChart = (p: ParamRow | undefined, title: string, color: string): any => ({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: any) => `${v} 人时/功能点` },
    grid: { left: 20, right: 24, top: 16, bottom: 20, containLabel: true },
    xAxis: {
      type: 'value',
      name: '人时/FP',
      nameTextStyle: { fontSize: 11, color: '#6b7280' },
      axisLabel: { fontSize: 11 },
      ...splitBase,
    },
    yAxis: { type: 'category', data: (p?.values || []).map((v) => v.label), ...axisBase },
    series: [
      {
        name: title,
        type: 'bar',
        barMaxWidth: 14,
        itemStyle: { color, borderRadius: [0, 4, 4, 0] },
        data: (p?.values || []).map((v) => Number(v.factor)),
      },
    ],
  })
  opts.domainCsbmk = domainChart(csbmkDomain.value, 'CSBMK 2025', '#2563eb')
  opts.domainCsbsg = domainChart(csbsgDomain.value, 'CSBSG 2021', '#f59e0b')

  // 3) 各工程活动工作量分布（堆叠条形）
  const workloadChart = (p: ParamRow | undefined, title: string): any => ({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: any) => `${v}%` },
    legend: { bottom: 0, textStyle: { fontSize: 10 } },
    grid: { left: 20, right: 24, top: 16, bottom: 48, containLabel: true },
    xAxis: { type: 'value', max: 100, name: '%', nameTextStyle: { fontSize: 11, color: '#6b7280' }, axisLabel: { fontSize: 11 }, ...splitBase },
    yAxis: { type: 'category', data: [title], ...axisBase },
    series: (p?.values || []).map((v, i) => ({
      name: v.label,
      type: 'bar',
      stack: 'total',
      barMaxWidth: 44,
      itemStyle: { color: WORKLOAD_COLORS[i % WORKLOAD_COLORS.length] },
      label: { show: true, fontSize: 10, formatter: '{c}%' },
      data: [Number(v.factor)],
    })),
  })
  opts.wlCsbmk = workloadChart(csbmkWl.value, 'CSBMK 2025')
  opts.wlCsbsg = workloadChart(csbsgWl.value, 'CSBSG 2021')

  // 4) 运维生产率分位（仅 CSBMK）
  opts.maintProd = {
    tooltip: { trigger: 'axis', valueFormatter: (v: any) => (v == null ? '-' : `${v} 人时/功能点`) },
    grid: { left: 20, right: 24, top: 24, bottom: 20, containLabel: true },
    xAxis: { type: 'category', data: PCT, ...axisBase },
    yAxis: { type: 'value', name: '人时/功能点', nameTextStyle: { fontSize: 11, color: '#6b7280' }, axisLabel: { fontSize: 11 }, ...splitBase },
    series: [
      {
        name: '运维生产率',
        type: 'bar',
        barMaxWidth: 28,
        itemStyle: { color: '#7c3aed', borderRadius: [4, 4, 0, 0] },
        data: PCT.map((p) => factorOf(csbmkMaintProd.value, p)),
      },
    ],
  }

  // 5) 年度运维费用占开发费用比例（仅 CSBMK）
  opts.maintRatio = {
    tooltip: { trigger: 'axis', valueFormatter: (v: any) => (v == null ? '-' : `${v}%`) },
    grid: { left: 20, right: 24, top: 24, bottom: 20, containLabel: true },
    xAxis: { type: 'category', data: PCT, ...axisBase },
    yAxis: { type: 'value', name: '占开发费用%', nameTextStyle: { fontSize: 11, color: '#6b7280' }, axisLabel: { fontSize: 11 }, ...splitBase },
    series: [
      {
        name: '运维费用占比',
        type: 'bar',
        barMaxWidth: 28,
        itemStyle: { color: '#0d9488', borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', fontSize: 10, formatter: '{c}%' },
        data: PCT.map((p) => factorOf(csbmkMaintRatio.value, p)),
      },
    ],
  }

  return opts
})

async function ensureEcharts() {
  if (!ec) ec = await import('echarts')
  return ec
}

async function renderAll() {
  await nextTick()
  const keys = Object.keys(chartEls)
  if (!keys.length) return
  await ensureEcharts()
  for (const key of keys) {
    const opt = chartOptions.value[key]
    if (!opt) continue
    if (!chartInst[key]) chartInst[key] = ec.init(chartEls[key])
    chartInst[key].setOption(opt, true)
  }
}
function onResize() {
  for (const k of Object.keys(chartInst)) chartInst[k]?.resize()
}
watch(chartOptions, renderAll)

// ---------- 加载 ----------
async function load() {
  loading.value = true
  try {
    const [pr, bm] = await Promise.all([
      $fetch('/api/parameters') as Promise<any>,
      $fetch('/api/estimation-benchmarks') as Promise<any>,
    ])
    params.value = (pr.parameters || []).map((p: any) => ({
      ...p,
      values: Array.isArray(p.values) ? p.values : [],
    }))
    benchmarks.value = bm.benchmarks || []
  } catch {
    params.value = []
    benchmarks.value = []
  } finally {
    loading.value = false
    await renderAll()
  }
}

onMounted(async () => {
  await load()
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  for (const k of Object.keys(chartInst)) chartInst[k]?.dispose()
})
</script>

<template>
  <div class="bg-gray-50">
    <section class="bg-gradient-to-br from-blue-600 to-brand-indigo py-16">
      <div class="container-custom">
        <h1 class="text-3xl font-bold text-white md:text-4xl">行业基准数据分析</h1>
        <p class="mt-3 max-w-2xl text-blue-100">
          CSBMK 与 CSBSG 双基准源并列对比，涵盖生产率分位、分业务领域生产率、工程活动工作量分布、运维成本结构及调整因子体系。
        </p>
      </div>
    </section>

    <div class="container-custom py-12">
      <p v-if="loading" class="py-10 text-center text-gray-400">加载中…</p>
      <p v-if="!loading && params.length === 0" class="py-10 text-center text-gray-400">暂无基准数据</p>

      <template v-if="!loading && params.length">
        <!-- 基准源概览 -->
        <div class="mb-10 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div
            v-for="s in SOURCES"
            :key="s.sid"
            class="card border-l-4"
            :style="{ borderLeftColor: s.color }"
          >
            <div class="flex items-start justify-between">
              <div>
                <h3 class="text-lg font-semibold text-gray-900">{{ s.label }}</h3>
                <p class="mt-1 text-xs text-gray-500">{{ s.org }}</p>
              </div>
              <span class="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">
                {{ s.sid === SID_CSBMK ? '2025 年' : '2021 年' }}
              </span>
            </div>
            <dl class="mt-4 grid grid-cols-3 gap-2 text-center">
              <div>
                <dt class="text-xs text-gray-500">生产率 P50</dt>
                <dd class="text-lg font-bold" :style="{ color: s.color }">
                  {{ factorOf(s.sid === SID_CSBMK ? csbmkProd : csbsgProd, 'P50') ?? '-' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-gray-500">功能点权重</dt>
                <dd class="text-lg font-bold text-gray-700">{{ csbmkUfp ? csbmkUfp.values.length : '-' }} 项</dd>
              </div>
              <div>
                <dt class="text-xs text-gray-500">因子类别</dt>
                <dd class="text-lg font-bold text-gray-700">
                  {{ (s.sid === SID_CSBMK ? csbmkFactors : csbsgFactors)?.values.length || '-' }} 类
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <!-- 生产率分位对比 -->
        <div class="card mb-8">
          <h2 class="mb-1 text-xl font-bold text-gray-900">软件开发生产率分位对比</h2>
          <p class="mb-4 text-sm text-gray-500">
            单位：人时/功能点。P50 为最有可能值，P25/P75 常用作测算上下限。
          </p>
          <div :ref="setRef('prodPct')" class="h-80 w-full"></div>
        </div>

        <!-- 分业务领域生产率 -->
        <div class="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div class="card">
            <h3 class="mb-1 font-semibold text-gray-900">分业务领域生产率（CSBMK 2025）</h3>
            <p class="mb-3 text-xs text-gray-500">各业务领域 P50 中位数，单位 人时/功能点</p>
            <div :ref="setRef('domainCsbmk')" class="h-72 w-full"></div>
          </div>
          <div class="card">
            <h3 class="mb-1 font-semibold text-gray-900">分行业生产率（CSBSG 2021）</h3>
            <p class="mb-3 text-xs text-gray-500">各行业 P50 中位数，单位 人时/功能点</p>
            <div :ref="setRef('domainCsbsg')" class="h-72 w-full"></div>
          </div>
        </div>

        <!-- 工程活动工作量分布 -->
        <div class="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div class="card">
            <h3 class="mb-3 font-semibold text-gray-900">工程活动工作量分布（CSBMK 2025）</h3>
            <div :ref="setRef('wlCsbmk')" class="h-56 w-full"></div>
          </div>
          <div class="card">
            <h3 class="mb-3 font-semibold text-gray-900">工程活动工作量分布（CSBSG 2021）</h3>
            <div :ref="setRef('wlCsbsg')" class="h-56 w-full"></div>
          </div>
        </div>

        <!-- 运维成本结构 -->
        <div class="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div class="card">
            <h3 class="mb-1 font-semibold text-gray-900">应用软件运维生产率（CSBMK 2025）</h3>
            <p class="mb-3 text-xs text-gray-500">单位：人时/功能点</p>
            <div :ref="setRef('maintProd')" class="h-64 w-full"></div>
          </div>
          <div class="card">
            <h3 class="mb-1 font-semibold text-gray-900">年度运维费用占开发费用比例（CSBMK 2025）</h3>
            <p class="mb-3 text-xs text-gray-500">用于由开发费用推算年度运维预算</p>
            <div :ref="setRef('maintRatio')" class="h-64 w-full"></div>
          </div>
        </div>

        <!-- 调整因子类别矩阵 -->
        <div class="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div v-for="s in SOURCES" :key="s.sid" class="card">
            <h3 class="mb-3 font-semibold text-gray-900">
              {{ s.label }} 规模与工作量调整因子类别
            </h3>
            <ul class="space-y-1.5">
              <li
                v-for="(v, i) in (s.sid === SID_CSBMK ? csbmkFactors : csbsgFactors)?.values || []"
                :key="i"
                class="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-1.5 text-sm text-gray-700"
              >
                <span class="inline-block h-1.5 w-1.5 rounded-full" :style="{ backgroundColor: s.color }"></span>
                {{ v.label }}
              </li>
            </ul>
            <p v-if="!(s.sid === SID_CSBMK ? csbmkFactors : csbsgFactors)" class="text-sm text-gray-400">
              暂无因子类别数据
            </p>
          </div>
        </div>

        <!-- 各标准核心参数总览 -->
        <div v-if="benchmarks.length" class="card overflow-x-auto">
          <h2 class="mb-4 text-xl font-bold text-gray-900">各标准核心计量参数总览</h2>
          <table class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-gray-200 text-gray-500">
                <th class="py-3 pr-4 font-medium">标准</th>
                <th class="py-3 pr-4 font-medium">地区</th>
                <th class="py-3 pr-4 font-medium text-right">人月折算(人时)</th>
                <th class="py-3 pr-4 font-medium text-right">人力成本费率(元/人月)</th>
                <th class="py-3 pr-4 font-medium text-right">基准生产率 P50(人时/FP)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in benchmarks" :key="b.id" class="border-b border-gray-100 hover:bg-gray-50">
                <td class="py-3 pr-4">
                  <div class="font-medium text-gray-900">{{ b.standardName }}</div>
                  <div class="text-xs text-gray-400">{{ b.standardCode }}</div>
                </td>
                <td class="py-3 pr-4 text-gray-600">{{ b.region }}</td>
                <td class="py-3 pr-4 text-right text-gray-600">{{ b.hm ?? '-' }}</td>
                <td class="py-3 pr-4 text-right font-semibold text-primary">
                  {{ b.rate ? b.rate.toLocaleString() : '-' }}
                </td>
                <td class="py-3 pr-4 text-right text-gray-600">{{ b.pdr?.all?.p50 ?? b.pdr?.gov?.p50 ?? '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="mt-6 rounded-lg bg-blue-50 p-4 text-xs text-blue-700">
          数据说明：CSBMK 2025 取自《2025年中国软件行业基准数据》，CSBSG 2021 取自《中国软件行业基准数据报告》（SSM-BK-202109）。
          生产率为功能点耗时率（人时/功能点），数值越小代表效率越高。
        </p>
      </template>
    </div>
  </div>
</template>
