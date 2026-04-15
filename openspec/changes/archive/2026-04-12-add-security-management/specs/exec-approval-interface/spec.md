## ADDED Requirements

### Requirement: 管理代理指令白名单
系统 SHALL 允许用户查看和编辑每个 Agent 的指令执行允许列表 (Allowlist)。

#### Scenario: 成功加载 Agent 允许列表
- **WHEN** 用户在“执行审批管理”中选择一个 Agent
- **THEN** 系统通过 `openclaw approvals allowlist get --agent <id>` 获取其当前允许的指令模式并展示

### Requirement: 更新代理指令权限
系统 SHALL 支持添加、修改或删除特定 Agent 的指令模式。

#### Scenario: 添加新的指令模式
- **WHEN** 用户为一个 Agent 输入 `npm install *` 并点击保存
- **THEN** 系统执行 `openclaw approvals allowlist add --agent <id> --pattern "npm install *"` 并确认成功

### Requirement: 全量审批文件管理
系统 SHALL 提供高级选项，允许用户直接查看和替换整个 `exec-approvals.json` 文件内容。

#### Scenario: 导出审批快照
- **WHEN** 用户点击“导出当前审批快照”
- **THEN** 系统执行 `openclaw approvals get` 并将 JSON 内容展示或提供下载
