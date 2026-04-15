## Context

当前 Chat V3 的会话列表使用统一的机器人图标作为头像，无法反映会话的多样化来源（如微信、飞书、API 等）。Session ID 采用 `agent:<bot_id>:<source>:<uuid>` 格式，其中包含了丰富的元数据，但目前仅在 UI 上作为纯文本展示。

## Goals / Non-Goals

**Goals:**
- 提供基于来源（Source）的直观视觉识别。
- 建立标准化的来源-图标-品牌色映射表。
- 实现复合头像布局，同时展示来源和机器人身份（Emoji）。
- 确保对未知来源有优雅的降级处理。

**Non-Goals:**
- 不改变后端的 Session ID 生成逻辑。
- 不引入新的第三方图标库（优先使用现有的 `lucide-react`）。

## Decisions

### 1. 来源解析逻辑 (Session ID Parsing)
在前端实现通用的解析函数 `parseSessionKey(key: string)`。
- **输入**: `agent:main:weixin:12345`
- **解析策略**: 使用 `split(':')`。
- **结构映射**:
  - `parts[1]` -> `botId`
  - `parts[2]` -> `source` (默认为 `dashboard`)
  - `parts[3]` -> `uuid`

### 2. 视觉映射配置 (Visual Mapping)
定义 `SourceConfig` 映射表：
| Source | Icon | Color | Note |
| :--- | :--- | :--- | :--- |
| `dashboard` | `Monitor` | `#6366f1` | 默认/管理后台 |
| `weixin` | `MessageCircle` | `#07c160` | 微信渠道 |
| `feishu` | `Send` | `#3370ff` | 飞书渠道 |
| `openai-user` | `Zap` | `#f59e0b` | API 接入 |
| `fallback` | `Globe` | `#94a3b8` | 未知来源兜底 |

### 3. 复合头像组件结构 (Composite Avatar Layout)
改造 `V3SessionList.tsx` 中的头像渲染：
- **容器**: `position: relative`
- **主背景**: 来源品牌色背景 + 白色来源图标。
- **微型勋章 (Bot Badge)**: 
  - 位置: 绝对定位 `bottom: -2px`, `right: -2px`。
  - 内容: 对应机器人的 `identityEmoji`。
  - 样式: 小型圆形容器，带描边以示区分。

### 4. 特殊情况：主会话 (agent:main:main)
主会话保留其特有的“置顶”金黄色调风格（使用 `Shield` 图标），作为系统级会话的特殊标识。

### 5. 详情页 Header 增强布局
在 `ChatV3.tsx` 的 Header 区域：
- **来源 Tag**: 在会话 ID 旁边增加一个 `AntD Tag`。
  - 样式: 圆角、淡色背景（来源品牌色 15% 透明度）、深色文字（品牌色）。
  - 文字内容: `来自 微信` / `OpenAI 接入` / `管理后台`。
- **Bot 身份**: 在会话标题（Editable Label）下方或右侧展示服务该会话的机器人名称和 Emoji。
- **状态同步**: 确保切换会话时，Header 的元数据能够即时更新。

### 6. 移动端信息密度适配 (Mobile Responsive)
为防止移动端界面过于拥挤，采取以下策略：
- **Header 瘦身**: 
  - 在移动端模式下，**隐藏原始 Session ID** 字符串。
  - **完全移除 Header 中的来源 Tag**（仅保留侧边栏头像的来源标识），将空间优先留给标题。
  - Bot 身份展示简化为标题前的 Emoji 前缀。
- **列表项优化**:
  - 适当增加会话项的垂直高度（`padding`），防止复合头像视觉过重。
  - 确保标题的 `maxWidth` 动态调整，防止挤压右侧的时间显示。

## Risks / Trade-offs

- **[Risk] Bot Emoji 获取延迟** → **[Mitigation]** 如果 `botsModels` 数据尚未加载完成，右下角勋章显示默认机器人图标或留空，主图标先行展示。
- **[Trade-off] 视觉复杂度** → 增加了头像的信息量，可能在极小屏幕下略显拥挤。通过调整 Badge 的尺寸（约主头像的 40%）来平衡。
