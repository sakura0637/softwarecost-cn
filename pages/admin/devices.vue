<script setup lang="ts">
// 管理员设备价格库维护（范式化三表）：站点维护 / 设备维护 / 站点-设备对照
// 浏览页走 v_device_prices 视图（合价现算）；本页负责三张基础表的增删改。
import { ref, computed, onMounted, reactive, watch } from 'vue'
import { useAuth } from '~/composables/useAuth'

const { api, can, me } = useAuth()

const activeTab = ref<'stations' | 'devices' | 'links'>('stations')
const canEdit = computed(() => can('devices:edit'))
const canDelete = computed(() => can('devices:delete'))
const canCreate = computed(() => can('devices:edit')) // 新增复用 edit 权限

// ── Tab1 站点维护 ────────────────────────────────────────────────
const stations = ref<any[]>([])
const stationLoading = ref(false)
async function loadStations() {
  stationLoading.value = true
  try { stations.value = (await api('/api/admin/stations')).items } catch (e: any) { alert(e?.data?.statusMessage || '加载站点失败') }
  finally { stationLoading.value = false }
}
const rootStations = computed(() => stations.value.filter((s) => !s.parent_id))
const childrenOf = (pid: number) => stations.value.filter((s) => s.parent_id === pid)
const stationOptions = computed(() => stations.value.filter((s) => s.level === 1)) // 可作父级的管理处

const showStationModal = ref(false)
const stationEditingId = ref<number | null>(null)
const stationForm = reactive({ parent_id: null as number | null, name: '', type: '', is_summary: false, sort_order: 0, remark: '' })
function openStationNew(parentId: number | null = null) {
  stationEditingId.value = null
  Object.assign(stationForm, { parent_id: parentId, name: '', type: '', is_summary: false, sort_order: 0, remark: '' })
  showStationModal.value = true
}
function openStationEdit(s: any) {
  stationEditingId.value = s.id
  Object.assign(stationForm, { parent_id: s.parent_id, name: s.name, type: s.type || '', is_summary: s.is_summary, sort_order: s.sort_order || 0, remark: s.remark || '' })
  showStationModal.value = true
}
async function saveStation() {
  try {
    const body = { ...stationForm }
    if (stationEditingId.value) await api(`/api/admin/stations/${stationEditingId.value}`, { method: 'PUT', body })
    else await api('/api/admin/stations', { method: 'POST', body })
    showStationModal.value = false
    await loadStations()
  } catch (e: any) { alert(e?.data?.statusMessage || '保存失败') }
}
async function deleteStation(s: any) {
  if (!confirm(`确定删除「${s.name}」？`)) return
  try { await api(`/api/admin/stations/${s.id}`, { method: 'DELETE' }); await loadStations() }
  catch (e: any) { alert(e?.data?.statusMessage || '删除失败') }
}

// ── Tab2 设备维护 ────────────────────────────────────────────────
const devResult = ref<{ total: number; page: number; pageSize: number; items: any[] }>({ total: 0, page: 1, pageSize: 50, items: [] })
const devKeyword = ref('')
const devCategory = ref('')
const devSubcategory = ref('')
const devPage = ref(1)
const devLoading = ref(false)
async function loadDevices() {
  devLoading.value = true
  try {
    const params = new URLSearchParams()
    if (devKeyword.value.trim()) params.set('q', devKeyword.value.trim())
    if (devCategory.value) params.set('category', devCategory.value)
    if (devSubcategory.value) params.set('subcategory', devSubcategory.value)
    params.set('sort', 'id'); params.set('order', 'asc')
    params.set('page', String(devPage.value)); params.set('pageSize', '50')
    devResult.value = await api(`/api/admin/devices?${params.toString()}`)
  } catch (e: any) { alert(e?.data?.statusMessage || '加载设备失败') }
  finally { devLoading.value = false }
}
watch([devKeyword, devCategory, devSubcategory], () => { devPage.value = 1; loadDevices() })

const showDevModal = ref(false)
const editingDevId = ref<number | null>(null)
const devForm = reactive({ category: '', subcategory: '', name: '', brand_model: '', unit: '', unit_price: '', remark: '' })
const devAffected = ref(0)
const devDup = ref<any[]>([])
function resetDevDup() { devDup.value = [] }
async function checkDup() {
  const nm = devForm.name.trim()
  if (!nm) { devDup.value = []; return }
  try {
    const r: any = await api(`/api/admin/devices?q=${encodeURIComponent(nm)}&pageSize=100`)
    devDup.value = (r.items || []).filter(
      (d: any) => d.id !== editingDevId.value && d.name === nm &&
        (d.brand_model || '') === devForm.brand_model.trim() && (d.unit || '') === devForm.unit.trim()
    )
  } catch { /* ignore */ }
}
watch(() => [devForm.name, devForm.brand_model, devForm.unit], () => { checkDup() }, { deep: true })

function openDevNew() {
  editingDevId.value = null; devAffected.value = 0; resetDevDup()
  Object.assign(devForm, { category: '', subcategory: '', name: '', brand_model: '', unit: '', unit_price: '', remark: '' })
  showDevModal.value = true
}
async function openDevEdit(d: any) {
  editingDevId.value = d.id; resetDevDup()
  Object.assign(devForm, { category: d.category || '', subcategory: d.subcategory || '', name: d.name, brand_model: d.brand_model || '', unit: d.unit || '', unit_price: d.unit_price ?? '', remark: d.remark || '' })
  showDevModal.value = true
  try { const r: any = await api(`/api/admin/station-devices?device_id=${d.id}&pageSize=1`); devAffected.value = r.total || 0 } catch { devAffected.value = 0 }
  checkDup()
}
async function saveDevice() {
  try {
    const body = { ...devForm }
    if (editingDevId.value) await api(`/api/admin/devices/${editingDevId.value}`, { method: 'PUT', body })
    else await api('/api/admin/devices', { method: 'POST', body })
    showDevModal.value = false
    await loadDevices()
  } catch (e: any) { alert(e?.data?.statusMessage || '保存失败') }
}
async function deleteDevice(d: any) {
  if (!confirm(`确定删除设备「${d.name}」？`)) return
  try { await api(`/api/admin/devices/${d.id}`, { method: 'DELETE' }); await loadDevices() }
  catch (e: any) { alert(e?.data?.statusMessage || '删除失败') }
}

// ── Tab3 站点-设备对照 ───────────────────────────────────────────
const linkResult = ref<{ total: number; page: number; pageSize: number; items: any[] }>({ total: 0, page: 1, pageSize: 50, items: [] })
const linkSubsite = ref<number | null>(null)
const linkKeyword = ref('')
const linkPage = ref(1)
const linkLoading = ref(false)
const subsiteOptions = computed(() => stations.value.filter((s) => s.level === 2)) // 仅子站可选
async function loadLinks() {
  linkLoading.value = true
  try {
    const params = new URLSearchParams()
    if (linkSubsite.value) params.set('subsite_id', String(linkSubsite.value))
    if (linkKeyword.value.trim()) params.set('q', linkKeyword.value.trim())
    params.set('page', String(linkPage.value)); params.set('pageSize', '50')
    linkResult.value = await api(`/api/admin/station-devices?${params.toString()}`)
  } catch (e: any) { alert(e?.data?.statusMessage || '加载对照失败') }
  finally { linkLoading.value = false }
}
watch([linkSubsite, linkKeyword], () => { linkPage.value = 1; loadLinks() })

const showLinkModal = ref(false)
const editingLinkId = ref<number | null>(null)
const linkForm = reactive({ subsite_id: null as number | null, device_id: null as number | null, device_name: '', qty: '', remark: '' })
const deviceSearchText = ref('')
const deviceResults = ref<any[]>([])
async function searchDevices(q: string) {
  try {
    const r: any = await api(`/api/admin/devices?q=${encodeURIComponent(q)}&pageSize=50`)
    deviceResults.value = r.items || []
  } catch { deviceResults.value = [] }
}
watch(deviceSearchText, (v) => { searchDevices(v) })
function pickDevice(d: any) { linkForm.device_id = d.id; linkForm.device_name = d.name; deviceSearchText.value = d.name; deviceResults.value = [] }

function openLinkNew() {
  editingLinkId.value = null
  Object.assign(linkForm, { subsite_id: linkSubsite.value, device_id: null, device_name: '', qty: '', remark: '' })
  deviceSearchText.value = ''; deviceResults.value = []
  showLinkModal.value = true
}
function openLinkEdit(l: any) {
  editingLinkId.value = l.id
  Object.assign(linkForm, { subsite_id: l.subsite_id, device_id: l.device_id, device_name: l.device_name, qty: l.qty ?? '', remark: l.remark || '' })
  deviceSearchText.value = l.device_name; deviceResults.value = []
  showLinkModal.value = true
}
async function saveLink() {
  try {
    const body = { subsite_id: linkForm.subsite_id, device_id: linkForm.device_id, qty: linkForm.qty, remark: linkForm.remark }
    if (editingLinkId.value) await api(`/api/admin/station-devices/${editingLinkId.value}`, { method: 'PUT', body })
    else await api('/api/admin/station-devices', { method: 'POST', body })
    showLinkModal.value = false
    await loadLinks()
  } catch (e: any) { alert(e?.data?.statusMessage || '保存失败') }
}
async function deleteLink(l: any) {
  if (!confirm(`确定删除对照「${l.station} / ${l.subsite} / ${l.device_name}」？`)) return
  try { await api(`/api/admin/station-devices/${l.id}`, { method: 'DELETE' }); await loadLinks() }
  catch (e: any) { alert(e?.data?.statusMessage || '删除失败') }
}

function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

onMounted(async () => {
  await me()
  if (!can('devices:view')) { useRouter().push('/'); return }
  await loadStations()
  await loadDevices()
  await loadLinks()
})
</script>

<template>
  <div class="bg-gray-50 min-h-screen">
    <section class="bg-gradient-to-br from-blue-600 to-brand-indigo py-12">
      <div class="container-custom">
        <h1 class="text-2xl font-bold text-white md:text-3xl">设备价格库维护</h1>
        <p class="mt-2 text-blue-100">范式化三表维护：站点、设备主数据、站点-设备对照。单价唯一存于设备表，合价由「数量×单价」实时计算。</p>
      </div>
    </section>

    <section class="container-custom -mt-6">
      <div class="rounded-xl bg-white p-6 shadow-card">
        <!-- Tab 切换 -->
        <div class="mb-5 flex gap-2 border-b border-gray-100">
          <button class="px-4 py-2 text-sm font-medium" :class="activeTab==='stations' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'" @click="activeTab='stations'">站点维护</button>
          <button class="px-4 py-2 text-sm font-medium" :class="activeTab==='devices' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'" @click="activeTab='devices'">设备维护</button>
          <button class="px-4 py-2 text-sm font-medium" :class="activeTab==='links' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'" @click="activeTab='links'">站点-设备对照</button>
        </div>

        <!-- ===== Tab1 站点维护 ===== -->
        <div v-if="activeTab==='stations'">
          <div class="mb-4 flex items-center justify-between">
            <p class="text-sm text-gray-500">共 {{ stations.length }} 个站点/子站 <span v-if="stationLoading" class="ml-2 text-primary">加载中…</span></p>
            <button v-if="canCreate" class="rounded-lg bg-primary px-3 py-2 text-sm text-white hover:bg-primary/90" @click="openStationNew()">+ 新增管理处</button>
          </div>
          <div class="space-y-2">
            <div v-for="s in rootStations" :key="s.id" class="rounded-lg border border-gray-100">
              <div class="flex items-center gap-2 px-3 py-2">
                <span class="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-600">管理处</span>
                <span class="font-medium text-gray-900">{{ s.name }}</span>
                <span v-if="s.is_summary" class="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-600">汇总</span>
                <span v-if="s.type" class="text-xs text-gray-400">类型：{{ s.type }}</span>
                <span class="text-xs text-gray-400">子站 {{ s.child_count }} · 对照 {{ s.link_count }}</span>
                <div class="ml-auto flex gap-2">
                  <button v-if="canCreate" class="text-xs text-blue-500 hover:underline" @click="openStationNew(s.id)">+ 子站</button>
                  <button v-if="canEdit" class="text-xs text-blue-500 hover:underline" @click="openStationEdit(s)">编辑</button>
                  <button v-if="canDelete" class="text-xs text-red-500 hover:underline" @click="deleteStation(s)">删除</button>
                </div>
              </div>
              <div v-if="childrenOf(s.id).length" class="border-t border-gray-50 pl-6">
                <div v-for="c in childrenOf(s.id)" :key="c.id" class="flex items-center gap-2 border-b border-gray-50 px-3 py-2 last:border-0">
                  <span class="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">子站</span>
                  <span class="text-gray-800">{{ c.name }}</span>
                  <span v-if="c.is_summary" class="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-600">汇总</span>
                  <span v-if="c.type" class="text-xs text-gray-400">类型：{{ c.type }}</span>
                  <span class="text-xs text-gray-400">对照 {{ c.link_count }}</span>
                  <div class="ml-auto flex gap-2">
                    <button v-if="canEdit" class="text-xs text-blue-500 hover:underline" @click="openStationEdit(c)">编辑</button>
                    <button v-if="canDelete" class="text-xs text-red-500 hover:underline" @click="deleteStation(c)">删除</button>
                  </div>
                </div>
              </div>
            </div>
            <p v-if="!rootStations.length" class="px-3 py-8 text-center text-gray-400">暂无站点数据</p>
          </div>
        </div>

        <!-- ===== Tab2 设备维护 ===== -->
        <div v-if="activeTab==='devices'">
          <div class="mb-4 flex flex-wrap items-end gap-3">
            <div class="min-w-[200px] flex-1">
              <label class="mb-1 block text-xs text-gray-400">关键词</label>
              <input v-model="devKeyword" type="text" placeholder="搜索设备名称、品牌型号…" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            </div>
            <div class="w-40">
              <label class="mb-1 block text-xs text-gray-400">分类</label>
              <input v-model="devCategory" type="text" placeholder="如：工程监控" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            </div>
            <div class="w-40">
              <label class="mb-1 block text-xs text-gray-400">子分类</label>
              <input v-model="devSubcategory" type="text" placeholder="如：硬件设备" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            </div>
            <div class="w-24">
              <button v-if="canCreate" class="w-full rounded-lg bg-primary px-3 py-2.5 text-sm text-white hover:bg-primary/90" @click="openDevNew">+ 新增</button>
            </div>
          </div>
          <p class="mb-3 text-sm text-gray-500">共 {{ devResult.total.toLocaleString() }} 条设备 <span v-if="devLoading" class="ml-2 text-primary">加载中…</span></p>
          <div class="overflow-hidden rounded-lg border border-gray-100">
            <div class="max-h-[55vh] min-h-[200px] overflow-auto">
              <table class="w-full min-w-[800px] text-left text-sm">
                <thead class="sticky top-0 z-10 bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th class="px-3 py-3">分类</th>
                    <th class="px-3 py-3">子分类</th>
                    <th class="px-3 py-3">设备名称</th>
                    <th class="px-3 py-3">品牌型号</th>
                    <th class="px-3 py-3 text-right">单位</th>
                    <th class="px-3 py-3 text-right">单价(元)</th>
                    <th class="px-3 py-3 text-right">引用</th>
                    <th class="px-3 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  <tr v-for="d in devResult.items" :key="d.id" class="hover:bg-gray-50">
                    <td class="px-3 py-2 text-gray-600">{{ d.category || '—' }}</td>
                    <td class="px-3 py-2 text-gray-600">{{ d.subcategory || '—' }}</td>
                    <td class="px-3 py-2 font-medium text-gray-900">{{ d.name }}</td>
                    <td class="px-3 py-2 text-gray-500">{{ d.brand_model || '—' }}</td>
                    <td class="px-3 py-2 text-right text-gray-600">{{ d.unit || '—' }}</td>
                    <td class="px-3 py-2 text-right font-medium text-gray-900">{{ fmt(d.unit_price) }}</td>
                    <td class="px-3 py-2 text-right text-gray-400">{{ d.link_count }}</td>
                    <td class="px-3 py-2 text-right">
                      <button v-if="canEdit" class="mr-2 text-xs text-blue-500 hover:underline" @click="openDevEdit(d)">编辑</button>
                      <button v-if="canDelete" class="text-xs text-red-500 hover:underline" @click="deleteDevice(d)">删除</button>
                    </td>
                  </tr>
                  <tr v-if="devResult.items.length === 0"><td colspan="8" class="px-3 py-12 text-center text-gray-400">未找到设备</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="mt-4 flex items-center gap-2">
            <button class="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40" :disabled="devPage<=1" @click="devPage--; loadDevices()">上一页</button>
            <span class="text-sm text-gray-500">第 {{ devPage }} 页</span>
            <button class="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40" :disabled="devResult.items.length<50" @click="devPage++; loadDevices()">下一页</button>
          </div>
        </div>

        <!-- ===== Tab3 站点-设备对照 ===== -->
        <div v-if="activeTab==='links'">
          <div class="mb-4 flex flex-wrap items-end gap-3">
            <div class="w-48">
              <label class="mb-1 block text-xs text-gray-400">子站</label>
              <select v-model="linkSubsite" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
                <option :value="null">全部子站</option>
                <option v-for="s in subsiteOptions" :key="s.id" :value="s.id">{{ s.parent_name || '' }} / {{ s.name }}</option>
              </select>
            </div>
            <div class="min-w-[200px] flex-1">
              <label class="mb-1 block text-xs text-gray-400">关键词</label>
              <input v-model="linkKeyword" type="text" placeholder="搜索设备名称…" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            </div>
            <div class="w-24">
              <button v-if="canCreate" class="w-full rounded-lg bg-primary px-3 py-2.5 text-sm text-white hover:bg-primary/90" @click="openLinkNew">+ 新增</button>
            </div>
          </div>
          <p class="mb-3 text-sm text-gray-500">共 {{ linkResult.total.toLocaleString() }} 条对照 <span v-if="linkLoading" class="ml-2 text-primary">加载中…</span></p>
          <div class="overflow-hidden rounded-lg border border-gray-100">
            <div class="max-h-[55vh] min-h-[200px] overflow-auto">
              <table class="w-full min-w-[900px] text-left text-sm">
                <thead class="sticky top-0 z-10 bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th class="px-3 py-3">站点</th>
                    <th class="px-3 py-3">子站</th>
                    <th class="px-3 py-3">设备名称</th>
                    <th class="px-3 py-3">分类</th>
                    <th class="px-3 py-3 text-right">数量</th>
                    <th class="px-3 py-3 text-right">单价(元)</th>
                    <th class="px-3 py-3 text-right">合价(元)</th>
                    <th class="px-3 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  <tr v-for="l in linkResult.items" :key="l.id" class="hover:bg-gray-50">
                    <td class="px-3 py-2 text-gray-600">{{ l.station }}</td>
                    <td class="px-3 py-2 text-gray-600">{{ l.subsite }}</td>
                    <td class="px-3 py-2 font-medium text-gray-900">{{ l.device_name }}</td>
                    <td class="px-3 py-2 text-gray-600">{{ l.category || '—' }}</td>
                    <td class="px-3 py-2 text-right text-gray-600">{{ l.qty !== null ? fmt(l.qty) : '—' }}</td>
                    <td class="px-3 py-2 text-right text-gray-600">{{ fmt(l.unit_price) }}</td>
                    <td class="px-3 py-2 text-right font-medium text-gray-900">{{ fmt(l.total_price) }}</td>
                    <td class="px-3 py-2 text-right">
                      <button v-if="canEdit" class="mr-2 text-xs text-blue-500 hover:underline" @click="openLinkEdit(l)">编辑</button>
                      <button v-if="canDelete" class="text-xs text-red-500 hover:underline" @click="deleteLink(l)">删除</button>
                    </td>
                  </tr>
                  <tr v-if="linkResult.items.length === 0"><td colspan="8" class="px-3 py-12 text-center text-gray-400">未找到对照记录</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="mt-4 flex items-center gap-2">
            <button class="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40" :disabled="linkPage<=1" @click="linkPage--; loadLinks()">上一页</button>
            <span class="text-sm text-gray-500">第 {{ linkPage }} 页</span>
            <button class="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40" :disabled="linkResult.items.length<50" @click="linkPage++; loadLinks()">下一页</button>
          </div>
        </div>
      </div>
    </section>

    <!-- 站点弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showStationModal" class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" @click.self="showStationModal=false">
          <div class="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h3 class="mb-4 text-lg font-bold text-gray-900">{{ stationEditingId ? '编辑站点' : '新增站点' }}</h3>
            <div class="grid grid-cols-2 gap-3">
              <label class="block text-xs text-gray-500">上级（空=管理处）
                <select v-model="stationForm.parent_id" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <option :value="null">（无 · 新建管理处）</option>
                  <option v-for="s in stationOptions" :key="s.id" :value="s.id">{{ s.name }}</option>
                </select>
              </label>
              <label class="block text-xs text-gray-500">名称 <span class="text-red-500">*</span>
                <input v-model="stationForm.name" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="站点名称" />
              </label>
              <label class="block text-xs text-gray-500">子站类型
                <input v-model="stationForm.type" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="如：泵站/闸站" />
              </label>
              <label class="block text-xs text-gray-500">排序
                <input v-model.number="stationForm.sort_order" type="number" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              </label>
              <label class="col-span-2 flex items-center gap-2 text-xs text-gray-500">
                <input v-model="stationForm.is_summary" type="checkbox" class="rounded" /> 标记为汇总节点（统计时排除，避免金额重复计入）
              </label>
              <label class="col-span-2 block text-xs text-gray-500">备注
                <input v-model="stationForm.remark" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="可选" />
              </label>
            </div>
            <div class="mt-5 flex justify-end gap-2">
              <button class="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100" @click="showStationModal=false">取消</button>
              <button class="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary/90" @click="saveStation">保存</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 设备弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showDevModal" class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" @click.self="showDevModal=false">
          <div class="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h3 class="mb-4 text-lg font-bold text-gray-900">{{ editingDevId ? '编辑设备' : '新增设备' }}</h3>
            <div class="grid grid-cols-2 gap-3">
              <label class="block text-xs text-gray-500">分类
                <input v-model="devForm.category" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="如：工程监控" />
              </label>
              <label class="block text-xs text-gray-500">子分类
                <input v-model="devForm.subcategory" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="如：硬件设备" />
              </label>
              <label class="col-span-2 block text-xs text-gray-500">设备名称 <span class="text-red-500">*</span>
                <input v-model="devForm.name" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="设备名称" />
              </label>
              <label class="block text-xs text-gray-500">品牌型号
                <input v-model="devForm.brand_model" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="可选" />
              </label>
              <label class="block text-xs text-gray-500">单位
                <input v-model="devForm.unit" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="如：套" />
              </label>
              <label class="col-span-2 block text-xs text-gray-500">单价(元) <span class="text-red-500">*</span>
                <input v-model="devForm.unit_price" type="number" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="全局唯一价格源" />
              </label>
              <label class="col-span-2 block text-xs text-gray-500">备注
                <input v-model="devForm.remark" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="可选" />
              </label>
            </div>
            <div v-if="devAffected > 0" class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              该设备被 <b>{{ devAffected }}</b> 条站点对照引用；修改单价后，所有相关子站的合价将自动按「数量×单价」重算，无需逐行修改。
            </div>
            <div v-if="devDup.length" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              疑似重复：已存在 {{ devDup.length }} 条同名同型号同单位设备（ID：{{ devDup.map(d=>d.id).join('、') }}）。如确为同一设备请勿重复新增，直接编辑原记录即可。
            </div>
            <div class="mt-5 flex justify-end gap-2">
              <button class="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100" @click="showDevModal=false">取消</button>
              <button class="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary/90" @click="saveDevice">保存</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 对照弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showLinkModal" class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" @click.self="showLinkModal=false">
          <div class="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
            <h3 class="mb-4 text-lg font-bold text-gray-900">{{ editingLinkId ? '编辑对照' : '新增对照' }}</h3>
            <div class="grid grid-cols-1 gap-3">
              <label class="block text-xs text-gray-500">子站 <span class="text-red-500">*</span>
                <select v-model="linkForm.subsite_id" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <option :value="null">请选择子站</option>
                  <option v-for="s in subsiteOptions" :key="s.id" :value="s.id">{{ s.parent_name || '' }} / {{ s.name }}</option>
                </select>
              </label>
              <label class="block text-xs text-gray-500">设备 <span class="text-red-500">*</span>
                <input v-model="deviceSearchText" type="text" placeholder="搜索设备名称…" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                <div v-if="deviceResults.length" class="mt-1 max-h-40 overflow-auto rounded-lg border border-gray-100">
                  <button v-for="d in deviceResults" :key="d.id" type="button" class="block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50" @click="pickDevice(d)">
                    {{ d.name }} <span class="text-gray-400">· {{ d.brand_model || '—' }} · {{ d.unit || '—' }} · {{ fmt(d.unit_price) }}元</span>
                  </button>
                </div>
                <p v-if="linkForm.device_name" class="mt-1 text-xs text-green-600">已选：{{ linkForm.device_name }}</p>
              </label>
              <label class="block text-xs text-gray-500">数量
                <input v-model="linkForm.qty" type="number" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="可选" />
              </label>
              <label class="block text-xs text-gray-500">行备注
                <input v-model="linkForm.remark" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="可选" />
              </label>
            </div>
            <div class="mt-5 flex justify-end gap-2">
              <button class="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100" @click="showLinkModal=false">取消</button>
              <button class="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary/90" @click="saveLink">保存</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>
