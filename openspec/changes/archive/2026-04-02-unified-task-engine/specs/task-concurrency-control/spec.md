## ADDED Requirements

### Requirement: 模块级任务互斥锁
系统必须防止在同一模块上同时运行多个可能产生冲突的耗时任务。

#### Scenario: 同模块任务冲突拦截
- **WHEN** 用户在 `gateway` 模块已有运行中任务时触发另一个 `gateway` 动作
- **THEN** 系统拒绝请求并返回 `409 Conflict` 错误

#### Scenario: 跨模块任务并行执行
- **WHEN** 用户在 `bots` 模块任务运行期间触发 `plugins` 模块的任务
- **THEN** 系统允许两个任务并行执行并分别记录状态
