## Why

提升 V3 聊天的上下文引用效率和交互体验。目前的附件功能仅限本地上传，且入口单一（回形针图标），无法快速引用工作区（Workspace）内的已有文件或系统集成的技能（Skills）。通过引入模块化的 `+` 菜单和 `@` 提及功能，使用户能够更自然地构建复杂的 AI 指令上下文。

## What Changes

- **UI 改装**: 将输入框左侧的 `📎` 按钮替换为 `+` 按钮，点击弹出下拉菜单。
- **菜单项**:
    - **上传文件 (Media)**: 触发原有的本地文件选择器。
    - **引用文件 (Mentions)**: 触发精简版的文件搜索面板。
    - **引用技能 (Workflows/Skills)**: 触发技能搜索面板。
- **提及功能 (@ Trigger)**: 在输入框内敲击 `@` 时，自动弹出精简版搜索面板，支持对文件和技能的模糊搜索。
- **状态管理**: 选中的文件或技能不再仅作为纯文本，而是作为实体（Entity）显示在输入框上方的预览区（Chip 形式），并随消息一同发送。
- **后端适配**: 确保 `handleSend` 逻辑能够识别并正确处理引用的工作区文件路径和技能标识。

## Capabilities

### New Capabilities
- `v3-chat-mentions`: 负责 V3 聊天中的实体提及、精简搜索面板交互以及上下文组装逻辑。

### Modified Capabilities
- `windows-desktop-gui`: 更新 V3 聊天界面的输入组件规范，增加对提及功能的支持。

## Impact

- **Frontend**: `web/src/components/Chat/V3InputArea.tsx`, `web/src/views/chatV3/V3ComposerBar.tsx`, `web/src/styles/ChatV3.css`。
- **Logic**: `web/src/hooks/chatV3/useV3Messages.ts` 中的 `handleSend` 逻辑需要适配。
- **API**: 可能需要调用现有的 `/v1/openclaw/files/list` 和 `/v1/openclaw/skills` 接口进行搜索。
