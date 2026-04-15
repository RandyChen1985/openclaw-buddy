## Why

当前会话列表头像过于单一（统一机器人图标），无法直观区分会话来源（Dashboard, 微信, 飞书, openai-user API等），导致多渠道管理效率低下，视觉辨识度不足。

## What Changes

- **Source Badge 替换**: 将会话列表的主头像区域由统一的机器人图标改为 Source Badge（来源标识），根据 Session ID 中的来源字段展示对应的图标和品牌色（如：微信绿、飞书蓝、API 橙）。
- **复合身份标识**: 在来源标识的右下角添加微型机器人身份标识（Emoji），保留机器人角色的识别度。
- **解析逻辑优化**: 增强 Session ID 的解析能力，从 `agent:<bot>:<source>:<uuid>` 结构中准确提取机器人 ID 和来源信息。
- **特定来源映射**: 将 `api` 来源明确映射为 `openai-user` 标识，增强兼容性提示。

## Capabilities

### New Capabilities
- `session-source-visualization`: 提供基于来源的会话身份识别能力，包括来源图标映射和复合头像渲染逻辑。

### Modified Capabilities
- `task-tray-ui`: 更新现有会话列表组件，支持新的复合头像布局和 Session ID 解析展示。

## Impact

- `web/src/components/Chat/V3SessionList.tsx`: 核心 UI 渲染逻辑，包括头像区域和 ID 解析。
- `web/src/views/ChatV3.tsx`: 确保状态正确传递和初始化。
- `web/src/locales/`: 可能需要补充部分来源名称的翻译。
