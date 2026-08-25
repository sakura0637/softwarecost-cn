<script setup lang="ts">
// 页脚组件
const year = new Date().getFullYear()
</script>

<template>
  <footer class="mt-20 border-t border-gray-200 bg-white">
    <div class="container-custom py-12">
      <div class="grid grid-cols-1 gap-8 md:grid-cols-4">
        <div>
          <div class="mb-4 flex items-center gap-2">
            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">造</div>
            <span class="text-lg font-bold text-gray-900">水网数智造价系统</span>
          </div>
          <p class="text-sm leading-relaxed text-gray-500">
            基于 AI 大模型的软件造价评估及软硬件设备询价工具，全面支持国内全量行业基准数据与各省市造价标准。
          </p>
        </div>

        <div>
          <h4 class="mb-3 text-sm font-semibold text-gray-900">产品功能</h4>
          <ul class="space-y-2 text-sm text-gray-500">
            <li>软件造价评估</li>
            <li>功能点审核</li>
            <li>软硬件设备询价</li>
            <li>造价标准库</li>
          </ul>
        </div>

        <div>
          <h4 class="mb-3 text-sm font-semibold text-gray-900">数据资源</h4>
          <ul class="space-y-2 text-sm text-gray-500">
            <li>行业基准数据</li>
            <li>各省市计价数据</li>
            <li><NuxtLink to="/devices" class="transition-colors hover:text-gray-900">设备价格数据库</NuxtLink></li>
            <li>自定义标准</li>
          </ul>
        </div>

        <div>
          <h4 class="mb-3 text-sm font-semibold text-gray-900">联系我们</h4>
          <ul class="space-y-2 text-sm text-gray-500">
            <li>商务合作</li>
            <li>专家咨询</li>
            <li>标准接入</li>
            <li>技术支持</li>
          </ul>
        </div>
      </div>

      <div class="mt-8 flex flex-col items-center justify-between gap-4 border-t border-gray-100 pt-8 text-sm text-gray-400 md:flex-row">
        <p>© {{ year }} 水网数智造价系统 · 演示版 · 数据整理自公开资料</p>
      </div>
    </div>
  </footer>
</template>
