# 软件造价喵平台 - 腾讯轻量云部署指南

> 目标服务器：Ubuntu 24.04 LTS (x86_64)，公网 IP `43.233.198.184`
> 架构：Nuxt 3 全栈（前端 + Nitro 后端）+ 本地 SQLite + DeepSeek AI 识别
> 数据库：云服务器本地 SQLite 文件（`data/software_cost.db`），与任何外部生产库零接触

---

## 一、准备工作（本机已完成，你只需做最后推送）

本地项目已 `git init` 并提交，文件已排除 `.env` / `node_modules` / `data/` 等敏感与体积项。

**你需要做的（本机 PowerShell）：**

1. 去 GitHub 网页新建一个**空仓库**（不要勾选 README/LICENSE），例如 `softwarecost-cn`
2. 关联并推送：
   ```powershell
   cd D:\softwarecost
   git remote add origin https://github.com/sakura0637/softwarecost-cn.git
   git push -u origin main
   ```
   > 如果提示认证失败，用 GitHub 网页生成的 Personal Access Token 当密码，或配置 Git Credential Manager。

---

## 二、服务器初始化（网页终端 OrcaTerm 执行）

1. 登录腾讯云控制台 → 轻量应用服务器 → 点「登录」开网页终端
2. 一键装环境：
   ```bash
   cd ~
   # 把 deploy-setup.sh 传上去后执行（见下方传文件方式）
   bash deploy-setup.sh
   ```

**传文件方式（在服务器终端用 curl 从 GitHub 拉取辅助文件即可，无需单独传）：**
```bash
cd ~
git clone https://github.com/sakura0637/softwarecost-cn.git softwarecost
```
> 部署脚本和 Nginx 配置已随仓库一起 clone 到 `~/softwarecost/`，直接在服务器上用。

---

## 三、拉代码 + 装依赖 + 构建

```bash
cd ~/softwarecost
npm install
npm run build
```

---

## 四、配置环境变量（关键，自己填！）

**切勿把含真实 Key 的 .env 提交到 GitHub。** 在服务器上手动创建：
```bash
nano ~/softwarecost/.env
```
填入：
```
DEEPSEEK_API_KEY=你的真实key
AUTH_SECRET=一段随机长字符串(可用 openssl rand -base64 32 生成)
```
保存退出（`Ctrl+O` → 回车 → `Ctrl+X`）。

---

## 五、启动 + 进程守护

```bash
cd ~/softwarecost
pm2 start .output/server/index.mjs --name softwarecost
pm2 save
pm2 startup   # 按提示执行它给出的 sudo 命令，实现开机自启
```

---

## 六、Nginx 反代（80 → 3000）

```bash
sudo cp ~/softwarecost/nginx-softwarecost.conf /etc/nginx/sites-enabled/softwarecost.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

---

## 七、防火墙（腾讯云控制台）

轻量云「防火墙」页放行：
- **80**（HTTP，必开）
- **443**（HTTPS，可选，建议用 certbot 申请免费证书）
- 22（SSH，默认开）
- **3000 不用对外开**，Nginx 已反代，外部只走 80

---

## 八、验证

浏览器访问 `http://43.233.198.184`（或你的域名）：
- 首页正常 → 前端 OK
- 注册 / 登录 → 后端 + SQLite OK
- 上传文档 → AI 识别 → DeepSeek Key OK

---

## 九、日常运维

```bash
pm2 ls                     # 看进程状态
pm2 logs softwarecost      # 看日志
pm2 restart softwarecost   # 重启
cd ~/softwarecost && git pull && npm install && npm run build && pm2 restart softwarecost   # 更新代码
```

---

## 常见问题

- **构建报 better-sqlite3 编译错误**：确认 `build-essential` 已装（deploy-setup.sh 已包含）。
- **启动后访问空白**：看 `pm2 logs softwarecost`，多半是 .env 没填或端口被占（`lsof -i:3000`）。
- **SQLite 库位置**：首次启动在 `~/softwarecost/data/software_cost.db` 自动创建。
- **重置数据库**：停进程后删 `data/software_cost.db` 再启动即重建（会清空账号和项目数据）。
