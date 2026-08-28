<script setup lang="ts">
// 省市计价数据分析 —— 数据从数据库读取（/api/city-rates）
// 单位：库内统一存 元/人月；图表展示换算为 万元/人月，表格保留 元/人月
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'

interface RateRow {
  city: string
  cityLevel: string
  year: number
  rateType: 'development' | 'maintenance'
  rate: number // 元/人月
  org: string
  source: string
}

const allRates = ref<RateRow[]>([])
const loading = ref(false)
const rateType = ref<'development' | 'maintenance'>('development')
const org = ref('CSBMK')

const RATE_TYPES = [
  { key: 'development' as const, label: '软件开发' },
  { key: 'maintenance' as const, label: '软件运维' },
]

const ORG_META: Record<string, { label: string; desc: string }> = {
  CSBMK: { label: 'CSBMK', desc: '北京软件造价评估技术创新联盟' },
  CSBSG: { label: 'CSBSG', desc: '中国软件行业协会软件造价分会' },
}

// ---------- 数据派生 ----------
const orgs = computed(() => {
  const set = new Set<string>()
  for (const r of allRates.value) if (r.org) set.add(r.org)
  return [...set]
})

const filtered = computed(() =>
  allRates.value.filter((r) => r.rateType === rateType.value && r.org === org.value)
)

// 当前机构下该类型是否有数据（CSBSG 只有开发，运维无数据）
const typeHasData = (t: 'development' | 'maintenance') =>
  allRates.value.some((r) => r.rateType === t && r.org === org.value)

const allCities = computed(() => [...new Set(filtered.value.map((r) => r.city))])

// 具备多年时序的城市（>=2 个年份），折线图才有意义
const seriesCities = computed(() => {
  const m = new Map<string, Set<number>>()
  for (const r of filtered.value) {
    if (!m.has(r.city)) m.set(r.city, new Set())
    m.get(r.city)!.add(r.year)
  }
  return [...m.entries()].filter(([, ys]) => ys.size >= 2).map(([c]) => c)
})

const years = computed(() => [...new Set(filtered.value.map((r) => r.year))].sort((a, b) => a - b))
const latestYear = computed(() => years.value[years.value.length - 1] || 0)

const selectedCities = ref<string[]>([])

// 切换维度时保留合法选择；无合法选择时回落到默认池
watch(
  filtered,
  () => {
    const valid = selectedCities.value.filter((c) => allCities.value.includes(c))
    if (valid.length) {
      selectedCities.value = valid
      return
    }
    const pool = seriesCities.value.length ? seriesCities.value : allCities.value.slice(0, 10)
    selectedCities.value = pool
  },
  { immediate: true }
)

// 当年（最新年份）排行
const ranking = computed(() =>
  filtered.value
    .filter((r) => r.year === latestYear.value)
    .slice()
    .sort((a, b) => b.rate - a.rate)
)

const stats = computed(() => {
  const list = ranking.value
  if (!list.length) return { max: 0, min: 0, avg: 0, maxCity: '-', minCity: '-' }
  const sum = list.reduce((a, r) => a + r.rate, 0)
  return {
    max: list[0].rate,
    min: list[list.length - 1].rate,
    avg: Math.round(sum / list.length),
    maxCity: list[0].city,
    minCity: list[list.length - 1].city,
  }
})

// ---------- 图表 ----------
const PALETTE = [
  '#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2',
  '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#9333ea',
]
const trendEl = ref<HTMLDivElement | null>(null)
const rankEl = ref<HTMLDivElement | null>(null)
let trendChart: any = null
let rankChart: any = null
let ec: any = null

const wan = (yuan: number) => Math.round((yuan / 10000) * 100) / 100

const trendOption = computed(() => ({
  color: PALETTE,
  tooltip: {
    trigger: 'axis',
    valueFormatter: (v: any) => (v == null ? '-' : `${v} 万元/人月`),
  },
  legend: { type: 'scroll', bottom: 0, textStyle: { fontSize: 11 } },
  grid: { left: 20, right: 24, top: 32, bottom: 56, containLabel: true },
  xAxis: {
    type: 'category',
    data: years.value.map(String),
    boundaryGap: false,
    axisLabel: { fontSize: 11 },
    axisLine: { lineStyle: { color: '#d1d5db' } },
  },
  yAxis: {
    type: 'value',
    name: '万元/人月',
    nameTextStyle: { fontSize: 11, color: '#6b7280' },
    axisLabel: { fontSize: 11 },
    splitLine: { lineStyle: { color: '#f3f4f6' } },
  },
  series: selectedCities.value.map((city) => ({
    name: city,
    type: 'line',
    smooth: true,
    symbol: 'circle',
    symbolSize: 6,
    connectNulls: true,
    lineStyle: { width: 2 },
    data: years.value.map((y) => {
      const hit = filtered.value.find((r) => r.city === city && r.year === y)
      return hit ? wan(hit.rate) : null
    }),
  })),
}))

const rankOption = computed(() => {
  const list = ranking.value.slice(0, 20)
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (v: any) => `${v} 万元/人月`,
    },
    grid: { left: 20, right: 24, top: 24, bottom: 20, containLabel: true },
    xAxis: {
      type: 'value',
      name: '万元/人月',
      nameTextStyle: { fontSize: 11, color: '#6b7280' },
      axisLabel: { fontSize: 11 },
      splitLine: { lineStyle: { color: '#f3f4f6' } },
    },
    yAxis: {
      type: 'category',
      data: list.map((r) => r.city).reverse(),
      axisLabel: { fontSize: 11 },
      axisLine: { lineStyle: { color: '#d1d5db' } },
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 16,
        itemStyle: { color: '#2563eb', borderRadius: [0, 4, 4, 0] },
        data: list
          .map((r) => wan(r.rate))
          .reverse(),
      },
    ],
  }
})

async function ensureEcharts() {
  if (!ec) ec = await import('echarts')
  return ec
}

async function render() {
  await nextTick()
  if (!trendEl.value && !rankEl.value) return
  await ensureEcharts()
  if (trendEl.value) {
    if (!trendChart) trendChart = ec.init(trendEl.value)
    trendChart.setOption(trendOption.value, true)
  }
  if (rankEl.value) {
    if (!rankChart) rankChart = ec.init(rankEl.value)
    rankChart.setOption(rankOption.value, true)
  }
}

function onResize() {
  trendChart?.resize()
  rankChart?.resize()
}

watch([trendOption, rankOption], render)

function toggleCity(city: string) {
  const i = selectedCities.value.indexOf(city)
  if (i >= 0) selectedCities.value.splice(i, 1)
  else selectedCities.value.push(city)
}
function selectSeriesOnly() {
  selectedCities.value = seriesCities.value.length ? [...seriesCities.value] : allCities.value.slice(0, 10)
}
function clearSelection() {
  selectedCities.value = []
}

function switchOrg(o: string) {
  org.value = o
  // 该机构无当前类型数据时自动切到有数据的类型
  if (!typeHasData(rateType.value)) {
    const alt = RATE_TYPES.find((t) => typeHasData(t.key))
    if (alt) rateType.value = alt.key
  }
}

async function load() {
  loading.value = true
  try {
    const res: any = await $fetch('/api/city-rates')
    allRates.value = (res.rates || []).filter((r: RateRow) => r.city && r.rate)
  } catch {
    allRates.value = []
  } finally {
    loading.value = false
    await render()
  }
}

onMounted(async () => {
  await load()
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  trendChart?.dispose()
  rankChart?.dispose()
})
</script>

<template>
  <div class="bg-gray-50">
    <!-- 标题 -->
    <section class="bg-gradient-to-br from-blue-600 to-brand-indigo py-16">
      <div class="container-custom">
        <h1 class="text-3xl font-bold text-white md:text-4xl">省市计价数据分析</h1>
        <p class="mt-3 max-w-2xl text-blue-100">
          基于《中国软件行业基准数据》的真实城市人月费率，支持开发/运维双维度、多基准机构对比，为跨地区造价测算提供数据支撑。
        </p>
      </div>
    </section>

    <div class="container-custom py-12">
      <p v-if="loading" class="py-10 text-center text-gray-400">加载中…</p>

      <template v-if="!loading && allRates.length">
        <!-- 维度控制 -->
        <div class="mb-6 flex flex-wrap items-center gap-4">
          <div class="flex rounded-lg bg-white p-1 shadow-sm">
            <button
              v-for="t in RATE_TYPES"
              :key="t.key"
              class="rounded-md px-4 py-2 text-sm font-medium transition-colors"
              :class="rateType === t.key ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-100'"
              @click="rateType = t.key"
            >
              {{ t.label }}
            </button>
          </div>

          <div class="flex rounded-lg bg-white p-1 shadow-sm">
            <button
              v-for="o in orgs"
              :key="o"
              class="rounded-md px-4 py-2 text-sm font-medium transition-colors"
              :class="org === o ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'"
              @click="switchOrg(o)"
            >
              {{ ORG_META[o]?.label || o }}
            </button>
          </div>

          <span class="text-xs text-gray-400">
            {{ ORG_META[org]?.desc || org }} · 共 {{ allCities.length }} 个城市 · {{ years[0] }}–{{ latestYear }}
          </span>
        </div>

        <!-- 概览 -->
        <div class="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div class="card text-center">
            <div class="text-sm text-gray-500">{{ latestYear }} 年最高</div>
            <div class="text-2xl font-bold text-primary">
              {{ wan(stats.max) }} <span class="text-sm font-normal text-gray-400">万元/人月</span>
            </div>
            <div class="mt-1 text-xs text-gray-400">{{ stats.maxCity }}</div>
          </div>
          <div class="card text-center">
            <div class="text-sm text-gray-500">{{ latestYear }} 年平均</div>
            <div class="text-2xl font-bold text-indigo-600">
              {{ wan(stats.avg) }} <span class="text-sm font-normal text-gray-400">万元/人月</span>
            </div>
            <div class="mt-1 text-xs text-gray-400">{{ ranking.length }} 个城市</div>
          </div>
          <div class="card text-center">
            <div class="text-sm text-gray-500">{{ latestYear }} 年最低</div>
            <div class="text-2xl font-bold text-sky-600">
              {{ wan(stats.min) }} <span class="text-sm font-normal text-gray-400">万元/人月</span>
            </div>
            <div class="mt-1 text-xs text-gray-400">{{ stats.minCity }}</div>
          </div>
        </div>

        <!-- 趋势折线图 -->
        <div class="card mb-8">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 class="font-semibold text-gray-900">
              {{ RATE_TYPES.find((t) => t.key === rateType)?.label }}人月费率趋势（{{ org }}）
            </h3>
            <div class="flex gap-2">
              <button class="rounded-md border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50" @click="selectSeriesOnly">
                仅看时序城市
              </button>
              <button class="rounded-md border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50" @click="clearSelection">
                清空
              </button>
            </div>
          </div>

          <!-- 城市复选 -->
          <div class="mb-4 flex flex-wrap gap-2">
            <label
              v-for="city in allCities"
              :key="city"
              class="flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors"
              :class="selectedCities.includes(city)
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'"
            >
              <input
                type="checkbox"
                class="h-3 w-3 accent-blue-600"
                :checked="selectedCities.includes(city)"
                @change="toggleCity(city)"
              />
              {{ city }}
            </label>
          </div>

          <div v-if="selectedCities.length" ref="trendEl" class="h-96 w-full"></div>
          <p v-else class="py-12 text-center text-sm text-gray-400">请至少选择一个城市</p>
        </div>

        <!-- 当年排行 -->
        <div class="card mb-8">
          <h3 class="mb-4 font-semibold text-gray-900">
            {{ latestYear }} 年城市{{ RATE_TYPES.find((t) => t.key === rateType)?.label }}人月费率排行（{{ org }}，前 20）
          </h3>
          <div ref="rankEl" class="h-[520px] w-full"></div>
        </div>

        <!-- 明细表 -->
        <div class="card overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-gray-200 text-gray-500">
                <th class="py-3 pr-4 font-medium">城市</th>
                <th class="py-3 pr-4 font-medium">城市级别</th>
                <th class="py-3 pr-4 font-medium text-right">{{ latestYear }} 年费率(元/人月)</th>
                <th class="py-3 pr-4 font-medium">数据来源</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in ranking" :key="r.city" class="border-b border-gray-100 hover:bg-gray-50">
                <td class="py-3 pr-4 font-medium text-gray-900">{{ r.city }}</td>
                <td class="py-3 pr-4 text-gray-600">{{ r.cityLevel || '-' }}</td>
                <td class="py-3 pr-4 text-right font-semibold text-primary">{{ r.rate.toLocaleString() }}</td>
                <td class="py-3 pr-4 text-xs text-gray-400">{{ r.source }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="mt-6 rounded-lg bg-blue-50 p-4 text-xs text-blue-700">
          数据说明：费率为基准机构公布的各城市基准人月费率（单位 元/人月，图表换算为 万元/人月）。
          CSBMK 数据取自《2025年中国软件行业基准数据》，其中 8 个典型城市含 2021–2025 完整时序，其余城市为当年官方单价；
          CSBSG 数据取自《中国软件行业基准数据报告》（SSM-BK-202109），为 2021 年典型城市单价。
        </p>
      </template>

      <p v-if="!loading && allRates.length === 0" class="py-10 text-center text-gray-400">暂无计价数据</p>
    </div>
  </div>
</template>
