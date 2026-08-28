<script setup lang="ts">
// 省市计价数据分析页面 —— 数据从数据库读取（/api/provincial-pricing）
import { ref, computed, onMounted } from 'vue'

interface Pricing {
  id: string
  region: string
  level: string
  functionPointPrice: number
  productivity: number
  laborRate: number
  hm: number
  rate: number
  cf: number
  source: string
  year: string
}

const pricing = ref<Pricing[]>([])
const loading = ref(false)

const metricOptions = [
  { key: 'functionPointPrice', label: '功能点单价', unit: '元/FP', color: '#2563eb' },
  { key: 'productivity', label: '基准生产率', unit: 'FP/人月', color: '#7c3aed' },
  { key: 'laborRate', label: '人月费率', unit: '万元/人月', color: '#0ea5e9' },
]
const selectedMetric = ref('functionPointPrice')

const currentMetric = computed(() => metricOptions.find(m => m.key === selectedMetric.value)!)
const maxValue = computed(() => Math.max(...pricing.value.map(c => c[selectedMetric.value as keyof Pricing] as number)))
const minValue = computed(() => Math.min(...pricing.value.map(c => c[selectedMetric.value as keyof Pricing] as number)))

const sortOrder = ref<'asc' | 'desc'>('desc')
const sortedData = computed(() => {
  return [...pricing.value].sort((a, b) => {
    const av = a[selectedMetric.value as keyof Pricing] as number
    const bv = b[selectedMetric.value as keyof Pricing] as number
    return sortOrder.value === 'desc' ? bv - av : av - bv
  })
})

const avgValue = computed(() => {
  const sum = pricing.value.reduce((acc, c) => acc + (c[selectedMetric.value as keyof Pricing] as number), 0)
  return Math.round((sum / pricing.value.length) * 100) / 100
})

async function load() {
  loading.value = true
  try {
    const res: any = await $fetch('/api/provincial-pricing')
    pricing.value = res.pricing || []
  } catch {
    pricing.value = []
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<template>
  <div class="bg-gray-50">
    <!-- 标题 -->
    <section class="bg-gradient-to-br from-blue-600 to-brand-indigo py-16">
      <h1 class="text-3xl font-bold text-white md:text-4xl">省市计价数据分析</h1>
      <p class="mt-3 max-w-2xl text-blue-100">
        对比各省市信息化项目造价核心参数，洞察区域计价差异，为预算编制提供数据参考。
      </p>
    </section>

    <div class="container-custom py-12">
      <p v-if="loading" class="py-10 text-center text-gray-400">加载中…</p>
      <template v-if="!loading && pricing.length">
        <!-- 指标切换 -->
        <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div class="flex flex-wrap gap-2">
            <button
              v-for="opt in metricOptions"
              :key="opt.key"
              class="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              :class="selectedMetric === opt.key ? 'bg-primary text-white' : 'bg-white text-gray-600 shadow-sm hover:bg-gray-100'"
              @click="selectedMetric = opt.key"
            >
              {{ opt.label }}
            </button>
          </div>
          <button
            class="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-600 shadow-sm hover:bg-gray-100"
            @click="sortOrder = sortOrder === 'desc' ? 'asc' : 'desc'"
          >
            {{ sortOrder === 'desc' ? '从高到低 ↓' : '从低到高 ↑' }}
          </button>
        </div>

        <!-- 概览卡片 -->
        <div class="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div class="card text-center">
            <div class="text-sm text-gray-500">最高值</div>
            <div class="text-2xl font-bold text-primary">{{ maxValue }} <span class="text-sm font-normal text-gray-400">{{ currentMetric.unit }}</span></div>
            <div class="mt-1 text-xs text-gray-400">{{ sortedData[0]?.region }}</div>
          </div>
          <div class="card text-center">
            <div class="text-sm text-gray-500">平均值</div>
            <div class="text-2xl font-bold text-indigo-600">{{ avgValue }} <span class="text-sm font-normal text-gray-400">{{ currentMetric.unit }}</span></div>
            <div class="mt-1 text-xs text-gray-400">全部 {{ pricing.length }} 个地区</div>
          </div>
          <div class="card text-center">
            <div class="text-sm text-gray-500">最低值</div>
            <div class="text-2xl font-bold text-sky-600">{{ minValue }} <span class="text-sm font-normal text-gray-400">{{ currentMetric.unit }}</span></div>
            <div class="mt-1 text-xs text-gray-400">{{ sortedData[sortedData.length - 1]?.region }}</div>
          </div>
        </div>

        <!-- 条形图 -->
        <div class="card">
          <h3 class="mb-6 font-semibold text-gray-900">
            {{ currentMetric.label }}对比（单位：{{ currentMetric.unit }}）
          </h3>
          <div class="space-y-3">
            <div v-for="city in sortedData" :key="city.id" class="flex items-center gap-3">
              <div class="w-24 flex-shrink-0 text-right text-sm font-medium text-gray-700">{{ city.region }}</div>
              <div class="relative h-8 flex-1 overflow-hidden rounded-md bg-gray-100">
                <div
                  class="flex h-full items-center justify-end rounded-md px-3 text-xs font-semibold text-white transition-all duration-500"
                  :style="{
                    width: `${Math.max(8, ((city[selectedMetric as keyof Pricing] as number) / maxValue) * 100)}%`,
                    backgroundColor: currentMetric.color,
                  }"
                >
                  {{ city[selectedMetric as keyof Pricing] }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 数据表 -->
        <div class="card mt-8 overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-gray-200 text-gray-500">
                <th class="py-3 pr-4 font-medium">地区</th>
                <th class="py-3 pr-4 font-medium">功能点单价(元/FP)</th>
                <th class="py-3 pr-4 font-medium">基准生产率(FP/人月)</th>
                <th class="py-3 pr-4 font-medium">人月费率(万元/人月)</th>
                <th class="py-3 pr-4 font-medium">数据来源</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="city in pricing" :key="city.id" class="border-b border-gray-100 hover:bg-gray-50">
                <td class="py-3 pr-4 font-medium text-gray-900">{{ city.region }}</td>
                <td class="py-3 pr-4 text-gray-600">{{ city.functionPointPrice }}</td>
                <td class="py-3 pr-4 text-gray-600">{{ city.productivity }}</td>
                <td class="py-3 pr-4 text-gray-600">{{ city.laborRate }}</td>
                <td class="py-3 pr-4 text-xs text-gray-400">{{ city.source }}（{{ city.year }}）</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="mt-6 rounded-lg bg-amber-50 p-4 text-xs text-amber-700">
          数据说明：功能点单价 = 人力成本费率 ÷ 基准生产率(P50)；生产率 = 人月折算系数 ÷ 生产率(P50)。以上为已落库的真实参数，山东/山西/河南等地区将随标准精抽后补充。
        </p>
      </template>
      <p v-if="!loading && pricing.length === 0" class="py-10 text-center text-gray-400">暂无计价数据</p>
    </div>
  </div>
</template>
