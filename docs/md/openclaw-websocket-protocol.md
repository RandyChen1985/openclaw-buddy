# OpenClaw WebSocket 协议全量参考手册 (V3)

本文档是针对 OpenClaw Gateway 的权威 WebSocket 协议参考。V3 协议通过 Ed25519 签名提供极高的安全性，并支持完整的 专家/会话/节点/任务 全生命周期管理。

---

## 1. 认证与连接 (Auth V3)

连接握手采用 **Challenge-Response** 机制。客户端连接后，网关会发送一个 `nonce` 质询词，客户端需使用 Ed25519 私钥对特定的 11 位管道符拼接字符串进行签名。

### 1.1 握手 Payload 构造规则 (Handshake String)
签名原始字符串共有 11 个部分，由 `|` (管道符) 分隔：
`v3|{deviceId}|{clientId}|{clientMode}|{role}|{scopes}|{signedAtMs}|{token}|{nonce}|{platform}|{deviceFamily}`

- **deviceId**: 客户端设备唯一 ID (SHA256 of Public Key Hex)。
- **clientId**: 客户端标识，推荐使用 `openclaw-control-ui` 或 `cli`。
- **clientMode**: 运行模式，推荐 `cli` 或 `ui`。
- **role**: 认证角色，通常为 `operator` 或 `admin`。
- **scopes**: 权限列表（**必须字母表升序排序**，逗号分隔，e.g. `operator.admin,operator.read,operator.write`）。
- **signedAtMs**: 当前毫秒时间戳。
- **nonce**: 网关推送的随机质询码。
- **platform**: 运行平台 (e.g. `macos`, `linux`, `windows`)。
- **deviceFamily**: 硬件家族 (若为空，payload 末尾仍需保留管道符，即 `...|platform|`)。

### 1.2 认证请求示例 (Request)
> [!IMPORTANT]
> 注意 `params` 内部的嵌套结构：`client`, `device`, `auth` 是分离的。若 `deviceFamily` 为空，请在 JSON 中**完全省略**该字段，否则会触发 "must NOT have fewer than 1 characters" 校验错误。

```json
{
  "type": "req",
  "id": "auth-1",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "role": "operator",
    "scopes": ["operator.admin", "operator.read", "operator.write"],
    "auth": { "token": "YOUR_GATEWAY_TOKEN" },
    "client": {
      "id": "openclaw-control-ui",
      "mode": "cli",
      "platform": "macos",
      "version": "1.0.3"
    },
    "device": {
      "id": "DEV_ID_HEX",
      "publicKey": "BASE64URL_PUBLIC_KEY",
      "signature": "BASE64URL_ED25519_SIGNATURE",
      "signedAt": 1712045000000,
      "nonce": "CHALLENGE_NONCE"
    }
  }
}
```

---

## 2. 机器人管理 (Agents)

### 2.1 接口列表速查

| 方法 (Method) | 核心功能 |
| :--- | :--- |
| `agents.list` | 列出所有已安装专家 |
| `agents.create` | 创建新专家 |
| `agents.update` | 增量修改专家属性 |
| `agents.delete` | 删除专家 |
| `agents.files.list`| 列出专家相关文件 |
| `agents.files.get` | 读取特定配置文件 |
| `agents.files.set` | 写入专家配置 |

### 2.2 详细接口说明

#### `agents.create`
创建新专家。
- **参数**:
  - `name`: (String, Required) 专家名称（尽量包含 ASCII 字符）。
  - `workspace`: (String, Required) 文件系统完整路径。
  - `emoji`: (String, Optional) 图标。
  - `avatar`: (String, Optional) 头像 URL。
- **响应 Payload**: `{ ok: true, agentId: "...", name: "...", workspace: "..." }`
- **注意**: `agentId` 是根据 `name` 归一化生成的，不能为 `main`。

#### `agents.files.set`
写入专家的配置文件（如 `SOUL.md` 或 `IDENTITY.md`）。
- **参数**:
  - `agentId`: (String, Required) 专家 ID。
  - `name`: (String, Required) 文件名称。
  - `content`: (String, Required) 文件完整内容。
- **响应 Payload**: `{ ok: true, agentId: "...", file: { name, path, content, ... } }`

---

## 3. 会话与上下文控制 (Sessions & Chat)

### 3.1 接口列表速查

| 方法 (Method) | 功能说明 | 关键入参 |
| :--- | :--- | :--- |
| `sessions.list` | 查询历史会话 | `limit`, `agentId` |
| `sessions.create` | 开启新对话 | `agentId`, `label`, `message` |
| `sessions.patch` | **实时调整策略** | `key`, `thinkingLevel`, `model` |
| `sessions.delete` | 物理删除会话 | `key` |
| `chat.send` | 发送对话请求 | `sessionKey`, `message`, `idempotencyKey` |
| `chat.history` | 获取对话历史 | `sessionKey`, `limit` |

### 3.2 详细接口说明

#### `sessions.create`
开启一个新的 AI 会话。
- **参数**:
  - `agentId`: (String, Optional) 绑定专家 ID（若为空则使用默认）。
  - `label`: (String, Optional) 会话标题。
  - `model`: (String, Optional) 指定模型 ID。
  - `parentSessionKey`: (String, Optional) 父会话（用于 Subagent/Thread 链路）。
  - `message`: (String, Optional) 随创建动作发送的初始指令。
- **响应 Payload**: `{ key: "agent:main:...", agentId: "main", ... }`

#### `sessions.patch`
在线修改会话的推理策略。
- **参数**:
  - `key`: (String, Required) 会话 sessionKey。
  - `thinkingLevel`: (String, Optional) 思维深度级别。
  - `model`: (String, Optional) 切换模型。
  - `reasoningLevel`: (String, Optional) 逻辑推理加权级别。
  - `fastMode`: (Boolean, Optional) 是否开启极速模式。
- **响应 Payload**: `{ ok: true, key: "..." }`

#### `chat.send`
向指定会话发送消息并触发 AI 推理。
- **参数**:
  - `key`: (String, Required) 会话 sessionKey。
  - `message`: (String, Required) 输入内容。
  - `idempotencyKey`: (String, Optional) 幂等 ID，防止重复提交。
- **注意**: 响应仅确认请求已接收，AI 的流式输出将通过 `chat` 事件推送。

---

## 4. 定时任务 (Cron)

| 方法 (Method) | 功能说明 | 关键参数 |
| :--- | :--- | :--- |
| `cron.list` | 获取调度任务列表 | `limit`, `offset`, `query` |
| `cron.run` | 立即手动触发一次 | `id` (任务 ID) |

---

## 5. 状态订阅与推送 (Events)

### 5.1 chat (流式输出)
当 AI 生成内容时，会推送包含推理深度和内容的 `event`。
```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "state": "delta",
    "message": { "content": [{ "text": "..." }] }
  }
}
```

### 5.2 sessions.changed
当任何方法修改了会话状态时，网关会向所有连接推送此事件。
- `reason`: `create`, `patch`, `delete`, `send`, `reset`, `compact`

---

## 6. 系统与监控 (System)

| 方法 (Method) | 功能说明 |
| :--- | :--- |
| `config.get` | 获取当前生效的网关完整 `openclaw.json`。 |
| `config.patch` | 热更网关定义文件。需传 `baseHash` 及 `raw` JSON 字符串。 |
| `models.list` | 列出当前所有可调用的模型路由。 |
| `skills.status` | 查看当前已安装插件与 SDK 状态。 |
| `health` | 获取内存/CPU 及系统健康状态。 |

---

## 7. 异常处理 (Error Codes)

| 错误代码 (Error) | 含义 |
| :--- | :--- |
| `INVALID_REQUEST` | **INVALID_REQUEST**: 消息格式错误或入参 Schema 校验失败 |
| `METHOD_NOT_FOUND` | **METHOD_NOT_FOUND**: 网关不支持该方法 |
| `NOT_PAIRED` | **NOT_PAIRED**: 设备未配对（通常发生在未批准的设备连接时） |
| `AUTH_UNAUTHORIZED` | **AUTH_UNAUTHORIZED**: Token 错误或权限不足 |

---

## 附录：自动化测试脚本
开发集成前，请务必使用 **[test_websocket_mutation_full.go](file:///Users/chenxiaolong/资料/有孚网络/1云枢中台/openclaw-buddy/tests/test_websocket_mutation_full.go)** 进行全量一致性验证。
