<script setup lang="ts">
// 首页 —— 产品介绍 + 核心功能 + 行业价值 + 合规权威

const features = [
  {
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    title: 'AI 自动识别功能点',
    desc: '上传 Word / Excel 需求文档，AI 大模型自动解析识别软件功能点，按 IFPUG / NESMA 方法度量。',
  },
  {
    icon: 'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z',
    title: '自动生成清单与报告',
    desc: '一键生成功能点明细清单和造价评估报告，每项识别均附有详细合规解释（深度评估方式）。',
  },
  {
    icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
    title: '60+ 造价标准全覆盖',
    desc: '全面支持各省市、各行业最新软件造价标准，兼容 CSBMK / CSBSG 行业基准数据，支持标准自定义。',
  },
  {
    icon: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4z',
    title: '专家三级审核',
    desc: '后台支持专家初审、复审、终审三级审核把关，严控造价评估质量，结果权威可信。',
  },
  {
    icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
    title: '多角色协同共享',
    desc: '支持导入导出项目，评估结果在线流转，多角色多部门共享协同，打破信息孤岛。',
  },
  {
    icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
    title: '软硬件设备询价',
    desc: '输入设备名称及参数，AI 生成可追溯价格分析报告，识别"高价低配""参数虚标"风险。',
  },
]

const stats = [
  { label: '已注册使用机构', value: '4000+', suffix: '' },
  { label: '支持的造价标准', value: '60', suffix: '+ 项' },
  { label: '覆盖省市地区', value: '30', suffix: '+ 个' },
  { label: '行业基准数据', value: '10', suffix: '年全量' },
]

const valueProps = [
  {
    title: '打破信息不对称',
    desc: 'AI 不被技术术语迷惑，穿透技术包装识别真实规模。供应商申报 400 个功能点，AI 识别出 200 个，差距一目了然。',
  },
  {
    title: '标准化输出',
    desc: 'AI 生成的功能点清单遵循统一度量标准和分类体系，避免人工审核尺度不一，提升评审规范性和可比性。',
  },
  {
    title: '专家审核兜底',
    desc: '"AI 初筛 + 专家终审"双重保障，兼顾效率与准确，最终输出既高效又可靠的评估报告。',
  },
  {
    title: '全量标准覆盖',
    desc: '根据项目所属行业和类型自动匹配适用基准数据，省去查找比对标准的繁琐工作。',
  },
]
</script>

<template>
  <div>
    <!-- Hero -->
    <section class="relative overflow-hidden bg-gradient-to-br from-blue-600 via-primary to-brand-indigo">
      <div class="absolute inset-0 opacity-10" style="background-image: radial-gradient(circle at 20% 80%, white 1px, transparent 1px); background-size: 40px 40px;" />
      <div class="container-custom relative py-24 text-center md:py-32">
        <span class="inline-block rounded-full bg-white/15 px-4 py-1.5 text-sm font-medium text-white backdrop-blur">基于 AI 大模型的软件造价评估工具</span>
        <h1 class="mt-6 text-4xl font-bold leading-tight text-white md:text-6xl">
          水网数智造价系统
        </h1>
        <p class="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-blue-100 md:text-xl">
          基于 AI 大模型的软件造价及 IT 设备询价工具。<br />
          全面支持国内全量行业基准数据（CSBMK 和 CSBSG），自动生成功能点明细清单和报告。
        </p>
        <div class="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <NuxtLink to="/standards" class="btn-primary bg-white text-primary hover:bg-blue-50">查看造价标准库</NuxtLink>
          <NuxtLink to="/industry" class="btn-outline border-white text-white hover:bg-white hover:text-primary">探索行业基准数据</NuxtLink>
        </div>
      </div>
    </section>

    <!-- 数据概览 -->
    <section class="border-b border-gray-100 bg-white">
      <div class="container-custom grid grid-cols-2 gap-8 py-12 md:grid-cols-4">
        <div v-for="stat in stats" :key="stat.label" class="text-center">
          <div class="text-4xl font-bold text-primary">{{ stat.value }}<span class="text-xl">{{ stat.suffix }}</span></div>
          <div class="mt-2 text-sm text-gray-500">{{ stat.label }}</div>
        </div>
      </div>
    </section>

    <!-- 核心功能 -->
    <section class="container-custom py-20">
      <div class="text-center">
        <h2 class="section-title">核心功能模块</h2>
        <p class="mx-auto mt-4 max-w-2xl text-gray-500">从需求文档到造价报告，一站式智能评估流水线</p>
      </div>
      <div class="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        <div v-for="feature in features" :key="feature.title" class="card group">
          <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-white">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="feature.icon" />
            </svg>
          </div>
          <h3 class="mb-2 text-lg font-semibold text-gray-900">{{ feature.title }}</h3>
          <p class="text-sm leading-relaxed text-gray-500">{{ feature.desc }}</p>
        </div>
      </div>
    </section>

    <!-- 行业价值 -->
    <section class="bg-white py-20">
      <div class="container-custom">
        <div class="text-center">
          <h2 class="section-title">行业价值</h2>
          <p class="mx-auto mt-4 max-w-2xl text-gray-500">AI 不是替代专业判断，而是提供可靠的"第二意见"</p>
        </div>
        <div class="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div v-for="(prop, idx) in valueProps" :key="prop.title" class="flex gap-4 rounded-xl border border-gray-100 bg-gray-50 p-6">
            <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">{{ idx + 1 }}</div>
            <div>
              <h3 class="mb-2 font-semibold text-gray-900">{{ prop.title }}</h3>
              <p class="text-sm leading-relaxed text-gray-500">{{ prop.desc }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 合规权威 -->
    <section class="container-custom py-20">
      <div class="rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 p-10 text-center">
        <h2 class="section-title">合规权威</h2>
        <p class="mx-auto mt-4 max-w-3xl text-gray-600">
          遵循行业基准数据、国家标准，兼容各省市已发布的各类计费标准。系统收集集成近 10 年的中国软件行业基准数据、中国软件行业协会软件造价分会基准数据、50 余个各省市信息化项目费用测算标准，提供全面的基准数据支撑。
        </p>
        <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
          <span class="rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm">CSBMK 中国软件行业基准数据</span>
          <span class="rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm">CSBSG 软件造价分会基准数据</span>
          <span class="rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm">GB/T 36964-2018</span>
          <span class="rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm">GB/T 28827.7-2022</span>
        </div>
        <p class="mx-auto mt-8 max-w-2xl text-sm text-gray-500">
          第十届中国软件成本度量大会荣获"2025年软件成本度量及造价评估优秀案例"，荣获"2024四川省优秀软件产品"等。
        </p>
      </div>
    </section>

    <!-- CTA -->
    <section class="container-custom pb-20">
      <div class="rounded-2xl bg-primary px-8 py-12 text-center">
        <h2 class="text-3xl font-bold text-white">立即体验智能造价评估</h2>
        <p class="mx-auto mt-3 max-w-xl text-blue-100">无需下载安装，在线使用，可下载评估明细清单和造价评估报告</p>
        <div class="mt-8 flex justify-center gap-4">
          <NuxtLink to="/standards" class="btn-primary bg-white text-primary hover:bg-blue-50">免费试用</NuxtLink>
          <NuxtLink to="/city" class="btn-outline border-white text-white hover:bg-white hover:text-primary">查看计价数据</NuxtLink>
        </div>
      </div>
    </section>
  </div>
</template>
