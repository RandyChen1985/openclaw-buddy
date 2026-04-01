## ADDED Requirements

### Requirement: 异步网关控制
网关的启动、停止和重启指令必须完全接入异步任务引擎。

#### Scenario: 启动网关任务化
- **WHEN** 用户点击“启动网关”
- **THEN** 后端立即返回任务 ID，并在后台执行 `openclaw gateway start`

#### Scenario: 停止网关的强制回退
- **WHEN** 正常停止指令超时
- **THEN** 任务引擎自动尝试强制停止（Force Stop）并更新任务结果为 `Completed (with force)`
