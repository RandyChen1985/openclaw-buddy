#!/bin/bash

# 🦞 有孚小龙虾监控 (Lobster Guardian) Linux 生产环境打包脚本
# 用途：在 Mac/Windows 上运行，跨平台编译生成 Linux 全量包

set -e

BINARY_NAME="lobster-monitor-linux"
RELEASE_ROOT="release"
PKG_NAME="lobster-guardian-linux"
PKG_DIR="${RELEASE_ROOT}/${PKG_NAME}"
VERSION=$(date +%Y%m%d)

echo "🚀 开始 Linux 版本打包 (交叉编译, 版本: ${VERSION})..."

mkdir -p "${RELEASE_ROOT}"

# 1. 编译前端
echo "🏗️ 正在编译前端 (React)..."
cd web
if [ ! -d "node_modules" ]; then
    npm install --silent
fi
npm run build --silent
cd ..
mkdir -p internal/api/dist
rm -rf internal/api/dist/*
cp -r web/dist/* internal/api/dist/

# 2. 交叉编译 Go 二进制 (Linux/AMD64)
echo "🏗️ 正在交叉编译 Go 程序 (Linux/amd64): ${BINARY_NAME}..."
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o "${BINARY_NAME}" cmd/monitor/main.go

# 3. 组织发布包结构
mkdir -p "${PKG_DIR}/lib" "${PKG_DIR}/logs" "${PKG_DIR}/reports" "${PKG_DIR}/backups" "${PKG_DIR}/data"
mv "${BINARY_NAME}" "${PKG_DIR}/lib/lobster-monitor"
[ -f "README.md" ] && cp README.md "${PKG_DIR}/"

# 4. 生成 Linux 默认 env 配置文件
cat <<EOF > "${PKG_DIR}/env"
# 🦞 有孚小龙虾监控 (Linux 生产环境)
WEB_PORT=3000
GUARDIAN_TOKEN="lobster-guardian-2026"
DB_FILE="./data/guardian.db"
OPENCLAW_CONFIG_DIR="~/.openclaw" # Linux 下通常位于此路径
BACKUP_DIR="./backups"
CHECK_INTERVAL_SECONDS=30
MAX_RETRIES=3
HEALTH_PORT=18789
LOG_FILE="./logs/guardian.log"
REPORT_DIR="./reports"
# 生产环境可选：外部访问域名 (例如 https://agent.example.com)，用于龙虾面板跳转
EXTERNAL_DASHBOARD_URL=""
EOF

# 生成 Linux 启动脚本 (start.sh)
cat <<'EOF' > "${PKG_DIR}/start.sh"
#!/bin/bash
cd "$(dirname "$0")"
PID_FILE="/tmp/lobster-guardian-linux.pid"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p $PID > /dev/null; then
        echo "❌ 服务已经在运行 (PID: $PID)"
        exit 1
    fi
    rm -f "$PID_FILE"
fi

echo "🚀 正在启动服务..."
chmod +x ./lib/lobster-monitor
nohup ./lib/lobster-monitor >> ./logs/guardian.log 2>&1 &
echo $! > "$PID_FILE"
echo "✅ 启动成功，PID: $(cat $PID_FILE)"
EOF
chmod +x "${PKG_DIR}/start.sh"

# 生成 Linux 停止脚本 (stop.sh)
cat <<'EOF' > "${PKG_DIR}/stop.sh"
#!/bin/bash
PID_FILE="/tmp/lobster-guardian-linux.pid"
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    kill $PID && echo "✅ 服务已停止 (PID: $PID)"
    rm -f "$PID_FILE"
else
    echo "⚠️ 未发现正在运行的服务"
fi
EOF
chmod +x "${PKG_DIR}/stop.sh"

# 5. 打包归档为 .tar.gz
echo "📦 正在生成归档压缩包..."
TAR_FILE="lobster-guardian-linux-${VERSION}.tar.gz"
cd "${RELEASE_ROOT}"
tar -czf "${TAR_FILE}" "${PKG_NAME}"
cd ..

echo "--------------------------------------------------"
echo "✅ Linux 版本打包完成！"
echo "📂 发布目录: ${PKG_DIR}"
echo "🎁 归档文件: ${RELEASE_ROOT}/${TAR_FILE}"
echo "--------------------------------------------------"
