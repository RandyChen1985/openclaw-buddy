# Audit Log Collector Capability

## Purpose
实现非侵入式的 OpenClaw 日志增量同步引擎，负责从底层 JSONL 日志中提取关键指标，并确保持续同步与过期数据的自动清理。

## Requirements

### Requirement: 增量日志采集引擎 (Incremental Log Collector)
系统必须实时、非侵入式地增量同步 OpenClaw 底层的 `.jsonl` 日志文件，确保能够捕获全渠道的审计信息。

#### Scenario: 监听日志目录变化
- **WHEN** 目录下 `~/.openclaw/agents/*/sessions/` 中新增或更新了 `.jsonl` 文件
- **THEN** 采集器必须自动检测到文件变动（每 1 分钟同步一次）

#### Scenario: 增量读取与断点续传
- **WHEN** 采集器读取 JSONL 记录后
- **THEN** 必须在 Buddy 本地数据库中记录最后处理的偏移量 (Offset)，并在系统重启后从该偏移量继续增量读取

### Requirement: 核心审计指标结构化入库 (Structured Storage)
采集器必须解析 JSONL 中的事件流，提取 Token 消耗、工具调用、系统指令执行等关键指标并存入本地数据库。

#### Scenario: 指标解析与分类
- **WHEN** 采集器处理一行日志记录时
- **THEN** 系统必须根据事件类型分类存储：
  - `type: "message"` 提取 Token 消耗（`usage`）及渠道信息
  - `type: "toolCall"` 提取工具/技能名称和参数
  - 提取原始指令内容、执行结果和安全风险等级

### Requirement: 7 天滚动清理策略 (7-Day TTL Policy)
为了控制资源占用，系统必须定期清理 Buddy 本地审计数据库中超过 7 天的旧记录。

#### Scenario: 自动清理旧数据
- **WHEN** 清理协程运行且发现记录的 `timestamp` 超过 7 天
- **THEN** 必须自动从审计表中执行物理删除操作

#### Scenario: 原始日志文件保护
- **WHEN** 清理操作执行时
- **THEN** 系统只能删除 Buddy 内部的审计数据库记录，严禁触碰或删除 OpenClaw 底层的 `.jsonl` 原始日志文件
