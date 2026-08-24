<script setup lang="ts">
// 造价标准库页面
import { standards, type CostStandard } from '~/composables/useStandards'

const searchQuery = ref('')
const selectedCategory = ref('全部')
const selectedLevel = ref('全部')

const categories = computed(() => ['全部', ...Array.from(new Set(standards.map(s => s.category)))])
const levels = [
  { key: '全部', label: '全部级别' },
  { key: 'national', label: '国家级' },
  { key: 'provincial', label: '省级' },
  { key: 'municipal', label: '市级/区级' },
  { key: 'industry', label: '行业/团体' },
  { key: 'military', label: '军用' },
]

const levelLabelMap: Record<string, string> = {
  national: '国家级',
  provincial: '省级',
  municipal: '市级/区级',
  industry: '行业/团体',
  military: '军用',
}

const filteredStandards = computed(() => {
  return standards.filter((s) => {
    const matchSearch = searchQuery.value === ''
      || s.name.includes(searchQuery.value)
      || s.code.includes(searchQuery.value)
      || s.region.includes(searchQuery.value)
      || s.org.includes(searchQuery.value)
    const matchCategory = selectedCategory.value === '全部' || s.category === selectedCategory.value
    const matchLevel = selectedLevel.value === '全部' || s.level === selectedLevel.value
    return matchSearch && matchCategory && matchLevel
  })
})

const selectedStandard = ref<CostStandard | null>(null)

const stats = computed(() => ({
  total: standards.length,
  national: standards.filter(s => s.level === 'national').length,
  provincial: standards.filter(s => s.level === 'provincial').length,
  municipal: standards.filter(s => s.level === 'municipal').length,
  industry: standards.filter(s => s.level === 'industry').length,
  military: standards.filter(s => s.level === 'military').length,
}))
</script>

<template>
  <div class="bg-gray-50">
    <!-- 页面标题 -->
    <section class="bg-gradient-to-br from-blue-600 to-brand-indigo py-16">
      <div class="container-custom">
        <h1 class="text-3xl font-bold text-white md:text-4xl">造价标准库</h1>
        <p class="mt-3 max-w-2xl text-blue-100">
          全面支持各省市、各行业最新软件造价标准 {{ stats.total }}+ 项，兼容 CSBMK / CSBSG 行业基准数据，支持标准自定义。
        </p>
        <div class="mt-6 flex flex-wrap gap-3">
          <span class="rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white">国家级 {{ stats.national }}</span>
          <span class="rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white">省级 {{ stats.provincial }}</span>
          <span class="rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white">市级/区级 {{ stats.municipal }}</span>
          <span class="rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white">行业/团体 {{ stats.industry }}</span>
          <span class="rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white">军用 {{ stats.military }}</span>
        </div>
      </div>
    </section>

    <!-- 筛选区 -->
    <section class="container-custom -mt-8">
      <div class="rounded-xl bg-white p-6 shadow-card">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div class="flex-1">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="搜索标准名称、编号、地区或发布机构…"
              class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="lv in levels"
              :key="lv.key"
              class="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              :class="selectedLevel === lv.key ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
              @click="selectedLevel = lv.key"
            >
              {{ lv.label }}
            </button>
          </div>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            v-for="cat in categories"
            :key="cat"
            class="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
            :class="selectedCategory === cat ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
            @click="selectedCategory = cat"
          >
            {{ cat }}
          </button>
        </div>
      </div>
    </section>

    <!-- 标准列表 -->
    <section class="container-custom py-8">
      <p class="mb-4 text-sm text-gray-500">共找到 {{ filteredStandards.length }} 项标准</p>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="std in filteredStandards"
          :key="std.id"
          class="card cursor-pointer"
          @click="selectedStandard = std"
        >
          <div class="mb-3 flex items-start justify-between">
            <span class="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">{{ std.category }}</span>
            <span class="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500">{{ levelLabelMap[std.level] }}</span>
          </div>
          <h3 class="mb-1 font-semibold text-gray-900 line-clamp-2">{{ std.name }}</h3>
          <p class="text-xs text-gray-400">{{ std.region }} · {{ std.code }}</p>
          <p class="mt-2 text-sm text-gray-500 line-clamp-2">{{ std.summary }}</p>
          <div class="mt-3 flex items-center justify-between">
            <span class="text-xs text-gray-400">{{ std.org }}</span>
            <span class="text-sm font-medium text-primary">查看参数 →</span>
          </div>
        </div>
      </div>
      <p v-if="filteredStandards.length === 0" class="py-16 text-center text-gray-400">未找到匹配的标准，请调整筛选条件</p>
    </section>

    <!-- 详情弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="selectedStandard"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          @click.self="selectedStandard = null"
        >
          <div class="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div class="mb-4 flex items-start justify-between">
              <div>
                <span class="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">{{ selectedStandard.category }}</span>
                <h3 class="mt-2 text-xl font-bold text-gray-900">{{ selectedStandard.name }}</h3>
              </div>
              <button class="text-gray-400 hover:text-gray-600" @click="selectedStandard = null">
                <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <dl class="space-y-3 text-sm">
              <div class="flex gap-3"><dt class="w-20 flex-shrink-0 text-gray-400">编号</dt><dd class="font-medium text-gray-700">{{ selectedStandard.code }}</dd></div>
              <div class="flex gap-3"><dt class="w-20 flex-shrink-0 text-gray-400">地区</dt><dd class="font-medium text-gray-700">{{ selectedStandard.region }}</dd></div>
              <div class="flex gap-3"><dt class="w-20 flex-shrink-0 text-gray-400">级别</dt><dd class="font-medium text-gray-700">{{ levelLabelMap[selectedStandard.level] }}</dd></div>
              <div class="flex gap-3"><dt class="w-20 flex-shrink-0 text-gray-400">发布机构</dt><dd class="font-medium text-gray-700">{{ selectedStandard.org }}</dd></div>
              <div class="flex gap-3"><dt class="w-20 flex-shrink-0 text-gray-400">说明</dt><dd class="font-medium text-gray-700">{{ selectedStandard.summary }}</dd></div>
            </dl>
            <div class="mt-4">
              <h4 class="mb-2 text-sm font-semibold text-gray-900">核心参数</h4>
              <div class="flex flex-wrap gap-2">
                <span v-for="p in selectedStandard.params" :key="p" class="rounded-md bg-blue-50 px-2.5 py-1 text-xs text-primary">{{ p }}</span>
              </div>
            </div>
            <div class="mt-6 rounded-lg bg-gray-50 p-4 text-xs text-gray-400">
              注：以上数据整理自公开资料，仅供演示参考。实际评估请以官方发布的最新标准文本为准。
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
