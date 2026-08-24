#!/usr/bin/env bash
# ============================================================
# 腾讯轻量云 Ubuntu 24.04 一键部署准备脚本
# 用法: bash deploy-setup.sh
# 作用: 更新系统 + 安装 Node.js 22 + PM2 + Nginx + 基础编译工具
# ============================================================
set -e

echo "==> [1/5] 更新系统软件包..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential

echo "==> [2/5] 安装 Node.js 22 (NodeSource)..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
fi
echo "    node: $(node -v)  npm: $(npm -v)"

echo "==> [3/5] 安装 PM2 进程守护..."
sudo npm install -g pm2
pm2 --version

echo "==> [4/5] 安装 Nginx 反代..."
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx

echo "==> [5/5] 完成！"
echo "    下一步："
echo "      1. 把 nginx-softwarecost.conf 复制到 /etc/nginx/sites-enabled/"
echo "      2. sudo nginx -t && sudo systemctl reload nginx"
echo "      3. cd ~/softwarecost && npm install && npm run build"
echo "      4. pm2 start .output/server/index.mjs --name softwarecost"
echo "      5. pm2 save && pm2 startup"
echo "    记得在服务器上创建 .env 并填入真实 DEEPSEEK_API_KEY 和 AUTH_SECRET"
