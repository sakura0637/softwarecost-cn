<script setup lang="ts">
// 角色管理：角色的增删改，以及为角色配置权限（模块 × 按钮 矩阵）
import { ref, computed, onMounted } from 'vue'
import { useAuth } from '~/composables/useAuth'

const { api, can, me } = useAuth()

const roles = ref<any[]>([])
const catalog = ref<any[]>([])          // 权限目录（模块 + 按钮）
const loading = ref(false)

// 角色增删改弹窗
const showRoleModal = ref(false)
const editingRoleId = ref<number | null>(null)
const savingRole = ref(false)
const roleForm = reactive({ code: '', name: '', description: '' })

// 权限矩阵弹窗
const showPermModal = ref(false)
const permRole = ref<any>(null)
const selectedPerms = ref<string[]>([])
const savingPerm = ref(false)

const grouped = computed(() => {
  const mods = catalog.value.filter(p => p.type === 'module')
  return mods.map(m => ({
    key: m.module,
    name: m.name,
    actions: catalog.value.filter(p => p.type === 'button' && p.module === m.module),
  }))
})

async function loadRoles() {
  loading.value = true
  try {
    const res: any = await api('/api/admin/roles')
    roles.value = res.roles || []
  } catch (e: any) { alert(e?.data?.statusMessage || '加载角色失败') }
  finally { loading.value = false }
}
async function loadCatalog() {
  try { const res: any = await api('/api/admin/permissions'); catalog.value = res.permissions || [] }
  catch { /* 无权限忽略 */ }
}

onMounted(async () => {
  await me()
  if (!can('admin-roles:view')) { useRouter().push('/'); return }
  await loadCatalog()
  await loadRoles()
})

// ── 角色增删改 ──
function openNewRole() {
  editingRoleId.value = null
  Object.assign(roleForm, { code: '', name: '', description: '' })
  showRoleModal.value = true
}
function openEditRole(r: any) {
  editingRoleId.value = r.id
  Object.assign(roleForm, { code: r.code, name: r.name, description: r.description || '' })
  showRoleModal.value = true
}
async function saveRole() {
  savingRole.value = true
  try {
    if (editingRoleId.value) await api(`/api/admin/roles/${editingRoleId.value}`, { method: 'PUT', body: { name: roleForm.name, description: roleForm.description } })
    else await api('/api/admin/roles', { method: 'POST', body: { ...roleForm } })
    showRoleModal.value = false
    await loadRoles()
  } catch (e: any) { alert(e?.data?.statusMessage || '保存失败') }
  finally { savingRole.value = false }
}
async function removeRole(r: any) {
  if (r.is_system) { alert('系统内置角色不可删除'); return }
  if (!confirm(`确定删除角色「${r.name}」？关联该角色的用户将失去对应权限。`)) return
  try { await api(`/api/admin/roles/${r.id}`, { method: 'DELETE' }); await loadRoles() }
  catch (e: any) { alert(e?.data?.statusMessage || '删除失败') }
}

// ── 权限矩阵 ──
async function openPerms(r: any) {
  permRole.value = r
  selectedPerms.value = (r.permissions || []).slice()
  showPermModal.value = true
}
function toggleAllInModule(mod: any, checked: boolean) {
  const codes = mod.actions.map((a: any) => a.code)
  if (checked) selectedPerms.value = Array.from(new Set([...selectedPerms.value, ...codes]))
  else selectedPerms.value = selectedPerms.value.filter(c => !codes.includes(c))
}
async function savePerms() {
  if (!permRole.value) return
  savingPerm.value = true
  try {
    await api(`/api/admin/roles/${permRole.value.id}/permissions`, { method: 'PUT', body: { permissions: selectedPerms.value } })
    showPermModal.value = false
    await loadRoles()
  } catch (e: any) { alert(e?.data?.statusMessage || '保存失败') }
  finally { savingPerm.value = false }
}

const canCreate = computed(() => can('admin-roles:create'))
const canEdit = computed(() => can('admin-roles:edit'))
const canDelete = computed(() => can('admin-roles:delete'))
const canEditPerm = computed(() => can('admin-permissions:edit'))
</script>

<template>
  <div class="bg-gray-50 min-h-screen">
    <section class="bg-gradient-to-br from-blue-600 to-brand-indigo py-12">
      <div class="container-custom">
        <h1 class="text-2xl font-bold text-white md:text-3xl">角色管理</h1>
        <p class="mt-2 text-blue-100">创建角色、增删改查，并为每个角色分配「模块 / 按钮」级权限。</p>
      </div>
    </section>

    <section class="container-custom -mt-6">
      <div class="rounded-xl bg-white p-6 shadow-card">
        <div class="mb-4 flex items-center justify-between">
          <span class="text-sm text-gray-500">共 {{ roles.length }} 个角色</span>
          <button v-if="canCreate" class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700" @click="openNewRole">+ 新增角色</button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-100 text-left text-xs text-gray-400">
                <th class="px-3 py-2">编码</th>
                <th class="px-3 py-2">名称</th>
                <th class="px-3 py-2">描述</th>
                <th class="px-3 py-2">权限数</th>
                <th class="px-3 py-2">类型</th>
                <th class="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in roles" :key="r.id" class="border-b border-gray-50 hover:bg-gray-50">
                <td class="px-3 py-2 font-mono text-xs text-gray-600">{{ r.code }}</td>
                <td class="px-3 py-2 font-medium text-gray-800">{{ r.name }}</td>
                <td class="px-3 py-2 text-gray-500">{{ r.description || '—' }}</td>
                <td class="px-3 py-2 text-gray-500">{{ (r.permissions || []).length }}</td>
                <td class="px-3 py-2">
                  <span v-if="r.is_system" class="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-600">系统内置</span>
                  <span v-else class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">自定义</span>
                </td>
                <td class="px-3 py-2 text-right">
                  <button v-if="canEditPerm" class="mr-2 text-xs text-primary hover:underline" @click="openPerms(r)">配置权限</button>
                  <button v-if="canEdit" class="mr-2 text-xs text-blue-500 hover:underline" @click="openEditRole(r)">编辑</button>
                  <button v-if="canDelete && !r.is_system" class="text-xs text-red-500 hover:underline" @click="removeRole(r)">删除</button>
                </td>
              </tr>
              <tr v-if="!loading && roles.length === 0">
                <td colspan="6" class="px-3 py-10 text-center text-gray-400">暂无角色</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- 角色增删改 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showRoleModal" class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" @click.self="showRoleModal = false">
          <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 class="mb-4 text-lg font-bold text-gray-900">{{ editingRoleId ? '编辑角色' : '新增角色' }}</h3>
            <div class="space-y-3">
              <label class="block text-xs text-gray-500">角色编码
                <input v-model="roleForm.code" :disabled="!!editingRoleId" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono" placeholder="如 auditor（仅字母数字下划线）" />
              </label>
              <label class="block text-xs text-gray-500">角色名称
                <input v-model="roleForm.name" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="如 审核专家" />
              </label>
              <label class="block text-xs text-gray-500">描述
                <textarea v-model="roleForm.description" rows="2" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"></textarea>
              </label>
            </div>
            <div class="mt-5 flex justify-end gap-2">
              <button class="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100" @click="showRoleModal = false">取消</button>
              <button :disabled="savingRole" class="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50" @click="saveRole">{{ savingRole ? '保存中…' : '保存' }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 权限矩阵 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showPermModal" class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" @click.self="showPermModal = false">
          <div class="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h3 class="mb-1 text-lg font-bold text-gray-900">配置权限 · {{ permRole?.name }}</h3>
            <p class="mb-4 text-xs text-gray-400">勾选该角色可访问的「模块」与可执行的「按钮」操作，权限按角色生效。</p>
            <div class="space-y-3">
              <div v-for="mod in grouped" :key="mod.key" class="rounded-xl border border-gray-100 p-3">
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-sm font-semibold text-gray-800">{{ mod.name }}</span>
                  <label class="flex cursor-pointer items-center gap-1 text-xs text-gray-500">
                    <input type="checkbox" class="accent-primary"
                      :checked="mod.actions.every((a: any) => selectedPerms.includes(a.code))"
                      @change="toggleAllInModule(mod, ($event.target as HTMLInputElement).checked)" />
                    全选
                  </label>
                </div>
                <div class="flex flex-wrap gap-2">
                  <label v-for="a in mod.actions" :key="a.code" class="flex cursor-pointer items-center gap-1 rounded-lg border px-3 py-1.5 text-sm"
                    :class="selectedPerms.includes(a.code) ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 text-gray-600'">
                    <input type="checkbox" class="accent-primary" :value="a.code" v-model="selectedPerms" />
                    {{ a.name }}
                  </label>
                </div>
              </div>
            </div>
            <div class="mt-5 flex justify-end gap-2">
              <button class="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100" @click="showPermModal = false">取消</button>
              <button :disabled="savingPerm" class="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50" @click="savePerms">{{ savingPerm ? '保存中…' : '保存权限' }}</button>
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
