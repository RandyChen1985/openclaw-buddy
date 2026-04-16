# OpenClaw WebSocket 协议全量参考手册 (V3)

本文档基于 OpenClaw Gateway 源码（`src/gateway/`）逐文件提取，作为 Buddy 前端/代理开发的权威协议参考。

> **最后对齐源码时间**: 2026-04-16

---

## 1. 协议帧格式

### 1.1 请求帧 (Client → Server)
```json
{ "type": "req", "id": "<唯一ID>", "method": "<方法名>", "params": { ... } }
```

### 1.2 响应帧 (Server → Client)
```json
{ "type": "res", "id": "<对应请求ID>", "ok": true, "result": { ... } }
{ "type": "res", "id": "<对应请求ID>", "ok": false, "error": { "code": "...", "message": "..." } }
```

### 1.3 事件帧 (Server → Client)
```json
{ "type": "event", "event": "<事件名>", "payload": { ... }, "seq": 123, "stateVersion": 456 }
```

---

## 2. 认证与连接 (Auth V3)

连接握手采用 **Challenge-Response** 机制。客户端连接后，网关推送 `connect.challenge` 事件携带 `nonce`，客户端需使用 Ed25519 私钥签名后发送 `connect` 请求。

### 2.1 握手签名字符串
11 段管道符拼接：
```
v3|{deviceId}|{clientId}|{clientMode}|{role}|{scopes}|{signedAtMs}|{token}|{nonce}|{platform}|{deviceFamily}
```

| 字段 | 说明 |
|------|------|
| `deviceId` | SHA256(PublicKey) 的十六进制 |
| `clientId` | 客户端标识，如 `openclaw-control-ui` |
| `clientMode` | `cli` / `ui` |
| `role` | `operator` / `admin` |
| `scopes` | **必须字母序排序**，逗号分隔，如 `operator.admin,operator.read,operator.write` |
| `signedAtMs` | 毫秒时间戳 |
| `nonce` | 服务端推送的随机质询码 |
| `platform` | `macos` / `linux` / `windows` |
| `deviceFamily` | 硬件家族（空则末尾保留管道符 `...\|platform\|`） |

### 2.2 认证请求 (`connect`)
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
    "auth": { "token": "GATEWAY_TOKEN" },
    "client": { "id": "openclaw-control-ui", "mode": "cli", "platform": "macos", "version": "1.0.3" },
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

> **注意**: `deviceFamily` 为空时从 JSON 中**完全省略**，否则触发 schema 校验错误。

---

## 3. 会话管理 (Sessions)

### 3.1 方法速查

| 方法 | 功能 | 关键参数 |
|------|------|----------|
| `sessions.list` | 查询历史会话 | `limit`, `agentId` |
| `sessions.create` | 创建新会话 | `agentId`, `label`, `model`, `parentSessionKey`, `message` |
| `sessions.get` | 获取单个会话详情 | `key` (或 `sessionKey`), `limit` |
| `sessions.patch` | 修改会话策略 | `key`, `thinkingLevel`, `model`, `reasoningLevel`, `fastMode`, `label` |
| `sessions.delete` | 删除会话 | `key`, `deleteTranscript?`, `emitLifecycleHooks?` |
| `sessions.reset` | 重置会话 | `key`, `reason`: `"new"` \| `"reset"` |
| `sessions.resolve` | 解析会话 key 别名 | `key` |
| `sessions.preview` | 预览多会话摘要 | `keys[]`, `limit`, `maxChars` |
| `sessions.send` | 发送消息（同 chat.send 管道） | `sessionKey`, `message`, `idempotencyKey` |
| `sessions.steer` | 发送消息并中断当前运行 | 同 `sessions.send` |
| `sessions.abort` | 中止活跃运行 | `key`, `runId?` |
| `sessions.compact` | 压缩上下文 | `key`, `maxLines?` |

### 3.2 订阅方法

| 方法 | 参数 | 效果 |
|------|------|------|
| `sessions.subscribe` | (无) | 订阅 `sessions.changed` 全局事件 |
| `sessions.unsubscribe` | (无) | 取消订阅 |
| `sessions.messages.subscribe` | `key` (sessionKey) | 订阅指定会话的 `session.message` / `session.tool` 事件 |
| `sessions.messages.unsubscribe` | `key` | 取消订阅 |

### 3.3 Compaction（检查点）方法

| 方法 | 功能 |
|------|------|
| `sessions.compaction.list` | 列出检查点 |
| `sessions.compaction.get` | 获取检查点详情 |
| `sessions.compaction.branch` | 从检查点分支新会话 |
| `sessions.compaction.restore` | 恢复到检查点 |

### 3.4 Usage 方法

| 方法 | 功能 |
|------|------|
| `sessions.usage` | 会话用量统计 |
| `sessions.usage.timeseries` | 时序用量 |
| `sessions.usage.logs` | 用量日志 |

### 3.5 `sessions.create` 详细

- **参数**:
  - `agentId`: (String, Optional) 绑定专家 ID
  - `label`: (String, Optional) 会话标题
  - `model`: (String, Optional) 模型 ID
  - `parentSessionKey`: (String, Optional) 父会话 key
  - `message`: (String, Optional) 创建时发送的初始消息
- **响应**: `{ ok: true, key: "agent:main:...", agentId: "main", ... }`
- **副作用**: 触发 `sessions.changed` (reason: `create`; 若带 `message` 则还有 `send`)

### 3.6 `sessions.patch` 详细

- **参数**:
  - `key`: (String, Required)
  - `thinkingLevel`: (String, Optional) `off` | `minimal` | `low` | `medium` | `high` | `xhigh`
  - `model`: (String, Optional)
  - `reasoningLevel`: (String, Optional)
  - `fastMode`: (Boolean, Optional)
  - `label`: (String, Optional)
- **副作用**: 触发 `sessions.changed` (reason: `patch`)

### 3.7 `sessions.compact` 详细

- **参数**:
  - `key`: (String, Required)
  - `maxLines`: (Number, Optional) 若指定则按行截断；不指定则运行 AI 嵌入式压缩
- **响应**: `{ ok, key, compacted, reason, result }` 或 `{ compacted, archived, kept }`
- **副作用**: 若压缩成功，触发 `sessions.changed` (reason: `compact`)

---

## 4. 聊天 (Chat)

### 4.1 方法速查

| 方法 | 功能 | 关键参数 |
|------|------|----------|
| `chat.send` | 发送消息触发推理 | `sessionKey`, `message`, `idempotencyKey?` |
| `chat.history` | 获取对话历史 | `sessionKey`, `limit`, `maxChars?` |
| `chat.abort` | 中止流式生成 | `sessionKey`, `runId?` |
| `chat.inject` | 注入消息(不触发推理) | `sessionKey`, `message`, `label?` |

### 4.2 `chat.send` 详细

- **参数**: `sessionKey` (Required), `message` (Required), `idempotencyKey` (Optional)
- **响应**: 仅确认接收，如 `{ ok: true, runId: "..." }`
- **AI 输出**: 通过 `chat` 事件流式推送

### 4.3 `chat.abort` 详细

- **参数**: `sessionKey` (Required), `runId` (Optional)
- **行为**:
  - 不指定 `runId`: 中止该会话所有活跃运行
  - 指定 `runId`: 仅中止匹配的运行
- **响应**: `{ ok: true, aborted: true/false, runIds: [...] }`
- **副作用**: 推送 `chat` 事件 state=`aborted`; 触发 `sessions.changed` (reason: `abort`)

### 4.4 `chat` 事件 states

| state | 含义 |
|-------|------|
| `delta` | 流式文本增量，`message.content` 包含当前累积内容 |
| `final` | 生成完毕，可选 `stopReason`, `message`, `usage` |
| `error` | 生成失败，`errorMessage`, `errorKind`: `refusal` / `timeout` / `rate_limit` / `context_length` / `unknown` |
| `aborted` | 用户/系统中止，可选 `stopReason`, `message`（含已生成部分） |

> **注意**: 源码中还存在 `thought` / `thinking` 状态用于深度推理阶段指示，由 agent 事件流中 `stream: "thinking"` 触发。

---

## 5. Agent 运行 (Agent)

### 5.1 方法

| 方法 | 功能 | 关键参数 |
|------|------|----------|
| `agent` | 启动 Agent 运行 | `message`, `idempotencyKey`, session/attachments 等 |
| `agent.identity.get` | 获取 Agent 身份 | `agentId` / `sessionKey` |
| `agent.wait` | 等待运行终态 | `runId`, `timeoutMs` |

### 5.2 `agent` 事件流

事件名: `agent`，payload 结构: `{ stream, seq, ts, data, sessionKey?, runId? }`

| `stream` 值 | 含义 |
|-------------|------|
| `lifecycle` | 生命周期，`data.phase`: `start` / `end` / `error` |
| `tool` | 工具调用/结果 |
| `assistant` | 助手文本流（驱动 `chat` delta） |
| `error` | 运行错误 |
| `item` | 中间状态项（如 `data.status: "blocked"`） |
| `plan` | 执行计划 |
| `approval` | 审批相关 |
| `command_output` | 命令输出 |
| `patch` | 会话补丁 |
| `compaction` | 压缩事件 |
| `thinking` | 深度思考中 |

---

## 6. 执行审批 (Exec Approval)

### 6.1 RPC 方法

| 方法 | 功能 | 关键参数 |
|------|------|----------|
| `exec.approval.get` | 查询待审批详情 | `id` |
| `exec.approval.list` | 列出所有待审批 | - |
| `exec.approval.request` | 创建审批请求 | `twoPhase?` |
| `exec.approval.waitDecision` | 阻塞等待决策 | `id` |
| `exec.approval.resolve` | 提交决策 | `id`, `decision`: `allow-once` / `allow-always` / `deny` |

### 6.2 审批文件管理

| 方法 | 功能 |
|------|------|
| `exec.approvals.get` | 获取磁盘审批配置文件 |
| `exec.approvals.set` | 写入审批配置（需 `baseHash`） |
| `exec.approvals.node.get` | 获取节点审批配置 |
| `exec.approvals.node.set` | 写入节点审批配置 |

### 6.3 事件

- **`exec.approval.requested`**: `{ id, request, createdAtMs, expiresAtMs }`
- **`exec.approval.resolved`**: `{ id, decision, resolvedBy, ts, request }`

`decision` 可选值: `allow-once`, `allow-always`, `deny`

### 6.4 Plugin Approval（同构）

方法: `plugin.approval.*`，事件: `plugin.approval.requested` / `plugin.approval.resolved`

---

## 7. 机器人管理 (Agents)

| 方法 | 功能 |
|------|------|
| `agents.list` | 列出所有已安装专家 |
| `agents.create` | 创建专家（`name`, `workspace`, `emoji?`, `avatar?`） |
| `agents.update` | 增量修改专家属性 |
| `agents.delete` | 删除专家 |
| `agents.files.list` | 列出专家配置文件 |
| `agents.files.get` | 读取配置文件（如 `SOUL.md`） |
| `agents.files.set` | 写入配置文件（`agentId`, `name`, `content`） |

---

## 8. 模型与工具

| 方法 | 功能 |
|------|------|
| `models.list` | 列出所有可调用模型路由 |
| `models.authStatus` | 模型认证状态 |
| `tools.catalog` | 工具目录 |
| `tools.effective` | 当前生效的工具列表 |
| `commands.list` | 命令列表 |

---

## 9. 技能 (Skills)

| 方法 | 功能 |
|------|------|
| `skills.status` | 已安装插件与 SDK 状态 |
| `skills.bins` | 可用二进制列表 |
| `skills.search` | 搜索技能 |
| `skills.detail` | 技能详情 |
| `skills.install` | 安装技能 |
| `skills.update` | 更新技能 |

---

## 10. 定时任务 (Cron)

| 方法 | 功能 | 关键参数 |
|------|------|----------|
| `cron.list` | 获取任务列表 | `limit`, `offset`, `query` |
| `cron.status` | 任务状态 | - |
| `cron.add` | 创建定时任务 | 任务定义 |
| `cron.update` | 修改任务 | 任务 ID + 更新字段 |
| `cron.remove` | 删除任务 | 任务 ID |
| `cron.run` | 立即触发一次 | `id` |
| `cron.runs` | 运行历史 | - |
| `wake` | 定时唤醒 | `mode`: `now` / `next-heartbeat`, `text` |

---

## 11. 配置管理 (Config)

| 方法 | 功能 |
|------|------|
| `config.get` | 获取网关 `openclaw.json` |
| `config.set` | 完整写入配置 |
| `config.apply` | 应用配置（带限流） |
| `config.patch` | 增量更新（需 `baseHash` + `raw`） |
| `config.schema` | 获取配置 JSON Schema |
| `config.schema.lookup` | Schema 字段查询 |
| `config.openFile` | 打开配置文件 |

---

## 12. 设备配对 (Device Pairing)

| 方法 | 功能 |
|------|------|
| `device.pair.list` | 列出配对请求 |
| `device.pair.approve` | 批准设备 |
| `device.pair.reject` | 拒绝设备 |
| `device.pair.remove` | 移除已配对设备 |
| `device.token.rotate` | 轮换 Token |
| `device.token.revoke` | 吊销 Token |

**事件**: `device.pair.requested` / `device.pair.resolved`

---

## 13. 节点管理 (Node)

| 方法 | 功能 |
|------|------|
| `node.pair.request` / `list` / `approve` / `reject` / `verify` | 节点配对 |
| `node.rename` / `node.list` / `node.describe` | 节点注册表 |
| `node.pending.drain` / `enqueue` / `pull` / `ack` | 待处理队列 |
| `node.invoke` / `node.invoke.result` | 远程调用 |
| `node.event` | 节点事件上报 |
| `node.canvas.capability.refresh` | 画布能力刷新 |

**事件**: `node.pair.requested` / `node.pair.resolved` / `node.invoke.request`

---

## 14. TTS / Voice / Talk

| 方法 | 功能 |
|------|------|
| `tts.status` / `tts.enable` / `tts.disable` | TTS 开关 |
| `tts.convert` | 文本转语音 |
| `tts.setProvider` / `tts.providers` | 提供商管理 |
| `talk.config` / `talk.speak` / `talk.mode` | 语音对话 |
| `voicewake.get` / `voicewake.set` | 语音唤醒 |

**事件**: `talk.mode` / `voicewake.changed`

---

## 15. 系统与监控 (System)

| 方法 | 功能 |
|------|------|
| `health` | 内存/CPU/健康状态（可选 `probe`） |
| `status` | 系统摘要 |
| `last-heartbeat` | 最近心跳事件 |
| `set-heartbeats` | 开关心跳 (`enabled: boolean`) |
| `system-presence` | 系统存在感知列表 |
| `system-event` | 上报系统事件 |
| `gateway.identity.get` | 网关设备 ID + 公钥 |
| `logs.tail` | 网关日志流 (`cursor`, `limit`, `maxBytes`) |
| `usage.status` / `usage.cost` | 全局用量 |
| `update.run` | 触发更新（限流） |
| `channels.status` / `channels.logout` | 渠道插件状态 |
| `wizard.start` / `next` / `cancel` / `status` | 向导流 |
| `web.login.start` / `web.login.wait` | Web 登录 |
| `secrets.reload` / `secrets.resolve` | 密钥管理 |
| `send` | 多渠道外发 |
| `poll` | 投票创建 |
| `message.action` | 渠道消息动作 |

---

## 16. 全量事件列表

| 事件名 | 推送时机 | 需要订阅 |
|--------|---------|---------|
| `connect.challenge` | 连接建立后立即推送 nonce | 否(自动) |
| `health` | 定期健康快照 | 否(自动) |
| `heartbeat` | 心跳 | 否(自动) |
| `tick` | 定期 tick | 否(自动) |
| `presence` | 存在感知变更 | 否 |
| `shutdown` | 网关即将关闭 | 否 |
| `update.available` | 有可用更新 | 否 |
| `sessions.changed` | 会话变更 | 需 `sessions.subscribe` |
| `session.message` | 会话消息推送 | 需 `sessions.messages.subscribe` |
| `session.tool` | 工具事件推送 | 需 `sessions.messages.subscribe` |
| `chat` | AI 流式输出 | 否(自动按 scope 推送) |
| `chat.side_result` | 副信道结果 | 否 |
| `agent` | Agent 运行事件流 | 否 |
| `exec.approval.requested` | 执行审批请求 | 否(需 operator scope) |
| `exec.approval.resolved` | 执行审批决策 | 否(需 operator scope) |
| `plugin.approval.requested` | 插件审批请求 | 否 |
| `plugin.approval.resolved` | 插件审批决策 | 否 |
| `device.pair.requested` | 设备配对请求 | 否 |
| `device.pair.resolved` | 设备配对决策 | 否 |
| `node.pair.requested` | 节点配对请求 | 否 |
| `node.pair.resolved` | 节点配对决策 | 否 |
| `node.invoke.request` | 节点远程调用请求 | 否 |
| `talk.mode` | 语音模式变更 | 否 |
| `voicewake.changed` | 语音唤醒配置变更 | 否 |
| `cron` | 定时任务事件 | 否 |

---

## 17. `sessions.changed` 事件 reason 全量

| reason | 触发源 |
|--------|-------|
| `create` | `sessions.create` / Agent 启动创建子会话 |
| `send` | `chat.send` / `sessions.send` |
| `steer` | `sessions.steer` 中断并重发 |
| `patch` | `sessions.patch` |
| `delete` | `sessions.delete` |
| `new` / `reset` | `sessions.reset` |
| `compact` | `sessions.compact`（payload 含 `compacted: boolean`） |
| `abort` | `sessions.abort` 成功中止 |
| `checkpoint-branch` | `sessions.compaction.branch` |
| `checkpoint-restore` | `sessions.compaction.restore` |
| `subagent-status` | 子 Agent 状态变更 |

Payload 中还可能包含 `phase` 字段（`start` / `end` / `error`），由 Agent 生命周期事件触发，携带 `runId`, `ts`, 会话快照等。

---

## 18. 错误码 (JSON Error Codes)

| 错误码 | 含义 |
|--------|------|
| `INVALID_REQUEST` | 消息格式错误、参数校验失败、未知方法 |
| `NOT_PAIRED` | 设备未配对（需先批准） |
| `NOT_LINKED` | 连接未关联 |
| `AGENT_TIMEOUT` | Agent 执行超时 |
| `APPROVAL_NOT_FOUND` | 审批记录不存在或已过期 |
| `UNAVAILABLE` | 服务不可用（限流、IO 失败、启动中） |

---

## 19. WebSocket Close Codes

| Code | 含义 |
|------|------|
| `1000` | 正常关闭 |
| `1002` | 协议版本不匹配 |
| `1008` | 策略违规（无效认证/角色/权限不足/慢消费者/重复未授权/TLS 错误） |
| `1009` | 认证前 payload 过大 |
| `1012` | 服务重启（网关关闭前主动关闭所有客户端） |
| `4000` | Tick 超时（客户端侧检测） |
| `4001` | 网关认证已轮换（共享 Token 换代 / 设备被移除） |

> **`4001` 处理建议**: 客户端收到后应重置重连计数器并立即重连，Buddy 代理层应将此 close code 透传给浏览器。

---

## 附录 A：Buddy 代理层拦截规则

| 拦截场景 | 行为 |
|---------|------|
| `connect` 请求 | 注入 Gateway 真实 Token |
| `sessions.patch` / `sessions.delete` 目标为 `agent:main:main` | 返回错误 `"System session is immutable"` |
| 网关响应含 `NOT_PAIRED` | 自动批准设备配对请求 |
| 网关 Close 4001 | 透传给浏览器触发重连 |

## 附录 B：自动化测试脚本

开发集成前，请使用 **[test_buddy_proxy_full.go](../tests/manual/test_buddy_proxy_full.go)** 进行全量一致性验证。
