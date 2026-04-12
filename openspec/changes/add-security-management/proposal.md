## Why

OpenClaw 拥有强大的指令执行策略 (`exec-policy`) 和审批系统 (`approvals`)，但目前 OpenClaw Buddy 缺乏管理这些安全设置的图形界面。用户目前必须通过 CLI 手动切换安全预设或管理 Agent 白名单，这与 Buddy 提供全方位管理 GUI 的目标不符。

## What Changes

- **后端 API 封装**: 在 Go 后端增加对 `openclaw exec-policy` (show, preset, set) 和 `openclaw approvals` (allowlist, get, set) 的封装。
- **安全管理面板**: 在 Buddy UI 中新增“安全与访问控制”视图。
- **策略预设切换**: 实现 `YOLO`、`Cautious` 和 `Deny All` 预设的一键切换功能。
- **白名单管理**: 创建用于管理每个 Agent 指令允许列表的交互界面。
- **高级配置编辑**: 提供 JSON 编辑器，支持直接修改 `exec-approvals.json` 配置。

## Capabilities

### New Capabilities
- `security-policy-management`: 管理执行策略预设和全局安全配置。
- `exec-approval-interface`: 用于管理特定 Agent 的指令允许列表和权限的 UI 界面。

### Modified Capabilities
<!-- 目前没有需要修改的现有能力需求 -->

## Impact

- `internal/process/openclaw.go`: 新增调用安全相关 CLI 命令的方法。
- `internal/api/handlers.go`: 为前端新增对应的 API 接口。
- `web/src/views/SecurityManager.tsx`: 新的安全管理视图及导航集成。
