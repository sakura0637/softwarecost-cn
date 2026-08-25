<script setup lang="ts">
const { setSession } = useAuth()
const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

const handleLogin = async () => {
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码'
    return
  }
  loading.value = true
  try {
    const res: any = await $fetch('/api/auth/login', {
      method: 'POST',
      body: { username: username.value.trim(), password: password.value }
    })
    setSession(res.token, res.user)
    const redirect = (route.query.redirect as string) || '/projects'
    router.push(redirect)
  } catch (e: any) {
    error.value = e.data?.statusMessage || e.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50 px-4 py-12">
    <div class="w-full max-w-md">
      <div class="mb-8 text-center">
        <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-2xl font-bold text-white">造</div>
        <h1 class="text-2xl font-bold text-gray-900">登录水网数智造价系统</h1>
        <p class="mt-1 text-sm text-gray-500">基于 AI 大模型的软件造价评估工具</p>
      </div>

      <div class="rounded-2xl bg-white p-8 shadow-card">
        <div v-if="error" class="mb-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{{ error }}</div>

        <form @submit.prevent="handleLogin">
          <div class="mb-4">
            <label class="mb-1.5 block text-sm font-medium text-gray-700">用户名</label>
            <input v-model="username" type="text" placeholder="请输入用户名" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          </div>
          <div class="mb-6">
            <label class="mb-1.5 block text-sm font-medium text-gray-700">密码</label>
            <input v-model="password" type="password" placeholder="请输入密码" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          </div>

          <button type="submit" class="btn-primary w-full" :disabled="loading">{{ loading ? '登录中…' : '登录' }}</button>
        </form>

        <p class="mt-6 text-center text-sm text-gray-500">
          还没有账号？
          <NuxtLink to="/register" class="font-medium text-primary hover:underline">免费注册</NuxtLink>
        </p>
      </div>
    </div>
  </div>
</template>
