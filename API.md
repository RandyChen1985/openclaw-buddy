# 🦞 OpenClaw Buddy 全量 API 开发者参考方案

本集成文档详细描述了 **OpenClaw (小龙虾)** 监控系统的所有对外 API 接口（共 40+ 个），旨在帮助开发者集成、监控以及自动化管理自己的 Agent 集群。

---

## 🔐 1. 基础规范 (Base Specification)

### 1.1 鉴权指南 (Authentication)
除公开路径外，所有 API 请求均需通过 Bearer Token 进行验证。
- **Header**: `Authorization: Bearer <TOKEN>`
- **Cookie (可选)**: `guardian_token=<TOKEN>`

### 1.2 响应约定 (Response Convention)
除特殊透传接口（如 AI 聊天流、面板代理、WebSocket）外，所有业务接口统一返回以下 JSON 结构：

```json
{
  "code": 200,        // 业务状态码，200 表示成功
  "message": "success", // 状态描述或错误信息
  "data": { ... }      // 业务数据负载（可选）
}
```

- **HTTP 200/201/202**: 请求成功，且返回体中 `code` 为 200/202。
- **HTTP 400/401/403/500**: 请求失败，返回体中 `code` 与 HTTP 状态码一致，`message` 包含错误详情。

---

## 🔌 2. 基础与认证 (Base & Auth)

### 2.1 健康检查 (Health Check)
用于检测 Buddy 服务本身的存活状态。
- **路径**: `/health`
- **方法**: `GET`
- **响应示例**:
  ```json
  {
    "code": 200,
    "message": "success",
    "data": { "status": "ok" }
  }
  ```

### 2.2 用户登录认证 (Login)
提交令牌获取 Cookie 凭证。
- **路径**: `/login`
- **方法**: `POST`
- **请求体**: `{"token": "string"}`
- **响应示例**:
  - 成功 (200): `{ "code": 200, "message": "success" }`
  - 失败 (401): `{ "code": 401, "message": "Invalid token" }`

---

## 📊 3. 系统状态与统计 (Status & Stats)

### 3.1 获取网关详细运行数据 (Structured Status)
获取网关版本、CPU/内存占用、工作区磁盘、心跳时间戳、运行时长等。
- **路径**: `/v1/openclaw/status`
- **方法**: `GET`
- **响应示例 (200)**:
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "version": "1.2.0",
      "status": "Running",
      "uptime": "2d 4h 12m",
      "cpuPercent": 1.2,
      "memoryMB": 128.5,
      "diskUsagePercent": 45.2,
      "installedAt": "2026-03-20 10:00:00",
      "health": "Healthy"
    }
  }
  ```

### 3.2 获取面板访问地址 (Dashboard URL)
- **路径**: `/v1/openclaw/dashboard-url`
- **方法**: `GET`
- **响应**: `{ "code": 200, "message": "success", "data": { "url": "..." } }`

### 3.3 24小时健康度趋势统计 (Health History)
- **路径**: `/v1/stats/health`
- **方法**: `GET`
- **响应**: `{ "code": 200, "message": "success", "data": [ { "timestamp": "...", "status": "ok", "response_time_ms": 45 } ] }`

---

## 🤖 4. 虾兵蟹将 (Bots & Models)

### 4.1 获取机器人与模型资产清单 (Asset Inventory)
- **路径**: `/v1/openclaw/bots-models`
- **方法**: `GET`
- **Query**: `refresh=true` (强制同步配置文件)
- **响应 (200)**:
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "data": {
        "bots": [{"id": "main", "name": "核心Bot", "model": "yovole/glm-5", "workspace": "..."}],
        "models": [{"id": "yovole/glm-5", "name": "GLM-5", "isDefault": true}]
      },
      "updated_at": "2026-03-28 10:00:00"
    }
  }
  ```

### 4.2 机器人管理 (Bot Operations)
| 动作 | 路径 | 方法 | 请求体 | 响应 Data 示例 |
| :--- | :--- | :--- | :--- | :--- |
| 添加 Bot | `/v1/openclaw/bots/add` | POST | `{"id": "bot_1", "model": "...", "workspace": "..."}` | `{"status": "success", "message": "创建成功"}` |
| 更新配置 | `/v1/openclaw/bots/update` | POST | `{"id": "bot_1", "config": {...}}` | `{"status": "success", "message": "配置已更新"}` |
| 修改名称 | `/v1/openclaw/bots/set-identity` | POST | `{"id": "bot_1", "name": "New Name"}` | `{"status": "success", "message": "名称修改成功"}` |
| 修改模型 | `/v1/openclaw/bots/set-model` | POST | `{"id": "bot_1", "model": "model_id"}` | `{"status": "success", "message": "模型修改成功"}` |
| 删除 Bot | `/v1/openclaw/bots/delete` | POST | `{"id": "bot_1"}` | `{"status": "success", "message": "机器人已彻底移除"}` |
| 读取文件 | `/v1/openclaw/bots/file` | GET | `?id=bot_1` | `{"content": "...json content..."}` |
| 保存文件 | `/v1/openclaw/bots/file` | POST | `{"id": "bot_1", "content": "..."}` | `{"status": "success"}` |

### 4.4 专家市场与模板 (Expert Market)
- **获取模板列表 (GET)**: `/v1/openclaw/experts` -> 返回预设的机器人专家配置及其元数据。
- **模板克隆 (POST)**: `/v1/openclaw/bots/template`
  - **Body**: `{"expertId": "architect", "newBotId": "my_dev_lead"}`
  - **响应**: 一键初始化一个具备特定能力的机器人。

---

## 💬 5. 在线聊天与会话 (Chat & Sessions)

### 5.1 OpenAI 兼容流式对话接口 (Proxy)
- **路径**: `/v1/openclaw/chat/completions`
- **方法**: `POST`
- **Body**: 标准 OpenAI 格式。
- **鉴权**: 自动追加网关 Token。

### 5.2 聊天状态与功能管理
- **查询功能开启状态 (GET)**: `/v1/openclaw/chat/status` -> `{ "enabled": true }`
- **开启聊天功能 (POST)**: `/v1/openclaw/chat/enable` (需重启生效) -> `{ "status": "success", "message": "聊天功能已开启，请重启网关" }`

### 5.3 快捷指令管理 (Quick Commands)
- **获取列表 (GET)**: `/v1/openclaw/chat/quick-commands`
- **添加 (POST)**: `/v1/openclaw/chat/quick-commands` -> `{ "id": 1, "status": "success" }`
- **删除 (DELETE)**: `/v1/openclaw/chat/quick-commands/:id`

---

## 🕹️ 6. 技能与插件 (Skills & Plugins)

### 6.1 技能管理 (Skills)
- **清单获取 (GET)**: `/v1/openclaw/skills`
- **卸载 (DELETE)**: `/v1/openclaw/skills/:name`
- **热重载 (POST)**: `/v1/openclaw/skills/reload`

### 6.2 插件管理 (Plugins)
底层插件（如 WeChat, Telegram）的生命周期管理：
- **获取插件列表 (GET)**: `/v1/openclaw/plugins`
- **开启插件 (POST)**: `/v1/openclaw/plugins/enable` -> `{"id": "wechat-control"}`
- **禁用插件 (POST)**: `/v1/openclaw/plugins/disable`
- **重载插件 (POST)**: `/v1/openclaw/plugins/reload`
- **更新插件 (POST)**: `/v1/openclaw/plugins/update`

---

## 🚀 7. 网关生命周期控制 (Gateway Control)

### 7.1 启动/停止/重启
- **路径**: `/v1/gateway/{action}` (action: `start`, `stop`, `restart`)
- **方法**: `POST`
- **异步响应示例 (202)**:
  ```json
  {
    "code": 202,
    "message": "Restart command initiated",
    "data": { "taskID": "task-1774656000" }
  }
  ```

---

## 🩺 8. 系统监控与审计 (System & Audit)

### 8.1 负载监控 (Server Info)
实时获取服务器硬件状态。
- **路径**: `/v1/system/info`
- **方法**: `GET`
- **响应 Data**:
  ```json
  {
    "cpu": {"usage": 15.5, "cores": 8},
    "memory": {"total": 16384, "used": 4096, "percent": 25.0},
    "disk": {"path": "/", "percent": 60.5},
    "os": "linux",
    "arch": "amd64"
  }
  ```

### 8.2 审计日志与事件 (Events)
追踪用户通过 Buddy 执行的所有敏感操作。
- **路径**: `/v1/system/events`
- **方法**: `GET`
- **响应 Data**: `[{"time": "...", "user": "admin", "action": "restart_gateway", "status": "success"}]`

---

## 🔌 9. 渠道集成与流通信 (Channels & Streams)

### 9.1 微信集成专项
- **获取登录二维码 (GET)**: `/v1/wechat/qrcode` -> 支持 SSE 模式或单次获取。
- **查询配置状态 (GET)**: `/v1/wechat/config/status` -> 返回微信绑定的 AppID、状态位及同步时间。

### 9.2 WebSocket 实时通信
Buddy 提供了多个 WebSocket 挂载点以实现极低延迟的交互：
- **日志订阅 (`/v1/ws/logs`)**: 实时推送 `.log` 文件行，适配前端 Xterm.js。
- **终端交互 (`/v1/ws/tui`)**: 提供完整的 PTY 映射，允许在浏览器内直接操作 OpenClaw 终端。
- **远程 Shell (`/v1/ws/shell`)**: (受限模式) 允许执行特定维护命令。

### 9.3 龙虾面板反向代理 (Proxy)
- **路径**: `/v1/proxy/*path`
- **原理**: 剥离 `X-Frame-Options` 等响应头，并自动追加 `Authorization` 透传给本地 18789 端口。

---

## 🛠️ Curl 执行范例 (Template)
```bash
# 修改机器人模型示例
curl -X POST http://localhost:3000/v1/openclaw/bots/set-model \
  -H "Authorization: Bearer openclaw-buddy-2026" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "main",
    "model": "yovole/glm-5"
  }'

# 响应结果
# { 
#   "code": 200, 
#   "message": "success", 
#   "data": { "status": "success", "message": "机器人默认模型修改成功" } 
# }
```

### 1.14 模型连通性直连测试 (TTFT)
由于浏览器跨域限制，此测试由监控后端发起，直接调用提供商的 `baseUrl/chat/completions` 以测量真实网络延迟。

- **URL**: `/v1/openclaw/models/test-direct`
- **Method**: `POST`
- **Auth**: `Bearer <token>`
- **Request Body**:
  ```json
  {
    "providerName": "aliyun",
    "modelId": "qwen3.5-plus"
  }
  ```
- **Response**:
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "latency": 450,
      "status": "success"
    }
  }
  ```
```
