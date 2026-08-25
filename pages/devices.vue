<script setup lang="ts">
// 设备价格库页面（数据来自桌面「价格汇总」10 站台账）
const keyword = ref('')
const station = ref('')
const category = ref('')
const sort = ref('id') // id | name | station | unit_price | total_price
const order = ref<'asc' | 'desc'>('asc')
const page = ref(1)
const pageSize = 50

const filters = ref<{ stations: string[]; categories: string[] }>({ stations: [], categories: [] })
const result = ref<{ total: number; page: number; pageSize: number; items: any[] }>({
  total: 0,
  page: 1,
  pageSize: 50,
  items: [],
})
const loading = ref(false)

async function loadFilters() {
  try {
    filters.value = await $fetch('/api/devices/filters')
  } catch (e) {
    /* 忽略：筛选项缺失不影响主列表 */
  }
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (keyword.value.trim()) params.set('q', keyword.value.trim())
    if (station.value) params.set('station', station.value)
    if (category.value) params.set('category', category.value)
    params.set('sort', sort.value)
    params.set('order', order.value)
    params.set('page', String(page.value))
    params.set('pageSize', String(pageSize))
    result.value = await $fetch(`/api/devices?${params.toString()}`)
  } finally {
    loading.value = false
  }
}

watch([keyword, station, category, sort, order], () => {
  page.value = 1
  load()
})

onMounted(() => {
  loadFilters()
  load()
})

const totalPages = computed(() => Math.max(1, Math.ceil(result.value.total / pageSize)))

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
function setSort(col: string) {
  if (sort.value === col) {
    order.value = order.value === 'asc' ? 'desc' : 'asc'
  } else {
    sort.value = col
    order.value = 'asc'
  }
}
</script>

<template>
  <div class="bg-gray-50">
    <!-- 页面标题 -->
    <section class="bg-gradient-to-br from-blue-600 to-brand-indigo py-16">
      <div class="container-custom">
        <h1 class="text-3xl font-bold text-white md:text-4xl">设备价格库</h1>
        <p class="mt-3 max-w-2xl text-blue-100">
          汇集南水北调中线输水管控能力提升项目 10 个管理处（石家庄、沧州、衡水、邢台、邯郸、保定、保沧、廊坊、廊涿、总调中心）的真实设备台账价格，支持按设备名称、品牌型号、站点与分类检索。
        </p>
      </div>
    </section>

    <!-- 筛选区 -->
    <section class="container-custom -mt-8">
      <div class="rounded-xl bg-white p-6 shadow-card">
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div class="lg:col-span-5">
            <input
              v-model="keyword"
              type="text"
              placeholder="搜索设备名称、品牌型号或备注…"
              class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div class="lg:col-span-3">
            <select
              v-model="station"
              class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="">全部站点</option>
              <option v-for="s in filters.stations" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
          <div class="lg:col-span-3">
            <select
              v-model="category"
              class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="">全部分类</option>
              <option v-for="c in filters.categories" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div class="flex items-center gap-2 lg:col-span-1">
            <button
              class="flex-1 rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-600 hover:bg-gray-100"
              :title="order === 'asc' ? '当前升序，点击切换降序' : '当前降序，点击切换升序'"
              @click="order = order === 'asc' ? 'desc' : 'asc'"
            >
              {{ order === 'asc' ? '↑' : '↓' }}
            </button>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
          <span>排序：</span>
          <button
            v-for="opt in [
              { k: 'id', t: '默认' },
              { k: 'unit_price', t: '单价' },
              { k: 'total_price', t: '合价' },
              { k: 'name', t: '名称' },
              { k: 'station', t: '站点' },
            ]"
            :key="opt.k"
            class="rounded-full px-3 py-1 font-medium transition-colors"
            :class="sort === opt.k ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
            @click="setSort(opt.k)"
          >
            {{ opt.t }}
          </button>
        </div>
      </div>
    </section>

    <!-- 列表 -->
    <section class="container-custom py-8">
      <p class="mb-4 text-sm text-gray-500">
        共找到 <span class="font-semibold text-gray-900">{{ result.total.toLocaleString() }}</span> 条设备价格
        <span v-if="loading" class="ml-2 text-primary">加载中…</span>
      </p>

      <div class="overflow-x-auto rounded-xl bg-white shadow-card">
        <table class="w-full min-w-[980px] text-left text-sm">
          <thead class="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th class="px-4 py-3">站点</th>
              <th class="px-4 py-3">子站</th>
              <th class="px-4 py-3">分类</th>
              <th class="px-4 py-3">设备名称</th>
              <th class="px-4 py-3">品牌型号</th>
              <th class="px-4 py-3 text-right">单位</th>
              <th class="px-4 py-3 text-right">数量</th>
              <th class="px-4 py-3 text-right">单价(元)</th>
              <th class="px-4 py-3 text-right">合价(元)</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="d in result.items" :key="d.id" class="hover:bg-gray-50">
              <td class="px-4 py-3 text-gray-600">{{ d.station }}</td>
              <td class="px-4 py-3 text-gray-600">{{ d.subsite }}</td>
              <td class="px-4 py-3">
                <span class="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{{ d.category }}</span>
              </td>
              <td class="px-4 py-3 font-medium text-gray-900">{{ d.name }}</td>
              <td class="px-4 py-3 text-gray-500">{{ d.brand_model || '—' }}</td>
              <td class="px-4 py-3 text-right text-gray-600">{{ d.unit || '—' }}</td>
              <td class="px-4 py-3 text-right text-gray-600">{{ d.qty !== null ? fmt(d.qty) : '—' }}</td>
              <td class="px-4 py-3 text-right font-medium text-gray-900">{{ fmt(d.unit_price) }}</td>
              <td class="px-4 py-3 text-right font-medium text-gray-900">{{ fmt(d.total_price) }}</td>
            </tr>
            <tr v-if="result.items.length === 0">
              <td colspan="9" class="px-4 py-16 text-center text-gray-400">未找到匹配的设备，请调整筛选条件</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 分页 -->
      <div class="mt-6 flex items-center justify-between">
        <p class="text-sm text-gray-500">
          第 {{ result.page }} / {{ totalPages }} 页
        </p>
        <div class="flex gap-2">
          <button
            class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="page <= 1"
            @click="page > 1 && (page--, load())"
          >
            上一页
          </button>
          <button
            class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="page >= totalPages"
            @click="page < totalPages && (page++, load())"
          >
            下一页
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
