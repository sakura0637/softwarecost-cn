<script setup lang="ts">
// 造价标准库页面
import { standards, type CostStandard } from '~/composables/useStandards'
import { useAuth } from '~/composables/useAuth'

const { token, api } = useAuth()

const searchQuery = ref('')
const selectedCategory = ref('全部')
const selectedLevel = ref('全部')
const selectedAttachment = ref<'all' | 'has' | 'none'>('all')

// 各标准附件计数（来自后台汇总接口），驱动「是否含附件」筛选与卡片角标
const attachSummary = ref<Record<string, number>>({})

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
    const hasAtt = (attachSummary.value[s.id] || 0) > 0
    const matchAttachment =
      selectedAttachment.value === 'all'
      || (selectedAttachment.value === 'has' && hasAtt)
      || (selectedAttachment.value === 'none' && !hasAtt)
    return matchSearch && matchCategory && matchLevel && matchAttachment
  })
})

// 拉取各标准附件计数（公开接口）
async function loadSummary() {
  try {
    const res: any = await $fetch('/api/standards/attachments-summary')
    attachSummary.value = res.counts || {}
  } catch {
    attachSummary.value = {}
  }
}
onMounted(loadSummary)

const selectedStandard = ref<CostStandard | null>(null)
const attachments = ref<any[]>([])
const uploading = ref(false)
const uploadFile = ref<File | null>(null)

// 附件在线预览（无需下载）。previewAttachment 为当前预览的附件对象，null 表示关闭。
const previewAttachment = ref<any | null>(null)
const PREVIEWABLE = (mime: string | null | undefined) =>
  !!mime && (mime === 'application/pdf' || mime.startsWith('image/') || mime.startsWith('text/'))
function openPreview(a: any) {
  // 所有附件都可点开预览浮层；可内联渲染的（PDF/图片/文本）走 iframe，其余在浮层内提示下载
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
            <div class="mt-4">
              <h4 class="mb-2 text-sm font-semibold text-gray-900">核心参数</h4>
              <div class="space-y-2">
                <div v-for="p in selectedStandard.params" :key="p" class="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                  <span class="text-gray-500">{{ p }}</span>
                  <span class="font-medium text-gray-700">{{ selectedStandard.paramValues?.[p] ?? '—' }}</span>
                </div>
              </div>
            </div>
            <div class="mt-6 rounded-lg bg-gray-50 p-4 text-xs text-gray-400">
              注：以上数据整理自公开资料，仅供演示参考。实际评估请以官方发布的最新标准文本为准。
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
                  <button v-if="token" class="shrink-0 text-xs text-red-500 hover:underline" @click="onDelete(a.id)">
                    删除
                  </button>
                </div>
              </div>
              <p v-else class="text-xs text-gray-400">暂无附件</p>

              <!-- 上传（需登录） -->
              <div v-if="token" class="mt-3 flex items-center gap-2">
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
                请 <NuxtLink to="/login" class="text-primary hover:underline">登录</NuxtLink> 后上传附件
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
