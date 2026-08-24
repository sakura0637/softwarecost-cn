<script setup lang="ts">
// 行业基准数据分析页面
import { adjustmentFactors, baseMetrics } from '~/composables/useBenchmark'

// 计算调整因子范围条的位置（归一化到 0-100%）
const getPosition = (value: number, range: [number, number]) => {
  const [min, max] = range
  const pct = ((value - min) / (max - min)) * 100
  return Math.max(0, Math.min(100, pct))
}

// 用户可调因子（演示交互）
const userFactors = ref<Record<string, number>>(
  Object.fromEntries(adjustmentFactors.map(f => [f.key, parseFloat(f.value)]))
)
const userMetrics = ref<Record<string, number>>(
  Object.fromEntries(baseMetrics.map(m => [m.key, parseFloat(m.value)]))
)

// 调整后的估算人月（演示计算）
const estimatedResult = computed(() => {
  const pdr = userMetrics.value.pdr
  const hm = userMetrics.value.hm
  const rate = userMetrics.value.rate
  // 假设项目规模为 1000 功能点
  const sizeFP = 1000
  const factorProduct = adjustmentFactors.reduce((acc, f) => acc * userFactors.value[f.key], 1)
  const adjustedFP = sizeFP * factorProduct
  const personMonths = adjustedFP / pdr
  const cost = personMonths * rate
  return {
    adjustedFP: Math.round(adjustedFP),
    personMonths: Math.round(personMonths * 100) / 100,
    cost: Math.round(cost * 100) / 100,
    factorProduct: Math.round(factorProduct * 1000) / 1000,
  }
})
</script>

<template>
  <div class="bg-gray-50">
    <!-- 标题 -->
    <section class="bg-gradient-to-br from-blue-600 to-brand-indigo py-16">
      <div class="container-custom">
        <h1 class="text-3xl font-bold text-white md:text-4xl">行业基准数据分析</h1>
        <p class="mt-3 max-w-2xl text-blue-100">
          整合 CSBMK（中国软件行业基准数据）与 CSBSG（中国软件行业协会软件造价分会基准数据），近 10 年全量数据支撑。
        </p>
      </div>
    </section>

    <div class="container-custom py-12">
      <!-- 调整因子分析 -->
      <div class="mb-12">
        <h2 class="mb-2 text-2xl font-bold text-gray-900">功能点法调整因子</h2>
        <p class="mb-6 text-sm text-gray-500">拖动滑块调整各因子取值，实时观察对造价评估结果的影响</p>

        <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <!-- 因子滑块 -->
          <div class="card">
            <h3 class="mb-4 font-semibold text-gray-900">因子取值调节</h3>
            <div class="space-y-5">
              <div v-for="f in adjustmentFactors" :key="f.key">
                <div class="mb-1 flex items-center justify-between">
                  <span class="text-sm font-medium text-gray-700">{{ f.label }}</span>
                  <span class="text-sm font-bold text-primary">{{ userFactors[f.key].toFixed(2) }}</span>
                </div>
                <input
                  v-model.number="userFactors[f.key]"
                  type="range"
                  :min="f.range[0]"
                  :max="f.range[1]"
                  step="0.01"
                  class="w-full accent-primary"
                />
                <p class="mt-0.5 text-xs text-gray-400">{{ f.description }}</p>
              </div>
            </div>
          </div>

          <!-- 实时估算结果 -->
          <div class="card flex flex-col">
            <h3 class="mb-4 font-semibold text-gray-900">1000 功能点项目估算（演示）</h3>
            <div class="space-y-4">
              <div class="rounded-lg bg-blue-50 p-4">
                <div class="text-sm text-gray-500">调整后功能点规模</div>
                <div class="text-2xl font-bold text-primary">{{ estimatedResult.adjustedFP }} <span class="text-sm font-normal text-gray-400">FP</span></div>
              </div>
              <div class="rounded-lg bg-indigo-50 p-4">
                <div class="text-sm text-gray-500">因子乘积</div>
                <div class="text-2xl font-bold text-indigo-600">{{ estimatedResult.factorProduct }}</div>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div class="rounded-lg bg-gray-50 p-4">
                  <div class="text-sm text-gray-500">所需人月</div>
                  <div class="text-xl font-bold text-gray-900">{{ estimatedResult.personMonths }} <span class="text-xs font-normal text-gray-400">人月</span></div>
                </div>
                <div class="rounded-lg bg-gray-50 p-4">
                  <div class="text-sm text-gray-500">估算造价</div>
                  <div class="text-xl font-bold text-gray-900">{{ estimatedResult.cost }} <span class="text-xs font-normal text-gray-400">万元</span></div>
                </div>
              </div>
            </div>
            <p class="mt-auto pt-4 text-xs text-gray-400">注：演示计算，实际评估需结合项目具体规模与官方基准数据。</p>
          </div>
        </div>
      </div>

      <!-- 基础计量参数 -->
      <div>
        <h2 class="mb-2 text-2xl font-bold text-gray-900">基础计量参数</h2>
        <p class="mb-6 text-sm text-gray-500">功能点法造价评估的核心计量基准</p>

        <div class="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div v-for="m in baseMetrics" :key="m.key" class="card">
            <h3 class="mb-1 font-semibold text-gray-900">{{ m.label }}</h3>
            <p class="mb-4 text-sm text-gray-500">{{ m.description }}</p>
            <div class="flex items-baseline gap-1">
              <span class="text-3xl font-bold text-primary">{{ userMetrics[m.key].toFixed(2) }}</span>
              <span class="text-sm text-gray-400">{{ m.unit }}</span>
            </div>
            <input
              v-model.number="userMetrics[m.key]"
              type="range"
              :min="m.range[0]"
              :max="m.range[1]"
              step="0.01"
              class="mt-4 w-full accent-primary"
            />
          </div>
        </div>
      </div>

      <!-- 基准数据来源 -->
      <div class="mt-12 rounded-2xl bg-white p-8 shadow-card">
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
