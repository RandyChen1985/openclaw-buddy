#!/bin/bash

echo "🧪 正在执行自动化测试..."

# 1. 运行 Go 包测试
# 内部包使用标准模式，tests 目录显式指定文件运行
echo "🏃 运行内部单元测试..."
go test ./internal/... -v
echo "🏃 运行集成测试 (tests/ 目录)..."
go test ./tests/... -v


if [ $? -eq 0 ]; then
    echo "✅ 所有后端测试通过！"
else
    echo "❌ 部分测试失败，请检查代码。"
    exit 1
fi

# 2. 检查前端构建
if [ -d "web" ]; then
    echo "🎨 正在验证前端构建..."
    cd web && npm run build --silent && cd ..
    if [ $? -eq 0 ]; then
        echo "✅ 前端构建验证通过！"
    else
        echo "❌ 前端构建失败。"
        exit 1
    fi
fi

echo "🎉 全量自动化测试完成。"
