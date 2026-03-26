#!/bin/bash

# 🦞 Lobster Guardian 快速开发/测试脚本 (隔离模式)
DEV_ROOT="temp-dev-test"
PID_FILE="/tmp/lobster-guardian-dev.pid"

stop_and_clean() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p $PID > /dev/null; then
            echo "🛑 正在停止进程 (PID: $PID)..."
            kill $PID
            sleep 1
        fi
        rm -f "$PID_FILE"
    fi
    
    if [ -d "$DEV_ROOT" ]; then
        echo "🧹 正在清理隔离目录: $DEV_ROOT"
        rm -rf "$DEV_ROOT"
    fi
}

# 如果输入参数为 stop，则执行停止并清理
if [ "$1" == "stop" ]; then
    stop_and_clean
    echo "✨ 停止并清理完成。"
    exit 0
fi

echo "🛠️  开始开发环境构建 (目标目录: $DEV_ROOT)..."

# 1. 停止旧进程并清理
stop_and_clean

# 2. 准备隔离目录
mkdir -p "$DEV_ROOT"
mkdir -p "$DEV_ROOT/logs"
mkdir -p "$DEV_ROOT/data"
mkdir -p "$DEV_ROOT/reports"
mkdir -p "$DEV_ROOT/backups"

# 3. 编译前端
if [ -d "web" ]; then
    echo "🎨 正在编译前端..."
    cd web && npm run build --silent && cd ..
    mkdir -p internal/api/dist
    rm -rf internal/api/dist/*
    cp -r web/dist/* internal/api/dist/
fi

# 4. 编译后端到隔离目录
echo "🏗️  正在编译后端..."
go build -o "$DEV_ROOT/lobster-monitor-dev" cmd/monitor/main.go
if [ $? -ne 0 ]; then
    echo "❌ 编译失败！"
    exit 1
fi

# 5. 在隔离目录创建本地 env 配置
echo "📝 生成隔离环境配置: $DEV_ROOT/env"
cat <<EOF > "$DEV_ROOT/env"
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

# 6. 切换到隔离目录启动服务
cd "$DEV_ROOT"
echo "🚀 启动服务..."
# 启动时指定 PID 文件位置 (cmd/monitor/main.go 中使用了 /tmp/lobster-guardian.pid, 我们这里稍微做一下兼容，或者由启动命令管理)
nohup ./lobster-monitor-dev >> ./logs/guardian.log 2>&1 &
NEW_PID=$!
echo $NEW_PID > "$PID_FILE"

echo "✅ 服务已在隔离环境启动 (PID: $NEW_PID)"
echo "🌐 访问地址: http://localhost:3000"
echo "--------------------------------------------------"
echo "💡 提示: "
echo "   - 实时日志: tail -f $DEV_ROOT/logs/guardian.log"
echo "   - 停止并清理: ./dev.sh stop"
