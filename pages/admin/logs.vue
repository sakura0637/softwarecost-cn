<script setup lang="ts">
// 全局操作审计：谁、什么时候、把哪张表的哪一条、从什么改成什么。
// 与「设备管理」页内嵌的操作记录的区别：这里覆盖**全部模块**（含数据维护的 15 张参数表、
// Excel 批量导入、运维测算存档），并按模块 / 实体 / 动作 / 操作人 组合筛选。
// 权限：admin-logs:view（只在系统管理员角色里）；撤销按记录所属模块再单独判定。
import { ref, computed, onMounted } from 'vue'
import { useAuth } from '~/composables/useAuth'
// 撤销权限表与后端共用同一份配置（config/audit.ts），避免「按钮可点但一定 403」的假入口
import { REVERT_PERM_BY_MODULE, REVERT_PERM_FALLBACK } from '~/server/config/audit'

const { api, can, me } = useAuth()

interface Opt { value: string; label: string; count?: number }

const items = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(30)
const loading = ref(false)

const facets = ref<{ modules: Opt[]; entityTypes: Opt[] }>({ modules: [], entityTypes: [] })

const fModule = ref('')
const fEntity = ref('')
const fAction = ref('')
const fOperator = ref('')

const actionOptions: Opt[] = [
  { value: '', label: '全部动作' },
  { value: 'create', label: '新增' },
  { value: 'update', label: '修改' },
  { value: 'delete', label: '删除' },
  { value: 'revert', label: '撤销' },
]

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

// 撤销权限按记录所属模块判定 —— 与后端 /api/admin/logs/:id/revert 的口径保持一致。
// 常量来自 config/audit.ts（与后端同一份），这里只做一层取值封装。
// revertible 由后端按实体类型给出（不可撤销的实体不给按钮，避免死入口）。
const canRevert = (l: any) =>
  l.revertible !== false &&
  l.action !== 'revert' && !l.reverted &&
  can(REVERT_PERM_BY_MODULE[l.module] || REVERT_PERM_FALLBACK)

async function loadFacets() {
  try {
    const res: any = await api('/api/admin/logs?facets=1')
    facets.value = res.facets || { modules: [], entityTypes: [] }
  } catch { /* 无权限则忽略 */ }
}

async function load() {
  loading.value = true
  try {
    const qs = new URLSearchParams()
    if (fModule.value) qs.set('module', fModule.value)
    if (fEntity.value) qs.set('entity_type', fEntity.value)
    if (fAction.value) qs.set('action', fAction.value)
    if (fOperator.value.trim()) qs.set('operator', fOperator.value.trim())
    qs.set('page', String(page.value))
    qs.set('page_size', String(pageSize.value))
    const res: any = await api(`/api/admin/logs?${qs.toString()}`)
    items.value = res.items || []
    total.value = res.total || 0
  } catch (e: any) {
    alert(e?.data?.statusMessage || '加载审计记录失败')
  } finally {
    loading.value = false
  }
}

function resetAndLoad() {
  page.value = 1
  load()
}

const revertingId = ref<number | null>(null)
async function revertLog(l: any) {
  if (l.reverted) { alert('该操作已被撤销，请勿重复撤销'); return }
  if (!confirm(`确定撤销这条「${l.actionLabel}」操作？\n模块：${l.moduleLabel}\n对象：${l.entityName}\n时间：${l.createdAt}\n\n撤销会反向修改线上数据，请确认已看清变更明细。`)) return
  revertingId.value = l.id
  try {
    const res: any = await api(`/api/admin/logs/${l.id}/revert`, { method: 'POST' })
    alert(res?.message ? `已撤销：${res.message}` : '已撤销')
    await load()
    await loadFacets()
  } catch (e: any) {
    alert(e?.data?.statusMessage || '撤销失败')
    await load()
  } finally {
    revertingId.value = null
  }
}

function fmtLogVal(v: any): string {
  if (v === undefined || v === null || v === '') return '（空）'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const actionClass = (a: string) =>
  a === 'create' ? 'text-green-600'
  : a === 'update' ? 'text-blue-600'
  : a === 'delete' ? 'text-red-600'
  : 'text-purple-600'

onMounted(async () => {
  await me()
  if (!can('admin-logs:view')) { useRouter().push('/'); return }
  await loadFacets()
  await load()
})
</script>

<template>
  <div class="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900">操作审计</h1>
      <p class="mt-1 text-sm text-gray-500">
        全站写操作的留痕台账：谁在什么时候改了哪张表的哪一条、从什么改成了什么。可反向撤销。
      </p>
    </div>

    <div class="card">
      <div class="mb-4 flex flex-wrap items-end gap-3">
        <div class="w-52">
          <label class="mb-1 block text-xs text-gray-400">模块</label>
          <select v-model="fModule" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" @change="resetAndLoad">
            <option value="">全部模块</option>
            <option v-for="o in facets.modules" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="w-56">
          <label class="mb-1 block text-xs text-gray-400">对象（实体 / 数据表）</label>
          <select v-model="fEntity" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" @change="resetAndLoad">
            <option value="">全部对象</option>
            <option v-for="o in facets.entityTypes" :key="o.value" :value="o.value">{{ o.label }}（{{ o.count }}）</option>
          </select>
        </div>
        <div class="w-36">
          <label class="mb-1 block text-xs text-gray-400">动作</label>
          <select v-model="fAction" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" @change="resetAndLoad">
            <option v-for="o in actionOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="w-40">
          <label class="mb-1 block text-xs text-gray-400">操作人</label>
          <input v-model="fOperator" type="text" placeholder="按用户名模糊查" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" @keyup.enter="resetAndLoad" />
        </div>
        <div class="w-28">
          <label class="mb-1 block text-xs text-gray-400">每页</label>
          <select v-model.number="pageSize" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" @change="resetAndLoad">
            <option :value="30">30</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
            <option :value="200">200</option>
          </select>
        </div>
        <button class="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:opacity-90" @click="resetAndLoad">查询</button>
        <button
          class="rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-100"
          @click="fModule=''; fEntity=''; fAction=''; fOperator=''; resetAndLoad()"
        >重置</button>
        <p class="ml-auto text-sm text-gray-500">
          共 {{ total.toLocaleString() }} 条记录<span v-if="loading" class="ml-2 text-primary">加载中…</span>
        </p>
      </div>

      <div class="overflow-hidden rounded-lg border border-gray-100">
        <div class="table-scroll min-h-[240px]">
          <table class="w-full min-w-[1100px] text-left text-sm">
            <thead class="sticky top-0 z-10 bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th class="px-3 py-3 whitespace-nowrap">时间</th>
                <th class="px-3 py-3 whitespace-nowrap">操作人</th>
                <th class="px-3 py-3 whitespace-nowrap">模块</th>
                <th class="px-3 py-3 whitespace-nowrap">对象</th>
                <th class="px-3 py-3 whitespace-nowrap">动作</th>
                <th class="px-3 py-3">变更详情</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr v-for="l in items" :key="l.id" class="align-top hover:bg-gray-50">
                <td class="px-3 py-2 whitespace-nowrap text-gray-600">{{ l.createdAt }}</td>
                <td class="px-3 py-2 whitespace-nowrap text-gray-600">{{ l.operatorName || '—' }}</td>
                <td class="px-3 py-2 whitespace-nowrap text-gray-600">{{ l.moduleLabel }}</td>
                <td class="px-3 py-2 text-gray-700">{{ l.entityName }}</td>
                <td class="px-3 py-2 whitespace-nowrap">
                  <span :class="actionClass(l.action)" class="font-medium">{{ l.actionLabel }}</span>
                </td>
                <td class="px-3 py-2">
                  <div class="flex items-start gap-2">
                    <details class="min-w-0 flex-1">
                      <summary class="cursor-pointer text-xs text-primary">
                        {{ l.changes.length }} 项变更<span v-if="l.remark" class="ml-2 text-gray-400">{{ l.remark }}</span>
                      </summary>
                      <div class="mt-1 max-h-64 overflow-auto rounded bg-gray-50 p-2 text-xs text-gray-500">
                        <ul class="space-y-0.5">
                          <li v-for="(c, i) in l.changes" :key="i" class="break-all">
                            <span class="text-gray-500">{{ c.label || c.field }}：</span>
                            <span class="text-red-500">{{ fmtLogVal(c.old) }}</span>
                            <span class="text-gray-400"> → </span>
                            <span class="text-green-600">{{ fmtLogVal(c.new) }}</span>
                          </li>
                        </ul>
                      </div>
                    </details>
                    <button
                      v-if="canRevert(l)"
                      class="shrink-0 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                      :disabled="revertingId === l.id"
                      @click="revertLog(l)"
                    >{{ revertingId === l.id ? '撤销中…' : '撤销' }}</button>
                    <span
                      v-else-if="l.action !== 'revert' && l.reverted"
                      class="shrink-0 rounded border border-gray-100 bg-gray-100 px-2 py-1 text-xs text-gray-400"
                      title="该操作已被撤销"
                    >已撤销</span>
                  </div>
                </td>
              </tr>
              <tr v-if="items.length === 0">
                <td colspan="6" class="px-3 py-12 text-center text-gray-400">{{ loading ? '加载中…' : '暂无操作记录' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="mt-4 flex items-center gap-2">
        <button class="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40" :disabled="page <= 1 || loading" @click="page--; load()">上一页</button>
        <span class="text-sm text-gray-500">第 {{ page }} / {{ totalPages }} 页</span>
        <button class="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40" :disabled="page >= totalPages || loading" @click="page++; load()">下一页</button>
      </div>

      <p class="mt-4 whitespace-pre-line text-xs leading-relaxed text-gray-500">台账范围：造价标准库（标准与参数明细）、数据维护（全部参数表的增删改 / Excel 批量导入）、设备价格库（站点·设备·对照）、运维测算存档。
撤销说明：新增可撤销为删除、修改可还原为改前值、删除可按快照恢复整行；已被撤销过的记录不能重复撤销。
不提供撤销按钮的情形：① 附件这类实体文件已删、快照不完整；② Excel 批量导入的汇总记录（要恢复等于恢复一整张表）；③ 记录含 JSON 大字段（如标准的参数取值、测算存档的完整结果），日志里只存了占位文字、还原会写坏数据列 —— 这几种都需人工重建或重新导入。</p>
    </div>
  </div>
</template>
