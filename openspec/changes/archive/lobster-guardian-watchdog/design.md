# 详细设计：OpenClaw 守护者 (Lobster Guardian)

## 1. 系统架构
本系统（Lobster Guardian）作为独立的 Go 二进制程序运行，采用“单例模式 + 强运行依赖”的设计。

### 核心模块划分：
- **Guardian Core**：主循环逻辑。
- **Health Checker**：TCP 端口与 `openclaw health` 探测。
- **Healer & Analyzer**：多级自愈决策与配置差异分析。
- **Notifier (DingTalk)**：钉钉 Webhook 告警模块。
- **Utils (File Lock)**：文件锁单例保障。

## 2. 启动自检流程 (Starting Ceremony)
1. **单例校验**：对 `/tmp/lobster-guardian.pid` 加锁。
2. **二进制检测**：在 `PATH` 中查找 `openclaw`。
3. **强启动校验**：检查 18789 端口或调用 `openclaw health`。**若失败，打印错误并退出。**
4. **版本握手**：记录并打印 `openclaw --version`。

## 3. 多级自愈流程 (Self-Healing Hierarchy)
当探测到服务异常（端口不通或 Health 检查失败）时，执行以下自愈逻辑：
- **Level 1 (Config Recovery)**：优先将 `openclaw.json.bak` 恢复至 `openclaw.json`。
- **Level 2 (Environment Recovery)**：若回滚失败，则执行 `openclaw doctor --fix`。
- **Level 3 (Process Restart)**：无论上述哪步，最后均执行 `openclaw gateway --force` 强行启动。

## 4. 告警策略 (Notification Strategy)
集成钉钉机器人 Webhook，在以下关键节点发送 Markdown 格式通知：
- **触发告警**：探测到服务宕机。
- **恢复成功**：成功自愈并上线。
- **严重故障**：多次尝试自愈均失败。

## 5. 配置规范 (.env)
```env
OPENCLAW_CONFIG_DIR="/Users/chenxiaolong/.openclaw"
CHECK_INTERVAL_SECONDS=30
HEALTH_PORT=18789
DINGDING_ENABLED=false
DINGDING_ACCESS_TOKEN=""
DINGDING_SECRET=""
LOG_FILE="./logs/guardian.log"
REPORT_DIR="./reports"
```
