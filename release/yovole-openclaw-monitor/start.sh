#!/bin/bash
# 自动进入脚本所在目录
cd "$(dirname "$0")"

# 检查是否已经在运行
PID_FILE="/tmp/lobster-guardian.pid"
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p $PID > /dev/null; then
        echo "❌ Guardian is already running (PID: $PID)."
        exit 1
    fi
    rm -f "$PID_FILE"
fi

# 后台运行逻辑
echo "🚀 Starting Guardian in background..."
# 我们将标准输出和错误流重定向到 logs/guardian.log
nohup ./lib/lobster-guardian >> ./logs/guardian.log 2>&1 &

# 获取刚启动的 PID
PID=$!
echo "✅ Guardian started with PID: $PID"
echo "📝 Log file: ./logs/guardian.log"
