<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const router = useRouter()
const { api } = useAuth()
const projectId = Number(route.params.id)

// 计价引擎：与服务端共用同一份实现（shared/），保证前端预览与后端测算结果完全一致
import { runPricingEngine, nonFunctionalFactor } from '../../shared/pricingEngine'

// UFP 权重：IFPUG/NESMA 标准常量（非示例值）
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

// 计价区：标准 / 费率 / 生产率全部来自数据库（/api/pricing-standards）
const standards = ref<any[]>([])
const cities = ref<any[]>([])
const stdId = ref('')
const pdr = ref<number | null>(null)
const city = ref('')

const selectedStd = computed<any | null>(
  () => standards.value.find((s) => s.id === stdId.value) || standards.value[0] || null
)

// 生效费率：选了城市用城市费率，否则用标准自带费率
const effectiveRate = computed<number | null>(() => {
  const s = selectedStd.value
  if (!s) return null
  if (city.value) {
    const c = cities.value.find((x) => x.city === city.value)
    const r = c ? (s.category === '运维' ? c.maintenance : c.development) : null
    if (r) return r
  }
  return s.rate
})
const effectivePdr = computed(() => pdr.value || selectedStd.value?.pdr || 0)

// 生产率(FP/人月) = hm ÷ pdr
const productivity = computed(() => {
  const s = selectedStd.value
  if (!s || !effectivePdr.value) return null
  return Math.round((s.hm / effectivePdr.value) * 100) / 100
})
// 功能点单价(元/FP) = rate × pdr ÷ hm
const fpPrice = computed(() => {
  const s = selectedStd.value
  if (!s || !effectiveRate.value || !effectivePdr.value) return null
  return Math.round((effectiveRate.value * effectivePdr.value) / s.hm)
})

// 只统计功能点层（level 4）；1~3 级模块的 UFP 由子节点汇总，避免重复计入
const totalUFP = computed(() =>
  editableFps.value
    .filter((fp) => Number(fp.level) === 4)
    .reduce((s, fp) => s + (Number(fp.ufp) || 0), 0)
)
// ---- 调整因子（未设置即取中性值 1，不参与调整）----
const fCf = ref<number | null>(null)
const fReuse = ref<number | null>(null)
const fAppType = ref<number | null>(null)
const fPlatform = ref<number | null>(null)
const fTeam = ref<number | null>(null)
const fIntegrity = ref<number | null>(null)
const fTeamSize = ref<number | null>(null)

// 软件完整性级别：标准参数里一般不给，取 GB/T 28827.7 的通用档位
const INTEGRITY_OPTS = [
  { label: '无明确 / CD 级', factor: 1.0 },
  { label: 'AB 级（含特殊设计）', factor: 1.1 },
  { label: 'A 级（全生命周期特殊措施）', factor: 1.3 },
]
// 非功能性特征：4 项，勾选=有明示要求(+1)，未勾选=无明示(-1)
const NF_ITEMS = ['性能效率', '兼容性', '可靠性', '可移植性']
const nfEnabled = ref(false)
const nfChecked = ref<boolean[]>([false, false, false, false])

function resetFactors() {
  fCf.value = null
  fReuse.value = null
  fAppType.value = null
  fPlatform.value = null
  fTeam.value = null
  fIntegrity.value = null
  fTeamSize.value = null
  nfEnabled.value = false
  nfChecked.value = [false, false, false, false]
}

// 只保留数值型选项（标准里有的填的是"参考CSBMK"这类非数值说明）
const numOpts = (arr: any[]) =>
  (arr || []).filter((o: any) => Number.isFinite(Number(o.factor)))

const nfFactor = computed(() =>
  nfEnabled.value ? nonFunctionalFactor(nfChecked.value.reduce((s, c) => s + (c ? 1 : -1), 0)) : 1
)

// 完整测算链：UFP → US(复用) → S(规模变更) → UE → AE(SWF×RDF) → 人月 → 费用
const engine = computed(() => {
  const s = selectedStd.value
  if (!s || !effectiveRate.value || !effectivePdr.value) return null
  return runPricingEngine({
    totalUFP: totalUFP.value,
    pdr: effectivePdr.value,
    hm: s.hm,
    rate: effectiveRate.value,
    factors: {
      cf: fCf.value ?? undefined,
      reuse: fReuse.value ?? undefined,
      appType: fAppType.value ?? undefined,
      platform: fPlatform.value ?? undefined,
      team: fTeam.value ?? undefined,
      integrityLevel: fIntegrity.value ?? undefined,
      nfSum: nfEnabled.value ? nfChecked.value.reduce((s, c) => s + (c ? 1 : -1), 0) : undefined,
      teamSize: fTeamSize.value ?? undefined,
    },
  })
})

const adjustedUFP = computed(() => engine.value?.s ?? totalUFP.value)
const cost = computed(() => engine.value?.cost ?? 0)
const months = computed(() => engine.value?.workMonths ?? null)

// 切换标准时，生产率 / 城市 / 调整因子一并重置（不同标准的因子取值不同，不可沿用）
watch(selectedStd, (s) => {
  if (!s) return
  pdr.value = s.pdr
  city.value = s.rateMode === 'city' ? s.suggestedCity || cities.value[0]?.city || '' : ''
  resetFactors()
})

const loadProject = async () => {
  loading.value = true
  try {
    const res: any = await api('/api/projects/' + projectId)
    project.value = res.project
    fps.value = res.functionPoints || []
    editableFps.value = hydrate(fps.value)
    // 仅当项目已存的标准仍存在于库里才沿用，否则回落到标准清单的第一条
    if (res.project.standard_id && standards.value.some((s) => s.id === res.project.standard_id)) {
      stdId.value = res.project.standard_id
    }
    // 文本预览
    if (res.project.document_path || res.project.raw_text) {
      rawTextPreview.value = res.project.raw_text || ''
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
    editableFps.value = hydrate(fps.value)
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

// ---- 四层模块：level 1~3 为模块层级（UFP 由子节点汇总），level 4 为功能点 ----
let keySeed = 0
const newKey = () => `k${Date.now().toString(36)}_${keySeed++}`

// 载入时补齐稳定 key 与层级；历史数据没有 level，默认 4（功能点）。
// 同时把后端返回的 parent_id 翻译成前端的 parentKey（本接口删除重建后 id 会变，不能直接引用）
function hydrate(rows: any[]): any[] {
  const list = (rows || []).map((r) => ({
    ...r,
    _key: r._key || newKey(),
    level: [1, 2, 3, 4].includes(Number(r.level)) ? Number(r.level) : 4,
  }))
  const idToKey = new Map<any, string>(list.map((r: any) => [r.id, r._key]))
  return list.map((r) => ({
    ...r,
    parentKey: r.parent_id != null ? idToKey.get(r.parent_id) ?? null : r.parentKey ?? null,
  }))
}

// 新增模块层级行（level 1~3），作为顶层分组
const addModuleRow = (level: number) => {
  editableFps.value.push({
    _key: newKey(),
    level,
    parentKey: null,
    name: `新${level}级模块`,
    type: '',
    complexity: '中',
    ret: 0,
    det: 0,
    ufp: 0,
    note: '',
    source: 'manual'
  })
}

const addManualRow = () => {
  editableFps.value.push({
    _key: newKey(),
    level: 4,
    parentKey: null,
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

// 在指定模块下插入子节点（只有 1~3 级模块可加子级）
const addChildRow = (parent: any) => {
  const lv = Number(parent?.level)
  if (!parent || !lv || lv >= 4) return
  const childLevel = lv + 1
  const idx = editableFps.value.findIndex((r) => r._key === parent._key)
  if (idx < 0) return
  const isLeaf = childLevel === 4
  editableFps.value.splice(idx + 1, 0, {
    _key: newKey(),
    level: childLevel,
    parentKey: parent._key,
    name: isLeaf ? '新功能项' : `新${childLevel}级模块`,
    type: isLeaf ? 'ILF' : '',
    complexity: '中',
    ret: 0,
    det: 0,
    ufp: isLeaf ? 10 : 0,
    note: '',
    source: 'manual'
  })
}

// 删除一行及其所有子孙
const removeRow = (row: any) => {
  const keys = new Set<string>([row._key])
  let grew = true
  while (grew) {
    grew = false
    for (const r of editableFps.value) {
      if (r.parentKey && keys.has(r.parentKey) && !keys.has(r._key)) {
        keys.add(r._key)
        grew = true
      }
    }
  }
  editableFps.value = editableFps.value.filter((r) => !keys.has(r._key))
}

const recomputeRow = (fp: any) => {
  // 模块层级（1~3）不计自身 UFP，由子节点汇总
  fp.ufp = Number(fp.level) === 4 ? computeUFP(fp.type, fp.complexity) : 0
}

// 父节点 UFP = 子孙中「功能点层（level 4）」之和
const subtreeUfp = (key: string): number =>
  editableFps.value
    .filter((r) => r.parentKey === key)
    .reduce((s, c) => s + (Number(c.level) === 4 ? Number(c.ufp) || 0 : subtreeUfp(c._key)), 0)

const saveFps = async () => {
  saving.value = true
  try {
    editableFps.value.forEach(recomputeRow)
    const res: any = await api('/api/projects/' + projectId + '/function-points', {
      method: 'PUT',
      body: { functionPoints: editableFps.value }
    })
    fps.value = res.functionPoints || []
    editableFps.value = hydrate(fps.value)
    alert('功能点已保存')
  } catch (err: any) {
    alert('保存失败：' + (err.data?.statusMessage || err.message))
  } finally {
    saving.value = false
  }
}

const exportReport = async () => {
  const s = selectedStd.value
  if (!s) return

  // 先把测算结果落库（供后续 Excel 导出 / 复用），失败也不阻塞导出
  try {
    await api('/api/projects/' + projectId + '/calculate', {
      method: 'POST',
      body: {
        standardId: stdId.value,
        city: city.value,
        pdr: effectivePdr.value,
        cf: fCf.value ?? undefined,
        reuse: fReuse.value ?? undefined,
        appType: fAppType.value ?? undefined,
        platform: fPlatform.value ?? undefined,
        team: fTeam.value ?? undefined,
        integrityLevel: fIntegrity.value ?? undefined,
        nfSum: nfEnabled.value ? nfChecked.value.reduce((a, c) => a + (c ? 1 : -1), 0) : undefined,
        teamSize: fTeamSize.value ?? undefined,
      }
    })
  } catch {
    /* 忽略保存失败 */
  }

  const lines: string[] = []
  lines.push('软件造价测算报告')
  lines.push('项目名称：' + (project.value?.name || ''))
  lines.push('功能点方法：' + (project.value?.method || '').toUpperCase())
  lines.push('计价标准：' + s.name + '（' + s.code + '）')
  lines.push('发布机构：' + s.org)
  if (city.value) lines.push('取费城市：' + city.value)
  lines.push('')
  lines.push('功能点明细（四层模块）：')
  lines.push('序号\t层级\t名称\t类型\t复杂度\tUFP')
  editableFps.value.forEach((fp, i) => {
    const lv = Number(fp.level)
    const indent = '　'.repeat(Math.max(0, lv - 1))
    const ufp = lv === 4 ? fp.ufp : subtreeUfp(fp._key)
    lines.push(`${i + 1}\t${lv}\t${indent}${fp.name}\t${fp.type || '-'}\t${lv === 4 ? fp.complexity : '-'}\t${ufp}`)
  })
  lines.push('')
  lines.push('未调整功能点合计(UFP)：' + totalUFP.value)
  lines.push('基准生产率(人时/功能点)：' + effectivePdr.value)
  lines.push('生产率(功能点/人月)：' + productivity.value)
  lines.push('人月折算系数(人时/人月)：' + s.hm)
  lines.push('人月费率(元/人月)：' + effectiveRate.value)
  lines.push('功能点单价(元/功能点)：' + fpPrice.value)
  lines.push('')
  lines.push('测算过程：')
  if (engine.value) {
    for (const st of engine.value.steps) {
      lines.push(`  ${st.label}\t${st.value}\t${st.unit}\t${st.formula}`)
    }
    if (engine.value.durationMonths != null) lines.push('工期(月)：' + engine.value.durationMonths)
  }
  lines.push('')
  lines.push('测算造价(元)：' + cost.value)
  lines.push('折合(万元)：' + (cost.value / 10000).toFixed(2))
  if (s.filled.length) {
    lines.push('')
    lines.push('参数补齐说明：' + s.filled.join('；'))
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `造价报告_${project.value?.name || projectId}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

const loadStandards = async () => {
  try {
    const res: any = await api('/api/pricing-standards')
    standards.value = res.standards || []
    cities.value = res.cities || []
    if (!stdId.value && standards.value.length) {
      stdId.value = (standards.value.find((s: any) => s.usable) || standards.value[0]).id
    }
  } catch {
    standards.value = []
    cities.value = []
  }
}

onMounted(async () => {
  await loadStandards()
  await loadProject()
})
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
          <div v-if="rawTextPreview" class="mt-3 max-h-[60vh] overflow-y-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
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
            <h2 class="text-lg font-bold text-gray-900">② 功能点清单（四层模块，可编辑）</h2>
            <div class="flex gap-2">
              <button class="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50" @click="addModuleRow(1)">+ 一级模块</button>
              <button class="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50" @click="addManualRow">+ 功能点</button>
              <button class="btn-primary px-3 py-1.5 text-sm" :disabled="saving" @click="saveFps">保存修改</button>
            </div>
          </div>
          <p class="mb-3 text-xs text-gray-400">
            一~三级为模块层级（UFP 由下级自动汇总，不重复计入合计），四级为功能点（按类型与复杂度计算 UFP）。
            在模块行点「+子级」可继续下钻。
          </p>

          <div v-if="editableFps.length === 0" class="py-10 text-center text-sm text-gray-400">
            暂无功能点。上传需求后点击「AI 识别功能点」，或手动添加。
          </div>
          <div v-else class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th class="px-2 py-2">名称 / 模块</th>
                  <th class="px-2 py-2">层级</th>
                  <th class="px-2 py-2">类型</th>
                  <th class="px-2 py-2">复杂度</th>
                  <th class="px-2 py-2">RET</th>
                  <th class="px-2 py-2">DET</th>
                  <th class="px-2 py-2">UFP</th>
                  <th class="px-2 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="fp in editableFps"
                  :key="fp._key"
                  class="border-b border-gray-100"
                  :class="Number(fp.level) < 4 ? 'bg-gray-50' : ''"
                >
                  <td class="px-2 py-2">
                    <div class="flex items-center gap-1" :style="{ paddingLeft: (Number(fp.level) - 1) * 14 + 'px' }">
                      <span v-if="Number(fp.level) < 4" class="text-gray-400">▸</span>
                      <input
                        v-model="fp.name"
                        class="w-40 rounded border border-gray-200 px-2 py-1 text-xs"
                        :class="Number(fp.level) < 4 ? 'font-medium text-gray-800' : ''"
                      />
                    </div>
                  </td>
                  <td class="px-2 py-2">
                    <select v-model.number="fp.level" class="rounded border border-gray-200 px-1.5 py-1 text-xs" @change="recomputeRow(fp)">
                      <option :value="1">一级</option>
                      <option :value="2">二级</option>
                      <option :value="3">三级</option>
                      <option :value="4">功能点</option>
                    </select>
                  </td>
                  <td class="px-2 py-2">
                    <select v-if="Number(fp.level) === 4" v-model="fp.type" class="rounded border border-gray-200 px-2 py-1 text-xs" @change="recomputeRow(fp)">
                      <option v-for="t in ['ILF','EIF','EI','EO','EQ']" :key="t" :value="t">{{ t }}</option>
                    </select>
                    <span v-else class="text-xs text-gray-400">—</span>
                  </td>
                  <td class="px-2 py-2">
                    <select v-if="Number(fp.level) === 4" v-model="fp.complexity" class="rounded border border-gray-200 px-2 py-1 text-xs" @change="recomputeRow(fp)">
                      <option v-for="c in ['低','中','高']" :key="c" :value="c">{{ c }}</option>
                    </select>
                    <span v-else class="text-xs text-gray-400">—</span>
                  </td>
                  <td class="px-2 py-2">
                    <input v-if="Number(fp.level) === 4" v-model.number="fp.ret" type="number" class="w-14 rounded border border-gray-200 px-2 py-1 text-xs" />
                    <span v-else class="text-xs text-gray-400">—</span>
                  </td>
                  <td class="px-2 py-2">
                    <input v-if="Number(fp.level) === 4" v-model.number="fp.det" type="number" class="w-14 rounded border border-gray-200 px-2 py-1 text-xs" />
                    <span v-else class="text-xs text-gray-400">—</span>
                  </td>
                  <td class="px-2 py-2 font-semibold" :class="Number(fp.level) === 4 ? 'text-primary' : 'text-gray-700'">
                    <span v-if="Number(fp.level) === 4">{{ fp.ufp }}</span>
                    <span v-else :title="'下级汇总（不计入合计）'">{{ subtreeUfp(fp._key) }}</span>
                  </td>
                  <td class="whitespace-nowrap px-2 py-2">
                    <button v-if="Number(fp.level) < 4" class="mr-2 text-xs text-primary hover:underline" @click="addChildRow(fp)">+子级</button>
                    <button class="text-xs text-red-500 hover:underline" @click="removeRow(fp)">删除</button>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="border-t-2 border-gray-200 text-sm font-semibold">
                  <td class="px-2 py-2 text-gray-700" colspan="6">功能点合计（仅统计功能点层）</td>
                  <td class="px-2 py-2 text-primary">{{ totalUFP }}</td>
                  <td></td>
                </tr>
              </tfoot>
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
                <optgroup label="参数完整（标准自带费率与生产率）">
                  <option v-for="s in standards.filter((x: any) => x.complete)" :key="s.id" :value="s.id">
                    {{ s.name }} · {{ s.region }}（{{ s.fpPrice }} 元/FP）
                  </option>
                </optgroup>
                <optgroup label="可用（需按城市取费 / 部分参数已补齐）">
                  <option v-for="s in standards.filter((x: any) => !x.complete && x.usable)" :key="s.id" :value="s.id">
                    {{ s.name }} · {{ s.region }}（{{ s.fpPrice ? s.fpPrice + ' 元/FP' : '需选城市' }}）
                  </option>
                </optgroup>
                <optgroup label="不可测算（缺少关键参数）">
                  <option v-for="s in standards.filter((x: any) => !x.usable)" :key="s.id" :value="s.id">
                    {{ s.name }} · {{ s.region }}（缺{{ s.missing.join('、') }}）
                  </option>
                </optgroup>
              </select>
              <p v-if="selectedStd && !selectedStd.usable" class="mt-2 text-xs text-amber-600">
                ⚠ 该标准缺少「{{ selectedStd.missing.join('、') }}」，无法测算，请改用其它标准。
              </p>

              <label class="mb-2 mt-4 block text-sm font-medium text-gray-700">基准生产率（人时/功能点）</label>
              <select v-model.number="pdr" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary">
                <option v-for="o in (selectedStd?.pdrOptions || [])" :key="o.label" :value="o.value">
                  {{ o.label }} — {{ o.value }}
                </option>
              </select>

              <label class="mb-2 mt-4 block text-sm font-medium text-gray-700">
                城市费率（留空则用标准自带费率）
              </label>
              <select v-model="city" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary">
                <option value="">（使用标准自带费率）</option>
                <option v-for="c in cities" :key="c.city" :value="c.city">
                  {{ c.city }} — {{ (selectedStd?.category === '运维' ? c.maintenance : c.development)?.toLocaleString() || '-' }} 元/人月
                </option>
              </select>

              <!-- 调整因子：均可留空，留空即取中性值 1，不参与调整 -->
              <div class="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3">
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-sm font-medium text-gray-700">调整因子</span>
                  <button class="text-xs text-primary hover:underline" @click="resetFactors">重置</button>
                </div>

                <div v-if="numOpts(selectedStd?.factors?.scaleChange).length" class="mb-2">
                  <label class="mb-1 block text-xs text-gray-500">规模变更因子 CF</label>
                  <select v-model="fCf" class="w-full rounded border border-gray-200 px-2 py-1.5 text-xs">
                    <option :value="null">（不调整）</option>
                    <option v-for="o in numOpts(selectedStd.factors.scaleChange)" :key="o.label" :value="Number(o.factor)">
                      {{ o.label }} — {{ o.factor }}
                    </option>
                  </select>
                </div>

                <div v-if="numOpts(selectedStd?.factors?.reuse).length" class="mb-2">
                  <label class="mb-1 block text-xs text-gray-500">复用系数</label>
                  <select v-model="fReuse" class="w-full rounded border border-gray-200 px-2 py-1.5 text-xs">
                    <option :value="null">（不调整）</option>
                    <option v-for="o in numOpts(selectedStd.factors.reuse)" :key="o.label" :value="Number(o.factor)">
                      {{ o.label }} — {{ o.factor }}
                    </option>
                  </select>
                </div>

                <div v-if="numOpts(selectedStd?.factors?.applicationType).length" class="mb-2">
                  <label class="mb-1 block text-xs text-gray-500">应用类型（SWF）</label>
                  <select v-model="fAppType" class="w-full rounded border border-gray-200 px-2 py-1.5 text-xs">
                    <option :value="null">（不调整）</option>
                    <option v-for="o in numOpts(selectedStd.factors.applicationType)" :key="o.label" :value="Number(o.factor)">
                      {{ o.label }} — {{ o.factor }}
                    </option>
                  </select>
                </div>

                <div v-if="numOpts(selectedStd?.factors?.platform).length" class="mb-2">
                  <label class="mb-1 block text-xs text-gray-500">开发平台（RDF）</label>
                  <select v-model="fPlatform" class="w-full rounded border border-gray-200 px-2 py-1.5 text-xs">
                    <option :value="null">（不调整）</option>
                    <option v-for="o in numOpts(selectedStd.factors.platform)" :key="o.label" :value="Number(o.factor)">
                      {{ o.label }} — {{ o.factor }}
                    </option>
                  </select>
                </div>

                <div v-if="numOpts(selectedStd?.factors?.team).length" class="mb-2">
                  <label class="mb-1 block text-xs text-gray-500">开发团队背景（RDF）</label>
                  <select v-model="fTeam" class="w-full rounded border border-gray-200 px-2 py-1.5 text-xs">
                    <option :value="null">（不调整）</option>
                    <option v-for="o in numOpts(selectedStd.factors.team)" :key="o.label" :value="Number(o.factor)">
                      {{ o.label }} — {{ o.factor }}
                    </option>
                  </select>
                </div>

                <div class="mb-2">
                  <label class="mb-1 block text-xs text-gray-500">软件完整性级别（SWF）</label>
                  <select v-model="fIntegrity" class="w-full rounded border border-gray-200 px-2 py-1.5 text-xs">
                    <option :value="null">（不调整）</option>
                    <option v-for="o in INTEGRITY_OPTS" :key="o.label" :value="o.factor">
                      {{ o.label }} — {{ o.factor }}
                    </option>
                  </select>
                </div>

                <!-- 非功能性特征：启用后按 (Σ±1)×0.025+1 计算 -->
                <div class="mb-2">
                  <label class="mb-1 flex items-center gap-2 text-xs text-gray-500">
                    <input v-model="nfEnabled" type="checkbox" class="h-3 w-3 accent-blue-600" />
                    非功能性特征（SWF）· 当前因子 {{ nfFactor }}
                  </label>
                  <div v-if="nfEnabled" class="mt-1 flex flex-wrap gap-3 pl-1">
                    <label v-for="(it, i) in NF_ITEMS" :key="it" class="flex items-center gap-1 text-xs text-gray-600">
                      <input v-model="nfChecked[i]" type="checkbox" class="h-3 w-3 accent-blue-600" />
                      {{ it }}
                    </label>
                  </div>
                  <p v-if="nfEnabled" class="mt-1 pl-1 text-[11px] text-gray-400">
                    勾选=有明示要求(+1)，未勾选=无明示(-1)；因子 = (合计)×0.025 + 1
                  </p>
                </div>

                <div>
                  <label class="mb-1 block text-xs text-gray-500">投入人数（仅用于估算工期）</label>
                  <input v-model.number="fTeamSize" type="number" min="1" placeholder="留空则不估工期" class="w-full rounded border border-gray-200 px-2 py-1.5 text-xs" />
                </div>
              </div>
            </div>

            <div class="rounded-xl bg-gradient-to-br from-primary/5 to-indigo-50 p-5">
              <div class="flex justify-between py-1.5 text-sm"><span class="text-gray-500">基准生产率</span><span class="font-semibold">{{ effectivePdr }} 人时/FP</span></div>
              <div class="flex justify-between border-t border-gray-100 py-1.5 text-sm">
                <span class="text-gray-500">人月折算 / 费率</span>
                <span class="font-semibold">{{ selectedStd?.hm ?? '-' }} 人时 · {{ effectiveRate?.toLocaleString() || '-' }} 元/人月</span>
              </div>
              <div class="flex justify-between border-t border-gray-100 py-1.5 text-sm"><span class="text-gray-500">功能点单价</span><span class="font-semibold">{{ fpPrice ?? '-' }} 元/FP</span></div>

              <!-- 完整测算链 -->
              <div v-if="engine" class="mt-3 border-t border-gray-200 pt-3">
                <div class="mb-1.5 text-xs font-semibold text-gray-600">测算过程</div>
                <div v-for="st in engine.steps" :key="st.key" class="py-1">
                  <div class="flex items-baseline justify-between gap-2 text-xs">
                    <span class="text-gray-500">{{ st.label }}</span>
                    <span class="whitespace-nowrap">
                      <span class="font-semibold text-gray-800">{{ st.value.toLocaleString() }}</span>
                      <span v-if="st.unit" class="ml-1 text-gray-400">{{ st.unit }}</span>
                    </span>
                  </div>
                  <div class="text-[11px] text-gray-400">{{ st.formula }}</div>
                </div>
              </div>
              <p v-else class="mt-3 border-t border-gray-200 pt-3 text-xs text-amber-600">
                当前标准参数不足，无法测算（请换用其它标准或选择城市）
              </p>

              <div class="mt-3 flex items-baseline justify-between border-t border-gray-200 pt-3">
                <span class="text-gray-700">测算造价</span>
                <span class="text-2xl font-bold text-primary">¥{{ cost.toLocaleString() }}</span>
              </div>
              <p class="mt-1 text-right text-xs text-gray-400">
                约 {{ (cost / 10000).toFixed(2) }} 万元
                <template v-if="engine?.durationMonths"> · 工期 {{ engine.durationMonths }} 月</template>
              </p>
              <button class="btn-primary mt-4 w-full py-2.5 text-sm" @click="exportReport">导出报告</button>
            </div>
          </div>

          <div v-if="selectedStd" class="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
            <div>数据来源：{{ selectedStd.code }} · {{ selectedStd.org }}（共 {{ selectedStd.paramCount }} 项参数）</div>
            <div v-if="selectedStd.filled.length" class="mt-1 text-amber-600">
              以下参数为该标准未给定、由系统补齐：{{ selectedStd.filled.join('；') }}
            </div>
          </div>
          <p class="mt-3 text-xs text-gray-400">
            测算口径：UFP → 复用调整 US → 规模变更调整 S → 未调整工作量 UE = S × 生产率 →
            调整后工作量 AE = UE × SWF(应用类型×非功能×完整性) × RDF(平台×团队) →
            工作量 = AE ÷ 人月折算系数 → 费用 = 工作量 × 人月费率。参数均取自已落库的标准原文。
          </p>
        </div>
      </template>
    </div>
  </div>
</template>
