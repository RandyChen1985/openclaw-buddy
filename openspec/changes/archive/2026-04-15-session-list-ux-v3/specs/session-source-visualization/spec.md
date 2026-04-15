## ADDED Requirements

### Requirement: Session ID 结构化解析
系统 SHALL 能够从标准 Session ID 格式 `agent:<bot_id>:<source>:<uuid>` 中准确提取出机器人 ID (`bot_id`) 和来源 (`source`)。

#### Scenario: 成功解析标准 ID
- **WHEN** 传入 Session ID 为 `agent:main:weixin:12345`
- **THEN** 系统提取出 bot 为 `main`，source 为 `weixin`

### Requirement: 基于来源的动态头像渲染
会话列表项的头像区域 SHALL 根据解析出的 `source` 展示对应的图标和品牌色。

#### Scenario: 渲染微信来源
- **WHEN** 会话来源为 `weixin`
- **THEN** 头像背景显示为微信绿 (`#07c160`)，图标显示为 `MessageCircle`

#### Scenario: 渲染 API 来源 (openai-user)
- **WHEN** 会话来源为 `api`
- **THEN** 头像背景显示为橙色 (`#f59e0b`)，图标显示为 `Zap` 或 `Terminal`

### Requirement: 复合头像显示机器人标识
在来源图标头像的右下角 SHALL 显示一个微型 Badge，展示该会话对应机器人的 Emoji。

#### Scenario: 显示机器人 Emoji
- **WHEN** 机器人配置了 Emoji 为 `🤖`
- **THEN** 头像右下角显示 `🤖` 徽章

### Requirement: 未知来源的兜底渲染
对于未在预设映射表（weixin, feishu, dashboard, openai-user 等）中的来源，系统 SHALL 提供中立的兜底显示。

#### Scenario: 渲染未知来源
- **WHEN** 会话来源为 `telegram` (假设尚未配置图标)
- **THEN** 头像背景显示为灰色 (`#94a3b8`)，图标显示为 `Globe` 或 `Link`，以示区分

### Requirement: 详情页 Header 同步展示元数据
Chat V3 的详情页顶部 Header 区域 SHALL 展示该会话的来源标识及处理该会话的机器人身份。

#### Scenario: Header 视觉校验
- **WHEN** 用户进入一个来自 `weixin` 的会话
- **THEN** Header 区域展示“来自微信”的彩色 Tag，并显示对应机器人的名称和 Emoji
