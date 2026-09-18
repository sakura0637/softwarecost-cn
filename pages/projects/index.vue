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
// ⚠️ 标准必须从 standards 表实时拉取，不能写死。
//    历史问题：这里曾硬编码 gb-t-36964 / hebei / beijing / sichuan 四个选项，
//    而 standards 表里 25 个标准没有一个叫 hebei（河北实际是 hb-eb40），
//    beijing / sichuan 也对不上（真身是 bj-db11-1010 / sc-t-0015）——
//    结果新建项目选完标准，后续根本找不到对应参数。
const newStandard = ref('')
const stdOptions = ref<{ id: string; name: string }[]>([])
const stdLoading = ref(false)
const creating = ref(false)

const loadStdOptions = async () => {
  stdLoading.value = true
  try {
    const res: any = await api('/api/standards')
    stdOptions.value = (res.standards || []).map((s: any) => ({
      id: s.id,
      name: s.code ? `${s.name}（${s.code}）` : s.name,
    }))
    if (!newStandard.value && stdOptions.value.length) newStandard.value = stdOptions.value[0].id
  } catch {
    stdOptions.value = []
  } finally {
    stdLoading.value = false
  }
}

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
  if (!newStandard.value) {
    alert('请先选择计价标准（标准清单从标准库读取，若为空请到「数据维护 → 造价标准」检查）')
    return
  }
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

onMounted(async () => {
  await Promise.all([load(), loadStdOptions()])
})
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
            <select
              v-model="newStandard"
              class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary"
              :disabled="stdLoading || !stdOptions.length"
            >
              <option v-if="stdLoading" value="">标准库加载中…</option>
              <option v-else-if="!stdOptions.length" value="">标准库为空，请先到「数据维护 → 造价标准」添加</option>
              <option v-for="s in stdOptions" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
            <p class="mt-1 text-xs text-gray-400">清单来自标准库（共 {{ stdOptions.length }} 项），选定后该项目的功能点方法与复杂度判定规则都按这份标准执行。</p>
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
