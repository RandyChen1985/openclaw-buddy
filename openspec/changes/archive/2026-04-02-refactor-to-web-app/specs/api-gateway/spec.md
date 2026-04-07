## ADDED Requirements

### Requirement: OpenClaw CLI 命令封装 (CLI Command Encapsulation)
系统必须通过标准的 RESTful API 提供对 OpenClaw CLI 的调用能力，支持 `/v1/gateway/restart`、`/v1/gateway/start`、`/v1/gateway/stop` 和 `/v1/wechat/qrcode` 接口。

#### Scenario: 重启网关命令 (Restart Gateway)
- **WHEN** 客户端 POST 请求 `/v1/gateway/restart`
- **THEN** 系统立即返回 202 状态码及 `task_id`，并在后台执行 `openclaw gateway restart`

#### Scenario: 获取微信登录二维码 (Get WeChat QR Code)
- **WHEN** 客户端 GET 请求 `/v1/wechat/qrcode`
- **THEN** 系统返回包含 `qrcode_url` 的 JSON 数据，且该数据在 5 分钟内通过缓存获取

#### Scenario: 实时日志流推送 (Live Log Streaming)
- **WHEN** 客户端连接 WebSocket `/v1/ws/logs`
- **THEN** 系统应通过该连接实时推送命令执行的 `stdout/stderr` 日志流
