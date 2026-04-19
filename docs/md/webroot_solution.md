# OpenClaw Buddy 全站 WebRoot 动态配置技术方案

## 1. 背景与目标
在多级子目录部署（如反向代理到 `/buddy/` 路径）或 PWA 环境下，前端资源加载和 API 请求常因路径不匹配（404）或认证失效而崩溃。
**目标**：实现全站路径的“单一事实来源（Single Source of Truth）”，通过环境变量 `WEB_ROOT` 动态驱动前后端，无需重新打包即可适配任意部署路径。

---

## 2. 后端实现 (Golang)

### 2.1 配置读取
- **文件**: `internal/config/config.go`
- **逻辑**: 从 `WEB_ROOT` 环境变量读取配置。自动进行规范化处理（确保以 `/` 开头，且非根路径时不带尾斜杠）。

### 2.2 路由分组与静态分发
- **文件**: `internal/api/router.go`
- **核心机制**:
    - **路由分组**: 使用 `engine.Group(config.WebRoot)` 将所有 API 接口（如 `/v1/...`）挂载到子路径下。
    - **动态注入 (renderIndexHTML)**: 
        - 统一拦截 `index.html` 的分发（包括根路径和 SPA 路由刷新时的 `NoRoute` 回退）。
        - 在运行时向 HTML 注入 `<script>`：对 `window.__WEB_ROOT__` 与（Wails 桌面端用的）`window.__BUDDY_API_BASE__` 赋值，二者均经 **JSON 编码** 写入，避免引号转义问题；`__BUDDY_API_BASE__` 含本机 `WEB_PORT` 与 `WEB_ROOT` 路径前缀（如 `http://127.0.0.1:3000/your-path`）。
        - **资源修复**: 自动扫描并替换 HTML 中的 `src="/`, `href="/`, `action="/`, `content="/` 前缀，确保即使构建时 `base` 为 `/`，运行时也能正确指向子目录。

---

## 3. 前端实现 (React/TypeScript)

### 3.1 运行时基准获取
- **文件**: `web/src/utils/url.ts`
- **逻辑**: 浏览器下 `getBaseURL()` 优先读 `window.__WEB_ROOT__`（后端注入），其次 `import.meta.env.BASE_URL`，最后回退 `/`。**Wails 生产包**优先读 `window.__BUDDY_API_BASE__`（与 `WEB_PORT`/`WEB_ROOT` 一致），避免写死端口。

### 3.2 统一 API 请求 (Axios)
- **文件**: `web/src/api/index.ts`
- **拦截器**: 
    - `request` 拦截器自动根据 `getBaseURL()` 为所有以 `/` 开头的相对路径补全前缀。
    - 确保 `Authorization` 头部在任何路径下都能随请求正确发送。

### 3.3 特殊处理：打字机聊天流 (SSE)
- **文件**: `web/src/views/OnlineChat.tsx`
- **说明**: 
    - 聊天页面由于需要处理 `ReadableStream`（打字机效果），使用了原生 `fetch` 而非 Axios。
    - **对齐方案**: 显式调用 `api` 模块导出的 `getFullUrl()` 助手函数来生成完整的请求 URL。这保证了即使外壳是 `fetch`，其路径识别算法与全站 Axios 实例是 100% 物理一致的。

### 3.4 运维终端与日志 (WebSocket)
- **机制**: 调用 `getWsUrl()` 助手函数，自动根据 `window.__WEB_ROOT__` 生成正确的 `ws://` 或 `wss://` 协议地址。

---

## 4. 维护与扩展规范

1. **新增页面/组件**:
    - 尽量使用 `api.get/post`。
    - 如果必须使用 `<a>` 标签或图片，尽量引用资产并通过 `getBaseURL() + path` 拼接。
2. **部署建议**:
    - 在 `env` 或 `.env` 中设置 `WEB_ROOT=/your-sub-path`。
    - 若使用 Nginx，请确保访问子路径时能够正确代理到 Buddy 的 Web 端口。

---
*本文档由 Antigravity 自动生成，记录于 2026-04-01 重构版本。*
