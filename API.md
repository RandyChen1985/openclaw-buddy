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
| 添加 Bot | `/v1/openclaw/bots/add` | POST | `{"id": "bot_1", "model": "...", "workspace": "..."}` | `{"code": 200, "message": "success", "data": {"status": "success", "message": "创建成功"}}` |
| 修改名称 | `/v1/openclaw/bots/set-identity` | POST | `{"id": "bot_1", "name": "New Name"}` | `{"code": 200, "message": "success", "data": {"status": "success", "message": "名称修改成功"}}` |
| 修改模型 | `/v1/openclaw/bots/set-model` | POST | `{"id": "bot_1", "model": "model_id"}` | `{"code": 200, "message": "success", "data": {"status": "success", "message": "模型修改成功"}}` |
| 删除 Bot | `/v1/openclaw/bots/delete` | POST | `{"id": "bot_1"}` | `{"code": 200, "message": "success", "data": {"status": "success", "message": "机器人已彻底移除"}}` |

### 4.3 模型与渠道管理 (Models & Providers)
- **获取渠道配置 (GET)**: `/v1/openclaw/models/config` -> `{ "code": 200, "message": "success", "data": { "providers": [...] } }`
- **新增渠道 (POST)**: `/v1/openclaw/models/provider`
  - **Body**: `{"name": "deepseek", "config": {"baseUrl": "...", "apiKey": "..."}}`
  - **响应**: `{ "code": 200, "message": "success", "data": { "status": "success", "message": "提供商已添加" } }`
- **向渠道追加模型 (POST)**: `/v1/openclaw/models/provider/model`
  - **Body**: `{"provider_name": "...", "model_config": {"id": "...", "name": "..."}}`
  - **响应**: `{ "code": 200, "message": "success", "data": { "status": "success", "message": "模型已添加" } }`
- **删除特定模型 (DELETE)**: `/v1/openclaw/models/provider/model` -> `{ "code": 200, "message": "success" }`
- **设定全局默认模型 (POST)**: `/v1/openclaw/models/set-default` -> `{ "code": 200, "message": "success" }`

---

## 💬 5. 在线聊天与会话 (Chat & Sessions)

### 5.1 OpenAI 兼容流式对话接口 (Proxy)
- **路径**: `/v1/openclaw/chat/completions`
- **方法**: `POST`
- **Body**: 标准 OpenAI 格式。
- **鉴权**: 自动追加网关 Token。

### 5.2 聊天状态与功能管理
- **查询功能开启状态 (GET)**: `/v1/openclaw/chat/status` -> `{ "code": 200, "message": "success", "data": { "enabled": true } }`
- **开启聊天功能 (POST)**: `/v1/openclaw/chat/enable` (需重启生效) -> `{ "code": 200, "message": "success", "data": { "status": "success", "message": "聊天功能已开启..." } }`

### 5.3 快捷指令管理 (Quick Commands)
- **获取列表 (GET)**: `/v1/openclaw/chat/quick-commands`
- **添加 (POST)**: `/v1/openclaw/chat/quick-commands` -> `{ "code": 200, "message": "success", "data": { "id": 1, "status": "success" } }`
- **删除 (DELETE)**: `/v1/openclaw/chat/quick-commands/:id` -> `{ "code": 200, "message": "success" }`

### 5.4 活跃会话监控 (Sessions)
- **路径**: `/v1/openclaw/sessions`
- **响应**: `{ "code": 200, "message": "success", "data": { "data": [...], "updated_at": "..." } }`

---

## 🕹️ 6. 技能管理 (Skills)

### 6.1 技能清单获取 (GET)
- **路径**: `/v1/openclaw/skills`
- **响应**: `{ "code": 200, "message": "success", "data": { "data": [...], "updated_at": "..." } }`

### 6.2 卸载技能插件 (DELETE)
- **路径**: `/v1/openclaw/skills/:name`

### 6.3 路由与技能热重载 (POST)
- **路径**: `/v1/openclaw/skills/reload` -> `{ "code": 200, "message": "success", "data": { "status": "success", "message": "规则与技能已重新加载" } }`

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
    "data": {
      "taskID": "task-1774656000",
      "command": "openclaw gateway restart"
    }
  }
  ```

---

## 🩺 8. 自愈审计与异步任务 (Healing & Tasks)

### 8.1 自愈设置管理
- **获取开关 (GET)**: `/v1/settings/self-healing` -> `{ "code": 200, "message": "success", "data": { "enabled": true } }`
- **修改开关 (POST)**: `/v1/settings/self-healing` -> `{ "code": 200, "message": "success", "data": { "enabled": true } }`

### 8.2 自愈记录审计 (Audit)
- **事件列表 (GET)**: `/v1/heal/events` -> `{ "code": 200, "message": "success", "data": [...] }`
- **报表列表 (GET)**: `/v1/heal/reports` -> `{ "code": 200, "message": "success", "data": [...] }`
- **报表内容详情 (GET)**: `/v1/heal/reports/:name` -> `{ "code": 200, "message": "success", "data": { "name": "...", "content": "..." } }`

### 8.3 任务系统进度查询 (Task Status)
用于追踪网关重启、安装插件等异步操作的实时进度。
- **路径**: `/v1/tasks/status`
- **方法**: `GET`
- **响应示例 (200)**:
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "task-123456": {
        "name": "重启网关",
        "status": "Completed",
        "error": "",
        "updatedAt": "2026-03-28 10:05:00"
      }
    }
  }
  ```

---

## 🔌 9. 渠道集成与日志流 (Channels & Logs)

### 9.1 微信集成专项
- **获取登录二维码 (GET)**: `/v1/wechat/qrcode` -> `{ "code": 200, "message": "success", "data": { "qrcode_url": "...", "expires_in": 300 } }`
- **查询插件状态 (GET)**: `/v1/wechat/plugin/status` -> `{ "code": 200, "message": "success", "data": { "is_installed": true, "version": "..." } }`
- **触发一键安装 (POST)**: `/v1/wechat/install` (异步执行) -> `{ "code": 202, "message": "Installation started", "data": { "taskID": "..." } }`

### 9.2 实时日志流 (WebSocket)
订阅系统实时运行日志。
- **路径**: `/v1/ws/logs`
- **方法**: `GET` (需使用 WebSocket 协议 `ws://` 或 `wss://`)
- **握手协议**: `Upgrade: websocket`
- **消息格式**: 文本字符串（单行日志内容）。

### 9.3 龙虾面板反向代理 (Proxy)
- **路径**: `/v1/proxy/*path`
- **功能**: 透传请求至本地网关健康监测端口，解决跨域与鉴权问题。

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
