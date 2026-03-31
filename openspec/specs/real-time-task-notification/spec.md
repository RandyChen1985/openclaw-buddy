# 规格：实时任务通知 (real-time-task-notification)

## 需求说明
当后台任务状态发生变化或进度更新时，系统应通过 WebSocket 实时推送给前端，无需前端轮询。

## 通讯协议
1. **消息类型**：`TASK_UPDATE`。
2. **消息体 (JSON)**：
   - `id`: 任务 ID
   - `status`: 状态 (Running, Completed, Failed, Timeout)
   - `progress`: 0-100 的数值
   - `message`: 当前阶段的文本描述
3. **心跳机制**：推送过程中应保持连接活跃。

## 验收标准
- [ ] 前端通过 WebSocket 收到 `type: "TASK_UPDATE"` 格式的消息。
- [ ] 后端在任务执行的关键节点（启动、完成、报错）均触发推送。
- [ ] 多个任务并行时，消息 ID 能够正确对应。
