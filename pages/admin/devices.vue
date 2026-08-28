<script setup lang="ts">
// 管理员设备价格库管理：增删改（仅管理员可见）
import { ref, computed, onMounted, reactive } from 'vue'
import { useAuth } from '~/composables/useAuth'

const { api, can, me, user } = useAuth()

const keyword = ref('')
const station = ref('')
const subsite = ref('')
const category = ref('')
const subcategory = ref('')
const sort = ref('id')
const order = ref<'asc' | 'desc'>('asc')
const page = ref(1)
const pageSize = 20

const filters = ref<{ stations: string[]; categories: string[] }>({ stations: [], categories: [] })
const subsiteOptions = ref<string[]>([])
const subcategoryOptions = ref<string[]>([])
const showSubsiteFilter = computed(() => subsiteOptions.value.length > 1)

const result = ref<{ total: number; page: number; pageSize: number; items: any[] }>({ total: 0, page: 1, pageSize: 20, items: [] })
const loading = ref(false)

const showModal = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)
const form = reactive({
  station: '',
  subsite: '',
  category: '',
  subcategory: '',
  name: '',
  unit: '',
  brand_model: '',
  qty: '',
  unit_price: '',
  total_price: '',
  remark: '',
})

async function loadFilters() {
  try { filters.value = await $fetch('/api/devices/filters') } catch { /* ignore */ }
}
async function refreshSubsiteOptions() {
  subsiteOptions.value = []
  if (!station.value) return
  try {
    const r: any = await $fetch(`/api/devices/filters?station=${encodeURIComponent(station.value)}`)
    subsiteOptions.value = r.subsites || []
  } catch { /* ignore */ }
}
async function refreshSubcategoryOptions() {
  subcategoryOptions.value = []
  const params = new URLSearchParams()
  if (station.value) params.set('station', station.value)
  if (category.value) params.set('category', category.value)
  try {
    const r: any = await $fetch(`/api/devices/filters?${params.toString()}`)
    subcategoryOptions.value = r.subcategories || []
  } catch { /* ignore */ }
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (keyword.value.trim()) params.set('q', keyword.value.trim())
    if (station.value) params.set('station', station.value)
    if (subsite.value) params.set('subsite', subsite.value)
    if (category.value) params.set('category', category.value)
    if (subcategory.value) params.set('subcategory', subcategory.value)
    params.set('sort', sort.value)
    params.set('order', order.value)
    params.set('page', String(page.value))
    params.set('pageSize', String(pageSize))
    result.value = await api(`/api/admin/devices?${params.toString()}`)
  } catch (e: any) { alert(e?.data?.statusMessage || '加载失败') }
  finally { loading.value = false }
}

watch(station, () => { subsite.value = ''; subcategory.value = ''; page.value = 1; refreshSubsiteOptions(); refreshSubcategoryOptions(); load() })
watch(category, () => { subcategory.value = ''; page.value = 1; refreshSubcategoryOptions(); load() })
watch([keyword, subsite, subcategory, sort, order], () => { page.value = 1; load() })

function resetFilters() {
  keyword.value = ''; station.value = ''; subsite.value = ''; category.value = ''; subcategory.value = ''
  sort.value = 'id'; order.value = 'asc'; page.value = 1
  subsiteOptions.value = []; subcategoryOptions.value = []
  load()
}

onMounted(async () => {
  await me()
  if (!can('devices:edit')) { useRouter().push('/'); return }
  await loadFilters()
  await load()
})

const totalPages = computed(() => Math.max(1, Math.ceil(result.value.total / pageSize)))
function fmt(n: number | null | undefined): string { return n === null || n === undefined ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) }

function openNew() {
  editingId.value = null
  Object.assign(form, { station: station.value || '', subsite: '', category: '', subcategory: '', name: '', unit: '', brand_model: '', qty: '', unit_price: '', total_price: '', remark: '' })
  showModal.value = true
}
function openEdit(item: any) {
  editingId.value = item.id
  Object.assign(form, {
    station: item.station || '', subsite: item.subsite || '', category: item.category || '', subcategory: item.subcategory || '',
    name: item.name || '', unit: item.unit || '', brand_model: item.brand_model || '',
    qty: item.qty ?? '', unit_price: item.unit_price ?? '', total_price: item.total_price ?? '', remark: item.remark || '',
  })
  showModal.value = true
}
async function save() {
  saving.value = true
  try {
    const body = { ...form }
    if (editingId.value) await api(`/api/admin/devices/${editingId.value}`, { method: 'PUT', body })
    else await api('/api/admin/devices', { method: 'POST', body })
    showModal.value = false
    await load()
  } catch (e: any) { alert(e?.data?.statusMessage || '保存失败') }
  finally { saving.value = false }
}
async function removeItem(item: any) {
  if (!confirm(`确定删除「${item.name}」？`)) return
  try { await api(`/api/admin/devices/${item.id}`, { method: 'DELETE' }); await load() }
  catch (e: any) { alert(e?.data?.statusMessage || '删除失败') }
}

const canCreate = computed(() => can('devices:create'))
const canEdit = computed(() => can('devices:edit'))
const canDelete = computed(() => can('devices:delete'))

function gotoPage(event: Event) {
  const target = event.target as HTMLInputElement
  const v = Math.max(1, Math.min(totalPages.value, Number(target.value) || 1))
  page.value = v
  load()
}
</script>

<template>
  <div class="bg-gray-50 min-h-screen">
    <section class="bg-gradient-to-br from-blue-600 to-brand-indigo py-12">
      <div class="container-custom">
        <h1 class="text-2xl font-bold text-white md:text-3xl">设备价格库管理</h1>
        <p class="mt-2 text-blue-100">管理员维护设备价格数据：新增、编辑、删除。</p>
      </div>
    </section>

    <section class="container-custom -mt-6">
      <div class="rounded-xl bg-white p-6 shadow-card">
        <div class="mb-4 flex flex-wrap items-end gap-3">
          <div class="min-w-[200px] flex-1">
            <label class="mb-1 block text-xs text-gray-400">关键词</label>
            <input v-model="keyword" type="text" placeholder="搜索设备名称、品牌型号或备注…" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          </div>
          <div class="w-40">
            <label class="mb-1 block text-xs text-gray-400">站点</label>
            <select v-model="station" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
              <option value="">全部站点</option>
              <option v-for="s in filters.stations" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
          <div v-if="showSubsiteFilter" class="w-40">
            <label class="mb-1 block text-xs text-gray-400">子站</label>
            <select v-model="subsite" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
              <option value="">全部子站</option>
              <option v-for="s in subsiteOptions" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
          <div class="w-40">
            <label class="mb-1 block text-xs text-gray-400">分类</label>
            <select v-model="category" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
              <option value="">全部分类</option>
              <option v-for="c in filters.categories" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div v-if="subcategoryOptions.length" class="w-40">
            <label class="mb-1 block text-xs text-gray-400">子分类</label>
            <select v-model="subcategory" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
              <option value="">全部子分类</option>
              <option v-for="c in subcategoryOptions" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div class="w-20">
            <button class="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-600 hover:bg-red-50 hover:text-red-600" @click="resetFilters">重置</button>
          </div>
          <div class="w-24">
            <button v-if="canCreate" class="w-full rounded-lg border border-primary bg-primary px-3 py-2.5 text-sm text-white hover:bg-primary/90" @click="openNew">+ 新增</button>
          </div>
        </div>

        <p class="mb-3 text-sm text-gray-500">共 {{ result.total.toLocaleString() }} 条 <span v-if="loading" class="ml-2 text-primary">加载中…</span></p>

        <div class="overflow-hidden rounded-lg border border-gray-100">
          <div class="max-h-[55vh] min-h-[300px] overflow-auto">
            <table class="w-full min-w-[900px] text-left text-sm">
              <thead class="sticky top-0 z-10 bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th class="px-3 py-3">站点</th>
                  <th class="px-3 py-3">子站</th>
                  <th class="px-3 py-3">分类</th>
                  <th class="px-3 py-3">子分类</th>
                  <th class="px-3 py-3">设备名称</th>
                  <th class="px-3 py-3">品牌型号</th>
                  <th class="px-3 py-3 text-right">单位</th>
                  <th class="px-3 py-3 text-right">数量</th>
                  <th class="px-3 py-3 text-right">单价(元)</th>
                  <th class="px-3 py-3 text-right">合价(元)</th>
                  <th class="px-3 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                <tr v-for="d in result.items" :key="d.id" class="hover:bg-gray-50">
                  <td class="px-3 py-2 text-gray-600">{{ d.station }}</td>
                  <td class="px-3 py-2 text-gray-600">{{ d.subsite || '—' }}</td>
                  <td class="px-3 py-2 text-gray-600">{{ d.category || '—' }}</td>
                  <td class="px-3 py-2 text-gray-600">{{ d.subcategory || '—' }}</td>
                  <td class="px-3 py-2 font-medium text-gray-900">{{ d.name }}</td>
                  <td class="px-3 py-2 text-gray-500">{{ d.brand_model || '—' }}</td>
                  <td class="px-3 py-2 text-right text-gray-600">{{ d.unit || '—' }}</td>
                  <td class="px-3 py-2 text-right text-gray-600">{{ d.qty !== null ? fmt(d.qty) : '—' }}</td>
                  <td class="px-3 py-2 text-right font-medium text-gray-900">{{ fmt(d.unit_price) }}</td>
                  <td class="px-3 py-2 text-right font-medium text-gray-900">{{ fmt(d.total_price) }}</td>
                  <td class="px-3 py-2 text-right">
                    <button v-if="canEdit" class="mr-2 text-xs text-blue-500 hover:underline" @click="openEdit(d)">编辑</button>
                    <button v-if="canDelete" class="text-xs text-red-500 hover:underline" @click="removeItem(d)">删除</button>
                  </td>
                </tr>
                <tr v-if="result.items.length === 0">
                  <td colspan="11" class="px-3 py-12 text-center text-gray-400">未找到匹配设备</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 分页 -->
        <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm text-gray-500">第 {{ result.page }} / {{ totalPages }} 页</p>
          <div class="flex items-center gap-2">
            <button class="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40" :disabled="page <= 1" @click="page = 1; load()">首页</button>
            <button class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40" :disabled="page <= 1" @click="page--; load()">上一页</button>
            <div class="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1">
              <span class="px-1 text-xs text-gray-400">跳至</span>
              <input :value="page" type="number" min="1" :max="totalPages" class="w-14 rounded border border-gray-200 px-2 py-1 text-center text-sm outline-none focus:border-primary" @change="($event: any) => { const v = Math.max(1, Math.min(totalPages, Number($event.target.value) || 1)); page = v; load() }" />
              <span class="px-1 text-xs text-gray-400">/ {{ totalPages }} 页</span>
            </div>
            <button class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40" :disabled="page >= totalPages" @click="page++; load()">下一页</button>
            <button class="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40" :disabled="page >= totalPages" @click="page = totalPages; load()">尾页</button>
          </div>
        </div>
      </div>
    </section>

    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showModal" class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" @click.self="showModal = false">
          <div class="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h3 class="mb-4 text-lg font-bold text-gray-900">{{ editingId ? '编辑设备' : '新增设备' }}</h3>
            <div class="grid grid-cols-2 gap-3">
              <label class="block text-xs text-gray-500">站点 <span class="text-red-500">*</span>
                <input v-model="form.station" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="如：保定" />
              </label>
              <label class="block text-xs text-gray-500">子站
                <input v-model="form.subsite" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="可选" />
              </label>
              <label class="block text-xs text-gray-500">分类
                <input v-model="form.category" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="如：工程监控" />
              </label>
              <label class="block text-xs text-gray-500">子分类
                <input v-model="form.subcategory" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="如：硬件设备" />
              </label>
              <label class="col-span-2 block text-xs text-gray-500">设备名称 <span class="text-red-500">*</span>
                <input v-model="form.name" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="设备名称" />
              </label>
              <label class="block text-xs text-gray-500">单位
                <input v-model="form.unit" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="如：套" />
              </label>
              <label class="block text-xs text-gray-500">品牌型号
                <input v-model="form.brand_model" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="可选" />
              </label>
              <label class="block text-xs text-gray-500">数量
                <input v-model="form.qty" type="number" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="可选" />
              </label>
              <label class="block text-xs text-gray-500">单价(元)
                <input v-model="form.unit_price" type="number" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="可选" />
              </label>
              <label class="block text-xs text-gray-500">合价(元)
                <input v-model="form.total_price" type="number" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="可选" />
              </label>
              <label class="col-span-2 block text-xs text-gray-500">备注
                <input v-model="form.remark" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="可选" />
              </label>
            </div>
            <div class="mt-5 flex justify-end gap-2">
              <button class="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100" @click="showModal = false">取消</button>
              <button :disabled="saving" class="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
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
