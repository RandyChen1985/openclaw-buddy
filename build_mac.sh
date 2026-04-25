#!/bin/bash

# 🦞 OpenClaw Buddy macOS 专用打包脚本
# 用途：编译预览版，仅限 macOS 运行

set -e

# 🦞 MacOS 开发环境路径补丁 (针对 Homebrew 与 /usr/local)
if [[ "$OSTYPE" == "darwin"* ]]; then
    EXTRA_PATHS="/opt/homebrew/bin:/usr/local/bin"
    IFS=':' read -ra ADDR <<< "$EXTRA_PATHS"
    for p in "${ADDR[@]}"; do
        if [[ ":$PATH:" != *":$p:"* ]] && [ -d "$p" ]; then
            export PATH="$p:$PATH"
        fi
    done
fi

BINARY_NAME="openclaw-buddy-mac"
RELEASE_ROOT="release"
PKG_PREFIX="openclaw-buddy-mac"
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
go build -ldflags="-s -w -X 'openclaw-buddy/internal/config.Version=${VERSION}'" -o "${BINARY_NAME}" cmd/monitor/main.go

# 3. 组织发布包结构
mkdir -p "${PKG_DIR}/lib" "${PKG_DIR}/logs" "${PKG_DIR}/reports" "${PKG_DIR}/backups" "${PKG_DIR}/data" "${PKG_DIR}/pid"
mv "${BINARY_NAME}" "${PKG_DIR}/lib/openclaw-buddy"

[ -f "release/README.md" ] && cp "release/README.md" "${PKG_DIR}/README.md"
# 将版本文件打入发布包，便于产物自描述
[ -f "VERSION" ] && cp "VERSION" "${PKG_DIR}/VERSION"

# 4. 生成配置文件与脚本
cat <<EOF > "${PKG_DIR}/env"
# 🦞 OpenClaw Buddy (macOS 生产环境)
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
# 是否显示“外部工具”菜单组
SHOW_EXTERNAL_TOOLS=false

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
# 🚀 确保必要目录存在
mkdir -p ./pid ./logs ./data ./reports ./backups

PID_FILE="./pid/openclaw-buddy.pid"
[ -f "$PID_FILE" ] && ps -p $(cat "$PID_FILE") > /dev/null && echo "❌ 已经在运行中" && exit 1
nohup ./lib/openclaw-buddy >> ./logs/guardian.log 2>&1 &
echo $! > "$PID_FILE"
echo "✅ macOS 版启动成功，PID: $(cat $PID_FILE)"
echo "💡 提示: 可通过 tail -f ./logs/guardian.log 查看实时日志"
EOF
chmod +x "${PKG_DIR}/start.sh"

# 生成停止脚本
cat <<'EOF' > "${PKG_DIR}/stop.sh"
#!/bin/bash
cd "$(dirname "$0")"
PID_FILE="./pid/openclaw-buddy.pid"

stop_process() {
    local pid=$1
    echo "⏱️ 正在关闭进程 $pid..."
    kill $pid 2>/dev/null

    # 等待最多 5 秒
    for i in {1..5}; do
        if ! ps -p $pid > /dev/null; then
            echo "✅ 进程 $pid 已成功停止"
            return 0
        fi
        sleep 1
    done

    echo "⚠️ 进程 $pid 未能优雅退出，正在强制终止 (kill -9)..."
    kill -9 $pid 2>/dev/null
    return 0
}

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p $PID > /dev/null; then
        stop_process $PID
    else
        echo "⚠️ PID 文件存在但进程 $PID 不在运行，正在清理陈旧文件..."
    fi
    rm -f "$PID_FILE"
else
    echo "⚠️ 未发现 PID 文件，尝试通过进程名匹配清理..."
fi

# 兜底清理：仅查找匹配当前目录绝对路径的进程，防止误杀多实例
CURRENT_BINARY=$(pwd)/lib/openclaw-buddy
# 使用 ps -ef 并通过 grep 匹配绝对路径
PIDS=$(ps -ef | grep "$CURRENT_BINARY" | grep -v grep | awk '{print $2}')

# 如果绝对路径没匹配到，尝试匹配相对路径 (兼容直接在当前目录启动的情况)
if [ -z "$PIDS" ]; then
    PIDS=$(ps -ef | grep "\./lib/openclaw-buddy" | grep -v grep | awk '{print $2}')
fi

if [ -n "$PIDS" ]; then
    echo "🔍 发现残余进程: $PIDS"
    for p in $PIDS; do
        stop_process $p
    done
else
    echo "✅ 未检测到其他运行进程"
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
