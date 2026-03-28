#!/bin/bash

# 🦞 OpenClaw Buddy macOS 专用打包脚本
# 用途：编译预览版，仅限 macOS 运行

set -e

BINARY_NAME="openclaw-buddy-mac"
RELEASE_ROOT="release"
PKG_PREFIX="openclaw-buddy-mac"
BASE_VERSION="1.0.0"

# 自动检测并递增版本号
LATEST_VERSION=$(ls "${RELEASE_ROOT}"/"${PKG_PREFIX}"-*.tar.gz 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -V | tail -n1)

if [ -z "$LATEST_VERSION" ]; then
    VERSION="$BASE_VERSION"
else
    major=$(echo "$LATEST_VERSION" | cut -d. -f1)
    minor=$(echo "$LATEST_VERSION" | cut -d. -f2)
    patch=$(echo "$LATEST_VERSION" | cut -d. -f3)
    VERSION="$major.$minor.$((patch + 1))"
fi

PKG_NAME="${PKG_PREFIX}-${VERSION}"
PKG_DIR="${RELEASE_ROOT}/${PKG_NAME}"

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
mv "${BINARY_NAME}" "${PKG_DIR}/lib/openclaw-buddy"
[ -f "release/README.md" ] && cp "release/README.md" "${PKG_DIR}/README.md"

# 4. 生成配置文件与脚本
cat <<EOF > "${PKG_DIR}/env"
# 🦞 OpenClaw Buddy (macOS 生产环境)
# Guardian 面板监听端口
WEB_PORT=3000
# 访问面板所需的认证令牌 (sk- 开头)
BUDDY_TOKEN="sk-replace-me-on-first-run"

# [存储与目录]
# SQLite 数据库文件路径 (存储记录与自愈开关)
DB_FILE="./data/guardian.db"
# OpenClaw 配置文件目录
OPENCLAW_CONFIG_DIR="~/.openclaw"
# 各类运行资产存放目录
BACKUP_DIR="./backups"
LOG_FILE="./logs/guardian.log"
REPORT_DIR="./reports"

# [监控策略]
# 监控轮询间隔 (秒)
CHECK_INTERVAL_SECONDS=30
# 网关健康检查端口
HEALTH_PORT=18789
# 最大重试次数
MAX_RETRIES=3

# [高级选项]
# 外部跳转链接 (可选)
EXTERNAL_DASHBOARD_URL=""

# [飞书通知 (可选)]
FEISHU_ENABLED=false
FEISHU_APP_ID=""
FEISHU_APP_SECRET=""
FEISHU_CHAT_ID=""
EOF

# 生成启动脚本
cat <<'EOF' > "${PKG_DIR}/start.sh"
#!/bin/bash
cd "$(dirname "$0")"
PID_FILE="/tmp/openclaw-buddy-mac.pid"
[ -f "$PID_FILE" ] && ps -p $(cat "$PID_FILE") > /dev/null && echo "❌ 已经在运行中" && exit 1
(trap "" INT; nohup ./lib/openclaw-buddy >> ./logs/guardian.log 2>&1 &)
echo $! > "$PID_FILE"
echo "✅ macOS 版启动成功，PID: $(cat $PID_FILE)"
echo "📋 正在自动追踪启动日志 (按 Ctrl+C 停止追踪，服务将继续后台运行)..."
sleep 1
# tail 运行在前台，接收到 Ctrl+C 后会退出，由于上面的 nohup 在子 shell 中由 trap 保护，不会受影响
tail -n 20 -f ./logs/guardian.log
EOF
chmod +x "${PKG_DIR}/start.sh"

# 生成停止脚本
cat <<'EOF' > "${PKG_DIR}/stop.sh"
#!/bin/bash
PID_FILE="/tmp/openclaw-buddy-mac.pid"
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
TAR_FILE="${PKG_NAME}.tar.gz"
cd "${RELEASE_ROOT}"
# COPYFILE_DISABLE=1 防止 macOS 产生 ._ 文件
# --no-xattrs 防止 Linux tar 提取时提示 LIBARCHIVE.xattr 警告
# --exclude 确保排除已存在的元数据文件
COPYFILE_DISABLE=1 tar --no-xattrs -czf "${TAR_FILE}" --exclude='._*' "${PKG_NAME}"
cd ..

echo "--------------------------------------------------"
echo "✅ macOS 版本打包完成！"
echo "🎁 归档文件: ${RELEASE_ROOT}/${TAR_FILE}"
echo "--------------------------------------------------"
