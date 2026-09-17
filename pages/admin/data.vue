<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue'
import { useAuth } from '~/composables/useAuth'
// 枚举列的中文映射（如 om_factors.engine 的 c1 → C.1 工作量法），纯静态配置
import { enumFor, CALC_ROLE_LABELS } from '~/server/config/dataTables'
// 分组接线声明（每个分组到底怎么进公式）与行级「计算方式」的中文含义 —— 与后端同一份，纯静态配置
import { rowGroupsFor, GROUP_ROLE_LABELS, GROUP_ROLE_TONE, isComputedCalc, columnNote } from '~/server/config/rowGroups'

const { can, api, token } = useAuth()

interface ColMeta { name: string; label: string; uiType: string; nullable: boolean; readonly: boolean; hidden: boolean; isPk: boolean; pkAuto: boolean; isFk: boolean; fkTable?: string; fkLabel?: string }
interface TableConf { key: string; label: string; category: string; hint?: string; groupBy?: string; calcRole?: string; calcRoleNote?: string }
interface Category { key: string; label: string }

const categories = ref<Category[]>([])
const tables = ref<TableConf[]>([])
const activeTable = ref<string>('')

const columns = ref<ColMeta[]>([])
const rows = ref<any[]>([])
const fkOptions = ref<Record<string, { value: any; label: string }[]>>({})
const total = ref(0)
const page = ref(1)
const pageSize = ref(50)
const loading = ref(false)

// ── 新增/编辑弹窗 ──
const showForm = ref(false)
const formMode = ref<'add' | 'edit'>('add')
const formCopy = reactive<any>({})
const editingPk = ref<any>(null)
const savingForm = ref(false)

const showImport = ref(false)
const importFile = ref<File | null>(null)
const importMode = ref<'overwrite' | 'incremental'>('incremental')
const importPreview = ref<any>(null)
const importing = ref(false)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const tablesByCat = computed(() => {
  const m: Record<string, TableConf[]> = {}
  for (const c of categories.value) m[c.key] = []
  for (const t of tables.value) (m[t.category] ||= []).push(t)
  return m
})

async function loadMeta() {
  const r: any = await api('/api/admin/data/meta')
  categories.value = r.categories
  tables.value = r.tables
  if (!activeTable.value && tables.value.length) selectTable(tables.value[0].key)
}

async function selectTable(key: string) {
  activeTable.value = key
  page.value = 1
  await loadTable()
}

async function loadTable() {
  if (!activeTable.value) return
  loading.value = true
  try {
    const r: any = await api(`/api/admin/data/${activeTable.value}?page=${page.value}&pageSize=${pageSize.value}`)
    columns.value = r.columns
    rows.value = r.rows
    fkOptions.value = r.fkOptions || {}
    total.value = r.total
    showForm.value = false
  } finally {
    loading.value = false
  }
}

function colByName(name: string) {
  return columns.value.find((c) => c.name === name)
}
function fkLabel(col: string, val: any): string {
  const opts = fkOptions.value[col] || []
  const hit = opts.find((o) => String(o.value) === String(val))
  return hit ? hit.label : String(val ?? '')
}
// JSON 列不展示原文（避免代码感），只显示项数摘要；编辑时才展开
function jsonCount(val: any): number {
  try {
    const o = typeof val === 'string' ? JSON.parse(val) : val
    if (Array.isArray(o)) return o.length
    if (o && typeof o === 'object') return Object.keys(o).length
    return 0
  } catch {
    return 0
  }
}
function displayVal(col: ColMeta, val: any): string {
  if (val === null || val === undefined || val === '') return '—'
  if (col.uiType === 'boolean') return val ? '是' : '否'
  if (col.uiType === 'json') {
    const n = jsonCount(val)
    return n ? `共 ${n} 项` : '—'
  }
  if (col.uiType === 'date') return String(val).replace('T', ' ').slice(0, 16)
  // 枚举列渲染成中文（存的是 c1 / quota / ratio 这类编码，不给用户看原文）
  const en = enumFor(activeTable.value, col.name)
  if (en && en[String(val)] != null) return en[String(val)]
  const s = String(val)
  // 兜底：文本列里存的 JSON 内容同样只显示摘要（防止配置漏标 json 的列露出原文）
  if (/^[[{]/.test(s.trim())) {
    const n = jsonCount(s)
    if (n) return `共 ${n} 项`
  }
  return s
}

// ── 新增/编辑（弹窗表单，替代原行内编辑）──
const editableColumns = computed(() => columns.value.filter((c) => !c.readonly))
/** 列表展示的列：hidden 的字段（如英文变量写法的公式）只在编辑弹窗里出现 */
const visibleColumns = computed(() => columns.value.filter((c) => !c.hidden))
/** 当前表的说明（告诉管理员这张表怎么看、怎么填） */
const activeHint = computed(() => tables.value.find((t) => t.key === activeTable.value)?.hint || '')

// ── 本表与「算钱」的关系徽标（来自 config/dataTables.ts 的 TABLE_CALC_ROLES）──
// 为什么要显这个：后台里几张表都长着「启用 / 来源 / 适用引擎」的开关模样，
// 但只有一部分真的被引擎读取。徽标把「改这张表有没有用」写在标题旁边，不用再去试。
const activeRole = computed(() => tables.value.find((t) => t.key === activeTable.value)?.calcRole || '')
const activeRoleMeta = computed(() => {
  const m = (CALC_ROLE_LABELS as any)[activeRole.value]
  return m ? (m as { label: string; note: string }) : null
})
const activeRoleNote = computed(() => tables.value.find((t) => t.key === activeTable.value)?.calcRoleNote || '')
function roleTone(r: string) {
  if (r === 'engine') return 'border-green-200 bg-green-50 text-green-700'
  if (r === 'archive') return 'border-gray-200 bg-gray-50 text-gray-600'
  return 'border-amber-200 bg-amber-50 text-amber-700'
}

// ── 分组渲染（有 groupBy 的表，如「调整因子」按因子分组分层）──
// 为什么要分组：这张表里混着三种性质完全不同的行 —— 真正参与计算的参数、
// 备查的备选项、以及由公式现算出来的结果行。以前它们平铺在一起、长得一模一样，
// 结果「改哪一行会让金额变」全靠人记。分组表头把「本组怎么进公式」写在明处。
const activeGroupBy = computed(() => tables.value.find((t) => t.key === activeTable.value)?.groupBy || '')
const groupConf = computed(() => (activeGroupBy.value ? rowGroupsFor(activeTable.value) : null))
/** 分组声明缺失时按「未登记分组」红字提示 —— 后台新增了引擎不认识的分组会立刻显形 */
function declOf(key: string) {
  return groupConf.value?.items?.[key] || null
}
function roleLabelOf(key: string): string {
  const d = declOf(key)
  return d ? GROUP_ROLE_LABELS[d.role] : '未登记分组（引擎不认，等于白填）'
}
function roleToneOf(key: string): string {
  const tone = declOf(key) ? GROUP_ROLE_TONE[declOf(key)!.role] : 'danger'
  return {
    info: 'border-blue-200 bg-blue-50 text-blue-700',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    muted: 'border-gray-200 bg-gray-100 text-gray-500',
    danger: 'border-red-200 bg-red-50 text-red-600',
  }[tone]
}
/** 系统计算行（分组合计 / 加权结果）：值由引擎现算，不可编辑、不可删除 */
function isComputedRow(row: any): boolean {
  return isComputedCalc(row?.calc)
}
/** 系统计算行与已停用行都做视觉降级，避免误当成可调参数 */
function rowMuted(row: any): boolean {
  return isComputedRow(row) || row?.is_active === false
}

type RenderItem = { type: 'group'; key: string } | { type: 'row'; row: any }
/** 渲染序列：有分组就先插一条分组表头，再铺该组的成员行（保持原顺序） */
const renderList = computed<RenderItem[]>(() => {
  const col = activeGroupBy.value
  if (!col) return rows.value.map((row) => ({ type: 'row' as const, row }))
  const out: RenderItem[] = []
  const seen = new Map<string, RenderItem>()
  for (const row of rows.value) {
    const k = String(row[col] ?? '')
    if (!seen.has(k)) {
      const item: RenderItem = { type: 'group', key: k }
      seen.set(k, item)
      out.push(item)
    }
    out.push({ type: 'row', row })
  }
  return out
})
const formTitle = computed(() => {
  const t = tables.value.find((x) => x.key === activeTable.value)?.label || ''
  return (formMode.value === 'add' ? '新增' : '编辑') + ' · ' + t
})
// JSON 字段校验：结构化编辑器输出的都是合法 JSON；只有「复杂结构回退到文本」时才可能填错，这里兜底拦一道
const jsonErrors = computed(() => {
  const errs: Record<string, boolean> = {}
  for (const c of editableColumns.value) {
    if (c.uiType !== 'json') continue
    const v = formCopy[c.name]
    if (v == null || String(v).trim() === '') continue
    try { JSON.parse(String(v)) } catch { errs[c.name] = true }
  }
  return errs
})
// 宽字段（表单里占整行）：JSON 配置、长文本说明
function isWide(c: ColMeta): boolean {
  return c.uiType === 'json' || (c.uiType === 'text' && ['summary', 'description', 'remark', 'note'].includes(c.name))
}
function openAdd() {
  formMode.value = 'add'
  editingPk.value = null
  Object.keys(formCopy).forEach((k) => delete formCopy[k])
  for (const c of editableColumns.value) formCopy[c.name] = c.uiType === 'boolean' ? false : ''
  showForm.value = true
}
function openEdit(row: any) {
  formMode.value = 'edit'
  editingPk.value = row[primaryKey.value]
  Object.keys(formCopy).forEach((k) => delete formCopy[k])
  for (const c of editableColumns.value) {
    const v = row[c.name] ?? ''
    // jsonb 列取回来是对象，结构化编辑器收字符串，先转成 JSON 文本
    formCopy[c.name] = c.uiType === 'json' && v && typeof v === 'object' ? JSON.stringify(v) : v
  }
  showForm.value = true
}
function cancelForm() {
  showForm.value = false
}
async function saveForm() {
  if (Object.keys(jsonErrors.value).length) return alert('部分配置内容格式有误，请修正后再保存')
  savingForm.value = true
  try {
    if (formMode.value === 'add') {
      await api(`/api/admin/data/${activeTable.value}`, { method: 'POST', body: { ...formCopy } })
    } else {
      await api(`/api/admin/data/${activeTable.value}/${editingPk.value}`, { method: 'PUT', body: { ...formCopy } })
    }
    showForm.value = false
    await loadTable()
  } catch (e: any) {
    alert(e?.data?.statusMessage || '保存失败')
  } finally {
    savingForm.value = false
  }
}
async function removeRow(row: any) {
  if (!confirm(`确定删除该记录？此操作不可撤销`)) return
  try {
    await api(`/api/admin/data/${activeTable.value}/${row[primaryKey.value]}`, { method: 'DELETE' })
    await loadTable()
  } catch (e: any) {
    alert(e?.data?.statusMessage || '删除失败')
  }
}

const primaryKey = computed(() => columns.value.find((c) => c.isPk)?.name || 'id')

// ── 导出 ──
async function exportXlsx() {
  try {
    const blob: any = await api(`/api/admin/data/${activeTable.value}/export`, { responseType: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeTable.value}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    alert(e?.data?.statusMessage || '导出失败')
  }
}

// ── 导入（两步）──
function onFile(e: any) {
  importFile.value = e.target.files?.[0] || null
}
async function uploadPreview() {
  if (!importFile.value) return alert('请先选择 Excel 文件')
  const fd = new FormData()
  fd.append('file', importFile.value)
  fd.append('mode', importMode.value)
  fd.append('apply', '0')
  importing.value = true
  try {
    importPreview.value = await api(`/api/admin/data/${activeTable.value}/import`, { method: 'POST', body: fd })
  } catch (e: any) {
    alert(e?.data?.statusMessage || '解析失败')
    importPreview.value = null
  } finally {
    importing.value = false
  }
}
async function confirmImport() {
  if (!importFile.value) return
  const fd = new FormData()
  fd.append('file', importFile.value)
  fd.append('mode', importMode.value)
  fd.append('apply', '1')
  importing.value = true
  try {
    const r: any = await api(`/api/admin/data/${activeTable.value}/import`, { method: 'POST', body: fd })
    alert(`导入完成：成功 ${r.imported} 条${r.skipped ? '，跳过 ' + r.skipped + ' 条' : ''}`)
    importPreview.value = null
    showImport.value = false
    importFile.value = null
    await loadTable()
  } catch (e: any) {
    alert(e?.data?.statusMessage || '导入失败')
  } finally {
    importing.value = false
  }
}

onMounted(loadMeta)
</script>

<template>
  <div class="mx-auto max-w-7xl px-4 py-6" v-if="can('data:view')">
    <h1 class="mb-4 text-2xl font-bold text-gray-900">数据维护</h1>
    <div class="flex gap-4">
      <!-- 左：分类-表树 -->
      <aside class="w-52 shrink-0 rounded-xl border border-gray-100 bg-white p-2">
        <div v-for="cat in categories" :key="cat.key" class="mb-1">
          <p class="mb-1 mt-2 px-2 text-[11px] font-semibold tracking-widest text-gray-400">{{ cat.label }}</p>
          <button
            v-for="t in (tablesByCat[cat.key] || [])"
            :key="t.key"
            class="mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors"
            :class="activeTable === t.key ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-100'"
            @click="selectTable(t.key)"
          >
            <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="activeTable === t.key ? 'bg-white' : 'bg-gray-300'"></span>
            <span class="truncate">{{ t.label }}</span>
          </button>
        </div>
      </aside>

      <!-- 右：表格编辑器 -->
      <section class="min-w-0 flex-1">
        <div v-if="!activeTable" class="text-gray-400">请选择左侧数据表</div>
        <template v-else>
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <h2 class="mr-2 text-lg font-semibold text-gray-900">{{ tables.find((t) => t.key === activeTable)?.label }}</h2>
            <span
              v-if="activeRoleMeta"
              class="rounded-lg border px-2 py-0.5 text-xs font-medium"
              :class="roleTone(activeRole)"
              :title="activeRoleNote"
            >{{ activeRoleMeta.label }}</span>
            <button v-if="can('data:create')" class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700" @click="openAdd">+ 新增</button>
            <button class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50" @click="exportXlsx">导出 Excel</button>
            <button v-if="can('data:create')" class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50" @click="showImport = true">导入 Excel</button>
            <span class="ml-auto text-xs text-gray-400">共 {{ total }} 条 · 第 {{ page }}/{{ totalPages }} 页</span>
            <button class="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 disabled:opacity-40" :disabled="page <= 1" @click="page--; loadTable()">上一页</button>
            <button class="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 disabled:opacity-40" :disabled="page >= totalPages" @click="page++; loadTable()">下一页</button>
          </div>

          <!-- 表级说明：讲清这张表怎么看、怎么填（来自 dataTables.ts 的 hint）
               whitespace-pre-line：hint 里用 \n 分行，直接照原样换行显示，免得挤成一大段 -->
          <div v-if="activeHint" class="mb-3 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2.5 text-xs leading-relaxed whitespace-pre-line text-gray-600">{{ activeHint }}</div>

          <div class="table-scroll rounded-xl border border-gray-100">
            <table class="w-full text-left text-sm">
              <thead class="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th v-for="c in visibleColumns" :key="c.name" class="whitespace-nowrap px-3 py-2 font-medium">{{ c.label }}<span v-if="c.isPk" class="text-gray-300"> #</span></th>
                  <th v-if="can('data:edit') || can('data:delete')" class="sticky right-0 z-20 bg-gray-50 px-3 py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                <!-- 数据行（有 groupBy 的表会在每组前插一条分组表头，写明本组到底算不算钱） -->
                <template v-for="(it, i) in renderList" :key="it.type === 'row' ? it.row[primaryKey] : 'g-' + it.key + '-' + i">
                  <tr v-if="it.type === 'group'" class="border-t-2 border-gray-200 bg-gray-100/70">
                    <td :colspan="visibleColumns.length + 1" class="px-3 py-2">
                      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span class="text-[13px] font-semibold text-gray-800">{{ declOf(it.key)?.name || it.key }}</span>
                        <code class="text-[11px] text-gray-400">{{ it.key }}</code>
                        <span class="rounded-full border px-2 py-0.5 text-[11px]" :class="roleToneOf(it.key)">{{ roleLabelOf(it.key) }}</span>
                        <span v-if="declOf(it.key)?.note" class="w-full text-[11px] leading-relaxed text-gray-500">{{ declOf(it.key)?.note }}</span>
                      </div>
                    </td>
                  </tr>
                  <tr v-else class="border-t border-gray-100" :class="rowMuted(it.row) ? 'bg-gray-50/70 text-gray-500' : 'bg-white hover:bg-gray-50'">
                    <td v-for="c in visibleColumns" :key="c.name" class="px-3 py-2 align-top">
                      <span v-if="c.isFk" class="block max-w-[180px] truncate" :title="fkLabel(c.name, it.row[c.name])">{{ fkLabel(c.name, it.row[c.name]) }}</span>
                      <span
                        v-else-if="c.uiType === 'json'"
                        class="block max-w-[110px] truncate rounded bg-gray-50 px-1.5 py-0.5 text-center text-xs text-gray-500"
                        title="查看和修改配置明细请点「编辑」"
                      >{{ displayVal(c, it.row[c.name]) }}</span>
                      <span
                        v-else-if="c.name === 'calc' && isComputedRow(it.row)"
                        class="rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500"
                      >{{ displayVal(c, it.row[c.name]) }}</span>
                      <span v-else class="flex items-center gap-1">
                        <span
                          class="block max-w-[220px] truncate"
                          :class="columnNote(activeTable, it.row, c.name) ? 'text-gray-400' : ''"
                          :title="columnNote(activeTable, it.row, c.name)?.note || displayVal(c, it.row[c.name])"
                        >{{ displayVal(c, it.row[c.name]) }}</span>
                        <span
                          v-if="columnNote(activeTable, it.row, c.name)"
                          class="shrink-0 rounded border border-gray-200 bg-gray-100 px-1 text-[10px] text-gray-500"
                          :title="columnNote(activeTable, it.row, c.name)?.note"
                        >{{ columnNote(activeTable, it.row, c.name)?.badge }}</span>
                      </span>
                    </td>
                    <td v-if="can('data:edit') || can('data:delete')" class="sticky right-0 bg-inherit px-3 py-2 whitespace-nowrap">
                      <span v-if="isComputedRow(it.row)" class="text-xs text-gray-400" title="取值由同组成员行推导、引擎现算；要改结果请改成员行">由公式决定</span>
                      <template v-else>
                        <button v-if="can('data:edit')" class="text-xs text-blue-500 hover:underline" @click="openEdit(it.row)">编辑</button>
                        <button v-if="can('data:delete')" class="ml-2 text-xs text-red-500 hover:underline" @click="removeRow(it.row)">删除</button>
                        <span v-if="it.row.is_active === false" class="ml-2 rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">已停用</span>
                      </template>
                    </td>
                  </tr>
                </template>

                <!-- 空数据提示 -->
                <tr v-if="!rows.length">
                  <td :colspan="visibleColumns.length + 1" class="px-3 py-12 text-center text-sm text-gray-400">暂无数据，点右上角「+ 新增」或「导入 Excel」开始维护</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="loading" class="mt-2 text-xs text-gray-400">加载中…</p>
        </template>
      </section>
    </div>

    <!-- 导入弹窗 -->
    <div v-if="showImport" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="showImport = false">
      <div class="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h3 class="mb-4 text-lg font-bold text-gray-900">导入 Excel · {{ tables.find((t) => t.key === activeTable)?.label }}</h3>
        <input type="file" accept=".xlsx,.xls" class="mb-3 block w-full text-sm" @change="onFile" />
        <div class="mb-3 flex gap-4 text-sm">
          <label class="flex items-center gap-1"><input type="radio" value="incremental" v-model="importMode" /> 增量（按主键更新/插入）</label>
          <label class="flex items-center gap-1"><input type="radio" value="overwrite" v-model="importMode" /> 覆盖（清空本表后重导）</label>
        </div>
        <p class="mb-3 text-xs text-gray-400">覆盖模式会先清空本表全部现有数据再导入；导入前请先「导出 Excel」备份。</p>

        <button class="mb-3 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50" :disabled="importing" @click="uploadPreview">
          {{ importing ? '处理中…' : '上传并预览校验' }}
        </button>

        <div v-if="importPreview" class="rounded-lg bg-gray-50 p-3 text-sm">
          <p>共 {{ importPreview.total }} 行 · 校验通过 <span class="font-semibold text-green-600">{{ importPreview.valid }}</span> · 不通过 <span class="font-semibold text-red-500">{{ importPreview.invalid }}</span></p>
          <p v-if="importPreview.errors?.length" class="mt-1 text-xs text-red-500">
            样例错误：<span v-for="(e, i) in importPreview.errors.slice(0, 5)" :key="i">第{{ e.row }}行 {{ e.msg }}；</span>
          </p>
          <button v-if="importPreview.valid > 0" class="mt-2 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50" :disabled="importing" @click="confirmImport">
            确认导入（{{ importMode === 'overwrite' ? '覆盖' : '增量' }}）
          </button>
        </div>

        <button class="mt-3 text-sm text-gray-400 hover:underline" @click="showImport = false">关闭</button>
      </div>
    </div>

    <!-- 新增/编辑弹窗 -->
    <div v-if="showForm" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="cancelForm">
      <div class="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h3 class="mb-4 text-lg font-bold text-gray-900">{{ formTitle }}</h3>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div v-for="c in editableColumns" :key="c.name" :class="isWide(c) ? 'md:col-span-2' : ''">
            <label class="mb-1 block text-xs font-medium text-gray-500">
              {{ c.label }}<span v-if="!c.nullable" class="ml-0.5 text-red-400">*</span>
            </label>
            <select v-if="c.isFk" v-model="formCopy[c.name]" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm">
              <option value="">（未选）</option>
              <option v-for="o in (fkOptions[c.name] || [])" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <!-- JSON 配置：结构化行编辑，页面不出现 JSON 原文 -->
            <JsonFieldEditor v-else-if="c.uiType === 'json'" v-model="formCopy[c.name]" />
            <!-- 枚举列：给中文下拉，存库仍是编码（如 适用引擎 c1 / quota） -->
            <select v-else-if="enumFor(activeTable, c.name)" v-model="formCopy[c.name]" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm">
              <option v-for="(zh, code) in enumFor(activeTable, c.name)" :key="code" :value="code">{{ zh }}</option>
            </select>
            <label v-else-if="c.uiType === 'boolean'" class="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" v-model="formCopy[c.name]" /> {{ formCopy[c.name] ? '是' : '否' }}
            </label>
            <input v-else v-model="formCopy[c.name]" :type="c.uiType === 'number' ? 'number' : (c.uiType === 'date' ? 'date' : 'text')" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
            <p v-if="jsonErrors[c.name]" class="mt-1 text-xs text-red-500">内容格式有误，请修正后再保存</p>
          </div>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button class="rounded-lg border border-gray-200 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50" @click="cancelForm">取消</button>
          <button class="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50" :disabled="savingForm" @click="saveForm">{{ savingForm ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </div>
  </div>

  <div v-else class="mx-auto max-w-7xl px-4 py-20 text-center text-gray-400">
    抱歉，您没有访问数据维护的权限，请联系管理员开通。
  </div>
</template>
