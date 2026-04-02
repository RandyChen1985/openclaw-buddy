#!/bin/bash

# 🦞 OpenClaw Buddy Windows 打包辅助脚本
# 注意：Windows GUI 版本推荐在 Windows 环境下使用 Wails CLI 编译
# 本脚本用于在 Linux/Mac 上准备发布包结构和版本号同步

set -e

BINARY_NAME="openclaw-buddy.exe"
RELEASE_ROOT="release"
PKG_PREFIX="openclaw-buddy-windows"
BASE_VERSION="1.0.0"

# 1. 识别版本逻辑
if [ -n "$1" ]; then
    VERSION="$1"
else
    LATEST_VERSION=$(ls "${RELEASE_ROOT}"/"${PKG_PREFIX}"-*.zip 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -V | tail -n1)
    if [ -z "$LATEST_VERSION" ]; then
        VERSION="$BASE_VERSION"
    else
        major=$(echo "$LATEST_VERSION" | cut -d. -f1)
        minor=$(echo "$LATEST_VERSION" | cut -d. -f2)
        patch=$(echo "$LATEST_VERSION" | cut -d. -f3)
        VERSION="$major.$minor.$((patch + 1))"
    fi
fi

PKG_NAME="${PKG_PREFIX}-${VERSION}"
PKG_DIR="${RELEASE_ROOT}/${PKG_NAME}"

echo "🧹 正在准备 Windows 发布目录 [${VERSION}]..."
rm -rf "${PKG_DIR}"
mkdir -p "${PKG_DIR}/logs" "${PKG_DIR}/reports" "${PKG_DIR}/backups" "${PKG_DIR}/data" "${PKG_DIR}/pid"

# 同步版本号
echo "export const APP_VERSION = '${VERSION}';" > web/src/version.ts
echo "${VERSION}" > VERSION

# 🏗️ 正在同步前端资源...
# Wails 会在编译时处理前端，但后端嵌入的图标需要手动同步
mkdir -p internal/api/dist
if [ -f "web/public/openclaw2.png" ]; then
    cp "web/public/openclaw2.png" "internal/api/dist/"
    echo "🎨 图标资源已同步到 internal/api/dist/"
fi

if command -v wails >/dev/null 2>&1; then
    echo "🚀 侦测到 Wails，正在尝试交叉编译 Windows 二进制..."
    wails build -platform windows/amd64 -ldflags "-s -w -X 'openclaw-buddy/internal/config.Version=${VERSION}'" -o "${BINARY_NAME}"
    if [ -f "build/bin/${BINARY_NAME}" ]; then
        mv "build/bin/${BINARY_NAME}" "${PKG_DIR}/"
        echo "✅ 二进制文件已编译并放入发布包"
    else
        echo "⚠️ Wails 编译成功但未找到产物，请手动检查 build/bin 目录"
    fi
else
    echo "💡 未发现 Wails，将仅生成发布包结构。请在 Windows 环境下完成最终编译。"
fi

# 生成 Windows 默认 env 配置文件

cat <<EOF | sed 's/$/\r/' > "${PKG_DIR}/env"
# 🦞 OpenClaw Buddy (Windows 生产环境)
# Guardian 面板监听端口
WEB_PORT=3000
# 基础路径 (默认为 /, 若需配置如 /claw 则改为 /claw)
WEB_ROOT="/"
# 访问面板所需的认证令牌 (sk- 开头)
BUDDY_TOKEN="sk-replace-me-on-first-run"

# [存储与目录]
# SQLite 数据库文件路径
DB_FILE="./data/guardian.db"
# OpenClaw 配置文件目录 (Windows 下 ~ 会自动展开为用户目录)
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

# [GUI 选项]
# 隐藏特定功能 (可选: terminal,logs)
GUI_DISABLE_FEATURES=""
# 是否显示“外部工具”菜单组
SHOW_EXTERNAL_TOOLS=false

# [飞书通知 (可选)]
FEISHU_ENABLED=false
FEISHU_APP_ID=""
FEISHU_APP_SECRET=""
FEISHU_CHAT_ID=""
EOF

echo "--------------------------------------------------"
echo "✅ Windows 发布包结构已准备就绪 (除 .exe 外)"
echo "📂 发布目录: ${PKG_DIR}"
echo ""
echo "💡 请在 Windows 环境下执行以下步骤完成编译："
echo "1. 安装 Wails: go install github.com/wailsapp/wails/v2/cmd/wails@latest"
echo "2. 在根目录运行: wails build -platform windows/amd64 -ldflags \"-X 'openclaw-buddy/internal/config.Version=${VERSION}'\""
echo "3. 将生成的 build/bin/openclaw-buddy.exe 放入 ${PKG_DIR}/ 目录即可"
echo "--------------------------------------------------"
