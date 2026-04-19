## ADDED Requirements

### Requirement: 查看执行策略状态
系统 SHALL 允许用户查看当前 OpenClaw 的执行策略状态，包括本地配置 (local config)、主机审批 (host approvals) 以及最终生效的合并策略 (effective merge)。

#### Scenario: 成功加载策略状态
- **WHEN** 用户打开安全管理面板
- **THEN** 系统通过 `openclaw exec-policy show` 获取数据并在界面上对比展示三层策略状态

### Requirement: 快速切换策略预设
系统 SHALL 提供预设 (Preset) 切换功能，允许用户一键应用 `YOLO`、`Cautious` 或 `Deny All` 预设。

#### Scenario: 切换为 YOLO 预设
- **WHEN** 用户在界面点击“应用 YOLO 预设”并确认
- **THEN** 系统执行 `openclaw exec-policy preset yolo` 并更新界面状态

### Requirement: 手动设置详细策略
系统 SHALL 允许用户显式设置 `ask` (on/off) 和 `security` (full/none) 参数。

#### Scenario: 开启指令询问
- **WHEN** 用户在设置中将 `ask` 选项设为 `on` 并保存
- **THEN** 系统执行 `openclaw exec-policy set --ask on` 并确认成功
