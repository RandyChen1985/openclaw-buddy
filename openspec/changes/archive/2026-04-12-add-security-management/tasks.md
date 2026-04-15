## 1. 后端封装与任务集成 (Backend & Task Integration)

- [x] 1.1 在 `internal/process/openclaw.go` 中新增 `ExecPolicyShow` 函数，解析 `openclaw exec-policy show` 输出。
- [x] 1.2 在任务调度系统（Task System）中注册新的任务动作：`security:set-policy`, `security:apply-preset`, `security:update-allowlist`。
- [x] 1.3 实现具体的任务处理器，异步调用 `openclaw` 安全相关 CLI 命令。
- [x] 1.4 新增获取“全量 Agent 映射列表”的 API，供安全中心选择器使用。

## 2. API 层 (API Layer)

- [x] 2.1 实现 `GetSecurityStatus` 接口，返回当前策略和白名单快照。
- [x] 2.2 实现 `TriggerSecurityTask` 接口，接收修改请求并返回 `taskID`。
- [x] 2.3 在 `internal/api/handlers.go` 中完善与前端的任务通讯逻辑。

## 3. 前端视图开发 (Frontend Views)

- [x] 3.1 创建 `web/src/views/SecurityManager.tsx` 基础框架，并支持国际化翻译（安全中心）。
- [x] 3.2 实现 **策略卡片 (Policy Cards)**：简洁展示当前生效状态，支持一键切换预设（触发异步任务）。
- [x] 3.3 实现 **白名单选择器 (Allowlist with Agent Selector)**：集成现有 Agent 列表，支持搜索和选择 Agent 后管理其白名单。
- [x] 3.4 接入 `useTaskCenter`，在安全中心显示相关任务的进度和结果。

## 4. 导航与 UI 集成 (UI Integration)

- [x] 4.1 在 `web/src/App.tsx` 中注册 `security` 视图，并处理任务中心的回调逻辑。
- [x] 4.2 在 `web/src/components/layout/Sidebar.tsx` 中增加“安全中心”入口，图标使用 `ShieldCheck`，位置在“专家市场”后。

## 5. 测试与验证 (Verification)

- [x] 5.1 验证一键切换 `YOLO` 模式是否生效（通过 `openclaw exec-policy show` 确认）。
- [x] 5.2 验证在 UI 上添加 Agent 白名单后，后端 `exec-approvals.json` 是否同步更新。
- [x] 5.3 验证 JSON 编辑器的导入/导出功能。
- [x] 5.4 更新 `tests/CHECKLIST.md` 中的自动化测试清单。
