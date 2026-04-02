# OpenClaw WebSocket 协议全量参考手册 (API Version 3)

本文档基于 OpenClaw Gateway 源码 (`src/gateway/protocol/schema/`) 整理，详述了全量 WebSocket 接口及其精确的入参定义。

---

## 1. 核心方法索引与权限要求

| 模块 | 方法 (Method) | 读/写 | 核心功能 | 常用权限 (Scope) |
| :--- | :--- | :--- | :--- | :--- |
| **基础** | `connect` | 写 | 身份验证与协议握手 | - |
| **机器人** | `agents.create` | 写 | 创建新专家实例 | `operator.admin` |
| **机器人** | `agents.update` | 写 | 修改名称、模型路由或头像 | `operator.write` |
| **机器人** | `agents.files.set`| 写 | 修改 `SOUL.md` / `TOOLS.md` | `operator.write` |
| **机器人** | `agents.delete` | 写 | 物理删除机器人及其归档 | `operator.admin` |
| **会话** | `sessions.create` | 写 | 开启新对话 (支持任务初始化) | `operator.write` |
| **会话** | `sessions.patch` | 写 | **[Mutation]** 调整运行时推理策略 | `operator.write` |
| **会话** | `sessions.reset` | 写 | 重置上下文 (类似新开局) | `operator.write` |
| **会话** | `sessions.delete` | 写 | 删除单条会话历史 | `operator.write` |
| **会话** | `sessions.compact`| 写 | 对会话日志执行截断/瘦身 | `operator.write` |
| **配置** | `config.patch` | 写 | **[Critical]** 热更新网关全局配置 | `operator.admin` |

---

## 2. 机器人深度管控 (Agents)

### 2.1 agents.create [Mutation]
**入参 (Params)**:
- `name`: (string, Required) 给机器人起的别名。
- `workspace`: (string, Required) 机器人的工作目录路径 (e.g. `./experts/my-expert`)。
- `emoji`: (string, Optional) 默认使用的 Emoji 图标。
- `avatar`: (string, Optional) 头像图片 URL 或 Base64。

### 2.2 agents.files.set [Mutation]
**入参 (Params)**:
- `agentId`: (string, Required) 机器人唯一标识。
- `name`: (string, Required) 配置文件名 (允许: `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, `MEMORY_ALT.md`)。
- `content`: (string, Required) 文件的 UTF-8 文本内容。

### 2.3 agents.update [Mutation]
**入参 (Params)**:
- `agentId`: (string, Required)。
- `model`: (string, Optional) 覆盖默认模型。
- `name`: (string, Optional) 修改名称。
- `avatar`: (string, Optional) 修改头像。

---

## 3. 会话动态配置 (Sessions)

### 3.1 sessions.patch [Mutation]
该方法用于在对话进行中实时调整参数，而无需重新开启连接。

**入参 (Params)**:
- `key`: (string, Required) Session 标识符。
- `label`: (string | null, Optional) 重命名当前会话。
- `thinkingLevel`: (string | null, Optional) 设置思考层级 (`normal`, `high`)。
- `fastMode`: (boolean | null, Optional) 是否开启极速模式。
- `reasoningLevel`: (string | null, Optional) 设置推理深度。
- `model`: (string | null, Optional) 覆盖此会话专用的模型。
- `sendPolicy`: (string | null, Optional) 发送策略 (`allow`, `deny`)。

### 3.2 sessions.create
**入参 (Params)**:
- `agentId`: (string, Optional) 默认为全局默认 Agent。
- `parentSessionKey`: (string, Optional) 关联父会话。
- `task`/`message`: (string, Optional) 创建后的初始指令。

---

## 4. 网关内核热更新 (Config)

### 4.1 config.patch [Critical Mutation]
直接修改 `openclaw.json`。修改后网关会立即应用变更并进入**热重启**。

**入参 (Params)**:
- `raw`: (string, Required) JSON5 格式的配置片段。
- `baseHash`: (string, Optional) 用于 CAS (Check-and-Set) 校验，防止并发写入覆盖。通过 `config.get` 获取。
- `note`: (string, Optional) 重启审计日志说明。
- `restartDelayMs`: (number, Optional) 延迟重启的毫秒数。

---

## 5. 状态同步 (Events)

### 5.1 sessions.changed
当任何方法（不论是 REST API 还是 WebSocket）修改了会话状态时，网关会向所有已订阅连接推送此事件。
```json
{
  "type": "event",
  "event": "sessions.changed",
  "payload": {
    "sessionKey": "...",
    "reason": "patch", // 触发原因: create, patch, delete, send, reset, compact
    "ts": 1712045500000
  }
}
```

---

## 6. 测试验证

建议使用 [test_websocket_mutation_full.go](file:///Users/chenxiaolong/资料/有孚网络/1云枢中台/openclaw-buddy/tests/test_websocket_mutation_full.go) 脚本进行自动化回归测试，确保在正式集成前鉴权与入参完全正确。
