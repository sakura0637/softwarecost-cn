<script setup lang="ts">
// 造价标准库页面：标准数据从数据库读取（/api/standards），失败回退静态数据
// 参数明细（standard_parameters 从表）随标准一起返回，并在详情/编辑中合并展示与维护
import { ref, computed, onMounted, reactive } from 'vue'
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
const editing = ref<CostStandard | null>(null) // 编辑中的标准；null 表示新增表单
const form = reactive({
  id: '', category: '', name: '', code: '', region: '', level: 'industry', org: '', summary: '',
})

function openNew() {
  editing.value = null
  Object.assign(form, { id: '', category: '', name: '', code: '', region: '', level: 'industry', org: '', summary: '' })
  paramRows.value = []
  paramDraft.value = null
  showAdmin.value = true
}
function openEdit(s: CostStandard) {
  editing.value = s
  Object.assign(form, {
    id: s.id, category: s.category || '', name: s.name, code: s.code || '', region: s.region || '',
    level: s.level || 'industry', org: s.org || '', summary: s.summary || '',
  })
  loadParams(s.id)
  showAdmin.value = true
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
    if (editing.value) {
      await api(`/api/standards/${editing.value.id}`, { method: 'PUT', body })
    } else {
      await api('/api/standards', { method: 'POST', body })
    }
    await loadStandards()
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
function startAddParam() {
  paramDraft.value = { paramCategory: '', paramName: '', paramType: '', unit: '', values: '', description: '', seq: 0 }
}
function startEditParam(p: any) {
  paramDraft.value = { ...p, values: typeof p.values === 'string' ? p.values : JSON.stringify(p.values ?? []) }
}
function cancelParam() {
  paramDraft.value = null
}
async function saveParam() {
  if (!paramDraft.value || !paramDraft.value.paramName?.trim()) { alert('参数名必填'); return }
  if (!editing.value) return
  savingParam.value = true
  try {
    const d = paramDraft.value
    const body = {
      param_category: d.paramCategory, param_name: d.paramName, param_type: d.paramType,
      unit: d.unit, values: d.values, description: d.description, seq: d.seq,
    }
    if (d.id) {
      await api(`/api/standards/${editing.value.id}/parameters/${d.id}`, { method: 'PUT', body })
    } else {
      await api(`/api/standards/${editing.value.id}/parameters`, { method: 'POST', body })
    }
    await loadParams(editing.value.id)
    paramDraft.value = null
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

            <!-- 参数明细（合并进标准） -->
            <div class="mt-4">
              <h4 class="mb-2 text-sm font-semibold text-gray-900">参数明细</h4>
              <div v-if="selectedStandard.parameters && selectedStandard.parameters.length" class="space-y-3">
                <div v-for="grp in groupParams(selectedStandard.parameters)" :key="grp.cat" class="rounded-lg bg-gray-50 p-3">
                  <p class="mb-1 text-xs font-medium text-primary">{{ grp.cat || '未分类' }}</p>
                  <div v-for="p in grp.items" :key="p.id" class="py-1 text-sm">
                    <div class="flex items-baseline justify-between gap-2">
                      <span class="font-medium text-gray-700">{{ p.paramName }}</span>
                      <span class="shrink-0 text-xs text-gray-400">{{ p.paramType }}{{ p.unit ? ' · ' + p.unit : '' }}</span>
                    </div>
                    <div v-if="p.description" class="text-xs text-gray-400">{{ p.description }}</div>
                    <div v-if="Array.isArray(p.values)" class="mt-0.5 flex flex-wrap gap-1">
                      <span v-for="(v, vi) in p.values" :key="vi" class="rounded bg-white px-1.5 py-0.5 text-xs text-gray-500">{{ v.label }}：{{ v.factor }}</span>
                    </div>
                    <div v-else-if="p.values" class="mt-0.5 text-xs text-gray-500">{{ p.values }}</div>
                  </div>
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
          <div class="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div class="mb-4 flex items-center justify-between">
              <h3 class="text-xl font-bold text-gray-900">管理标准（{{ standards.length }}）</h3>
              <div class="flex gap-2">
                <button v-if="!editing && can('standards:create')" class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700" @click="openNew">+ 新增标准</button>
                <button class="text-gray-400 hover:text-gray-600" @click="showAdmin = false">✕</button>
              </div>
            </div>

            <!-- 列表 -->
            <div v-if="!editing" class="space-y-2">
              <div
                v-for="s in standards"
                :key="s.id"
                class="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm"
              >
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium text-gray-800">{{ s.name }}</p>
                  <p class="text-xs text-gray-400">{{ s.id }} · {{ s.category }} · {{ levelLabelMap[s.level] || s.level }}</p>
                </div>
                <button v-if="can('standards:edit')" class="shrink-0 text-xs text-blue-500 hover:underline" @click="openEdit(s)">编辑</button>
                <button v-if="can('standards:delete')" class="shrink-0 text-xs text-red-500 hover:underline" @click="deleteStandard(s)">删除</button>
              </div>
              <p v-if="standards.length === 0" class="py-8 text-center text-gray-400">暂无数据</p>
            </div>

            <!-- 表单 -->
            <div v-else class="space-y-3">
              <div class="grid grid-cols-2 gap-3">
                <label class="text-xs text-gray-500">标准 id<div class="mt-1"><input v-model="form.id" :disabled="!!editing" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="如 hb-eb40" /></div></label>
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

              <!-- 参数明细编辑器（合并进标准） -->
              <div class="block rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-gray-500">参数明细（{{ paramRows.length }} 条）</span>
                  <button type="button" class="text-xs text-primary hover:underline" :disabled="!editing || !!paramDraft" @click="startAddParam">+ 添加参数</button>
                </div>
                <p v-if="!editing" class="mt-2 text-xs text-gray-400">先保存标准，再回来编辑即可添加参数</p>
                <template v-else>
                  <div v-for="p in paramRows" :key="p.id" class="mt-2 flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                    <div class="min-w-0">
                      <p class="truncate font-medium text-gray-800">{{ p.paramName }}</p>
                      <p class="text-xs text-gray-400">{{ p.paramCategory || '未分类' }} · {{ p.paramType }}{{ p.unit ? ' · ' + p.unit : '' }}</p>
                    </div>
                    <div class="flex shrink-0 gap-2">
                      <button class="text-xs text-blue-500 hover:underline" :disabled="!!paramDraft" @click="startEditParam(p)">编辑</button>
                      <button class="text-xs text-red-500 hover:underline" :disabled="!!paramDraft" @click="removeParam(p)">删除</button>
                    </div>
                  </div>
                  <p v-if="paramRows.length === 0" class="mt-2 text-xs text-gray-400">暂无参数</p>
                </template>

                <!-- 参数草稿表单 -->
                <div v-if="paramDraft" class="mt-3 space-y-2 rounded-lg border border-gray-200 p-3">
                  <div class="grid grid-cols-2 gap-2">
                    <input v-model="paramDraft.paramCategory" class="rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder="分类（如 规模度量-功能点相关）" />
                    <input v-model="paramDraft.paramName" class="rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder="参数名（必填）" />
                    <input v-model="paramDraft.paramType" class="rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder="类型（weight/factor/rate…）" />
                    <input v-model="paramDraft.unit" class="rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder="单位（如 人月/元）" />
                  </div>
                  <textarea v-model="paramDraft.description" rows="2" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder="说明"></textarea>
                  <textarea v-model="paramDraft.values" rows="2" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder='取值 JSON，如 [{"label":"高","factor":0.3333}]'></textarea>
                  <div class="flex justify-end gap-2">
                    <button class="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100" :disabled="savingParam" @click="cancelParam">取消</button>
                    <button :disabled="savingParam" class="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" @click="saveParam">{{ savingParam ? '保存中…' : '保存参数' }}</button>
                  </div>
                </div>
              </div>

              <div class="flex justify-end gap-2 pt-2">
                <button class="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100" @click="editing = null">返回列表</button>
                <button :disabled="saving" class="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50" @click="saveStandard">{{ saving ? '保存中…' : '保存' }}</button>
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
