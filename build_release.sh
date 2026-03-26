#!/bin/bash

# 🦞 有孚小龙虾监控 (Lobster Guardian) 一键打包发布脚本
# 用途：编译前端 React 项目 -> 嵌入 Go 程序 -> 生成发布包

# 设置变量
BINARY_NAME="lobster-monitor"
RELEASE_ROOT="release_pkg"
PKG_NAME="yovole-openclaw-monitor"
PKG_DIR="${RELEASE_ROOT}/${PKG_NAME}"

echo "🚀 开始打包发布流程..."

# 1. 清理旧的发布目录
echo "🧹 清理旧文件: ${RELEASE_ROOT}"
rm -rf "${RELEASE_ROOT}"

# 2. 编译前端项目
echo "🏗️ 正在编译前端项目 (web)..."
if [ -d "web" ]; then
    cd web
    npm install --silent
    npm run build --silent
    cd ..
    
    # 移动产物到 Go embed 目录
    mkdir -p internal/api/dist
    rm -rf internal/api/dist/*
    cp -r web/dist/* internal/api/dist/
else
    echo "❌ 错误: 未找到 web 目录"
    exit 1
fi

# 3. 编译 Go 二进制程序
echo "🏗️ 正在编译 Go 程序: ${BINARY_NAME}..."
go build -o "${BINARY_NAME}" cmd/monitor/main.go
if [ $? -ne 0 ]; then
    echo "❌ 编译失败，请检查 Go 环境和代码！"
    exit 1
fi

# 4. 创建发布目录结构
echo "📂 创建目录结构: ${PKG_DIR}"
mkdir -p "${PKG_DIR}/lib"
mkdir -p "${PKG_DIR}/logs"
mkdir -p "${PKG_DIR}/reports"
mkdir -p "${PKG_DIR}/backups"
mkdir -p "${PKG_DIR}/data"

# 5. 移动二进制文件
mv "${BINARY_NAME}" "${PKG_DIR}/lib/"

# 6. 生成 env 配置文件 (带详细说明)
echo "📝 生成配置文件: env"
cat <<EOF > "${PKG_DIR}/env"
# 🦞 有孚小龙虾监控 (Lobster Guardian) 配置文件

# [Web 服务配置]
# Web 管理面板监听端口
WEB_PORT=3000
# 管理员访问令牌 (Token)，用于 API 和 Web 登录校验
GUARDIAN_TOKEN="lobster-guardian-2026"

# [数据库配置]
# SQLite 数据库文件路径
DB_FILE="./data/guardian.db"

# [基础配置]
# OpenClaw 的配置目录路径
OPENCLAW_CONFIG_DIR="~/.openclaw"
# 守护进程自己的备份存放目录
BACKUP_DIR="./backups"

# [监控配置]
# 巡检频率（秒）
CHECK_INTERVAL_SECONDS=30
# 宕机确认重试次数
MAX_RETRIES=3
# 小龙虾网关健康检查端口
HEALTH_PORT=18789

# [告警配置]
FEISHU_ENABLED=false
FEISHU_APP_ID=""
FEISHU_APP_SECRET=""
FEISHU_CHAT_ID=""

# [日志与报表]
LOG_FILE="./logs/guardian.log"
LOG_MAX_SIZE=10
LOG_MAX_BACKUPS=5
LOG_MAX_AGE=7
LOG_COMPRESS=true
REPORT_DIR="./reports"
EOF

# 7. 生成启动脚本 (start.sh)
echo "📜 生成启动脚本: start.sh"
cat <<'EOF' > "${PKG_DIR}/start.sh"
#!/bin/bash
cd "$(dirname "$0")"

# 1. 检查服务是否已经在运行
PID_FILE="/tmp/lobster-guardian.pid"
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p $PID > /dev/null; then
        echo "❌ 服务已经在运行中 (PID: $PID)。"
        exit 1
    fi
    rm -f "$PID_FILE"
fi

# 2. 启动服务
echo "🚀 正在后台启动有孚小龙虾监控服务..."
nohup ./lib/lobster-monitor >> ./logs/guardian.log 2>&1 &
PID=$!
echo "✅ 启动成功，PID: $PID"
echo "🌐 Web 管理地址: http://localhost:3000"
EOF
chmod +x "${PKG_DIR}/start.sh"

# 8. 生成停止脚本 (stop.sh)
echo "📜 生成停止脚本: stop.sh"
cat <<'EOF' > "${PKG_DIR}/stop.sh"
#!/bin/bash
PID_FILE="/tmp/lobster-guardian.pid"
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    kill $PID && echo "Stopped Service (PID: $PID)"
    rm -f "$PID_FILE"
else
    echo "服务未在运行。"
fi
EOF
chmod +x "${PKG_DIR}/stop.sh"

echo "--------------------------------------------------"
echo "✅ 构建完成！发布包目录位于: ${PKG_DIR}"
echo "--------------------------------------------------"
