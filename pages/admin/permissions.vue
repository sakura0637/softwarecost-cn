<script setup lang="ts">
// 权限管理：展示系统权限目录（模块 / 按钮），以及每个权限点当前被哪些角色拥有
import { ref, computed, onMounted } from 'vue'
import { useAuth } from '~/composables/useAuth'

const { api, can, me } = useAuth()

const catalog = ref<any[]>([])
const roles = ref<any[]>([])
const loading = ref(false)

const modules = computed(() => {
  const mods = catalog.value.filter(p => p.type === 'module')
  return mods.map(m => ({
    key: m.module,
    name: m.name,
    actions: catalog.value
      .filter(p => p.type === 'button' && p.module === m.module)
      .map(a => ({
        ...a,
        owners: roles.value.filter(r => (r.permissions || []).includes(a.code)).map(r => r.name),
      })),
  }))
})

async function loadAll() {
  loading.value = true
  try {
    const [cat, rl]: any[] = await Promise.all([
      api('/api/admin/permissions'),
      api('/api/admin/roles'),
    ])
    catalog.value = cat.permissions || []
    roles.value = rl.roles || []
  } catch (e: any) { alert(e?.data?.statusMessage || '加载失败') }
  finally { loading.value = false }
}

onMounted(async () => {
  await me()
  if (!can('admin-permissions:view')) { useRouter().push('/'); return }
  await loadAll()
})
</script>

<template>
  <div class="bg-gray-50 min-h-screen">
    <section class="bg-gradient-to-br from-blue-600 to-brand-indigo py-12">
      <div class="container-custom">
        <h1 class="text-2xl font-bold text-white md:text-3xl">权限管理</h1>
        <p class="mt-2 text-blue-100">系统界面上的「模块 / 按钮」权限目录，及每个权限点当前被哪些角色拥有。</p>
      </div>
    </section>

    <section class="container-custom -mt-6">
      <div class="space-y-4">
        <div v-for="mod in modules" :key="mod.key" class="rounded-xl bg-white p-6 shadow-card">
          <div class="mb-3 flex items-center gap-2">
            <span class="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">模块</span>
            <h3 class="text-base font-semibold text-gray-900">{{ mod.name }}</h3>
            <span class="font-mono text-xs text-gray-400">{{ mod.key }}</span>
          </div>
          <div class="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
            <div v-for="a in mod.actions" :key="a.code" class="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              <div>
                <span class="rounded bg-white px-1.5 py-0.5 text-xs text-gray-500">按钮</span>
                <span class="ml-2 text-sm font-medium text-gray-800">{{ a.name }}</span>
                <span class="ml-1 font-mono text-xs text-gray-400">{{ a.code }}</span>
              </div>
              <div class="flex shrink-0 flex-wrap justify-end gap-1">
                <span v-for="o in a.owners" :key="o" class="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{{ o }}</span>
                <span v-if="a.owners.length === 0" class="text-xs text-gray-300">无</span>
              </div>
            </div>
          </div>
        </div>
        <p v-if="!loading && modules.length === 0" class="py-12 text-center text-gray-400">暂无权限数据</p>
      </div>
    </section>
  </div>
</template>
