<script setup lang="ts">
// 参数设置 —— 数据从数据库读取（/api/parameters，estimation_parameters 表）
// 结构对齐：顶部标准卡片网格（搜索/筛选/启用开关）→ 查看参数 → 左侧分类树 + 右侧明细表
import { ref, computed, onMounted, watch } from 'vue'

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
interface StandardCard {
  id: string
  code: string
  name: string
  edition: string
  region: string
  org: string
  categories: string[]
  count: number
}

const params = ref<ParamRow[]>([])
const loading = ref(false)

const keyword = ref('')
const typeFilter = ref('') // 全部 / 开发 / 运维
const enabledFilter = ref<'all' | 'on' | 'off'>('all')

const activeStandard = ref<string | null>(null)
const activeParamId = ref<number | null>(null)

const TYPE_LABEL: Record<string, string> = {
  weight: '权重',
  factor: '调整因子',
  rate: '费率',
  productivity: '生产率',
  formula: '公式',
}

// ---------- 启用状态（本地持久化，不写库） ----------
const LS_KEY = 'softwarecost:param-standard-enabled'
const disabled = ref<Set<string>>(new Set())

function loadDisabled() {
  if (!process.client) return
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) disabled.value = new Set(JSON.parse(raw))
  } catch {
    disabled.value = new Set()
  }
}
function persistDisabled() {
  if (!process.client) return
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...disabled.value]))
  } catch {
    /* 忽略写入失败 */
  }
}
function toggleEnabled(id: string) {
  const next = new Set(disabled.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  disabled.value = next
  persistDisabled()
}
const isEnabled = (id: string) => !disabled.value.has(id)

// ---------- 派生数据 ----------
const standards = computed<StandardCard[]>(() => {
  const map = new Map<string, StandardCard>()
  for (const p of params.value) {
    if (!map.has(p.standardId)) {
      map.set(p.standardId, {
        id: p.standardId,
        code: p.standardCode,
        name: p.standardName,
        edition: p.edition,
        region: p.region,
        org: p.org,
        categories: [],
        count: 0,
      })
    }
    const s = map.get(p.standardId)!
    if (!s.categories.includes(p.category)) s.categories.push(p.category)
    s.count++
  }
  return [...map.values()]
})

const filteredStandards = computed(() => {
  let list = standards.value
  if (typeFilter.value) {
    list = list.filter((s) => s.categories.includes(typeFilter.value))
  }
  if (enabledFilter.value === 'on') list = list.filter((s) => isEnabled(s.id))
  if (enabledFilter.value === 'off') list = list.filter((s) => !isEnabled(s.id))
  if (keyword.value.trim()) {
    const k = keyword.value.trim().toLowerCase()
    list = list.filter(
      (s) =>
        s.name.toLowerCase().includes(k) ||
        s.code.toLowerCase().includes(k) ||
        s.org.toLowerCase().includes(k) ||
        s.region.toLowerCase().includes(k)
    )
  }
  return list
})

const activeCard = computed(() => standards.value.find((s) => s.id === activeStandard.value) || null)

// 左侧分类树：按 param_category 分组该标准的参数项
const categoryTree = computed(() => {
  const list = params.value
    .filter((p) => p.standardId === activeStandard.value)
    .slice()
    .sort((a, b) => a.seq - b.seq)
  const map = new Map<string, ParamRow[]>()
  for (const p of list) {
    if (!map.has(p.paramCategory)) map.set(p.paramCategory, [])
    map.get(p.paramCategory)!.push(p)
  }
  return [...map.entries()].map(([cat, items]) => ({ cat, items }))
})

const activeParam = computed(() => params.value.find((p) => p.id === activeParamId.value) || null)

function openStandard(id: string) {
  activeStandard.value = id
  const first = params.value.find((p) => p.standardId === id)
  activeParamId.value = first ? first.id : null
}
function backToList() {
  activeStandard.value = null
  activeParamId.value = null
}

// 进入某个标准时默认选中第一个参数项
watch(activeStandard, (sid) => {
  if (!sid) return
  const first = params.value.find((p) => p.standardId === sid)
  if (first && !params.value.some((p) => p.id === activeParamId.value && p.standardId === sid)) {
    activeParamId.value = first.id
  }
})

const fmtFactor = (v: number | string) =>
  typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(v < 1 ? 4 : 2)) : v

async function load() {
  loading.value = true
  try {
    const res: any = await $fetch('/api/parameters')
    params.value = (res.parameters || []).map((p: any) => ({
      ...p,
      values: Array.isArray(p.values) ? p.values : [],
    }))
  } catch {
    params.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadDisabled()
  load()
})
</script>

<template>
  <div class="bg-gray-50">
    <section class="bg-gradient-to-br from-blue-600 to-brand-indigo py-16">
      <div class="container-custom">
        <h1 class="text-3xl font-bold text-white md:text-4xl">参数设置</h1>
        <p class="mt-3 max-w-2xl text-blue-100">
          汇集国标、行标及各省市标准的造价测算参数，支持按标准查看完整参数体系，并可控制各标准是否参与测算。
        </p>
      </div>
    </section>

    <div class="container-custom py-12">
      <p v-if="loading" class="py-10 text-center text-gray-400">加载中…</p>
      <p v-if="!loading && params.length === 0" class="py-10 text-center text-gray-400">暂无参数数据</p>

      <template v-if="!loading && params.length">
        <!-- ============ 视图 A：标准卡片网格 ============ -->
        <template v-if="!activeStandard">
          <div class="mb-6 flex flex-wrap items-center gap-3">
            <input
              v-model="keyword"
              type="text"
              placeholder="搜索标准名称 / 编号 / 发布机构"
              class="w-full max-w-sm rounded-lg border border-gray-200 px-4 py-2 text-sm outline-none focus:border-primary"
            />
            <div class="flex rounded-lg bg-white p-1 shadow-sm">
              <button
                v-for="t in ['', '开发', '运维']"
                :key="t"
                class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                :class="typeFilter === t ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-100'"
                @click="typeFilter = t"
              >
                {{ t || '全部' }}
              </button>
            </div>
            <div class="flex rounded-lg bg-white p-1 shadow-sm">
              <button
                v-for="f in [{ k: 'all', l: '全部' }, { k: 'on', l: '已启用' }, { k: 'off', l: '已停用' }]"
                :key="f.k"
                class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                :class="enabledFilter === f.k ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'"
                @click="enabledFilter = f.k as any"
              >
                {{ f.l }}
              </button>
            </div>
            <span class="text-xs text-gray-400">共 {{ filteredStandards.length }} 套标准</span>
          </div>

          <div v-if="filteredStandards.length" class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div v-for="s in filteredStandards" :key="s.id" class="card flex flex-col">
              <div class="flex items-start justify-between gap-2">
                <h3 class="text-base font-semibold leading-snug text-gray-900">{{ s.name }}</h3>
                <button
                  class="relative h-5 w-9 flex-shrink-0 rounded-full transition-colors"
                  :class="isEnabled(s.id) ? 'bg-primary' : 'bg-gray-300'"
                  :title="isEnabled(s.id) ? '已启用，点击停用' : '已停用，点击启用'"
                  @click="toggleEnabled(s.id)"
                >
                  <span
                    class="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
                    :class="isEnabled(s.id) ? 'left-4' : 'left-0.5'"
                  ></span>
                </button>
              </div>

              <p class="mt-1 text-xs text-gray-500">{{ s.code }}</p>

              <div class="mt-3 flex flex-wrap gap-1.5">
                <span
                  v-for="c in s.categories"
                  :key="c"
                  class="rounded-full px-2 py-0.5 text-xs"
                  :class="c === '开发' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'"
                >
                  {{ c }}
                </span>
                <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{{ s.region }}</span>
              </div>

              <p class="mt-3 text-xs text-gray-400">{{ s.org }}</p>

              <div class="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
                <span class="text-xs text-gray-500">{{ s.count }} 项参数</span>
                <button
                  class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                  @click="openStandard(s.id)"
                >
                  查看参数
                </button>
              </div>
            </div>
          </div>
          <p v-else class="py-10 text-center text-gray-400">没有匹配的标准</p>
        </template>

        <!-- ============ 视图 B：参数明细（左侧树 + 右侧表） ============ -->
        <template v-else>
          <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <button class="mb-2 text-sm text-primary hover:underline" @click="backToList">← 返回标准列表</button>
              <h2 class="text-xl font-bold text-gray-900">{{ activeCard?.name }}</h2>
              <p class="mt-1 text-xs text-gray-500">
                {{ activeCard?.code }} · {{ activeCard?.org }} · {{ activeCard?.region }}
              </p>
            </div>
            <span
              class="rounded-full px-3 py-1 text-xs"
              :class="isEnabled(activeCard?.id || '') ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'"
            >
              {{ isEnabled(activeCard?.id || '') ? '已启用' : '已停用' }}
            </span>
          </div>

          <div class="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
            <!-- 左侧分类树 -->
            <div class="card self-start">
              <h3 class="mb-3 text-sm font-semibold text-gray-500">参数分类</h3>
              <div v-for="grp in categoryTree" :key="grp.cat" class="mb-4">
                <div class="mb-1.5 text-xs font-semibold text-gray-800">{{ grp.cat }}</div>
                <ul class="space-y-0.5 border-l border-gray-200 pl-2">
                  <li v-for="p in grp.items" :key="p.id">
                    <button
                      class="w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors"
                      :class="activeParamId === p.id
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-gray-600 hover:bg-gray-50'"
                      @click="activeParamId = p.id"
                    >
                      {{ p.paramName }}
                    </button>
                  </li>
                </ul>
              </div>
            </div>

            <!-- 右侧明细表 -->
            <div class="card">
              <template v-if="activeParam">
                <div class="mb-4">
                  <h3 class="text-lg font-semibold text-gray-900">{{ activeParam.paramName }}</h3>
                  <p class="mt-1 text-xs text-gray-500">
                    {{ TYPE_LABEL[activeParam.paramType] || activeParam.paramType }}
                    <template v-if="activeParam.unit"> · 单位：{{ activeParam.unit }}</template>
                  </p>
                  <p v-if="activeParam.description" class="mt-2 text-sm text-gray-600">
                    {{ activeParam.description }}
                  </p>
                </div>

                <div class="overflow-x-auto">
                  <table class="w-full text-left text-sm">
                    <thead>
                      <tr class="border-b border-gray-200 text-gray-500">
                        <th class="py-2.5 pr-4 font-medium">因子项</th>
                        <th class="py-2.5 pr-4 font-medium text-right">取值</th>
                        <th class="py-2.5 pr-4 font-medium">说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(v, i) in activeParam.values"
                        :key="i"
                        class="border-b border-gray-100 hover:bg-gray-50"
                      >
                        <td class="py-2.5 pr-4 text-gray-800">{{ v.label }}</td>
                        <td class="py-2.5 pr-4 text-right font-semibold text-primary">{{ fmtFactor(v.factor) }}</td>
                        <td class="py-2.5 pr-4 text-xs text-gray-400">{{ v.desc || activeParam.unit || '-' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p v-if="!activeParam.values.length" class="py-8 text-center text-sm text-gray-400">
                  该参数暂无取值明细
                </p>
              </template>
              <p v-else class="py-16 text-center text-sm text-gray-400">请从左侧选择参数项</p>
            </div>
          </div>
        </template>

        <p class="mt-6 rounded-lg bg-blue-50 p-4 text-xs text-blue-700">
          数据说明：以上参数均从标准原文精确抽取并落库，涵盖 GB/T 36964-2018、GB/T 28827.7-2022、
          CSBMK/CSBSG 行业基准数据，以及四川、北京、山东、河南、江西、山西等省市标准。
          「启用 / 停用」为本机偏好设置（保存在浏览器本地），用于标记该标准是否参与测算，不会修改数据库。
        </p>
      </template>
    </div>
  </div>
</template>
