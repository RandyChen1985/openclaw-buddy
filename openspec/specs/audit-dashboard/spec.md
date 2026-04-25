# Audit Dashboard Capability

## Purpose
提供一个集中的审计大屏，以可视化方式展示 OpenClaw 全渠道的使用情况，包括 Token 消耗、工具/Skill 调用分布以及高危指令执行日志，旨在提升系统的透明度、合规性和安全性。

## Requirements

### Requirement: 全维度审计视图 (Full Audit Dashboard)
系统必须提供一个集中的审计大屏，以可视化方式展示 OpenClaw 全渠道的使用情况，包括 Token 消耗、工具/Skill 调用分布以及高危指令执行日志。

#### Scenario: 仪表盘核心指标展示
- **WHEN** 用户进入审计大屏页面
- **THEN** 系统必须展示“总 Token 消耗”、“总会话数”和“已拦截/标记的高危指令数”三个核心指标卡片

#### Scenario: ECharts 可视化图表渲染
- **WHEN** 数据加载完成后
- **THEN** 系统必须通过 ECharts 渲染：
  - 一个展示 Token 消耗随时间波动的**折线图**
  - 一个展示工具与技能（Tools/Skills）调用频次分布的**饼图或柱状图**
  - 一个展示不同 Agent 活跃度的统计图表

### Requirement: 按日期范围过滤统计数据 (Date Range Filtering)
审计大屏必须允许用户按自定义日期范围（起始日期和结束日期）对所有统计指标进行过滤。

#### Scenario: 按指定日期查询
- **WHEN** 用户在日期选择器中选择特定时间段
- **THEN** 大屏上所有的 ECharts 图表和统计数字必须立即更新为该时间段内的聚合数据

### Requirement: 高危指令审计流水 (Security Audit Trail)
系统必须实时列出所有触发安全规则的操作记录，重点关注 Shell 指令的执行情况。

#### Scenario: 审计日志追溯与详情查看
- **WHEN** 用户选择特定日期并查看审计流水
- **THEN** 系统必须列出操作记录，包括：Agent 名称、执行的原始指令字符串（支持点击查看完整详情）、执行路径、时间戳以及安全风险等级（高/低）
