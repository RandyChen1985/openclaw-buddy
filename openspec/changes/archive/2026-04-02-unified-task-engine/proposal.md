## Why

当前项目中，如“添加机器人”、“修改身份”、“删除机器人”等写操作均为同步阻塞模式。当底层 CLI 执行较慢时，前端请求会挂起，甚至触发网关超时。此外，异步任务（如网关重启、插件安装）缺乏统一的状态追踪和持久化审计机制，用户无法直观感知后台任务的实时进度与历史记录。

引入统一任务引擎（Unified Task Engine）旨在将所有耗时操作异步化，提供高可靠的任务追踪与实时反馈，提升运维确定感。

## What Changes

- **异步化重构**：将所有涉及 `openclaw` CLI 的写操作（Bots, Models, Plugins, Skills）从同步阻塞改为异步执行，立即返回 `taskID`。
- **任务持久化**：引入 SQLite `tasks` 表，记录任务的完整生命周期（Metadata, Status, Result）。
- **实时推送协议**：扩展 WebSocket 日志流，支持 `TASK_UPDATE` 类型的结构化 JSON 消息。
- **并发锁机制**：实现“模块级”并发控制，防止同一模块（如 Gateway）同时执行冲突任务。
- **超时与看门狗**：为每个后台任务配置 `context.WithTimeout`，自动回收超时的子进程资源。
- **UI 交互升级**：在前端引入非阻断式的“任务托盘”与进度通知气泡，取代现有的全屏遮罩。

## Capabilities

### New Capabilities
- `task-persistence`: 基于 SQLite 的后台任务生命周期管理与审计。
- `real-time-task-notification`: 基于 WebSocket 的结构化任务进度推送。
- `task-concurrency-control`: 模块级别的任务冲突与并发控制。
- `task-tray-ui`: 前端任务进度中心与全局状态感知通知。

### Modified Capabilities
- `gateway-control`: 从内存任务状态改为持久化任务流。
- `bot-lifecycle-management`: 创建、删除等操作全面接入异步任务引擎。

## Impact

- **后端**：`internal/process/tasks.go` 将进行大规模重构，引入数据库支持；API Handler 需调整响应逻辑。
- **前端**：`App.tsx` 的全局遮罩逻辑将逐步退役，引入全新的任务中心组件；WebSocket Hook 需支持解析 JSON 消息。
- **数据库**：新增 `tasks` 表。
