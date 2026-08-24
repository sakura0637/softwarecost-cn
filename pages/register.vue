<script setup lang="ts">
const { setSession } = useAuth()
const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const confirm = ref('')
const email = ref('')
const phone = ref('')
const error = ref('')
const loading = ref(false)

const handleRegister = async () => {
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = '用户名和密码必填'
    return
  }
  if (password.value.length < 6) {
    error.value = '密码至少 6 位'
    return
  }
  if (password.value !== confirm.value) {
    error.value = '两次输入的密码不一致'
    return
  }
  loading.value = true
  try {
    const res: any = await $fetch('/api/auth/register', {
      method: 'POST',
      body: {
        username: username.value.trim(),
        password: password.value,
        email: email.value || null,
        phone: phone.value || null
      }
    })
    setSession(res.token, res.user)
    const redirect = (route.query.redirect as string) || '/projects'
    router.push(redirect)
  } catch (e: any) {
    error.value = e.data?.statusMessage || e.message || '注册失败'
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
        <h1 class="text-2xl font-bold text-gray-900">注册账号</h1>
        <p class="mt-1 text-sm text-gray-500">创建你的软件造价工作台</p>
      </div>

      <div class="rounded-2xl bg-white p-8 shadow-card">
        <div v-if="error" class="mb-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{{ error }}</div>

        <form @submit.prevent="handleRegister">
          <div class="mb-4">
            <label class="mb-1.5 block text-sm font-medium text-gray-700">用户名 <span class="text-red-500">*</span></label>
            <input v-model="username" type="text" placeholder="用于登录的用户名" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          </div>
          <div class="mb-4">
            <label class="mb-1.5 block text-sm font-medium text-gray-700">密码 <span class="text-red-500">*</span></label>
            <input v-model="password" type="password" placeholder="至少 6 位" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          </div>
          <div class="mb-4">
            <label class="mb-1.5 block text-sm font-medium text-gray-700">确认密码 <span class="text-red-500">*</span></label>
            <input v-model="confirm" type="password" placeholder="再次输入密码" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          </div>
          <div class="mb-4">
            <label class="mb-1.5 block text-sm font-medium text-gray-700">邮箱</label>
            <input v-model="email" type="email" placeholder="选填" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          </div>
          <div class="mb-6">
            <label class="mb-1.5 block text-sm font-medium text-gray-700">手机号</label>
            <input v-model="phone" type="tel" placeholder="选填" class="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          </div>

          <button type="submit" class="btn-primary w-full" :disabled="loading">{{ loading ? '注册中…' : '注册并进入' }}</button>
        </form>

        <p class="mt-6 text-center text-sm text-gray-500">
          已有账号？
          <NuxtLink to="/login" class="font-medium text-primary hover:underline">去登录</NuxtLink>
        </p>
      </div>
    </div>
  </div>
</template>
