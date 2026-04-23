## Context

OpenClaw 系统目前缺乏一个全局的审计监控界面。由于 OpenClaw 是一个多渠道（飞书、微信、TG 等）的 Agent 平台，传统的流量拦截统计方式（在 Buddy 层做）会遗漏非 Buddy 渠道的数据。为了获取完整的审计信息，必须直接解析 OpenClaw 底层存储在 `~/.openclaw/agents/*/sessions/*.jsonl` 中的原始事件流日志。

## Goals / Non-Goals

**Goals:**
- **全局统计**：捕获全渠道（不仅仅是 Buddy）的 Token、工具和高危指令数据。
- **可视化审计**：集成 ECharts，提供直观的趋势图和热力图，支持按日期范围查询。
- **安全预警**：实时识别并列出包含危险关键词（如 `rm -rf`）的指令记录。
- **轻量化存储**：Buddy 本地 SQLite 存储解析后的聚合数据，且仅保留最近 7 天的记录。

**Non-Goals:**
- **修改 OpenClaw 核心日志**：本设计仅为“只读”读取原始 JSONL，严禁修改或删除原始日志文件。
- **实时流量分析**：不通过拦截实时 WebSocket 流量进行统计，而是通过读取磁盘上的事件记录。

## Decisions

### 1. 数据采集：Log Shipper 增量同步器 (Go)
- **方案**：在 `internal/analyzer/` 下引入一个后台协程，递归遍历 `~/.openclaw/agents/` 目录。
- **实现细节**：
  - 为每个 `.jsonl` 会话文件在数据库中记录一个 `offset`。
  - 使用 `io.Seek` 跳转到 `offset`，增量读取新行，解析后更新 `offset`。
  - **Rationale**：这种方式既能保证 Buddy 重启后不重复读取，又能实现接近实时的准实时同步（每 5-10 秒轮询一次或结合 fsnotify）。

### 2. 数据库设计：Buddy 本地 SQLite 审计表
- **`audit_usage`**: 存储 Token 消耗。字段：`agent_id`, `model_id`, `prompt_tokens`, `completion_tokens`, `timestamp`。
- **`audit_tool_calls`**: 存储工具调用。字段：`agent_id`, `tool_name`, `timestamp`。
- **`audit_security_events`**: 存储高危指令。字段：`agent_id`, `command`, `risk_level`, `timestamp`。
- **`audit_log_offsets`**: 存储日志读取进度。字段：`file_path`, `last_offset`。

### 3. 安全审计规则引擎
- **规则配置**：预置一个 `security_patterns` 正则表达式列表。
- **逻辑**：在解析 `type: "system_run_command"` 时，提取 `command` 字段，通过正则匹配。
- **分级**：匹配到 `rm`, `chmod`, `reboot` 等标记为 `high`。

### 4. 7 天滚动清理策略 (TTL)
- **实现**：后台 Worker 每 24 小时运行一次。
- **逻辑**：`DELETE FROM ... WHERE timestamp < datetime('now', '-7 days')`。

### 5. 前端 ECharts 适配 API
- **聚合接口**：提供 `/v1/audit/dashboard/summary?start=...&end=...` 接口。
- **聚合逻辑**：后端使用 SQL 的 `GROUP BY` 按天、按 Agent、按工具进行预聚合，返回符合 ECharts 数据格式的 JSON 数组（例如 `xAxis: [dates], series: [data]`）。

## Risks / Trade-offs

- **[Risk] 日志文件过多导致 IO 压力** → **Mitigation**: 仅处理 `.jsonl` 文件，且在增量同步间隙增加 Sleep，避免对宿主机造成高负载。
- **[Risk] SQLite 写入锁争用** → **Mitigation**: 使用 Write-Ahead Logging (WAL) 模式，并尽量在单个事务中批量写入解析出的多行记录。
- **[Trade-off] 实时性** → 为了系统稳定性，选择了“准实时”同步（可能有 5-10 秒延迟），这在审计场景下是可以接受的。
