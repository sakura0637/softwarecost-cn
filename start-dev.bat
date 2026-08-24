@echo off
chcp 65001 >nul
echo ========================================
echo   软件造价喵 仿站 - 开发服务器启动脚本
echo ========================================
echo.

cd /d "%~dp0"

REM 检查 node 是否可用
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [错误] 未找到 node，请先安装 Node.js 22+
  pause
  exit /b 1
)

REM 清理可能的旧缓存（首次或异常退出后）
if exist ".nuxt" ( rmdir /s /q ".nuxt" 2>nul )
if exist "node_modules\.vite" ( rmdir /s /q "node_modules\.vite" 2>nul )
if exist "node_modules\.nuxt-build" ( rmdir /s /q "node_modules\.nuxt-build" 2>nul )

echo 正在启动 Nuxt 开发服务器...
echo 启动后请浏览器访问: http://localhost:3000
echo 按 Ctrl+C 停止服务器
echo.

node node_modules/nuxt/bin/nuxt.mjs dev --port 3000

pause
