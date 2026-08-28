<script setup lang="ts">
// 顶部导航栏组件（含登录态 + 权限门禁）
const route = useRoute()
const router = useRouter()
const { token, user, roles, logout, can } = useAuth()
const mobileOpen = ref(false)

// 业务模块：按 `${module}:view` 权限决定是否在导航显示
const navItems = [
  { label: '首页', to: '/' },
  { label: '造价标准', to: '/standards', module: 'standards' },
  { label: '设备价格库', to: '/devices', module: 'devices' },
  { label: '行业基准数据', to: '/industry', module: 'industry' },
  { label: '省市计价数据', to: '/city', module: 'city' },
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

const allNavItems = computed(() => [...visibleNav.value, ...visibleAdminNav.value])

const handleLogout = () => {
  logout()
  mobileOpen.value = false
  router.push('/')
}
</script>

<template>
  <header class="sticky top-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur">
    <!-- 全宽布局：logo 在最左，导航居中，用户区在最右 -->
    <div class="mx-auto flex h-16 w-full items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 xl:px-12">
      <!-- Logo / 系统名：固定在左侧 -->
      <NuxtLink to="/" class="flex shrink-0 items-center gap-2">
        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-lg font-bold text-white">造</div>
        <span class="whitespace-nowrap text-lg font-bold text-gray-900 sm:text-xl">水网数智造价系统</span>
      </NuxtLink>

      <!-- 桌面导航：占据剩余空间并居中 -->
      <nav class="hidden flex-1 items-center justify-center gap-1 md:flex">
        <NuxtLink
          v-for="item in visibleNav"
          :key="item.to"
          :to="item.to"
          class="whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium transition-colors lg:px-3"
          :class="isActive(item.to) ? 'bg-primary/10 text-primary' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'"
        >
          {{ item.label }}
        </NuxtLink>
        <template v-if="visibleAdminNav.length">
          <span class="mx-1 hidden h-5 w-px bg-gray-200 lg:block"></span>
          <NuxtLink
            v-for="item in visibleAdminNav"
            :key="item.to"
            :to="item.to"
            class="whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium transition-colors lg:px-3"
            :class="isActive(item.to) ? 'bg-primary/10 text-primary' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'"
          >
            {{ item.label }}
          </NuxtLink>
        </template>
      </nav>

      <!-- 用户区：固定在右侧 -->
      <div class="flex shrink-0 items-center gap-3">
        <template v-if="token">
          <span class="hidden text-sm text-gray-600 lg:inline">你好，{{ user?.username || '用户' }}</span>
          <span v-if="roles.length" class="hidden rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary sm:inline">{{ roles.join(' / ') }}</span>
          <button class="btn-primary whitespace-nowrap px-4 py-2 text-sm" @click="handleLogout">退出</button>
        </template>
        <template v-else>
          <NuxtLink to="/login" class="hidden px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 lg:inline">登录</NuxtLink>
          <NuxtLink to="/register" class="btn-primary whitespace-nowrap px-4 py-2 text-sm">免费注册</NuxtLink>
        </template>

        <!-- 移动端菜单按钮 -->
        <button class="text-gray-600 md:hidden" aria-label="菜单" @click="mobileOpen = !mobileOpen">
          <svg v-if="!mobileOpen" class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <svg v-else class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 移动端抽屉菜单 -->
    <div v-if="mobileOpen" class="border-t border-gray-100 bg-white md:hidden" @click.self="mobileOpen = false">
      <nav class="flex flex-col px-4 py-3">
        <NuxtLink
          v-for="item in allNavItems"
          :key="item.to"
          :to="item.to"
          class="rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
          :class="isActive(item.to) ? 'bg-primary/10 text-primary' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'"
          @click="mobileOpen = false"
        >
          {{ item.label }}
        </NuxtLink>
        <template v-if="!token">
          <div class="my-2 h-px bg-gray-100"></div>
          <NuxtLink to="/login" class="rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900" @click="mobileOpen = false">登录</NuxtLink>
        </template>
      </nav>
    </div>
  </header>
</template>
