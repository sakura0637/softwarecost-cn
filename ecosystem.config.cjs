// PM2 启动配置：自动从项目根 .env 加载环境变量并注入进程
// 解决 Nitro 打包后不读 .env 导致 AUTH_SECRET / DEEPSEEK_API_KEY 为 undefined 的问题
const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')

const ROOT = __dirname
const envPath = path.join(ROOT, '.env')

// 读取 .env（若已存在），注入到 env
const env = {
  NODE_ENV: 'production',
  // 数据库目录：用绝对路径，避免 Nitro chdir 到 .output/server 后找不到 data/
  DB_DIR: path.join(ROOT, 'data'),
  // 标准附件上传目录：绝对路径，避免 Nitro chdir 后落到 .output/data/uploads 被构建清掉
  UPLOAD_DIR: path.join(ROOT, 'data', 'uploads'),
}

if (fs.existsSync(envPath)) {
  const parsed = dotenv.parse(fs.readFileSync(envPath))
  Object.assign(env, parsed)
}

module.exports = {
  apps: [
    {
      name: 'softwarecost',
      cwd: ROOT,
      script: '.output/server/index.mjs',
      instances: 1,
      exec_mode: 'fork',
      env,
      // 确保 data 目录存在
      interpreter: 'node',
    },
  ],
}
