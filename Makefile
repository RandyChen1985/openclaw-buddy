BINARY_NAME=lobster-guardian
RELEASE_ROOT=release
PKG_NAME=yovole-openclaw-monitor
PKG_DIR=$(RELEASE_ROOT)/$(PKG_NAME)

.PHONY: build clean run deps release

build:
	go build -o $(BINARY_NAME) cmd/guardian/main.go

deps:
	go mod tidy

clean:
	rm -f $(BINARY_NAME)
	rm -rf $(RELEASE_ROOT)
	rm -f guardian.log
	rm -rf reports/

run: build
	./$(BINARY_NAME)

release: build
	@echo "📦 Creating professional release package with documentation..."
	@rm -rf $(PKG_DIR)
	@mkdir -p $(PKG_DIR)/lib
	@mkdir -p $(PKG_DIR)/logs
	@mkdir -p $(PKG_DIR)/reports
	@cp $(BINARY_NAME) $(PKG_DIR)/lib/
	@# 创建带有详细说明的 env 文件
	@echo '# 🦞 OpenClaw 守护者 (Lobster Guardian) 配置文件' > $(PKG_DIR)/env
	@echo '' >> $(PKG_DIR)/env
	@echo '# [基础配置]' >> $(PKG_DIR)/env
	@echo '# OpenClaw 的配置目录路径，守护进程会监控此目录下的 openclaw.json' >> $(PKG_DIR)/env
	@echo 'OPENCLAW_CONFIG_DIR="$(HOME)/.openclaw"' >> $(PKG_DIR)/env
	@echo '' >> $(PKG_DIR)/env
	@echo '# [监控配置]' >> $(PKG_DIR)/env
	@echo '# 巡检频率（单位：秒），默认每 30 秒探测一次小龙虾状态' >> $(PKG_DIR)/env
	@echo 'CHECK_INTERVAL_SECONDS=30' >> $(PKG_DIR)/env
	@echo '' >> $(PKG_DIR)/env
	@echo '# 小龙虾网关监听的健康检查端口（默认：18789）' >> $(PKG_DIR)/env
	@echo 'HEALTH_PORT=18789' >> $(PKG_DIR)/env
	@echo '' >> $(PKG_DIR)/env
	@echo '# [告警配置]' >> $(PKG_DIR)/env
	@echo '# 是否启用飞书告警 (true/false)' >> $(PKG_DIR)/env
	@echo 'FEISHU_ENABLED=false' >> $(PKG_DIR)/env
	@echo '# 飞书应用 App ID' >> $(PKG_DIR)/env
	@echo 'FEISHU_APP_ID=""' >> $(PKG_DIR)/env
	@echo '# 飞书应用 App Secret' >> $(PKG_DIR)/env
	@echo 'FEISHU_APP_SECRET=""' >> $(PKG_DIR)/env
	@echo '# 接收通知的 Chat ID (群组 ID 或 Open ID)' >> $(PKG_DIR)/env
	@echo 'FEISHU_CHAT_ID=""' >> $(PKG_DIR)/env
	@echo '' >> $(PKG_DIR)/env
	@echo '# [日志与报表]' >> $(PKG_DIR)/env
	@echo '# 守护进程自身的日志存放路径' >> $(PKG_DIR)/env
	@echo 'LOG_FILE="./logs/guardian.log"' >> $(PKG_DIR)/env
	@echo '' >> $(PKG_DIR)/env
	@echo '# 故障诊断报表（Markdown 格式）的存放目录' >> $(PKG_DIR)/env
	@echo 'REPORT_DIR="./reports"' >> $(PKG_DIR)/env
	@# 创建运行脚本（支持后台运行与自检）
	@printf '#!/bin/bash\ncd "$$(dirname "$$0")"\n# 1. 环境预检查\nif ! command -v openclaw &> /dev/null; then\n  echo "❌ Error: openclaw command not found."\n  exit 1\nfi\n# 2. 状态预检查\nif ! openclaw status &> /dev/null; then\n  echo "❌ Error: OpenClaw is not running. Please start it first."\n  exit 1\nfi\nPID_FILE="/tmp/lobster-guardian.pid"\nif [ -f "$$PID_FILE" ]; then\n  PID=$$(cat "$$PID_FILE")\n  if ps -p $$PID > /dev/null; then\n    echo "❌ Guardian is already running (PID: $$PID)."\n    exit 1\n  fi\n  rm -f "$$PID_FILE"\nfi\necho "🚀 Starting Guardian in background..."\nnohup ./lib/$(BINARY_NAME) >> ./logs/guardian.log 2>&1 &\nPID=$$!\necho "✅ Guardian started with PID: $$PID"\necho "📝 Log file: ./logs/guardian.log"\n' > $(PKG_DIR)/start.sh
	@chmod +x $(PKG_DIR)/start.sh
	@# 创建停止脚本
	@printf '#!/bin/bash\nPID_FILE="/tmp/lobster-guardian.pid"\nif [ -f "$$PID_FILE" ]; then\n  PID=$$(cat "$$PID_FILE")\n  kill $$PID && echo "Stopped Guardian (PID: $$PID)"\n  rm -f "$$PID_FILE"\nelse\n  echo "Guardian is not running."\nfi\n' > $(PKG_DIR)/stop.sh
	@chmod +x $(PKG_DIR)/stop.sh
	@# 生成 README.md
	@echo "# 🦞 Lobster Guardian (小龙虾守护者)" > $(PKG_DIR)/README.md
	@echo "" >> $(PKG_DIR)/README.md
	@echo "本项目是专门为 **OpenClaw (小龙虾)** 设计的独立守护程序。它作为“带外管理”工具运行，旨在解决 OpenClaw 因配置改错导致网关宕机、进而导致管理界面失联的问题。" >> $(PKG_DIR)/README.md
	@echo "" >> $(PKG_DIR)/README.md
	@echo "## 🛠️ 工作原理" >> $(PKG_DIR)/README.md
	@echo "1. **周期性健康检查**：每隔 30 秒通过 TCP 端口和 CLI 命令探测 OpenClaw 运行状态。" >> $(PKG_DIR)/README.md
	@echo "2. **故障诊断**：一旦发现服务宕机，自动对比当前的 \`openclaw.json\` 与备份配置的差异并生成 Markdown 报表。" >> $(PKG_DIR)/README.md
	@echo "3. **多级自愈**：检测到配置错误导致的启动失败后，自动将 \`openclaw.json.bak\` 还原；若回滚失败或缺失备份，则执行 \`openclaw doctor --fix\` 自动修复环境。" >> $(PKG_DIR)/README.md
	@echo "4. **强制自愈**：执行 \`openclaw gateway --force\` 强行恢复服务。" >> $(PKG_DIR)/README.md
	@echo "5. **主动告警**：支持通过钉钉 Webhook 发送故障与自愈成功的实时告警。" >> $(PKG_DIR)/README.md
	@echo "" >> $(PKG_DIR)/README.md
	@echo "## 🚀 快速开始" >> $(PKG_DIR)/README.md
	@echo "### 前提条件" >> $(PKG_DIR)/README.md
	@echo "- 启动本程序前，请确保 **OpenClaw 已经正常运行**。" >> $(PKG_DIR)/README.md
	@echo "- 本程序采用单例模式运行，PID 锁文件位于 \`/tmp/lobster-guardian.pid\`。" >> $(PKG_DIR)/README.md
	@echo "" >> $(PKG_DIR)/README.md
	@echo "### 运行与停止" >> $(PKG_DIR)/README.md
	@echo "\`\`\`bash" >> $(PKG_DIR)/README.md
	@echo "./start.sh   # 启动守护进程" >> $(PKG_DIR)/README.md
	@echo "./stop.sh    # 停止守护进程" >> $(PKG_DIR)/README.md
	@echo "\`\`\`" >> $(PKG_DIR)/README.md
	@echo "" >> $(PKG_DIR)/README.md
	@echo "## 📂 目录说明" >> $(PKG_DIR)/README.md
	@echo "- **lib/**: 存放核心二进制程序。" >> $(PKG_DIR)/README.md
	@echo "- **logs/**: 存放 Guardian 自身的运行日志。" >> $(PKG_DIR)/README.md
	@echo "- **reports/**: 存放服务崩溃后的差异分析报表。" >> $(PKG_DIR)/README.md
	@echo "- **.env**: 配置文件，可调整巡检频率和路径。" >> $(PKG_DIR)/README.md
