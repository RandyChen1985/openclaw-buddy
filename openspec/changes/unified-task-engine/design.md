## Context

当前 Buddy 的耗时操作处理分散在各个模块中，且大部分为同步调用。现有的 `internal/process/tasks.go` 仅实现了简单的内存管理，缺乏持久化和统一的反馈机制。随着功能的增加，系统需要一套更稳健的异步任务管理方案。

## Goals / Non-Goals

**Goals:**
- 将所有 `openclaw` 相关耗时操作转化为异步任务。
- 实现任务的持久化存储与历史审计。
- 提供基于 WebSocket 的实时任务进度与结果反馈。
- 实现模块级的任务互斥控制。
- 提供非阻断式的前端任务托盘 UI。

**Non-Goals:**
- 实现跨节点的分布式任务调度。
- 实现复杂的任务依赖链（DAG）。
- 对 OpenClaw 核心逻辑进行修改。

## Decisions

### 1. 存储方案：SQLite 任务表
在 `guardian.db` 中新增 `tasks` 表，用于存储任务全生命周期数据。
- **字段定义**：`id`, `module`, `action`, `target`, `status`, `progress`, `payload`, `result`, `error`, `start_time`, `end_time`。
- **Rationale**: 相比内存 map，数据库支持断电恢复，且能为未来的“审计日志”页面提供底层支持。

### 2. 通讯协议：WebSocket 结构化推送
扩展现有的日志 WebSocket 流，引入 JSON 消息格式。
- **消息格式**：
  ```json
  {
    "type": "TASK_UPDATE",
    "data": {
      "id": "t_123",
      "status": "running",
      "progress": 45,
      "message": "正在安装..."
    }
  }
  ```
- **Rationale**: 复用现有连接，减少前端连接开销，同时提供秒级反馈。

### 3. 并发控制：模块级互斥锁 (Module Lock)
在任务引擎中维护一个活跃任务注册表。执行任务前，先检查该 `Module` 是否已有 `Running` 状态的任务。
- **策略**：独占式（同一模块同一时间只能运行一个任务）。
- **Rationale**: 防止多个 API 同时对同一个机器人或网关状态进行修改，导致配置损坏。

### 4. 超时管理：Watchdog 机制
每个任务在创建时指定超时时间（默认 120s）。后台协程使用 `context.WithTimeout` 监控子进程。
- **超时动作**：杀掉进程组 -> 标记状态为 `Timeout` -> 释放模块锁。

## Risks / Trade-offs

- **[Risk] 数据库写竞争** → **[Mitigation]** 使用 SQLite 的事务机制或单线程写队列确保任务状态的一致性。
- **[Risk] WebSocket 连接断开导致通知丢失** → **[Mitigation]** 前端在重新连接后，自动请求一次 `/v1/tasks/active` 获取最新状态。
- **[Trade-off] 异步化增加前端逻辑复杂度** → 相比同步挂起，异步化能极大提升用户体验，这部分复杂度是值得的。
