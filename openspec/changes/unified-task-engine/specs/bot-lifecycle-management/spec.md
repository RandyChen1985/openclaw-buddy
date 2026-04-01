## ADDED Requirements

### Requirement: 机器人生命周期操作异步化
机器人的创建、删除以及核心配置修改（SOUL/Identity）必须接入异步任务引擎。

#### Scenario: 批量专家克隆任务
- **WHEN** 用户从专家市场克隆大型模板
- **THEN** 任务引擎展示每个子阶段（创建目录、写入 SOUL、注入 Identity）的进度描述
