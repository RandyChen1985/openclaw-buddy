#!/bin/bash

echo "🧪 正在启动全量回归测试体系..."

# 0. 准备 Mock 模拟器
MOCK_DIR="$(pwd)/tests/bin"
mkdir -p "$MOCK_DIR"
echo "🔨 正在编译 Mock OpenClaw 模拟器..."
go build -o "$MOCK_DIR/openclaw" ./tests/mock_openclaw/main.go

# 1. 设置临时 PATH，确保测试时调用的是 Mock 程序
export PATH="$MOCK_DIR:$PATH"
echo "🔍 当前调用的 openclaw 位置: $(which openclaw)"

# 2. 运行集成测试
echo "🏃 正在执行后端 API 全量回归测试..."
go test ./tests/... -v -count=1

if [ $? -eq 0 ]; then
    echo "✅ 后端接口全量测试通过！"
else
    echo "❌ 发现接口逻辑异常，请检查代码。"
    rm -rf "$MOCK_DIR"
    exit 1
fi

# 3. 检查前端构建 (可选，视需要开启)
# ... (保持原有逻辑)

# 清理 Mock
rm -rf "$MOCK_DIR"
echo "🎉 自动化回归测试流程结束。"
