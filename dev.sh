#!/bin/bash

# 🦞 OpenClaw Buddy 快速开发/测试脚本 (隔离模式)
DEV_ROOT="temp-dev-test"
PID_FILE="/tmp/openclaw-buddy-dev.pid"

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

stop_and_clean() {
    echo "🔍 检查端口 3000 占用情况..."
    PORT_PID=$(lsof -ti :3000)
    
    if [ ! -z "$PORT_PID" ]; then
        echo "🛑 发现正在运行的服务 (PID: $PORT_PID)，正在尝试停止..."
        kill $PORT_PID
        sleep 2
        
        # 如果还在运行，暴力关掉
        if ps -p $PORT_PID > /dev/null; then
            echo "⚠️  进程服务仍未退出，执行强制清理 (kill -9)..."
            kill -9 $PORT_PID
        fi
    fi

    # 兜底清理同名进程
    pkill -f "openclaw-buddy-dev" 2>/dev/null

    # 清理 PID 文件与临时环境
    if [ -f "$PID_FILE" ]; then
        rm -f "$PID_FILE"
    fi
    
    if [ -d "$DEV_ROOT" ]; then
        echo "🧹 正在清理隔离任务环境 (保留数据与配置)..."
        # 排除 data 目录和 env 文件，清理其余所有内容
        find "$DEV_ROOT" -mindepth 1 -maxdepth 1 ! -name 'data' ! -name 'env' -exec rm -rf {} +
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
    pushd web > /dev/null
    npm run build
    if [ $? -ne 0 ]; then
        echo "❌ 前端项目编译失败！请检查 TypeScript 或 Lint 错误。"
        popd > /dev/null
        exit 1
    fi
    popd > /dev/null

    # 校验产物目录
    if [ ! -d "web/dist" ]; then
        echo "❌ 找不到编译产物目录 (web/dist)，编译可能未完整完成。"
        exit 1
    fi

    echo "📦 正在同步前端资产到后端..."
    mkdir -p internal/api/dist
    rm -rf internal/api/dist/*
    cp -r web/dist/* internal/api/dist/
fi

# 4. 编译后端到隔离目录
DEV_VERSION=$(cat VERSION 2>/dev/null || echo "dev")
echo "🏗️  正在编译后端 (版本: $DEV_VERSION)..."
go build -ldflags="-X 'openclaw-buddy/internal/config.Version=${DEV_VERSION}'" -o "$DEV_ROOT/openclaw-buddy-dev" ./cmd/monitor/main.go
if [ $? -ne 0 ]; then
    echo "❌ 编译失败！"
    exit 1
fi

# 6. 生成隔离环境配置: $DEV_ROOT/env (仅在不存在时生成)
if [ ! -f "$DEV_ROOT/env" ]; then
    echo "📝 生成隔离环境配置: $DEV_ROOT/env"
    cat <<EOF > "$DEV_ROOT/env"
# [网络与访问]
# 默认端口 (3000)
WEB_PORT=3000
# 基础路径 (默认为 /, 若需配置如 /claw 则改为 /claw)
WEB_ROOT="/console/claw"
BUDDY_TOKEN="openclaw-buddy-2026"
PID_FILE="./openclaw-buddy.pid"

# [存储与目录]
# 隔离数据存储路径 (相对于执行路径)
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
# 最大容错重试次数
MAX_RETRIES=3

# [高级选项]
# 外部跳转链接 (可选)
EXTERNAL_DASHBOARD_URL=""
# 是否显示“外部工具”菜单组
SHOW_EXTERNAL_TOOLS=true

# [飞书通知 (可选)]
FEISHU_ENABLED=false
FEISHU_APP_ID=""
FEISHU_APP_SECRET=""
FEISHU_CHAT_ID=""
EOF
else
    echo "📝 使用已存在的隔离环境配置: $DEV_ROOT/env"
fi

# 7. 切换到隔离目录启动服务
cd "$DEV_ROOT"
echo "🚀 启动服务..."
# 显式读取 env 中的变量并导出 (也可以由 Go 代码中的 godotenv.Load("env") 处理，但 PID 检查在 Load 之前)
export PID_FILE="./openclaw-buddy.pid"
nohup ./openclaw-buddy-dev > /dev/null 2>&1 &
NEW_PID=$!
echo $NEW_PID > "/tmp/openclaw-buddy-dev.pid"

echo "✅ 服务已在隔离环境启动 (PID: $NEW_PID)"
echo "🌐 访问地址: http://localhost:3000"
echo "🔑 认证令牌 (Token): $(grep BUDDY_TOKEN env | cut -d'=' -f2 | tr -d '"')"
echo "--------------------------------------------------"
echo "💡 提示: "
echo "   - 实时日志: tail -f $DEV_ROOT/logs/guardian.log"
echo "   - 停止并清理: ./dev.sh stop"
