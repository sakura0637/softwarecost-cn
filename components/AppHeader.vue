<script setup lang="ts">
// 顶部导航栏组件（含登录态 + 权限门禁）
const route = useRoute()
const router = useRouter()
const { token, user, roles, logout, can } = useAuth()

// 业务模块：按 `${module}:view` 权限决定是否在导航显示
const navItems = [
  { label: '首页', to: '/' },
  { label: '造价标准', to: '/standards', module: 'standards' },
  { label: '设备价格库', to: '/devices', module: 'devices' },
  { label: '行业基准数据分析', to: '/industry', module: 'industry' },
  { label: '省市计价数据分析', to: '/city', module: 'city' },
  { label: '工作台', to: '/projects', module: 'projects' },
]
// 管理模块：仅当用户拥有对应 view 权限时显示
const adminNavItems = [
  { label: '用户管理', to: '/admin/users', module: 'admin-users' },
  { label: '角色管理', to: '/admin/roles', module: 'admin-roles' },
  { label: '权限管理', to: '/admin/permissions', module: 'admin-permissions' },
]
const visibleNav = computed(() => navItems.filter(i => !i.module || can(i.module + ':view')))
const visibleAdminNav = computed(() => adminNavItems.filter(i => can(i.module + ':view')))
const isActive = (to: string) => route.path === to || (to !== '/' && route.path.startsWith(to))

const handleLogout = () => {
  logout()
  router.push('/')
}
</script>

<template>
  <header class="sticky top-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur">
    <div class="container-custom flex h-16 items-center justify-between">
      <!-- Logo -->
      <NuxtLink to="/" class="flex items-center gap-2">
        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-lg font-bold text-white">造</div>
        <span class="text-xl font-bold text-gray-900">水网数智造价系统</span>
      </NuxtLink>

      <!-- 桌面导航 -->
      <nav class="hidden items-center gap-1 md:flex">
        <NuxtLink
          v-for="item in visibleNav"
          :key="item.to"
          :to="item.to"
          class="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          :class="isActive(item.to) ? 'bg-primary/10 text-primary' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'"
        >
          {{ item.label }}
        </NuxtLink>
        <template v-if="visibleAdminNav.length">
          <span class="mx-1 h-5 w-px bg-gray-200"></span>
          <NuxtLink
            v-for="item in visibleAdminNav"
            :key="item.to"
            :to="item.to"
            class="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            :class="isActive(item.to) ? 'bg-primary/10 text-primary' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'"
          >
            {{ item.label }}
          </NuxtLink>
        </template>
      </nav>

      <!-- 用户区 -->
      <div class="flex items-center gap-3">
        <template v-if="token">
          <span class="hidden text-sm text-gray-600 md:inline">你好，{{ user?.username || '用户' }}</span>
          <span v-if="roles.length" class="hidden rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary md:inline">{{ roles.join(' / ') }}</span>
          <button class="btn-primary px-5 py-2 text-sm" @click="handleLogout">退出</button>
        </template>
        <template v-else>
          <NuxtLink to="/login" class="hidden px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 md:inline">登录</NuxtLink>
          <NuxtLink to="/register" class="btn-primary px-5 py-2 text-sm">免费注册</NuxtLink>
        </template>
        <button class="text-gray-600 md:hidden" aria-label="菜单">
          <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
    </div>
  </header>
</template>
