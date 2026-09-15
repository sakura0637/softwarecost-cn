export default defineNuxtConfig({
  devtools: { enabled: false },
  buildDir: 'node_modules/.nuxt-build',
  // ⚠️ 部署关键：Nitro 打包后不会自动加载 .env。
  // 这里把敏感变量声明进 runtimeConfig，Nitro 会在构建期保留引用，
  // 运行时通过 useRuntimeConfig() 或进程环境变量获取（见 ecosystem.config.cjs 注入）。
  runtimeConfig: {
    authSecret: process.env.AUTH_SECRET || '',
    deepseekKey: process.env.DEEPSEEK_API_KEY || '',
    dbDir: process.env.DB_DIR || '',
  },
  css: ['~/assets/css/main.css'],
  postcss: {
    plugins: {
      tailwindcss: {},
      autoprefixer: {},
    },
  },
  app: {
    head: {
      title: '水网数智造价系统 · 基于AI大模型的软件造价评估工具',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: '基于AI大模型的软件造价及IT设备询价工具，全面支持国内全量行业基准数据，自动生成功能点明细清单和报告。' },
      ],
    },
  },
  build: {
    transpile: [],
  },
  nitro: {
    // pg 为纯 JS 驱动，运行时从 node_modules 加载，禁止 nft 追踪打包
    externals: {
      external: ['pg'],
    },
    output: {
      external: ['pg'],
    },
    rollupConfig: {
      external: ['pg'],
    },
    // 请求体大小上限（Nitro 默认 1MB，会在读 body 阶段就拒绝，走不到业务校验）：
    //   /api/standards/**  要传 PDF/Word 附件
    //   /api/om/**         测算接口要传整份设备清单 —— 「全选站点」8452 行实测 1.79MB，
    //                      默认 1MB 会把正常用法顶掉（2026-09-15）
    routeRules: {
      '/api/standards/**': { body: { maxSize: '25mb' } },
      '/api/om/**': { body: { maxSize: '16mb' } },
    },
  },
})
