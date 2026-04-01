## ADDED Requirements

### Requirement: WebSocket 实时任务通知
系统必须通过现有的 WebSocket 隧道向前端推送结构化的任务状态更新。

#### Scenario: 任务进度实时推送
- **WHEN** 后台任务产生关键进度（如 50%）或状态变更
- **THEN** 系统发送 `type: "TASK_UPDATE"` 的 JSON 消息至所有已连接的客户端

#### Scenario: 结构化消息格式校验
- **WHEN** 前端收到任务更新消息
- **THEN** 消息必须包含 `id`, `status`, `progress` 和描述信息 `message`
