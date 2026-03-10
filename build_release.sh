#!/bin/bash

# 🦞 OpenClaw Guardian 一键打包发布脚本
# 用途：编译 Go 程序并生成标准的工业级发布包目录结构

# 设置变量
BINARY_NAME="lobster-guardian"
RELEASE_ROOT="release"
PKG_NAME="yovole-openclaw-monitor"
PKG_DIR="${RELEASE_ROOT}/${PKG_NAME}"

echo "🚀 开始打包发布流程..."

# 1. 清理旧的发布目录
echo "🧹 清理旧文件: ${RELEASE_ROOT}"
rm -rf "${RELEASE_ROOT}"

# 2. 编译 Go 二进制程序
echo "🏗️ 正在编译 Go 程序: ${BINARY_NAME}..."
go build -o "${BINARY_NAME}" cmd/guardian/main.go
if [ $? -ne 0 ]; then
    echo "❌ 编译失败，请检查 Go 环境和代码！"
    exit 1
fi

# 3. 创建发布目录结构
echo "📂 创建目录结构: ${PKG_DIR}"
mkdir -p "${PKG_DIR}/lib"
mkdir -p "${PKG_DIR}/logs"
mkdir -p "${PKG_DIR}/reports"

# 4. 移动二进制文件
mv "${BINARY_NAME}" "${PKG_DIR}/lib/"

# 5. 生成 env 配置文件 (带详细说明)
echo "📝 生成配置文件: env"
cat <<EOF > "${PKG_DIR}/env"
# 🦞 OpenClaw 守护者 (Lobster Guardian) 配置文件

# [基础配置]
# OpenClaw 的配置目录路径，守护进程会监控此目录下的 openclaw.json
OPENCLAW_CONFIG_DIR="$HOME/.openclaw"

# [监控配置]
# 巡检频率（单位：秒），默认每 30 秒探测一次小龙虾状态
CHECK_INTERVAL_SECONDS=30

# 小龙虾网关监听的健康检查端口（默认：18789）
HEALTH_PORT=18789

# [告警配置]
# 是否启用飞书告警 (true/false)
FEISHU_ENABLED=false
# 飞书应用 App ID
FEISHU_APP_ID=""
# 飞书应用 App Secret
FEISHU_APP_SECRET=""
# 接收通知的 Chat ID (群组 ID 或 Open ID)
FEISHU_CHAT_ID=""

# [日志与报表]
# 守护进程自身的日志存放路径
LOG_FILE="./logs/guardian.log"

# 故障诊断报表（Markdown 格式）的存放目录
REPORT_DIR="./reports"
EOF

# 6. 生成启动脚本 (start.sh)
echo "📜 生成启动脚本: start.sh"
cat <<'EOF' > "${PKG_DIR}/start.sh"
#!/bin/bash
# 自动进入脚本所在目录
cd "$(dirname "$0")"

# 1. 环境预检查: OpenClaw 是否安装
if ! command -v openclaw &> /dev/null; then
    echo "❌ 错误: 未找到 'openclaw' 命令，请确保它已安装在 PATH 中。"
    exit 1
fi

# 2. 状态预检查: OpenClaw 是否已启动
# 守护进程的设计初衷是守护已运行的服务，若服务未运行则不启动守护
# 尝试通过 openclaw status 或检测 18789 端口来判断
if ! openclaw status &> /dev/null; then
    echo "⚠️ 警告: 检测到 OpenClaw 网关可能未在运行。"
    echo "💡 提示: 监控将继续启动，并在检测到故障时尝试拉起服务。"
    # exit 1 # 取消强制退出，仅作提示
fi

# 3. 检查 Guardian 是否已经在运行
PID_FILE="/tmp/lobster-guardian.pid"
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p $PID > /dev/null; then
        echo "❌ Guardian 已经运行中 (PID: $PID)。"
        exit 1
    fi
    rm -f "$PID_FILE"
fi

# 4. 后台运行逻辑
echo "🚀 正在后台启动 Guardian..."
# 我们将标准输出和错误流重定向到 logs/guardian.log
nohup ./lib/lobster-guardian >> ./logs/guardian.log 2>&1 &

# 获取刚启动的 PID
PID=$!
echo "✅ Guardian 启动成功，PID: $PID"
echo "📝 日志文件: ./logs/guardian.log"
EOF
chmod +x "${PKG_DIR}/start.sh"

# 7. 生成停止脚本 (stop.sh)
echo "📜 生成停止脚本: stop.sh"
cat <<'EOF' > "${PKG_DIR}/stop.sh"
#!/bin/bash
PID_FILE="/tmp/lobster-guardian.pid"
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    kill $PID && echo "Stopped Guardian (PID: $PID)"
    rm -f "$PID_FILE"
else
    echo "Guardian 未在运行 (未找到 PID 文件)。"
fi
EOF
chmod +x "${PKG_DIR}/stop.sh"

# 8. 生成帮助文档 (README.md)
echo "📖 生成帮助文档: README.md"
cat <<EOF > "${PKG_DIR}/README.md"
# 🦞 Lobster Guardian (小龙虾守护者)

本项目是专门为 **OpenClaw (小龙虾)** 设计的独立守护程序。它作为“带外管理”工具运行，旨在解决 OpenClaw 因配置改错导致网关宕机、进而导致管理界面失联的问题。

## 🛠️ 工作原理
1. **周期性健康检查**：每隔 30 秒通过 TCP 端口和 CLI 命令探测 OpenClaw 运行状态。
2. **故障诊断**：一旦发现服务宕机，自动对比当前的 \`openclaw.json\` 与备份配置的差异并生成 Markdown 报表。
3. **多级自愈**：检测到配置错误导致的启动失败后，自动将 \`openclaw.json.bak\` 还原；若回滚失败或缺失备份，则执行 \`openclaw doctor --fix\` 自动修复环境。
4. **强制自愈**：执行 \`openclaw gateway --force\` 强行恢复服务。
5. **主动告警**：支持通过飞书 Webhook 发送故障与自愈成功的实时告警。

## 📊 运行实例
以下是 \`logs/guardian.log\` 中记录的一次真实自愈过程：
\`\`\`text
2026/03/10 12:25:23 🛡️ Guardian started (PID: 30362). Watching OpenClaw...
2026/03/10 12:25:23 🛡️ Guardian monitor loop started. Every 30 seconds.
2026/03/10 12:25:58 ✅ OpenClaw is healthy.
2026/03/10 12:27:53 ⚠️ Port 18789 is not listening! Service might be down.
2026/03/10 12:27:53 🛠️ Initiating self-healing process for reason: Port Down
2026/03/10 12:27:53 🔄 Attempting to recover service...
2026/03/10 12:27:53 ✅ Config rollback successful.
2026/03/10 12:27:53 🚀 Requesting gateway force start...
2026/03/10 12:27:53 ✨ Gateway start request sent. Self-healing cycle completed.
2026/03/10 12:28:27 ✅ OpenClaw is healthy.
\`\`\`

## 🚀 快速开始
### 前提条件
- 启动本程序前，请确保 **OpenClaw 已经正常运行**。
- 本程序采用单例模式运行，PID 锁文件位于 \`/tmp/lobster-guardian.pid\`。

### 运行与停止
\`\`\`bash
./start.sh   # 启动守护进程
./stop.sh    # 停止守护进程
\`\`\`

## 📂 目录说明
- **lib/**: 存放核心二进制程序。
- **logs/**: 存放 Guardian 自身的运行日志。
- **reports/**: 存放服务崩溃后的差异分析报表。
- **env**: 配置文件，可调整巡检频率和路径。
EOF

# 9. 清理中间产物 (Cleanup)
echo "🧹 清理根目录中间产物: ${BINARY_NAME}"
rm -f "${BINARY_NAME}"

echo "--------------------------------------------------"
echo "✅ 打包完成！发布包位于: ${PKG_DIR}"
echo "--------------------------------------------------"
