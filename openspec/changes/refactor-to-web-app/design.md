# 设计文档：重构为 Web 应用与 API 服务 (refactor-to-web-app)

## 背景 (Context)

当前项目是一个 Go 编写的后台守护进程，通过 `os/exec` 调用 OpenClaw CLI 并进行健康检查。重构目标是将其转变为一个具备 Web UI 和 API 接口的完整管理工具。

## 目标与非目标 (Goals / Non-Goals)

**目标:**
- **Web 应用化**: 引入 Gin 框架提供 RESTful API 和静态资源托管。
- **Token 认证**: 实现基于静态 Token 的 API 和 Web 访问控制。
- **SQLite 持久化**: 记录健康检查历史和自愈记录，用于前端图表展示。
- **响应式 UI**: 使用 React + Ant Design 构建适配移动端的 Dashboard。
- **CLI 增强解析**: 实现对 OpenClaw CLI 输出（ANSI/表格）的结构化解析。
- **自动化构建**: 更新构建脚本，支持前端编译与后端打包的整合。

**非目标:**
- **多用户管理**: 本次重构不实现复杂的 RBAC 权限系统，仅使用单 Token 认证。
- **配置文件在线编辑**: 飞书配置等敏感信息仍保留在 `.env` 中，不支持 Web 端修改。
- **全量日志存储**: SQLite 仅存储结构化事件，不存储全量文本日志。

## 技术决策 (Decisions)

### 1. 架构模式：Web Server + Background Worker
- **决策**: 采用单进程多协程模式。主协程运行 Gin Web Server，后台协程运行原有的 Guardian 巡检逻辑。
- **理由**: 保持部署简单，减少进程间通信开销。

### 2. 数据库：SQLite 3
- **决策**: 使用 `modernc.org/sqlite` (无 CGO 依赖) 作为持久化方案。
- **理由**: 保持 Go 的交叉编译便捷性，且足以支持监控数据的存储。
- **表结构预览**:
  - `health_checks`: 记录每次巡检的时间、状态、响应时间。
  - `heal_events`: 记录自愈触发的原因、采取的措施、最终结果。

### 3. 前端方案：React + Vite + AntD 5.0 + Tailwind
- **决策**: 前端代码位于 `web/` 目录，通过 Vite 构建。生产环境下，构建产物通过 Go `embed` 嵌入二进制文件。
- **理由**: 极简的单文件分发体验，AntD 5.0 的 `configProvider` 易于适配移动端。

### 4. 认证：静态 Token 中间件
- **决策**: 在 Gin 中实现一个全局中间件，校验 `Authorization: Bearer <token>` 头部。Web 端在首次登录后将 Token 存储在 `localStorage` 中。
- **理由**: 实现简单且能有效防止未授权访问。

### 5. CLI 解析方案：正则表达式 + ANSI 过滤
- **决策**: 使用正则表达式过滤 `\x1b[[0-9;]*m` 等 ANSI 码。针对表格数据（如 `openclaw status`），按行切分并根据 `│` 符号进行字段提取。
- **理由**: OpenClaw 官方目前无 API，这是目前最稳健的解析方式。

## 风险与权衡 (Risks / Trade-offs)

- **[风险] CLI 输出变化**: OpenClaw 版本更新可能导致 CLI 输出格式变化，进而破坏解析逻辑。
  - **缓解**: 在 `internal/process` 中增加详细的错误日志和降级处理（无法解析时返回原始文本）。
- **[权衡] 单 Token 安全性**: 如果 Token 泄露，则拥有全部控制权。
  - **缓解**: 建议用户在 `.env` 中设置复杂的随机字符串，并配合 HTTPS 使用。
- **[风险] 内存占用**: 嵌入前端资源会略微增加二进制文件大小（约 2-5MB）。
  - **缓解**: 对于企业级管理工具，这在可接受范围内。

## 构建计划 (Build Plan)

1.  `web/` 目录下执行 `npm run build`。
2.  构建产物输出到 `internal/ui/dist`。
3.  Go 后端使用 `//go:embed internal/ui/dist/*` 引用资源。
4.  `go build` 生成最终二进制。
