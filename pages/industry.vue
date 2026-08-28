<script setup lang="ts">
// 行业基准数据分析页面 —— 数据从数据库读取（/api/estimation-benchmarks），展示真实基准参数
import { ref, computed, onMounted } from 'vue'

interface Benchmark {
  id: string
  standardCode: string
  standardName: string
  edition: string
  region: string
  level: string
  org: string
  category: string
  ufpMethod: string
  ufpWeights: Record<string, Record<string, number>> | null
  reuseFactors: Record<string, number> | null
  cf: Record<string, number> | null
  pdr: { all?: Record<string, number>; gov?: Record<string, number> } | null
  hm: number | null
  rate: number | null
  adjustmentFactors: any
  source: string
}

const benchmarks = ref<Benchmark[]>([])
const loading = ref(false)

const ufpTypes = ['ILF', 'EIF', 'EI', 'EO', 'EQ']
const ufpLevels = ['low', 'mid', 'high'] as const
const ufpLevelLabel: Record<string, string> = { low: '低', mid: '中', high: '高' }

const national = computed(() => benchmarks.value.find(b => b.level === 'national') || benchmarks.value[0] || null)
const sichuan = computed(() => benchmarks.value.find(b => b.region === '四川') || null)
const beijing = computed(() => benchmarks.value.find(b => b.region === '北京') || null)

const afSichuan = computed(() => sichuan.value?.adjustmentFactors || null)

async function load() {
  loading.value = true
  try {
    const res: any = await $fetch('/api/estimation-benchmarks')
    benchmarks.value = res.benchmarks || []
  } catch {
    benchmarks.value = []
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<template>
  <div class="bg-gray-50">
    <section class="bg-gradient-to-br from-blue-600 to-brand-indigo py-16">
      <div class="container-custom">
        <h1 class="text-3xl font-bold text-white md:text-4xl">行业基准数据分析</h1>
        <p class="mt-3 max-w-2xl text-blue-100">
          真实基准参数来自 CSBMK 中国软件行业基准数据、GB/T 36964-2018 及四川/北京等地标，数据已落库，随标准更新同步维护。
        </p>
      </div>
    </section>

    <div class="container-custom py-12">
      <p v-if="loading" class="py-10 text-center text-gray-400">加载中…</p>
      <p v-if="!loading && benchmarks.length === 0" class="py-10 text-center text-gray-400">暂无基准数据</p>

      <!-- 生产率基准数据 -->
      <div v-if="national && national.pdr" class="mb-12">
        <h2 class="mb-2 text-2xl font-bold text-gray-900">生产率基准数据（人时/功能点）</h2>
        <p class="mb-6 text-sm text-gray-500">取自 {{ national.source }}，通常用 P50 测算最有可能值，P25/P75 测算上下限</p>
        <div class="card overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-gray-200 text-gray-500">
                <th class="py-3 pr-4 font-medium">业务领域</th>
                <th class="py-3 pr-4 font-medium">P10</th>
                <th class="py-3 pr-4 font-medium">P25</th>
                <th class="py-3 pr-4 font-medium">P50</th>
                <th class="py-3 pr-4 font-medium">P75</th>
                <th class="py-3 pr-4 font-medium">P90</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="national.pdr.all" class="border-b border-gray-100">
                <td class="py-3 pr-4 font-medium text-gray-900">全行业</td>
                <td class="py-3 pr-4 text-gray-600">{{ national.pdr.all.p10 }}</td>
                <td class="py-3 pr-4 text-gray-600">{{ national.pdr.all.p25 }}</td>
                <td class="py-3 pr-4 font-semibold text-primary">{{ national.pdr.all.p50 }}</td>
                <td class="py-3 pr-4 text-gray-600">{{ national.pdr.all.p75 }}</td>
                <td class="py-3 pr-4 text-gray-600">{{ national.pdr.all.p90 }}</td>
              </tr>
              <tr v-if="national.pdr.gov" class="border-b border-gray-100">
                <td class="py-3 pr-4 font-medium text-gray-900">电子政务</td>
                <td class="py-3 pr-4 text-gray-600">{{ national.pdr.gov.p10 }}</td>
                <td class="py-3 pr-4 text-gray-600">{{ national.pdr.gov.p25 }}</td>
                <td class="py-3 pr-4 font-semibold text-primary">{{ national.pdr.gov.p50 }}</td>
                <td class="py-3 pr-4 text-gray-600">{{ national.pdr.gov.p75 }}</td>
                <td class="py-3 pr-4 text-gray-600">{{ national.pdr.gov.p90 }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- UFP 复杂度权重 -->
      <div v-if="sichuan && sichuan.ufpWeights" class="mb-12">
        <h2 class="mb-2 text-2xl font-bold text-gray-900">功能点复杂度权重（UFP）</h2>
        <p class="mb-6 text-sm text-gray-500">来源：{{ sichuan.standardName }}（与 GB/T 36964-2018 一致）</p>
        <div class="card overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-gray-200 text-gray-500">
                <th class="py-3 pr-4 font-medium">计数项</th>
                <th class="py-3 pr-4 font-medium">低</th>
                <th class="py-3 pr-4 font-medium">中</th>
                <th class="py-3 pr-4 font-medium">高</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in ufpTypes" :key="t" class="border-b border-gray-100">
                <td class="py-3 pr-4 font-medium text-gray-900">{{ t }}</td>
                <td class="py-3 pr-4 text-gray-600">{{ sichuan.ufpWeights[t]?.low }}</td>
                <td class="py-3 pr-4 text-gray-600">{{ sichuan.ufpWeights[t]?.mid }}</td>
                <td class="py-3 pr-4 text-gray-600">{{ sichuan.ufpWeights[t]?.high }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 调整因子 -->
      <div v-if="afSichuan" class="mb-12">
        <h2 class="mb-2 text-2xl font-bold text-gray-900">功能点法调整因子（四川 T/SCSIA 0015-2025）</h2>
        <p class="mb-6 text-sm text-gray-500">SWF = 应用类型 × 非功能性 × 开发平台 × 开发团队背景</p>
        <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div v-if="afSichuan.application_type" class="card">
            <h3 class="mb-3 font-semibold text-gray-900">应用类型调整因子（ST）</h3>
            <table class="w-full text-sm">
              <tbody>
                <tr v-for="(v, k) in afSichuan.application_type" :key="k" class="border-b border-gray-100">
                  <td class="py-2 text-gray-700">{{ k }}</td>
                  <td class="py-2 text-right font-medium text-primary">{{ v }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="afSichuan.platform" class="card">
            <h3 class="mb-3 font-semibold text-gray-900">开发平台调整因子（SL）</h3>
            <table class="w-full text-sm">
              <tbody>
                <tr v-for="(v, k) in afSichuan.platform" :key="k" class="border-b border-gray-100">
                  <td class="py-2 text-gray-700">{{ k }}</td>
                  <td class="py-2 text-right font-medium text-primary">{{ v }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="afSichuan.team" class="card">
            <h3 class="mb-3 font-semibold text-gray-900">开发团队背景调整因子（DT）</h3>
            <table class="w-full text-sm">
              <tbody>
                <tr v-for="(v, k) in afSichuan.team" :key="k" class="border-b border-gray-100">
                  <td class="py-2 text-gray-700">{{ k }}</td>
                  <td class="py-2 text-right font-medium text-primary">{{ v }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="afSichuan.nonfunctional" class="card">
            <h3 class="mb-3 font-semibold text-gray-900">非功能性特征调整因子（NF）</h3>
            <p class="mb-2 text-xs text-gray-500">{{ afSichuan.nonfunctional.formula }}</p>
            <table class="w-full text-sm">
              <tbody>
                <tr
                  v-for="dim in ['性能效率', '兼容性', '可靠性', '可移植性']"
                  :key="dim"
                  class="border-b border-gray-100"
                >
                  <td class="py-2 text-gray-700">{{ dim }}</td>
                  <td class="py-2 text-right text-gray-600">明示要求 {{ afSichuan.nonfunctional[dim]['明示要求'] }}</td>
                  <td class="py-2 text-right font-medium text-primary">无明示 {{ afSichuan.nonfunctional[dim]['无明示'] }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 各标准核心计量参数 -->
      <div class="mb-12">
        <h2 class="mb-2 text-2xl font-bold text-gray-900">各标准核心计量参数</h2>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div v-for="b in benchmarks" :key="b.id" class="card">
            <div class="mb-1 flex items-center justify-between">
              <h3 class="font-semibold text-gray-900">{{ b.region }} · {{ b.edition }}</h3>
              <span class="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{{ b.standardCode }}</span>
            </div>
            <dl class="space-y-1 text-sm">
              <div v-if="b.hm != null" class="flex justify-between"><dt class="text-gray-500">人月折算系数</dt><dd class="font-medium text-gray-700">{{ b.hm }} 人时/人月</dd></div>
              <div v-if="b.rate != null" class="flex justify-between"><dt class="text-gray-500">人力成本费率</dt><dd class="font-medium text-gray-700">{{ b.rate.toLocaleString() }} 元/人月</dd></div>
              <div v-if="b.cf" class="flex justify-between"><dt class="text-gray-500">规模变更因子</dt><dd class="font-medium text-gray-700">{{ Object.values(b.cf).join(' / ') }}</dd></div>
              <div v-if="b.reuseFactors" class="flex justify-between"><dt class="text-gray-500">重用程度</dt><dd class="font-medium text-gray-700">高1/3·中2/3·低1</dd></div>
            </dl>
            <p class="mt-2 text-xs text-gray-400">{{ b.source }}</p>
          </div>
        </div>
      </div>

      <!-- 数据来源 -->
      <div class="rounded-2xl bg-white p-8 shadow-card">
        <h2 class="mb-4 text-xl font-bold text-gray-900">基准数据来源</h2>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div class="flex items-start gap-3 rounded-lg bg-gray-50 p-4">
            <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-white">CS</div>
            <div>
              <h4 class="font-semibold text-gray-900">CSBMK 中国软件行业基准数据</h4>
              <p class="text-sm text-gray-500">北京软件造价评估技术创新联盟发布，覆盖生产率、费率等核心参数</p>
            </div>
          </div>
          <div class="flex items-start gap-3 rounded-lg bg-gray-50 p-4">
            <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">SS</div>
            <div>
              <h4 class="font-semibold text-gray-900">CSBSG 软件造价分会基准数据</h4>
              <p class="text-sm text-gray-500">中国软件行业协会软件造价分会发布，行业权威基准参考</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
