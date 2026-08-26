<script setup lang="ts">
// 用户管理：列出全部用户、分配角色、重置密码、增删改（权限由后端守卫）
import { ref, computed, onMounted } from 'vue'
import { useAuth } from '~/composables/useAuth'

const { api, can, me, user } = useAuth()

const users = ref<any[]>([])
const allRoles = ref<{ id: number; code: string; name: string; is_system: number }[]>([])
const loading = ref(false)

const showModal = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)
const form = reactive({
  username: '',
  email: '',
  phone: '',
  password: '',        // 新增必填 / 编辑留空=不重置
  roleCodes: [] as string[],
})

async function loadUsers() {
  loading.value = true
  try {
    const res: any = await api('/api/admin/users')
    users.value = (res.users || []).map((u: any) => ({
      ...u,
      role_codes: u.role_codes ? u.role_codes.split(',') : [],
      role_names: u.role_names ? u.role_names.split(',') : [],
    }))
  } catch (e: any) {
    alert(e?.data?.statusMessage || '加载用户失败')
  } finally {
    loading.value = false
  }
}
async function loadRoles() {
  try {
    const res: any = await api('/api/admin/roles')
    allRoles.value = res.roles || []
  } catch { /* 无权限则忽略 */ }
}

onMounted(async () => {
  await me()
  if (!can('admin-users:view')) { useRouter().push('/'); return }
  await loadRoles()
  await loadUsers()
})

function openNew() {
  editingId.value = null
  Object.assign(form, { username: '', email: '', phone: '', password: '', roleCodes: ['user'] })
  showModal.value = true
}
function openEdit(u: any) {
  editingId.value = u.id
  Object.assign(form, {
    username: u.username,
    email: u.email || '',
    phone: u.phone || '',
    password: '',
    roleCodes: u.role_codes && u.role_codes.length ? u.role_codes : ['user'],
  })
  showModal.value = true
}
async function save() {
  saving.value = true
  try {
    if (editingId.value) {
      await api(`/api/admin/users/${editingId.value}`, { method: 'PUT', body: { ...form } })
    } else {
      await api('/api/admin/users', { method: 'POST', body: { ...form } })
    }
    showModal.value = false
    await loadUsers()
  } catch (e: any) {
    alert(e?.data?.statusMessage || '保存失败')
  } finally {
    saving.value = false
  }
}
async function removeUser(u: any) {
  if (!confirm(`确定删除用户「${u.username}」？`)) return
  try {
    await api(`/api/admin/users/${u.id}`, { method: 'DELETE' })
    await loadUsers()
  } catch (e: any) {
    alert(e?.data?.statusMessage || '删除失败')
  }
}

const canCreate = computed(() => can('admin-users:create'))
const canEdit = computed(() => can('admin-users:edit'))
const canDelete = computed(() => can('admin-users:delete'))
</script>

<template>
  <div class="bg-gray-50 min-h-screen">
    <section class="bg-gradient-to-br from-blue-600 to-brand-indigo py-12">
      <div class="container-custom">
        <h1 class="text-2xl font-bold text-white md:text-3xl">用户管理</h1>
        <p class="mt-2 text-blue-100">查看系统内全部用户，分配角色（支持多角色），可重置密码。</p>
      </div>
    </section>

    <section class="container-custom -mt-6">
      <div class="rounded-xl bg-white p-6 shadow-card">
        <div class="mb-4 flex items-center justify-between">
          <span class="text-sm text-gray-500">共 {{ users.length }} 个用户</span>
          <button v-if="canCreate" class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700" @click="openNew">+ 新增用户</button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-100 text-left text-xs text-gray-400">
                <th class="px-3 py-2">ID</th>
                <th class="px-3 py-2">用户名</th>
                <th class="px-3 py-2">邮箱</th>
                <th class="px-3 py-2">手机</th>
                <th class="px-3 py-2">角色</th>
                <th class="px-3 py-2">创建时间</th>
                <th class="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.id" class="border-b border-gray-50 hover:bg-gray-50">
                <td class="px-3 py-2 text-gray-400">{{ u.id }}</td>
                <td class="px-3 py-2 font-medium text-gray-800">{{ u.username }}</td>
                <td class="px-3 py-2 text-gray-500">{{ u.email || '—' }}</td>
                <td class="px-3 py-2 text-gray-500">{{ u.phone || '—' }}</td>
                <td class="px-3 py-2">
                  <span v-for="rn in (u.role_names || [])" :key="rn" class="mr-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{{ rn }}</span>
                  <span v-if="!(u.role_names && u.role_names.length)" class="text-xs text-gray-400">—</span>
                </td>
                <td class="px-3 py-2 text-gray-400">{{ u.created_at }}</td>
                <td class="px-3 py-2 text-right">
                  <button v-if="canEdit" class="mr-2 text-xs text-blue-500 hover:underline" @click="openEdit(u)">编辑</button>
                  <button v-if="canDelete" class="text-xs text-red-500 hover:underline" @click="removeUser(u)">删除</button>
                </td>
              </tr>
              <tr v-if="!loading && users.length === 0">
                <td colspan="7" class="px-3 py-10 text-center text-gray-400">暂无用户</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- 新增/编辑用户 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showModal" class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" @click.self="showModal = false">
          <div class="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h3 class="mb-4 text-lg font-bold text-gray-900">{{ editingId ? '编辑用户' : '新增用户' }}</h3>
            <div class="space-y-3">
              <label class="block text-xs text-gray-500">用户名
                <input v-model="form.username" :disabled="!!editingId" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="登录用户名" />
              </label>
              <div class="grid grid-cols-2 gap-3">
                <label class="block text-xs text-gray-500">邮箱
                  <input v-model="form.email" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="可选" />
                </label>
                <label class="block text-xs text-gray-500">手机
                  <input v-model="form.phone" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="可选" />
                </label>
              </div>
              <label class="block text-xs text-gray-500">
                {{ editingId ? '重置密码（留空则不修改）' : '初始密码' }}
                <input v-model="form.password" type="text" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" :placeholder="editingId ? '留空不修改' : '至少 6 位'" />
              </label>
              <div class="block">
                <span class="text-xs text-gray-500">分配角色（可多选，权限取并集）</span>
                <div class="mt-2 flex flex-wrap gap-2">
                  <label v-for="r in allRoles" :key="r.code" class="flex cursor-pointer items-center gap-1 rounded-lg border px-3 py-1.5 text-sm"
                    :class="form.roleCodes.includes(r.code) ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 text-gray-600'">
                    <input type="checkbox" class="accent-primary" :value="r.code" v-model="form.roleCodes" />
                    {{ r.name }}
                  </label>
                </div>
              </div>
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
