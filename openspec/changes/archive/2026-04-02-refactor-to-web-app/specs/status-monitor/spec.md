## ADDED Requirements

### Requirement: 结构化状态监控 (Structured Status Monitoring)
系统必须实时监控并展示 OpenClaw 的运行状态，包括 Gateway、Plugins、Channels 的实时数据。

#### Scenario: 查询结构化状态
- **WHEN** 客户端 GET 请求 `/v1/openclaw/status`
- **THEN** 系统解析 `openclaw status` 输出并返回 JSON，包含 Gateway PID、Runtime 以及各插件的 Online 状态。

### Requirement: 历史健康统计 (Historical Health Statistics)
系统必须利用 SQLite 记录巡检数据，并展示过去 24 小时的健康率。

#### Scenario: 获取历史统计数据
- **WHEN** 客户端 GET 请求 `/v1/stats/health`
- **THEN** 系统返回过去 24 小时每 5 分钟的健康百分比分布图数据。
