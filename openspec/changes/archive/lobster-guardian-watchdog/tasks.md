# 任务列表：OpenClaw 守护者 (Lobster Guardian)

## 🚩 阶段一：环境搭建与启动自检 (Bootstrap)
- [x] **任务 1.1: Go 项目初始化**
  - 初始化 `go mod init yovole-openclaw-monitor`。
- [x] **任务 1.2: 实现单例锁 (PID File Lock)**
  - 实现对 `/tmp/lobster-guardian.pid` 的文件锁。
- [x] **任务 1.3: 实现环境探测与强启动校验**
  - 检查 `PATH` 中的 `openclaw` 二进制文件。
  - 检查端口与 `health` 状态。

## 🚩 阶段二：核心监控引擎 (Monitoring Engine)
- [x] **任务 2.1: 基础配置加载**
  - 支持 `.env` 文件加载环境变量。
- [x] **任务 2.2: 实现巡检循环 (The Loop)**
  - 30 秒一次的监控主循环，并支持优雅退出信号处理。

## 🚩 阶段三：故障诊断与自愈 (Self-Healing)
- [x] **任务 3.1: 配置差异分析 (Analyzer)**
  - 生成 `fault_report_<timestamp>.md` 差异报表。
- [x] **任务 3.2: 多级自愈逻辑**
  - 实现配置回滚、`openclaw doctor --fix`、强制重启。
- [x] **任务 3.3: 钉钉告警系统**
  - 增加钉钉机器人 Webhook 推送功能，支持加签。

## 🚩 阶段四：收尾与测试 (Finalization)
- [x] **任务 4.1: 实现优雅退出**
  - 信号处理与 PID 锁释放。
- [x] **任务 4.2: 编写 Makefile & 打包脚本**
  - 提供 `build_release.sh` 和 `Makefile`。
