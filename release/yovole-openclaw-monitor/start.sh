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
