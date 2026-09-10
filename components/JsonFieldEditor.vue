<script setup lang="ts">
// 通用 JSON 结构化编辑器：把 JSON 配置变成「键值行 / 分组键值 / 表格行 / 列表」的行编辑，
// 页面上不再出现 JSON 原文；解析不了的复杂结构才回退文本框（带格式化按钮）。
// 数据流向：外部传入 JSON 字符串（modelValue）→ 解析成行结构 → 编辑后序列化回 JSON 字符串。
import { ref, watch } from 'vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

type KvRow = { k: string; v: string; numeric: boolean }
type Group = { k: string; rows: KvRow[] }
type Mode = 'kv' | 'grouped' | 'objArray' | 'strArray' | 'raw'

const mode = ref<Mode>('kv')
const rows = ref<KvRow[]>([])
const groups = ref<Group[]>([])
const cols = ref<string[]>([])
const objRows = ref<Record<string, string>[]>([])
const strItems = ref<string[]>([])
const rawText = ref('')
const rawBad = ref(false)
// 复杂结构才回退文本编辑，默认收起，避免页面上出现代码感内容
const showRaw = ref(false)

let lastEmitted: string | null = null

function isScalar(x: any): boolean {
  return x === null || ['string', 'number', 'boolean'].includes(typeof x)
}
// 序列化值：纯数字字符串转数字（与「管理标准」的取值行序列化同一策略）
function toNum(s: string): number | string {
  const t = String(s ?? '').trim()
  if (t === '') return ''
  const n = Number(t)
  return !Number.isNaN(n) ? n : t
}

function loadFrom(text: string) {
  const t = String(text ?? '').trim()
  if (t === lastEmitted) return
  lastEmitted = null
  if (t === '') {
    mode.value = 'kv'; rows.value = []; groups.value = []; return
  }
  let o: any
  try { o = JSON.parse(t) } catch { mode.value = 'raw'; rawText.value = text; rawBad.value = true; return }
  rawBad.value = false
  if (Array.isArray(o)) {
    if (o.every(isScalar)) {
      mode.value = 'strArray'; strItems.value = o.map(String); return
    }
    if (o.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      const keys: string[] = []
      for (const it of o) for (const k of Object.keys(it)) if (!keys.includes(k)) keys.push(k)
      cols.value = keys
      objRows.value = o.map((it) => {
        const r: Record<string, string> = {}
        for (const k of keys) r[k] = it[k] == null ? '' : String(it[k])
        return r
      })
      mode.value = 'objArray'; return
    }
    mode.value = 'raw'; rawText.value = JSON.stringify(o, null, 2); return
  }
  if (o && typeof o === 'object') {
    const vals = Object.values(o)
    if (vals.every(isScalar)) {
      mode.value = 'kv'
      rows.value = Object.entries(o).map(([k, v]) => ({ k, v: String(v), numeric: typeof v === 'number' }))
      return
    }
    if (vals.every((v) => v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isScalar))) {
      mode.value = 'grouped'
      groups.value = Object.entries(o).map(([g, children]: any) => ({
        k: g,
        rows: Object.entries(children).map(([k, v]: any) => ({ k, v: String(v), numeric: typeof v === 'number' })),
      }))
      return
    }
    mode.value = 'raw'; rawText.value = JSON.stringify(o, null, 2); return
  }
  mode.value = 'raw'; rawText.value = String(o)
}

function emitNow() {
  let out = ''
  if (mode.value === 'kv') {
    const o: any = {}
    for (const r of rows.value) {
      const k = r.k.trim()
      if (!k) continue
      o[k] = r.numeric ? toNum(r.v) : r.v
    }
    out = Object.keys(o).length ? JSON.stringify(o) : ''
  } else if (mode.value === 'grouped') {
    const o: any = {}
    for (const g of groups.value) {
      const gk = g.k.trim()
      if (!gk) continue
      const c: any = {}
      for (const r of g.rows) {
        const k = r.k.trim()
        if (!k) continue
        c[k] = r.numeric ? toNum(r.v) : r.v
      }
      o[gk] = c
    }
    out = Object.keys(o).length ? JSON.stringify(o) : ''
  } else if (mode.value === 'objArray') {
    const arr = objRows.value
      .map((r) => {
        const it: any = {}
        for (const k of cols.value) {
          const v = String(r[k] ?? '').trim()
          if (v !== '') it[k] = toNum(v)
        }
        return it
      })
      .filter((it) => Object.keys(it).length)
    out = arr.length ? JSON.stringify(arr) : ''
  } else if (mode.value === 'strArray') {
    const arr = strItems.value.map((s) => s.trim()).filter((s) => s !== '')
    out = arr.length ? JSON.stringify(arr) : ''
  } else {
    out = rawText.value.trim() === '' ? '' : rawText.value
  }
  lastEmitted = out
  emit('update:modelValue', out)
}

watch([rows, groups, objRows, strItems, rawText, mode], emitNow, { deep: true })
watch(() => props.modelValue, (v) => loadFrom(v), { immediate: true })

// ── 行操作 ──
function newRow(): KvRow { return { k: '', v: '', numeric: false } }
const addRow = (arr: KvRow[]) => arr.push(newRow())
const delRow = (arr: KvRow[], i: number) => arr.splice(i, 1)
const addGroup = () => groups.value.push({ k: '', rows: [newRow()] })
const addObjRow = () => objRows.value.push(Object.fromEntries(cols.value.map((k) => [k, ''])))
const addStr = () => strItems.value.push('')
function formatRaw() {
  try {
    rawText.value = JSON.stringify(JSON.parse(rawText.value), null, 2)
    rawBad.value = false
  } catch {
    rawBad.value = true
  }
}

// 常见键名的中文提示（仅展示辅助，存储仍用原名，避免破坏下游计算）
const KEY_HINT: Record<string, string> = {
  low: '低', mid: '中', high: '高',
  estimate: '估算', budget: '预算', operation: '运维',
  all: '全行业', gov: '电子政务',
  label: '名称', factor: '取值', desc: '说明', value: '值', note: '备注',
}
const hint = (k: string) => KEY_HINT[String(k).trim()] || ''
</script>

<template>
  <div class="space-y-2 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
    <!-- 扁平键值 -->
    <template v-if="mode === 'kv'">
      <div v-for="(r, i) in rows" :key="i" class="flex items-center gap-2">
        <input v-model="r.k" placeholder="名称" class="w-28 shrink-0 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600" />
        <span v-if="hint(r.k)" class="shrink-0 text-[11px] text-gray-400">{{ hint(r.k) }}</span>
        <input v-model="r.v" placeholder="值" class="min-w-0 flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm" />
        <button type="button" class="shrink-0 text-xs text-gray-300 hover:text-red-500" title="删除" @click="delRow(rows, i)">✕</button>
      </div>
      <p v-if="!rows.length" class="text-xs text-gray-400">暂无配置项，点下方「+ 添加一项」开始填写</p>
      <button type="button" class="text-xs text-blue-500 hover:underline" @click="addRow(rows)">+ 添加一项</button>
    </template>

    <!-- 分组键值（两层）-->
    <template v-else-if="mode === 'grouped'">
      <div v-for="(g, gi) in groups" :key="gi" class="rounded-lg border border-gray-200 bg-white p-2.5">
        <div class="mb-2 flex items-center gap-2">
          <span class="text-[11px] text-gray-400">分组</span>
          <input v-model="g.k" placeholder="分组名" class="w-28 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600" />
          <span v-if="hint(g.k)" class="text-[11px] text-gray-400">{{ hint(g.k) }}</span>
          <button type="button" class="ml-auto text-xs text-gray-300 hover:text-red-500" title="删除分组" @click="groups.splice(gi, 1)">✕</button>
        </div>
        <div class="space-y-1.5 pl-3">
          <div v-for="(r, i) in g.rows" :key="i" class="flex items-center gap-2">
            <input v-model="r.k" placeholder="名称" class="w-24 shrink-0 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600" />
            <span v-if="hint(r.k)" class="shrink-0 text-[11px] text-gray-400">{{ hint(r.k) }}</span>
            <input v-model="r.v" placeholder="值" class="min-w-0 flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm" />
            <button type="button" class="shrink-0 text-xs text-gray-300 hover:text-red-500" title="删除" @click="delRow(g.rows, i)">✕</button>
          </div>
          <button type="button" class="text-xs text-blue-500 hover:underline" @click="addRow(g.rows)">+ 添加一项</button>
        </div>
      </div>
      <p v-if="!groups.length" class="text-xs text-gray-400">暂无配置项，点下方「+ 添加一组」开始填写</p>
      <button type="button" class="text-xs text-blue-500 hover:underline" @click="addGroup">+ 添加一组</button>
    </template>

    <!-- 对象数组（每行一条记录）-->
    <template v-else-if="mode === 'objArray'">
      <div v-for="(r, i) in objRows" :key="i" class="flex items-center gap-2">
        <div v-for="k in cols" :key="k" class="flex min-w-0 flex-1 items-center gap-1">
          <span class="w-10 shrink-0 text-[11px] text-gray-400">{{ hint(k) || k }}</span>
          <input v-model="r[k]" class="min-w-0 flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm" />
        </div>
        <button type="button" class="shrink-0 text-xs text-gray-300 hover:text-red-500" title="删除" @click="objRows.splice(i, 1)">✕</button>
      </div>
      <p v-if="!objRows.length" class="text-xs text-gray-400">暂无记录，点下方「+ 添加一行」开始填写</p>
      <button type="button" class="text-xs text-blue-500 hover:underline" @click="addObjRow()">+ 添加一行</button>
    </template>

    <!-- 字符串数组 -->
    <template v-else-if="mode === 'strArray'">
      <div v-for="(s, i) in strItems" :key="i" class="flex items-center gap-2">
        <input v-model="strItems[i]" class="min-w-0 flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm" />
        <button type="button" class="shrink-0 text-xs text-gray-300 hover:text-red-500" title="删除" @click="strItems.splice(i, 1)">✕</button>
      </div>
      <p v-if="!strItems.length" class="text-xs text-gray-400">暂无内容，点下方「+ 添加一项」开始填写</p>
      <button type="button" class="text-xs text-blue-500 hover:underline" @click="addStr()">+ 添加一项</button>
    </template>

    <!-- 兜底：复杂结构回退文本编辑，默认收起 -->
    <template v-else>
      <div class="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span>该配置层级较深，暂不支持表格化编辑</span>
        <button type="button" class="text-blue-500 hover:underline" @click="showRaw = !showRaw">{{ showRaw ? '收起原文' : '展开原文' }}</button>
      </div>
      <template v-if="showRaw">
        <textarea v-model="rawText" rows="8" class="w-full rounded-md border px-2 py-1.5 font-mono text-xs" :class="rawBad ? 'border-red-400' : 'border-gray-200'"></textarea>
        <div class="flex items-center gap-3">
          <button type="button" class="text-xs text-blue-500 hover:underline" @click="formatRaw">格式化</button>
          <span v-if="rawBad" class="text-xs text-red-500">内容格式有误</span>
        </div>
      </template>
    </template>
  </div>
</template>
