# 提案：重构为 Web 应用与 API 服务 (refactor-to-web-app)

## 为什么 (Why)

当前项目仅作为后台守护进程运行，缺乏直观的管理界面。用户无法方便地通过可视化方式监控 OpenClaw 的运行状态、查看统计信息，或在移动端进行重启等紧急操作。此外，OpenClaw 本身不提供 API 接口，限制了其与外部自动化运维系统的集成能力。

通过本次重构，我们将项目升级为一个功能完善的 Web 管理面板和 API 网关，提升运维效率和用户体验。

## 变更内容 (What Changes)

- **Web 应用化**: 引入 Gin 框架，将项目从纯守护进程转换为 Web Server。
- **API 接口化**: 提供标准的 RESTful API (`/v1/xx`)，封装 OpenClaw 的 CLI 操作。
- **安全认证**: 引入基于 Token 的身份验证机制。Token 存储在配置文件中，所有 API 接口及 Web 访问均需携带该 Token 进行校验。
- **可视化界面**: 构建响应式 Web Dashboard，支持 PC 和移动端。
- **结构化解析**: 增强对 OpenClaw CLI 输出的解析能力，将 ANSI/表格数据转化为结构化 JSON。
- **架构升级**: 采用 Web Server + Background Worker (Guardian) 的模式，保留并整合原有的自愈逻辑。
- **一键交付**: 继续保持单二进制文件交付模式，通过 Go `embed` 嵌入前端静态资源。

## 功能能力 (Capabilities)

### 新功能 (New Capabilities)
- `web-dashboard`: 适配移动端的响应式可视化管理界面。
- `api-gateway`: 将 OpenClaw CLI 命令封装为标准 RESTful API。
- `auth-management`: 基于静态 Token 的轻量级身份验证能力。
- `status-monitor`: 提供 OpenClaw 运行状态、版本、资源占用等结构化监控数据。
- `remote-control`: 支持通过 Web 界面安全地执行重启、停止、启动等控制操作。

### 修改功能 (Modified Capabilities)
- `guardian-worker`: 原有的健康检查与自愈逻辑将重构为后台异步工作线程。

## 影响 (Impact)

- **代码结构**: `cmd/guardian` 将更名为 `cmd/monitor`，新增 `internal/api` 和 `web/` 目录。
- **系统依赖**: 后端新增 Gin 等 Web 相关库，前端引入 React 及其工具链。
- **运行模式**: 占用端口将从无（或仅健康检查端口）变为固定的 Web 服务端口（默认 3000）。
- **交付产物**: 构建流程需要增加前端编译步骤。
