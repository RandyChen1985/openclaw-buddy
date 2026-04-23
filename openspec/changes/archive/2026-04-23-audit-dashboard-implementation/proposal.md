## Why

随着 OpenClaw 系统的深入使用，多渠道（飞书、微信、本地终端等）的 Agent 交互日益频繁。目前系统缺乏一个全局的、非侵入式的监控视角，导致难以精确追踪 Token 消耗（成本核算）、工具/Skill 使用频次以及危险 Shell 指令的执行情况。我们需要一个审计大屏来提供全渠道的透明度，确保系统的经济性、合规性和安全性。

## What Changes

- 引入一个轻量级的旁路日志采集器（Log Shipper），实时增量读取 OpenClaw 底层 `~/.openclaw/agents/*/sessions/*.jsonl` 日志文件。
- 在 Buddy 端引入本地审计数据库（如 SQLite），结构化存储解析后的 Token、工具调用和高危操作数据。
- 实现审计数据的 7 天滚动清理策略（TTL），以控制存储资源占用。
- 提供多维度的统计查询 API（支持按时间范围、按 Agent、按渠道、按模型、按工具聚合）。
- 前端集成 **ECharts** 图表库，构建可视化审计大屏，支持趋势折线图、调用分布饼图和高危操作实时告警列表。

## Capabilities

### New Capabilities
- `audit-dashboard`: 提供全渠道视角的系统使用情况大屏，包含成本监控、工具热力图、高危操作审计，支持按自定义日期维度查询，前端可视化基于 ECharts 渲染。
- `audit-log-collector`: 非侵入式的 JSONL 日志增量同步引擎，带 7 天数据自动清理（TTL）机制。

### Modified Capabilities


## Impact

- **架构层面**：完全旁路设计，不侵入现有 OpenClaw 核心链路或 Buddy 的 WebSocket 代理链路，保证主干高可用。
- **存储层面**：Buddy 所在机器的磁盘 IO 将有轻微增加（日志解析与数据库写入），SQLite 将新增若干审计数据表。
- **前端依赖**：项目中需要引入 ECharts 库用于复杂图表渲染。