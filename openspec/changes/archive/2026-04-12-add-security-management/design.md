## Context

OpenClaw Buddy 作为一个 GUI 管理工具，目前缺少对 OpenClaw 核心安全策略的管理能力。用户在运行可能有风险的 Agent 指令时，只能通过命令行手动审批或修改 `exec-approvals.json`。本设计旨在将这些安全配置整合进 Buddy 的 **“安全中心”** 中。

## Goals / Non-Goals

**Goals:**
- 提供可视化 **“安全中心”** 界面。
- **简洁状态卡片**: 优先展示最终生效策略（Effective Policy），隐藏复杂的对比细节。
- **异步任务机制**: 所有写操作（Preset 切换、策略设置、白名单修改）均接入平台的异步任务系统，确保与 Bot 修改等操作体验一致。
- **Agent 联动**: 白名单管理直接读取并关联当前已安装的 Agent 列表。
- 支持高级用户直接编辑审批 JSON 配置。

**Non-Goals:**
- 实现超越 CLI 功能本身的自定义权限逻辑。

## Decisions

### 1. 后端封装：异步任务化
- **选择**: 在 `internal/api/handlers.go` 中，安全写操作将调用任务调度器（Scheduler/TaskCenter）创建一个后台任务。
- **理由**: 保持与平台一致的异步交互模式，避免 UI 阻塞，并利用现有的任务通知机制。

### 2. 前端展示：卡片式布局
- **设计**: 使用简洁的状态卡片展示 `ask`, `security` 等核心开关状态。
- **交互**: 提供“一键切换预设”大按钮，点击后触发异步任务并显示进度。

### 3. Agent 选择器
- **设计**: 在白名单编辑界面，不再让用户手动输入 ID，而是提供一个包含所有已注册 Agent 的选择列表（Select/Search）。

## Risks / Trade-offs

- **[Risk] 任务状态不一致** → **Mitigation**: 依赖现有的任务状态轮询/推送机制（`useTaskCenter`）确保 UI 实时更新。
- **[Risk] 术语理解门槛** → **Mitigation**: 在安全中心界面增加中文 Tooltips 解释。
