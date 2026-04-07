## ADDED Requirements

### Requirement: 任务数据持久化存储
系统必须在 SQLite 数据库中维护 `tasks` 表，用于记录所有耗时异步任务的状态和结果。

#### Scenario: 任务初始化记录
- **WHEN** 用户触发异步动作（如安装插件）
- **THEN** 系统立即在 `tasks` 表中插入一条状态为 `Running` 的记录并分配唯一 ID

#### Scenario: 任务结果回写
- **WHEN** 后台任务协程执行完毕
- **THEN** 系统自动更新该记录的 `status`, `result` 以及 `end_time` 字段

#### Scenario: 系统重启后的孤儿任务处理
- **WHEN** Buddy 系统启动并检测到数据库中有 `Running` 状态的任务
- **THEN** 系统自动将其状态更新为 `Interrupted` 以释放模块锁定
