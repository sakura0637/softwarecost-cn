<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const router = useRouter()
const { api } = useAuth()
const projectId = Number(route.params.id)

// ---- 计价参数（与后端 pricing.ts 对应，需替换为你手上的权威基准）----
const PRICING = [
  { id: 'gb-t-36964', name: 'GB/T 36964（国标）', unitPrice: 1100 },
  { id: 'hebei', name: '河北省信息化预算标准', unitPrice: 1000 },
  { id: 'beijing', name: '北京市', unitPrice: 1400 },
  { id: 'sichuan', name: '四川省', unitPrice: 1050 }
]
const UFP_WEIGHT: Record<string, Record<string, number>> = {
  ILF: { 低: 7, 中: 10, 高: 15 },
  EIF: { 低: 5, 中: 7, 高: 10 },
  EI: { 低: 3, 中: 4, 高: 6 },
  EO: { 低: 4, 中: 5, 高: 7 },
  EQ: { 低: 3, 中: 4, 高: 6 }
}
const computeUFP = (type: string, complexity: string) =>
  UFP_WEIGHT[type]?.[complexity] ?? 0

const project = ref<any>(null)
const rawTextPreview = ref('')
const fps = ref<any[]>([])
const editableFps = ref<any[]>([])
const loading = ref(false)
const analyzing = ref(false)
const saving = ref(false)
const analyzingMsg = ref('')
const uploadMsg = ref('')

// 录入区
const pastedText = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

// 计价区
const stdId = ref('hebei')
const vaf = ref(1.0)

const totalUFP = computed(() =>
  editableFps.value.reduce((s, fp) => s + (Number(fp.ufp) || 0), 0)
)
const adjustedUFP = computed(() =>
  Math.round(totalUFP.value * vaf.value * 100) / 100
)
const selectedStd = computed(
  () => PRICING.find((s) => s.id === stdId.value) || PRICING[0]
)
const cost = computed(() =>
  Math.round(adjustedUFP.value * selectedStd.value.unitPrice)
)

const loadProject = async () => {
  loading.value = true
  try {
    const res: any = await api('/api/projects/' + projectId)
    project.value = res.project
    fps.value = res.functionPoints || []
    editableFps.value = JSON.parse(JSON.stringify(fps.value))
    stdId.value = res.project.standard_id || 'hebei'
    // 文本预览
    if (res.project.document_path || res.project.raw_text) {
      rawTextPreview.value = (res.project.raw_text || '').slice(0, 800)
    }
  } finally {
    loading.value = false
  }
}

const onFileUpload = async (e: Event) => {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  uploadMsg.value = '上传并提取中…'
  const fd = new FormData()
  fd.append('file', file)
  try {
    const res: any = await api('/api/projects/' + projectId + '/upload', {
      method: 'POST',
      body: fd
    })
    uploadMsg.value = `已提取需求文本，共 ${res.rawTextLength} 字`
    rawTextPreview.value = res.rawTextPreview || ''
  } catch (err: any) {
    uploadMsg.value = '上传失败：' + (err.data?.statusMessage || err.message)
  }
}

const submitText = async () => {
  if (!pastedText.value.trim()) return
  uploadMsg.value = '保存文本中…'
  try {
    const res: any = await api('/api/projects/' + projectId + '/upload', {
      method: 'POST',
      body: { text: pastedText.value }
    })
    uploadMsg.value = `已保存需求文本，共 ${res.rawTextLength} 字`
    rawTextPreview.value = res.rawTextPreview || ''
  } catch (err: any) {
    uploadMsg.value = '保存失败：' + (err.data?.statusMessage || err.message)
  }
}

const runAnalyze = async () => {
  analyzing.value = true
  analyzingMsg.value = ''
  try {
    const res: any = await api('/api/projects/' + projectId + '/analyze', {
      method: 'POST'
    })
    fps.value = res.functionPoints || []
    editableFps.value = JSON.parse(JSON.stringify(fps.value))
    analyzingMsg.value = `AI 识别完成，共 ${fps.value.length} 个功能点`
  } catch (err: any) {
    const msg = err.data?.statusMessage || err.message || '识别失败'
    analyzingMsg.value = msg.includes('DEEPSEEK_API_KEY')
      ? '后端未配置 DEEPSEEK_API_KEY，无法调用 AI。请在环境变量中设置后重启（可暂时手动添加功能点）。'
      : '识别失败：' + msg
  } finally {
    analyzing.value = false
  }
}

const addManualRow = () => {
  editableFps.value.push({
    name: '新功能项',
    type: 'ILF',
    complexity: '中',
    ret: 0,
    det: 0,
    ufp: 10,
    note: '',
    source: 'manual'
  })
}

const recomputeRow = (fp: any) => {
  fp.ufp = computeUFP(fp.type, fp.complexity)
}

const saveFps = async () => {
  saving.value = true
  try {
    editableFps.value.forEach(recomputeRow)
    const res: any = await api('/api/projects/' + projectId + '/function-points', {
      method: 'PUT',
      body: { functionPoints: editableFps.value }
    })
    fps.value = res.functionPoints || []
    editableFps.value = JSON.parse(JSON.stringify(fps.value))
    alert('功能点已保存')
  } catch (err: any) {
    alert('保存失败：' + (err.data?.statusMessage || err.message))
  } finally {
    saving.value = false
  }
}

const exportReport = () => {
  const lines: string[] = []
  lines.push('软件造价测算报告')
  lines.push('项目名称：' + (project.value?.name || ''))
  lines.push('功能点方法：' + (project.value?.method || '').toUpperCase())
  lines.push('计价标准：' + selectedStd.value.name)
  lines.push('调整因子 VAF：' + vaf.value)
  lines.push('')
  lines.push('功能点明细：')
  lines.push('序号\t名称\t类型\t复杂度\tUFP')
  editableFps.value.forEach((fp, i) => {
    lines.push(`${i + 1}\t${fp.name}\t${fp.type}\t${fp.complexity}\t${fp.ufp}`)
  })
  lines.push('')
  lines.push('未调整功能点合计(UFP)：' + totalUFP.value)
  lines.push('调整后功能点：' + adjustedUFP.value)
  lines.push('功能点单价(元/功能点)：' + selectedStd.value.unitPrice)
  lines.push('测算造价(元)：' + cost.value)
  lines.push('折合(万元)：' + (cost.value / 10000).toFixed(2))

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `造价报告_${project.value?.name || projectId}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(loadProject)
</script>

<template>
  <div class="min-h-[calc(100vh-4rem)] bg-gray-50 py-8">
    <div class="container-custom">
      <button class="mb-4 text-sm text-gray-500 hover:text-primary" @click="router.push('/projects')">← 返回工作台</button>

      <div v-if="loading" class="py-20 text-center text-gray-400">加载中…</div>

      <template v-else-if="project">
        <div class="mb-6">
          <h1 class="text-2xl font-bold text-gray-900">{{ project.name }}</h1>
          <p class="mt-1 text-sm text-gray-500">{{ project.description || '暂无描述' }}</p>
        </div>

        <!-- 步骤一：录入需求 -->
        <div class="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 class="mb-4 text-lg font-bold text-gray-900">① 录入需求文档</h2>
          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700">上传文件（Word / Excel / TXT）</label>
              <input ref="fileInput" type="file" accept=".docx,.xlsx,.xls,.txt,.md,.csv" class="block w-full text-sm text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-white" @change="onFileUpload" />
            </div>
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700">或粘贴需求文本</label>
              <div class="flex gap-2">
                <textarea v-model="pastedText" rows="3" placeholder="把需求描述粘贴到这里…" class="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary"></textarea>
                <button class="btn-primary self-end px-4 py-2 text-sm" @click="submitText">保存</button>
              </div>
            </div>
          </div>
          <p v-if="uploadMsg" class="mt-3 text-sm text-primary">{{ uploadMsg }}</p>
          <div v-if="rawTextPreview" class="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
            <p class="mb-1 font-medium text-gray-600">已提取的需求文本预览：</p>
            <p class="whitespace-pre-wrap">{{ rawTextPreview }}</p>
          </div>
          <div class="mt-4">
            <button class="btn-primary px-6 py-2.5 text-sm" :disabled="analyzing" @click="runAnalyze">
              {{ analyzing ? 'AI 识别中…' : '🤖 AI 识别功能点' }}
            </button>
            <span v-if="analyzingMsg" class="ml-3 text-sm" :class="analyzingMsg.includes('未配置') ? 'text-red-500' : 'text-green-600'">{{ analyzingMsg }}</span>
          </div>
        </div>

        <!-- 步骤二：功能点清单 -->
        <div class="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-lg font-bold text-gray-900">② 功能点清单（可编辑）</h2>
            <div class="flex gap-2">
              <button class="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50" @click="addManualRow">+ 手动添加</button>
              <button class="btn-primary px-3 py-1.5 text-sm" :disabled="saving" @click="saveFps">保存修改</button>
            </div>
          </div>

          <div v-if="editableFps.length === 0" class="py-10 text-center text-sm text-gray-400">
            暂无功能点。上传需求后点击「AI 识别功能点」，或手动添加。
          </div>
          <div v-else class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th class="px-2 py-2">名称</th>
                  <th class="px-2 py-2">类型</th>
                  <th class="px-2 py-2">复杂度</th>
                  <th class="px-2 py-2">RET</th>
                  <th class="px-2 py-2">DET</th>
                  <th class="px-2 py-2">UFP</th>
                  <th class="px-2 py-2">来源</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(fp, i) in editableFps" :key="i" class="border-b border-gray-100">
                  <td class="px-2 py-2"><input v-model="fp.name" class="w-40 rounded border border-gray-200 px-2 py-1 text-xs" /></td>
                  <td class="px-2 py-2">
                    <select v-model="fp.type" class="rounded border border-gray-200 px-2 py-1 text-xs" @change="recomputeRow(fp)">
                      <option v-for="t in ['ILF','EIF','EI','EO','EQ']" :key="t" :value="t">{{ t }}</option>
                    </select>
                  </td>
                  <td class="px-2 py-2">
                    <select v-model="fp.complexity" class="rounded border border-gray-200 px-2 py-1 text-xs" @change="recomputeRow(fp)">
                      <option v-for="c in ['低','中','高']" :key="c" :value="c">{{ c }}</option>
                    </select>
                  </td>
                  <td class="px-2 py-2"><input v-model.number="fp.ret" type="number" class="w-14 rounded border border-gray-200 px-2 py-1 text-xs" /></td>
                  <td class="px-2 py-2"><input v-model.number="fp.det" type="number" class="w-14 rounded border border-gray-200 px-2 py-1 text-xs" /></td>
                  <td class="px-2 py-2 font-semibold text-primary">{{ fp.ufp }}</td>
                  <td class="px-2 py-2 text-xs text-gray-400">{{ fp.source === 'manual' ? '手动' : 'AI' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 步骤三：计价 -->
        <div class="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 class="mb-4 text-lg font-bold text-gray-900">③ 造价测算</h2>
          <div class="grid gap-6 md:grid-cols-2">
            <div>
              <label class="mb-2 block text-sm font-medium text-gray-700">计价标准</label>
              <select v-model="stdId" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary">
                <option v-for="s in PRICING" :key="s.id" :value="s.id">{{ s.name }}（{{ s.unitPrice }} 元/功能点）</option>
              </select>
              <label class="mb-2 mt-4 block text-sm font-medium text-gray-700">调整因子 VAF：{{ vaf.toFixed(2) }}</label>
              <input v-model.number="vaf" type="range" min="0.5" max="1.5" step="0.01" class="w-full" />
            </div>
            <div class="rounded-xl bg-gradient-to-br from-primary/5 to-indigo-50 p-5">
              <div class="flex justify-between py-2 text-sm"><span class="text-gray-500">未调整功能点(UFP)</span><span class="font-semibold">{{ totalUFP }}</span></div>
              <div class="flex justify-between border-t border-gray-100 py-2 text-sm"><span class="text-gray-500">调整后功能点</span><span class="font-semibold">{{ adjustedUFP }}</span></div>
              <div class="flex justify-between border-t border-gray-100 py-2 text-sm"><span class="text-gray-500">功能点单价</span><span class="font-semibold">{{ selectedStd.unitPrice }} 元</span></div>
              <div class="mt-3 flex items-baseline justify-between border-t border-gray-200 pt-3">
                <span class="text-gray-700">测算造价</span>
                <span class="text-2xl font-bold text-primary">¥{{ cost.toLocaleString() }}</span>
              </div>
              <p class="mt-1 text-right text-xs text-gray-400">约 {{ (cost / 10000).toFixed(2) }} 万元</p>
              <button class="btn-primary mt-4 w-full py-2.5 text-sm" @click="exportReport">导出报告</button>
            </div>
          </div>
          <p class="mt-3 text-xs text-gray-400">注：单价为标准示例值，正式测算请替换为你手上的权威基准参数。</p>
        </div>
      </template>
    </div>
  </div>
</template>
