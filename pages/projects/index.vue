<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { api } = useAuth()
const router = useRouter()
const projects = ref<any[]>([])
const loading = ref(false)
const showNew = ref(false)
const newName = ref('')
const newDesc = ref('')
const newMethod = ref('ifpug')
const newStandard = ref('hebei')
const creating = ref(false)

const stdOptions = [
  { id: 'gb-t-36964', name: 'GB/T 36964（国标）' },
  { id: 'hebei', name: '河北省信息化预算标准' },
  { id: 'beijing', name: '北京市' },
  { id: 'sichuan', name: '四川省' },
]

const statusText: Record<string, string> = {
  draft: '草稿',
  analyzed: '已识别',
  calculated: '已计价'
}

const load = async () => {
  loading.value = true
  try {
    const res: any = await api('/api/projects')
    projects.value = res.projects || []
  } finally {
    loading.value = false
  }
}

const createProject = async () => {
  if (!newName.value.trim()) return
  creating.value = true
  try {
    await api('/api/projects', {
      method: 'POST',
      body: {
        name: newName.value.trim(),
        description: newDesc.value || null,
        method: newMethod.value,
        standard_id: newStandard.value
      }
    })
    showNew.value = false
    newName.value = ''
    newDesc.value = ''
    await load()
  } finally {
    creating.value = false
  }
}

const removeProject = async (id: number) => {
  if (!confirm('确认删除该项目？删除后功能点数据不可恢复。')) return
  await api('/api/projects/' + id, { method: 'DELETE' })
  await load()
}

onMounted(load)
</script>

<template>
  <div class="min-h-[calc(100vh-4rem)] bg-gray-50 py-10">
    <div class="container-custom">
      <div class="mb-8 flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">我的工作台</h1>
          <p class="mt-1 text-sm text-gray-500">上传需求文档，AI 自动识别功能点并测算造价</p>
        </div>
        <button class="btn-primary px-5 py-2.5 text-sm" @click="showNew = true">+ 新建项目</button>
      </div>

      <!-- 新建弹窗 -->
      <div v-if="showNew" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" @click.self="showNew = false">
        <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
          <h2 class="mb-4 text-lg font-bold text-gray-900">新建项目</h2>
          <div class="mb-4">
            <label class="mb-1.5 block text-sm font-medium text-gray-700">项目名称</label>
            <input v-model="newName" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="例如：某政务系统升级改造" />
          </div>
          <div class="mb-4">
            <label class="mb-1.5 block text-sm font-medium text-gray-700">项目描述</label>
            <textarea v-model="newDesc" rows="3" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="选填"></textarea>
          </div>
          <div class="mb-4">
            <label class="mb-1.5 block text-sm font-medium text-gray-700">功能点方法</label>
            <select v-model="newMethod" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary">
              <option value="ifpug">IFPUG</option>
              <option value="nesma">NESMA</option>
            </select>
          </div>
          <div class="mb-6">
            <label class="mb-1.5 block text-sm font-medium text-gray-700">计价标准</label>
            <select v-model="newStandard" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary">
              <option v-for="s in stdOptions" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
          <div class="flex gap-3">
            <button class="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600" @click="showNew = false">取消</button>
            <button class="btn-primary flex-1 py-2.5 text-sm" :disabled="creating" @click="createProject">{{ creating ? '创建中…' : '创建' }}</button>
          </div>
        </div>
      </div>

      <!-- 项目列表 -->
      <div v-if="loading" class="py-20 text-center text-gray-400">加载中…</div>
      <div v-else-if="projects.length === 0" class="rounded-2xl border border-dashed border-gray-200 bg-white py-20 text-center">
        <p class="text-gray-500">还没有项目，点击右上角「新建项目」开始</p>
      </div>
      <div v-else class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="p in projects" :key="p.id" class="group rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-card">
          <div class="mb-2 flex items-start justify-between">
            <h3 class="font-bold text-gray-900">{{ p.name }}</h3>
            <span class="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{{ statusText[p.status] || p.status }}</span>
          </div>
          <p class="mb-4 line-clamp-2 text-sm text-gray-500">{{ p.description || '暂无描述' }}</p>
          <div class="flex items-center justify-between">
            <span class="text-xs text-gray-400">方法：{{ p.method?.toUpperCase() }}</span>
            <div class="flex gap-2">
              <button class="text-xs font-medium text-red-500 hover:underline" @click="removeProject(p.id)">删除</button>
              <button class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90" @click="router.push('/projects/' + p.id)">打开</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
