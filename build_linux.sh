#!/bin/bash

# 🦞 OpenClaw Buddy Linux 生产环境打包脚本
# 用途：在 Mac/Windows 上运行，跨平台编译生成 Linux 全量包

set -e

BINARY_NAME="openclaw-buddy-linux"
RELEASE_ROOT="release"
PKG_PREFIX="openclaw-buddy-linux"
BASE_VERSION="1.0.0"

# 1. 识别版本逻辑 (优先使用参数)
if [ -n "$1" ]; then
    VERSION="$1"
    echo "📌 使用手动指定版本: ${VERSION}"
else
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
    echo "🤖 自动计算下一个版本: ${VERSION}"
fi

PKG_NAME="${PKG_PREFIX}-${VERSION}"
PKG_DIR="${RELEASE_ROOT}/${PKG_NAME}"
TAR_FILE="${PKG_NAME}.tar.gz"

# 2. 强力清理旧产物
echo "🧹 正在清理旧版产物 [${VERSION}]..."
rm -rf "${PKG_DIR}"
rm -f "${RELEASE_ROOT}/${TAR_FILE}"

# 同步版本号到前端与根目录 VERSION 文件
echo "export const APP_VERSION = '${VERSION}';" > web/src/version.ts
echo "${VERSION}" > VERSION
echo "✅ 版本号已同步至 web/src/version.ts 和 VERSION 文件"

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
mv "${BINARY_NAME}" "${PKG_DIR}/lib/openclaw-buddy"
[ -f "release/README.md" ] && cp "release/README.md" "${PKG_DIR}/README.md"

# 4. 生成 Linux 默认 env 配置文件
cat <<EOF > "${PKG_DIR}/env"
# 🦞 OpenClaw Buddy (Linux 生产环境)
# Guardian 面板监听端口
WEB_PORT=3000
# 基础路径 (默认为 /, 若需配置如 /claw 则改为 /claw)
WEB_ROOT="/"
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
CHECK_INTERVAL_SECONDS=60
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

# 生成 Linux 启动脚本 (start.sh)
cat <<'EOF' > "${PKG_DIR}/start.sh"
#!/bin/bash
cd "$(dirname "$0")"
PID_FILE="/tmp/openclaw-buddy-linux.pid"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p $PID > /dev/null; then
        echo "❌ 服务已经在运行 (PID: $PID)"
        exit 1
    fi
    rm -f "$PID_FILE"
fi

echo "🚀 正在启动服务..."
chmod +x ./lib/openclaw-buddy
nohup ./lib/openclaw-buddy >> ./logs/guardian.log 2>&1 &
echo $! > "$PID_FILE"
echo "✅ 启动成功，PID: $(cat $PID_FILE)"
echo "💡 提示: 可通过 tail -f ./logs/guardian.log 查看实时日志"
EOF
chmod +x "${PKG_DIR}/start.sh"

# 生成 Linux 停止脚本 (stop.sh)
cat <<'EOF' > "${PKG_DIR}/stop.sh"
#!/bin/bash
PID_FILE="/tmp/openclaw-buddy-linux.pid"
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
TAR_FILE="${PKG_NAME}.tar.gz"
cd "${RELEASE_ROOT}"
# COPYFILE_DISABLE=1 防止 macOS 产生 ._ 文件
# --no-xattrs 防止 Linux tar 提取时提示 LIBARCHIVE.xattr 警告
# --exclude 确保排除已存在的元数据文件
COPYFILE_DISABLE=1 tar --no-xattrs -czf "${TAR_FILE}" --exclude='._*' "${PKG_NAME}"
cd ..

echo "--------------------------------------------------"
echo "✅ Linux 版本打包完成！"
echo "📂 发布目录: ${PKG_DIR}"
echo "🎁 归档文件: ${RELEASE_ROOT}/${TAR_FILE}"
echo "--------------------------------------------------"
