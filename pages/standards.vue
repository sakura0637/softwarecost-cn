<script setup lang="ts">
// 造价标准库页面：标准数据从数据库读取（/api/standards），失败回退静态数据
// 参数明细（standard_parameters 从表）随标准一起返回，并在详情/编辑中合并展示与维护
import { ref, computed, onMounted, reactive, watch } from 'vue'
import { standards as fallbackStandards, type CostStandard } from '~/composables/useStandards'
import { useAuth } from '~/composables/useAuth'

const { token, user, isAdmin, can, api } = useAuth()

// 标准列表（运行时权威来自库；接口失败则用静态 fallback）
const standards = ref<CostStandard[]>([])
const loadingStandards = ref(false)

const searchQuery = ref('')
const selectedCategory = ref('全部')
const selectedLevel = ref('全部')
const selectedAttachment = ref<'all' | 'has' | 'none'>('all')

// 各标准附件计数（来自后台汇总接口），驱动「是否含附件」筛选与卡片角标
const attachSummary = ref<Record<string, number>>({})

const categories = computed(() => ['全部', ...Array.from(new Set(standards.value.map(s => s.category)))])
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
  return standards.value.filter((s) => {
    const matchSearch = searchQuery.value === ''
      || s.name.includes(searchQuery.value)
      || s.code.includes(searchQuery.value)
      || s.region.includes(searchQuery.value)
      || s.org.includes(searchQuery.value)
    const matchCategory = selectedCategory.value === '全部' || s.category === selectedCategory.value
    const matchLevel = selectedLevel.value === '全部' || s.level === selectedLevel.value
    const hasAtt = (attachSummary.value[s.id] || 0) > 0
    const matchAttachment =
      selectedAttachment.value === 'all'
      || (selectedAttachment.value === 'has' && hasAtt)
      || (selectedAttachment.value === 'none' && !hasAtt)
    return matchSearch && matchCategory && matchLevel && matchAttachment
  })
})

async function loadStandards() {
  loadingStandards.value = true
  try {
    const res: any = await $fetch('/api/standards')
    standards.value = res.standards || []
  } catch {
    standards.value = fallbackStandards
  } finally {
    loadingStandards.value = false
  }
}

// 拉取各标准附件计数（公开接口）
async function loadSummary() {
  try {
    const res: any = await $fetch('/api/standards/attachments-summary')
    attachSummary.value = res.counts || {}
  } catch {
    attachSummary.value = {}
  }
}
onMounted(() => { loadSummary(); loadStandards() })

const selectedStandard = ref<CostStandard | null>(null)
const attachments = ref<any[]>([])
const uploading = ref(false)
const uploadFile = ref<File | null>(null)

// 附件在线预览（无需下载）。previewAttachment 为当前预览的附件对象，null 表示关闭。
const previewAttachment = ref<any | null>(null)
const PREVIEWABLE = (mime: string | null | undefined) =>
  !!mime && (mime === 'application/pdf' || mime.startsWith('image/') || mime.startsWith('text/'))
function openPreview(a: any) {
  previewAttachment.value = a
}
function closePreview() {
  previewAttachment.value = null
}
function previewUrl(a: any): string {
  return `/api/standards/${selectedStandard.value!.id}/attachments/${a.id}?preview=1`
}

// 打开标准详情时拉取附件列表
async function openStandard(std: CostStandard) {
  selectedStandard.value = std
  await loadAttachments(std.id)
}

async function loadAttachments(standardId: string) {
  try {
    const res: any = await $fetch(`/api/standards/${standardId}/attachments`)
    attachments.value = res.items || []
  } catch {
    attachments.value = []
  }
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

async function onUpload() {
  if (!uploadFile.value || !selectedStandard.value) return
  const formData = new FormData()
  formData.append('file', uploadFile.value)
  uploading.value = true
  try {
    await api(`/api/standards/${selectedStandard.value.id}/attachments`, {
      method: 'POST',
      body: formData,
    })
    uploadFile.value = null
    const input = document.getElementById('std-file-input') as HTMLInputElement | null
    if (input) input.value = ''
    await loadAttachments(selectedStandard.value.id)
    await loadSummary()
  } catch (e: any) {
    alert(e?.data?.statusMessage || '上传失败')
  } finally {
    uploading.value = false
  }
}

async function onDelete(fid: number) {
  if (!confirm('确定删除该附件？')) return
  try {
    await api(`/api/standards/${selectedStandard.value!.id}/attachments/${fid}`, { method: 'DELETE' })
    await loadAttachments(selectedStandard.value!.id)
    await loadSummary()
  } catch (e: any) {
    alert(e?.data?.statusMessage || '删除失败')
  }
}

const stats = computed(() => ({
  total: standards.value.length,
  national: standards.value.filter(s => s.level === 'national').length,
  provincial: standards.value.filter(s => s.level === 'provincial').length,
  municipal: standards.value.filter(s => s.level === 'municipal').length,
  industry: standards.value.filter(s => s.level === 'industry').length,
  military: standards.value.filter(s => s.level === 'military').length,
}))

// ===== 管理标准（需登录） =====
const showAdmin = ref(false)
const editing = ref<CostStandard | null>(null) // 编辑中的标准对象（新增模式下为 null）
const isNew = ref(false)                       // true=新增模式；false=编辑模式
const saving = ref(false)                      // 保存标准中（此前漏声明，导致 saveStandard 抛 TypeError）
const form = reactive({
  id: '', category: '', name: '', code: '', region: '', level: 'industry', org: '', summary: '',
})

// 是否处于表单态（新增或编辑）。
// 注意：不能只靠 editing 判空——「新增」时 editing 恒为 null，
// 若用 !editing 判断列表/表单，点「+ 新增标准」会一直停在列表、进不去表单。
const inForm = computed(() => !!editing.value || isNew.value)

function openNew() {
  editing.value = null
  isNew.value = true
  Object.assign(form, { id: '', category: '', name: '', code: '', region: '', level: 'industry', org: '', summary: '' })
  paramRows.value = []
  paramDraft.value = null
  valueRows.value = []
  showAdmin.value = true
}
function openEdit(s: CostStandard) {
  editing.value = s
  isNew.value = false
  Object.assign(form, {
    id: s.id, category: s.category || '', name: s.name, code: s.code || '', region: s.region || '',
    level: s.level || 'industry', org: s.org || '', summary: s.summary || '',
  })
  loadParams(s.id)
  showAdmin.value = true
}
function backToList() {
  editing.value = null
  isNew.value = false
  paramDraft.value = null
  paramRows.value = []
  valueRows.value = []
}
async function saveStandard() {
  if (!form.id.trim() || !form.name.trim()) { alert('id 与 name 必填'); return }
  // 仅保存标准自身字段；参数明细走独立的参数接口维护
  const body = {
    id: form.id.trim(), category: form.category, name: form.name, code: form.code, region: form.region,
    level: form.level, org: form.org, summary: form.summary, params: [], paramValues: {},
  }
  saving.value = true
  try {
    if (editing.value && !isNew.value) {
      await api(`/api/standards/${editing.value.id}`, { method: 'PUT', body })
    } else {
      await api('/api/standards', { method: 'POST', body })
    }
    await loadStandards()
    // 新增保存成功后就地切为「编辑模式」，方便立刻继续维护该标准的参数
    if (isNew.value) {
      const justSaved = standards.value.find((s) => s.id === body.id)
      if (justSaved) {
        editing.value = justSaved
        isNew.value = false
        await loadParams(body.id)
        return
      }
    }
    showAdmin.value = false
  } catch (e: any) {
    alert(e?.data?.statusMessage || '保存失败')
  } finally {
    saving.value = false
  }
}
async function deleteStandard(s: CostStandard) {
  if (!confirm(`确定删除标准「${s.name}」？其附件也会一并删除。`)) return
  try {
    await api(`/api/standards/${s.id}`, { method: 'DELETE' })
    await loadStandards()
    await loadSummary()
  } catch (e: any) {
    alert(e?.data?.statusMessage || '删除失败')
  }
}

// ===== 参数明细（合并进标准的从表 standard_parameters）=====
const paramRows = ref<any[]>([])
const paramDraft = ref<any | null>(null) // 正在新增/编辑的参数草稿
const savingParam = ref(false)

// 取值改用结构化行编辑（不再手填 JSON），每行 { label, factor, desc }
const valueRows = ref<any[]>([])
function addValueRow() {
  valueRows.value.push({ label: '', factor: '', desc: '' })
}
function removeValueRow(i: number) {
  valueRows.value.splice(i, 1)
}

async function loadParams(stdId: string) {
  try {
    const res: any = await $fetch(`/api/standards/${stdId}/parameters`)
    paramRows.value = res.parameters || []
  } catch {
    paramRows.value = []
  }
}
function groupParams(list: any[]) {
  const map: Record<string, any[]> = {}
  for (const p of list) (map[p.paramCategory || '未分类'] ||= []).push(p)
  return Object.entries(map).map(([cat, items]) => ({ cat, items }))
}
// 把结构化取值行序列化成后端 standard_parameters.values 需要的 JSON 字符串
function serializeValues() {
  return JSON.stringify(
    valueRows.value
      .filter((r) => String(r.label ?? '').trim() !== '' || String(r.factor ?? '').trim() !== '')
      .map((r) => {
        const raw = String(r.factor ?? '').trim()
        const num = Number(raw)
        const item: any = {
          label: String(r.label ?? '').trim(),
          factor: raw !== '' && !Number.isNaN(num) ? num : raw,
        }
        const desc = String(r.desc ?? '').trim()
        if (desc) item.desc = desc
        return item
      })
  )
}

function startAddParam() {
  const nextSeq = paramRows.value.length
    ? Math.max(...paramRows.value.map((p: any) => Number(p.seq) || 0)) + 1
    : 0
  paramDraft.value = {
    paramCategory: '', paramName: '', paramType: 'factor', unit: '', description: '', seq: nextSeq,
  }
  valueRows.value = []
}
function startEditParam(p: any) {
  let vals: any[] = []
  if (Array.isArray(p.values)) vals = p.values
  else if (typeof p.values === 'string' && p.values.trim()) {
    try {
      const j = JSON.parse(p.values)
      if (Array.isArray(j)) vals = j
    } catch { vals = [] }
  }
  paramDraft.value = {
    id: p.id,
    paramCategory: p.paramCategory || '',
    paramName: p.paramName || '',
    paramType: p.paramType || 'factor',
    unit: p.unit || '',
    description: p.description || '',
    seq: p.seq ?? 0,
  }
  valueRows.value = vals.map((v: any) => ({
    label: v?.label ?? '',
    factor: v?.factor ?? '',
    desc: v?.desc ?? '',
  }))
}
function cancelParam() {
  paramDraft.value = null
  valueRows.value = []
}
async function saveParam() {
  if (!paramDraft.value || !paramDraft.value.paramName?.trim()) { alert('参数名必填'); return }
  if (!editing.value) return
  savingParam.value = true
  try {
    const d = paramDraft.value
    const body = {
      param_category: d.paramCategory || '未分类',
      param_name: d.paramName.trim(),
      param_type: d.paramType,
      unit: d.unit,
      values: serializeValues(),
      description: d.description || '',
      seq: Number(d.seq) || 0,
    }
    if (d.id) {
      await api(`/api/standards/${editing.value.id}/parameters/${d.id}`, { method: 'PUT', body })
    } else {
      await api(`/api/standards/${editing.value.id}/parameters`, { method: 'POST', body })
    }
    await loadParams(editing.value.id)
    paramDraft.value = null
    valueRows.value = []
  } catch (e: any) {
    alert(e?.data?.statusMessage || '保存参数失败')
  } finally {
    savingParam.value = false
  }
}
async function removeParam(p: any) {
  if (!editing.value) return
  if (!confirm(`确定删除参数「${p.paramName}」？`)) return
  try {
    await api(`/api/standards/${editing.value.id}/parameters/${p.id}`, { method: 'DELETE' })
    await loadParams(editing.value.id)
  } catch (e: any) {
    alert(e?.data?.statusMessage || '删除失败')
  }
}

// 类型标签（与旧 /parameters 页右侧明细表保持一致）
const TYPE_LABEL: Record<string, string> = {
  weight: '权重',
  factor: '调整因子',
  rate: '费率',
  productivity: '生产率',
  formula: '公式',
}
const fmtFactor = (v: number | string) =>
  typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(v < 1 ? 4 : 2)) : v

// 编辑表单用的类型下拉（避免界面上出现 weight/factor 这类英文代码）
const TYPE_OPTIONS = [
  { value: 'weight', label: '权重' },
  { value: 'factor', label: '调整因子' },
  { value: 'rate', label: '费率' },
  { value: 'productivity', label: '生产率' },
  { value: 'formula', label: '公式' },
]

// ===== 详情弹窗：左侧参数分类树 + 右侧选中参数明细 =====
const activeParamId = ref<number | null>(null)
const paramTree = computed(() => groupParams((selectedStandard.value?.parameters as any[]) || []))
const activeParam = computed(() => {
  const list: any[] = (selectedStandard.value?.parameters as any[]) || []
  return list.find((p: any) => p.id === activeParamId.value) || null
})
// 打开某标准时默认选中它的第一个参数
watch(selectedStandard, (std) => {
  const list: any[] = (std?.parameters as any[]) || []
  if (!list.length) { activeParamId.value = null; return }
  if (!list.some((p: any) => p.id === activeParamId.value)) activeParamId.value = list[0].id
})
</script>

<template>
  <div class="bg-gray-50">
    <!-- 页面标题 -->
    <section class="bg-gradient-to-br from-blue-600 to-brand-indigo py-16">
      <div class="container-custom">
        <h1 class="text-3xl font-bold text-white md:text-4xl">造价标准库</h1>
        <p class="mt-3 max-w-2xl text-blue-100">
          全面支持各省市、各行业最新软件造价标准 {{ stats.total }}+ 项，兼容 CSBMK / CSBSG 行业基准数据，支持标准与参数自定义。
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
        <div v-if="can('standards:edit')" class="mb-3 flex justify-end">
          <button class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700" @click="showAdmin = true">管理标准</button>
        </div>
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
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <span class="text-xs text-gray-400">附件状态：</span>
          <button
            v-for="opt in [{ key: 'all', label: '全部' }, { key: 'has', label: '已上传附件' }, { key: 'none', label: '未上传附件' }]"
            :key="opt.key"
            class="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
            :class="selectedAttachment === opt.key ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
            @click="selectedAttachment = opt.key"
          >
            {{ opt.label }}
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
          @click="openStandard(std)"
        >
          <div class="mb-3 flex items-start justify-between">
            <span class="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">{{ std.category }}</span>
            <span class="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500">{{ levelLabelMap[std.level] }}</span>
          </div>
          <h3 class="mb-1 font-semibold text-gray-900 line-clamp-2">{{ std.name }}</h3>
          <p class="text-xs text-gray-400">{{ std.region }} · {{ std.code }}</p>
          <span
            v-if="(attachSummary[std.id] || 0) > 0"
            class="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600"
          >
            📎 {{ attachSummary[std.id] }} 个附件
          </span>
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
          <div class="max-h-[85vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
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

            <!-- 参数明细：左侧参数分类树 + 右侧选中参数表格（对齐旧 /parameters 页左右结构） -->
            <div class="mt-4">
              <h4 class="mb-2 text-sm font-semibold text-gray-900">参数明细</h4>
              <div v-if="selectedStandard.parameters && selectedStandard.parameters.length" class="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
                <!-- 左：参数分类树 -->
                <div class="max-h-[44vh] overflow-y-auto rounded-lg bg-gray-50 p-3">
                  <div v-for="grp in paramTree" :key="grp.cat" class="mb-4 last:mb-0">
                    <div class="mb-1.5 text-xs font-semibold text-gray-700">{{ grp.cat }}</div>
                    <ul class="space-y-0.5 border-l border-gray-200 pl-2">
                      <li v-for="p in grp.items" :key="p.id">
                        <button
                          class="w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors"
                          :class="activeParamId === p.id ? 'bg-primary/10 font-medium text-primary' : 'text-gray-600 hover:bg-gray-100'"
                          @click="activeParamId = p.id"
                        >
                          {{ p.paramName }}
                        </button>
                      </li>
                    </ul>
                  </div>
                </div>

                <!-- 右：选中参数明细 -->
                <div class="rounded-lg border border-gray-100 p-4">
                  <template v-if="activeParam">
                    <h5 class="text-base font-semibold text-gray-900">{{ activeParam.paramName }}</h5>
                    <p class="mt-1 text-xs text-gray-500">
                      {{ TYPE_LABEL[activeParam.paramType] || activeParam.paramType }}<template v-if="activeParam.unit"> · 单位：{{ activeParam.unit }}</template>
                    </p>
                    <p v-if="activeParam.description" class="mt-1 text-sm text-gray-600">{{ activeParam.description }}</p>

                    <div v-if="Array.isArray(activeParam.values) && activeParam.values.length" class="mt-3 overflow-x-auto">
                      <table class="w-full text-left text-sm">
                        <thead>
                          <tr class="border-b border-gray-200 text-gray-500">
                            <th class="py-2 pr-4 font-medium">因子项</th>
                            <th class="py-2 pr-4 font-medium text-right">取值</th>
                            <th class="py-2 pr-4 font-medium">说明</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="(v, vi) in activeParam.values" :key="vi" class="border-b border-gray-100 hover:bg-gray-50">
                            <td class="py-2 pr-4 text-gray-800">{{ v.label }}</td>
                            <td class="py-2 pr-4 text-right font-semibold text-primary">{{ fmtFactor(v.factor) }}</td>
                            <td class="py-2 pr-4 text-xs text-gray-400">{{ v.desc || activeParam.unit || '-' }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p v-else-if="activeParam.values && !Array.isArray(activeParam.values)" class="mt-2 text-sm text-gray-500">{{ activeParam.values }}</p>
                    <p v-else class="mt-2 text-sm text-gray-400">该参数暂无取值明细</p>
                  </template>
                  <p v-else class="py-12 text-center text-sm text-gray-400">请从左侧选择参数</p>
                </div>
              </div>
              <p v-else class="text-xs text-gray-400">该标准暂无参数明细</p>
            </div>

            <div class="mt-6 rounded-lg bg-gray-50 p-4 text-xs text-gray-400">
              注：以上参数已随标准一并落库（standard_parameters 从表）。实际评估请以官方发布的最新标准文本为准。
            </div>

            <!-- 附件（政策原文，后台上传） -->
            <div class="mt-4">
              <h4 class="mb-2 text-sm font-semibold text-gray-900">附件（政策原文）</h4>
              <div v-if="attachments.length" class="space-y-2">
                <div
                  v-for="a in attachments"
                  :key="a.id"
                  class="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm"
                >
                  <a
                    :href="`/api/standards/${selectedStandard.id}/attachments/${a.id}`"
                    target="_blank"
                    :download="a.file_name"
                    class="flex-1 truncate text-primary hover:underline"
                  >
                    {{ a.file_name }}
                    <span class="text-xs text-gray-400">（{{ formatSize(a.file_size) }}）</span>
                  </a>
                  <button
                    class="shrink-0 text-xs text-blue-500 hover:underline"
                    @click="openPreview(a)"
                  >
                    预览
                  </button>
                  <button v-if="can('standards:edit')" class="shrink-0 text-xs text-red-500 hover:underline" @click="onDelete(a.id)">
                    删除
                  </button>
                </div>
              </div>
              <p v-else class="text-xs text-gray-400">暂无附件</p>

              <!-- 上传（需 standards:edit 权限） -->
              <div v-if="can('standards:edit')" class="mt-3 flex items-center gap-2">
                <input
                  id="std-file-input"
                  type="file"
                  class="block w-full text-xs text-gray-500 file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1 file:text-primary"
                  @change="(e: any) => (uploadFile = e.target.files?.[0] || null)"
                />
                <button
                  :disabled="!uploadFile || uploading"
                  class="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  @click="onUpload"
                >
                  {{ uploading ? '上传中…' : '上传' }}
                </button>
              </div>
              <p v-else class="mt-3 text-xs text-gray-400">
                无上传/编辑权限
              </p>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 附件在线预览浮层（无需下载） -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="previewAttachment"
          class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          @click.self="closePreview"
        >
          <div class="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div class="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold text-gray-900">{{ previewAttachment.file_name }}</p>
                <p class="text-xs text-gray-400">{{ formatSize(previewAttachment.file_size) }} · {{ previewAttachment.mime_type }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-3">
                <a
                  :href="`/api/standards/${selectedStandard.id}/attachments/${previewAttachment.id}`"
                  target="_blank"
                  :download="previewAttachment.file_name"
                  class="text-xs text-primary hover:underline"
                >下载</a>
                <button class="text-gray-400 hover:text-gray-600" @click="closePreview">
                  <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div class="flex-1 bg-gray-100">
              <template v-if="PREVIEWABLE(previewAttachment.mime_type)">
                <iframe :src="previewUrl(previewAttachment)" class="h-full w-full border-0" />
              </template>
              <div v-else class="flex h-full items-center justify-center text-sm text-gray-500">
                该文件格式暂不支持在线预览，请点击右上角「下载」查看。
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 管理标准浮层（需登录） -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showAdmin"
          class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          @click.self="showAdmin = false"
        >
          <div class="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div class="mb-4 flex items-center justify-between">
              <h3 class="text-xl font-bold text-gray-900">管理标准（{{ standards.length }}）</h3>
              <div class="flex gap-2">
                <button v-if="!inForm && can('standards:create')" class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700" @click="openNew">+ 新增标准</button>
                <button class="text-gray-400 hover:text-gray-600" @click="showAdmin = false">✕</button>
              </div>
            </div>

            <!-- 列表 -->
            <div v-if="!inForm" class="space-y-2">
              <div
                v-for="s in standards"
                :key="s.id"
                class="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm"
              >
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium text-gray-800">{{ s.name }}</p>
                  <p class="text-xs text-gray-400">{{ s.category || '未分类' }} · {{ levelLabelMap[s.level] || s.level }}<template v-if="s.code"> · {{ s.code }}</template></p>
                </div>
                <button v-if="can('standards:edit')" class="shrink-0 text-xs text-blue-500 hover:underline" @click="openEdit(s)">编辑</button>
                <button v-if="can('standards:delete')" class="shrink-0 text-xs text-red-500 hover:underline" @click="deleteStandard(s)">删除</button>
              </div>
              <p v-if="standards.length === 0" class="py-8 text-center text-gray-400">暂无数据</p>
            </div>

            <!-- 表单 -->
            <div v-else class="space-y-3">
              <div class="grid grid-cols-2 gap-3">
                <label class="text-xs text-gray-500">标准 id<div class="mt-1"><input v-model="form.id" :disabled="!isNew" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="如 hb-eb40" /></div></label>
                <label class="text-xs text-gray-500">名称<div class="mt-1"><input v-model="form.name" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" /></div></label>
                <label class="text-xs text-gray-500">类别<div class="mt-1"><input v-model="form.category" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="软件开发" /></div></label>
                <label class="text-xs text-gray-500">编号<div class="mt-1"><input v-model="form.code" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="DB13/T 2106" /></div></label>
                <label class="text-xs text-gray-500">地区<div class="mt-1"><input v-model="form.region" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="河北" /></div></label>
                <label class="text-xs text-gray-500">级别<div class="mt-1">
                  <select v-model="form.level" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                    <option value="national">国家级</option>
                    <option value="provincial">省级</option>
                    <option value="municipal">市级/区级</option>
                    <option value="industry">行业/团体</option>
                    <option value="military">军用</option>
                  </select>
                </div></label>
                <label class="col-span-2 text-xs text-gray-500">发布机构<div class="mt-1"><input v-model="form.org" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" /></div></label>
              </div>
              <label class="block text-xs text-gray-500">说明<div class="mt-1"><textarea v-model="form.summary" rows="2" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"></textarea></div></label>

              <!-- 参数明细编辑器：左侧参数树 + 右侧编辑表单 -->
              <div class="block rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-gray-500">参数明细（{{ paramRows.length }} 条）</span>
                  <button type="button" class="text-xs text-primary hover:underline" @click="startAddParam">+ 添加参数</button>
                </div>
                <p v-if="isNew" class="mt-2 text-xs text-gray-400">先创建标准，创建后即可在此维护它的参数</p>
                <div v-else class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[200px_1fr]">
                  <!-- 左：参数列表（按分类分组） -->
                  <div class="max-h-[38vh] overflow-y-auto rounded-lg bg-white p-2">
                    <p v-if="!paramRows.length" class="px-1 py-6 text-center text-xs text-gray-400">暂无参数</p>
                    <div v-for="grp in groupParams(paramRows)" :key="grp.cat" class="mb-3 last:mb-0">
                      <div class="mb-1 px-1 text-xs font-semibold text-gray-700">{{ grp.cat }}</div>
                      <ul class="space-y-0.5 border-l border-gray-200 pl-1">
                        <li v-for="p in grp.items" :key="p.id">
                          <div class="flex items-center gap-1">
                            <button
                              class="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs transition-colors"
                              :class="paramDraft && paramDraft.id === p.id ? 'bg-primary/10 font-medium text-primary' : 'text-gray-600 hover:bg-gray-100'"
                              :title="p.paramName"
                              @click="startEditParam(p)"
                            >
                              {{ p.paramName }}
                            </button>
                            <button class="shrink-0 rounded px-1 text-xs text-gray-300 hover:text-red-500" title="删除" @click="removeParam(p)">✕</button>
                          </div>
                        </li>
                      </ul>
                    </div>
                  </div>

                  <!-- 右：参数编辑表单 -->
                  <div class="rounded-lg bg-white p-3">
                    <template v-if="paramDraft">
                      <p class="mb-2 text-xs font-semibold text-gray-700">{{ paramDraft.id ? '编辑参数' : '新增参数' }}</p>
                      <div class="grid grid-cols-2 gap-2">
                        <label class="text-xs text-gray-500">分类<div class="mt-1"><input v-model="paramDraft.paramCategory" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder="如 规模度量-功能点相关" /></div></label>
                        <label class="text-xs text-gray-500">参数名（必填）<div class="mt-1"><input v-model="paramDraft.paramName" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder="如 功能点取值（UFP权重）" /></div></label>
                        <label class="text-xs text-gray-500">类型<div class="mt-1">
                          <select v-model="paramDraft.paramType" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm">
                            <option v-for="t in TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
                          </select>
                        </div></label>
                        <label class="text-xs text-gray-500">单位<div class="mt-1"><input v-model="paramDraft.unit" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder="如 人月 / 元" /></div></label>
                      </div>
                      <label class="mt-2 block text-xs text-gray-500">说明<div class="mt-1"><textarea v-model="paramDraft.description" rows="2" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder="选填"></textarea></div></label>

                      <!-- 取值：结构化行编辑（不再手填 JSON） -->
                      <div class="mt-2">
                        <div class="flex items-center justify-between">
                          <span class="text-xs text-gray-500">取值项</span>
                          <button type="button" class="text-xs text-primary hover:underline" @click="addValueRow">+ 添加一行</button>
                        </div>
                        <table v-if="valueRows.length" class="mt-1 w-full text-left text-xs">
                          <thead>
                            <tr class="text-gray-400">
                              <th class="py-1 pr-2 font-medium">因子项</th>
                              <th class="py-1 pr-2 font-medium">取值</th>
                              <th class="py-1 pr-2 font-medium">说明</th>
                              <th class="w-8"></th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="(r, ri) in valueRows" :key="ri">
                              <td class="py-1 pr-2"><input v-model="r.label" class="w-full rounded border border-gray-200 px-1.5 py-1" placeholder="如 ILF(低)" /></td>
                              <td class="py-1 pr-2"><input v-model="r.factor" class="w-full rounded border border-gray-200 px-1.5 py-1" placeholder="7" /></td>
                              <td class="py-1 pr-2"><input v-model="r.desc" class="w-full rounded border border-gray-200 px-1.5 py-1" placeholder="选填" /></td>
                              <td class="py-1"><button type="button" class="text-gray-300 hover:text-red-500" @click="removeValueRow(ri)">✕</button></td>
                            </tr>
                          </tbody>
                        </table>
                        <p v-else class="mt-1 text-xs text-gray-400">暂无取值项，点「+ 添加一行」新增</p>
                      </div>

                      <div class="mt-3 flex justify-end gap-2">
                        <button class="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100" :disabled="savingParam" @click="cancelParam">取消</button>
                        <button :disabled="savingParam" class="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" @click="saveParam">{{ savingParam ? '保存中…' : '保存参数' }}</button>
                      </div>
                    </template>
                    <p v-else class="py-12 text-center text-xs text-gray-400">从左侧点选参数进行编辑，或点「+ 添加参数」新建</p>
                  </div>
                </div>
              </div>

              <div class="flex justify-end gap-2 pt-2">
                <button class="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100" @click="backToList">返回列表</button>
                <button :disabled="saving" class="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50" @click="saveStandard">{{ saving ? '保存中…' : (isNew ? '创建标准' : '保存') }}</button>
              </div>
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
