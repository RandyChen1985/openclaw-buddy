# 🦞 OpenClaw Buddy 全量 API 开发者参考方案

本集成文档详细描述了 **OpenClaw (小龙虾)** 监控系统的所有对外 API 接口（共 40+ 个），旨在帮助开发者集成、监控以及自动化管理自己的 Agent 集群。

---

## ⚡ 0. API 概览与后端实现 (Overview & Implementation)

下表总结了平台各模块 API 的分类及其底层实现方式，帮助开发者了解接口的调用开销（如 CLI 进程启动 vs 数据库查询）。

| 模块分组 | 接口路径 (Path, `/v1` 前缀) | 功能简述 | 后端底层实现机制 |
| :--- | :--- | :--- | :--- |
| **OpenClaw 核心 (Bots)** | `GET /openclaw/bots-models` | 获取专家及模型汇总信息 | **CLI**: `openclaw agents list` & `openclaw models list` |
| | `POST /openclaw/bots/add` | 新增一个机器人专家 | **CLI**: `openclaw agents add` |
| | `POST /openclaw/bots/set-identity` | 修改机器人名称与身份标识 | **CLI**: `openclaw agents set-identity` |
| | `POST /openclaw/bots/set-model` | 修改机器人关联模型 | **File**: 追加至 `openclaw.json` (重写) |
| | `POST /openclaw/bots/delete` | 物理移除机器人工作区 | **CLI**: `openclaw agents delete` |
| | `[GET/POST] /openclaw/bots/file` | 读写专家配置(SOUL/Identity) | **File**: `.md` (直接读写) |
| **专家模板 (Experts)** | `GET /openclaw/experts` | 获取本地预设模板列表 | **File**: `experts/*.json` (资源树嵌读) |
| | `POST /openclaw/bots/template` | 通过模板克隆出新机器人 | **CLI** + **File**: 组合多步文件覆写与命名 |
| **模型渠道 (Models)** | `GET /openclaw/models/config` | 查看渠道列表(Providers) | **File**: 解析 `openclaw.json` |
| | `POST /openclaw/models/provider` | 新增/更新提供商 API Key | **File**: `openclaw.json` (写入) |
| | `POST /openclaw/models/provider/model` | 追加/修改渠道内模型 | **File**: `openclaw.json` (写入) |
| | `DELETE /openclaw/models/provider/:provider/model/:id` | 移除特定模型或提供商 | **File**: `openclaw.json` (删除后重写) |
| | `POST /openclaw/models/set-default` | 设定全局默认模型 | **CLI**: `openclaw models set` |
| | `POST /openclaw/models/test-direct` | 绕过网关直连测速 | **Network**: 后端直发 HTTP 握手测连通性 |
| **插件与机制 (Engine)** | `GET /openclaw/skills` | 获取已安装技能与 SDK 状态 | **CLI**: `openclaw skills list --json` |
| | `DELETE /openclaw/skills/:name` | 卸载特定的技能包 | **CLI**: `openclaw skills uninstall` |
| | `POST /openclaw/skills/reload` | 热重载规则引擎机制 | **Memory**: 令配置缓存失效引发下阶动作 |
| | `GET /openclaw/plugins` | 获取系统底层插件配置清单 | **CLI**: `openclaw plugins list --json` |
| | `POST /openclaw/plugins/enable` | 启用插件包 (如微信) | **CLI**: `openclaw plugins enable` |
| | `POST /openclaw/plugins/disable` | 禁用插件包挂载 | **CLI**: `openclaw plugins disable` |
| | `DELETE /openclaw/plugins/:id` | 彻底移除已安装的插件体系 | **CLI**: `openclaw plugins uninstall` |
| | `POST /openclaw/plugins/update` | 一键增量更新全站所有插件 | **CLI**: `openclaw plugins update` |
| **网关聊天 (Chat)** | `POST /openclaw/chat/completions`| 发起流式并发 AI 对话 | **Proxy**: 代理至本地大模型网关入口 (WAF 穿透) |
| | `GET /openclaw/chat/status` | 查询聊天功能开启标记状态 | **File**: 读取 `openclaw.json` 开关配置 |
| | `POST /openclaw/chat/enable` | 一键解封网关聊天并发功能 | **File**: `openclaw.json` (配置修改置位) |
| | `GET /openclaw/sessions` | 查看已有的运行态大纲记录 | **CLI**: `openclaw sessions --json` |
| **网关生命周期控制** | `POST /gateway/start` | 重新拉起网关守护主进程 | **System**: 本机子线程派发命令 |
| | `POST /gateway/stop` | 主动停止网关运行排障 | **Signal**: 端口占用扫描及优雅的中断信号 |
| | `POST /gateway/restart` | 重启网关彻底应用最新配置 | **System**: 调用关停与启动守护队列模型 |
| **系统排障自愈 (Heal)** | `GET /heal/events` | 调取系统异常重启审计履历 | **DB**: Sqlite `heal_events` 查询 |
| | `GET /heal/reports` | 检索故障高阶自动诊断序列 | **File**: 读取 `reports` 存储下的 markdown 报表 |
| | `GET /heal/backups` | 平台配置防灾容灾备份列表 | **File**: 查询 `backup/` 的历史 `.bak` 状态 |
| | `GET /heal/backups/:name/diff` | 高时效检索配置对比及差异 | **Logic**: 派发 Analyzer 对比算法返回抽象 Diff |
| **状态大盘 (Dashboard)**| `GET /openclaw/status` | 网关核心结构健康状态探针 | **Proxy**: 解析 18789 面板端口下沉服务数据 |
| | `GET /openclaw/bots/top` | 人手最常问询的对话排行榜 | **Logic**+**CLI**: 获取所有 Sessions 本地汇总分析 |
| | `GET /stats/health` | 24 小时资源趋势（内存/CPU） | **DB**: Sqlite `health_checks` 轮询高密持久数据 |
| | `GET /tasks/status` | 用户发起的并发长时处理状态 | **Memory**: 本机异步协程调度管理器暴露的数据总线 |
| | `GET /system/events` | 近期人员管理面板行为溯源 | **DB**: Sqlite `system_events` 日志库查询 |
| **微信生态 (WeChat)** | `GET /wechat/qrcode` | 特殊扫码托管及反注入探针 | **Logic**: 动态截取 CLI 输出文本中流暴露的图片地址 |
| | `GET /wechat/config/status` | 查询通道授权挂载配置状况 | **File**: 获取 `channels` Key |
| | `POST /wechat/install` | 零配置拉取微信全量通道 | **CLI**: `openclaw plugins install wechat` |

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
- **日志订阅 (`/v1/ws/logs`)**: 实时推送 `.log` 文件行，适配前端 Xterm.js。`source=buddy`（默认）时，先以一条 JSON 消息推送文件末尾历史行，再仅跟新追加内容。Query：`source`（`buddy`|`gateway`）、`history_lines`（0–5000，默认 500；0 表示不要历史、仅跟尾）。`source=gateway` 时走 `openclaw logs --follow`，无历史批处理。
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
