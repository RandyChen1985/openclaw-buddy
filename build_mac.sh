#!/bin/bash

# 🦞 有孚小龙虾监控 (Lobster Guardian) macOS 专用打包脚本
# 用途：编译预览版，仅限 macOS 运行

set -e

BINARY_NAME="lobster-monitor-mac"
RELEASE_ROOT="release"
PKG_NAME="lobster-guardian-mac"
PKG_DIR="${RELEASE_ROOT}/${PKG_NAME}"
VERSION=$(date +%Y%m%d)

echo "🚀 开始 macOS 版本打包 (版本: ${VERSION})..."

rm -rf "${RELEASE_ROOT}/mac_tmp"
mkdir -p "${RELEASE_ROOT}"

# 1. 编译前端
echo "🏗️ 正在编译前端..."
cd web && npm run build --silent && cd ..
mkdir -p internal/api/dist
rm -rf internal/api/dist/*
cp -r web/dist/* internal/api/dist/

# 2. 编译 Go 二进制 (macOS)
echo "🏗️ 正在编译 Go 程序 (Darwin/amd64): ${BINARY_NAME}..."
go build -ldflags="-s -w" -o "${BINARY_NAME}" cmd/monitor/main.go

# 3. 组织发布包
mkdir -p "${PKG_DIR}/lib" "${PKG_DIR}/logs" "${PKG_DIR}/reports" "${PKG_DIR}/backups" "${PKG_DIR}/data"
mv "${BINARY_NAME}" "${PKG_DIR}/lib/lobster-monitor"
[ -f "README.md" ] && cp README.md "${PKG_DIR}/"

# 4. 生成配置文件与脚本
cat <<EOF > "${PKG_DIR}/env"
# 🦞 有孚小龙虾监控 (macOS 版)
WEB_PORT=3000
GUARDIAN_TOKEN="lobster-guardian-2026"
DB_FILE="./data/guardian.db"
OPENCLAW_CONFIG_DIR="~/.openclaw"
BACKUP_DIR="./backups"
CHECK_INTERVAL_SECONDS=30
MAX_RETRIES=3
HEALTH_PORT=18789
LOG_FILE="./logs/guardian.log"
REPORT_DIR="./reports"
EOF

# 生成启动脚本
cat <<'EOF' > "${PKG_DIR}/start.sh"
#!/bin/bash
cd "$(dirname "$0")"
PID_FILE="/tmp/lobster-guardian-mac.pid"
[ -f "$PID_FILE" ] && ps -p $(cat "$PID_FILE") > /dev/null && echo "❌ 已经在运行中" && exit 1
nohup ./lib/lobster-monitor >> ./logs/guardian.log 2>&1 &
echo $! > "$PID_FILE"
echo "✅ macOS 版启动成功，PID: $(cat $PID_FILE)"
EOF
chmod +x "${PKG_DIR}/start.sh"

# 生成停止脚本
cat <<'EOF' > "${PKG_DIR}/stop.sh"
#!/bin/bash
PID_FILE="/tmp/lobster-guardian-mac.pid"
if [ -f "$PID_FILE" ]; then
    kill $(cat "$PID_FILE") && echo "✅ 已停止 (Mac)"
    rm -f "$PID_FILE"
else
    echo "⚠️ 未发现运行中的服务"
fi
EOF
chmod +x "${PKG_DIR}/stop.sh"

# 5. 打包归档
echo "📦 正在归档..."
TAR_FILE="lobster-guardian-mac-${VERSION}.tar.gz"
cd "${RELEASE_ROOT}"
tar -czf "${TAR_FILE}" "${PKG_NAME}"
cd ..

echo "--------------------------------------------------"
echo "✅ macOS 版本打包完成！"
echo "🎁 归档文件: ${RELEASE_ROOT}/${TAR_FILE}"
echo "--------------------------------------------------"
