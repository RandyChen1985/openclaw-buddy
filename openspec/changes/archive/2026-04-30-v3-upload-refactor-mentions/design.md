## Context

V3 聊天的输入区域（`V3InputArea.tsx`）目前是核心交互点。用户需要更灵活的方式来引用服务器资源（文件）和系统功能（技能）。当前的附件系统仅支持本地文件上传。我们需要引入一种“提及（Mentions）”机制，使输入框能够引用工作区内的持久化资源。

## Goals / Non-Goals

**Goals:**
- 提供一个受 `+` 菜单和 `@` 键触发的统一选择器面板。
- 实现一个精简的文件/技能搜索交互，支持模糊匹配。
- 将引用的文件/技能可视化为输入框上方的徽标（Chips），与本地上传文件对齐。
- 在消息发送时，将这些引用转化为后端可理解的上下文（路径或 ID）。

**Non-Goals:**
- 不实现复杂的富文本编辑器（保持 TextArea 纯文本，通过 Chip 区域管理状态）。
- 不在本次改动中重构后端的专家系统逻辑。

## Decisions

### 1. 统一实体选择器 (Unified Entity Selector)
创建一个名为 `V3MentionSelector` 的新组件，它将作为一个浮动层（Popover 或自定义定位 Div）挂载。
- **理由**: 避免在 `V3InputArea` 中混入过多的 UI 代码。
- **交互**: 包含两个 Tab（文件、技能），支持关键词过滤。
- **触发**: 由输入框的 `onKeyDown` (检测 `@`) 或 `+` 菜单项触发。

### 2. 实体状态管理
在 `V3InputArea` 的 `files` 状态数组中引入扩展。
- **结构**:
  ```typescript
  interface MentionEntity {
    type: 'workspace_file' | 'skill';
    id: string; // 路径或技能名称
    label: string;
    icon?: string;
  }
  ```
- **理由**: 复用现有的文件预览展示区域，减少 UI 层级的改变。

### 3. 光标定位与触发逻辑
使用原生的 `selectionStart` 和 `selectionEnd` 来检测输入框中的 `@` 位置，并使用简单的计算或第三方库（如 `textarea-caret`）获取坐标。
- **备选方案**: 使用 `antd` 的 `Mentions` 组件。
- **最终决定**: 手动监听。因为 `antd` 的 `Mentions` 对自定义渲染（如展示文件层级）的支持较弱，且我们的“选中实体变成上方 Chip”的逻辑超出了它的默认范畴。

### 4. 数据组装策略
在 `handleSend` 中，将选中的实体转化为 Prompt 的一部分或特殊的 `attachments` 结构。
- **实现**: 在发送前，将 `workspace_file` 路径转换为 `File: [path]` 格式追加到消息末尾或放入 RPC payload 的特定字段。

## Risks / Trade-offs

- **[Risk]**: 输入框内的 `@` 纯文本可能被用户误删，导致与上方的 Chip 状态不一致。
- **[Mitigation]**: 简化逻辑——不强制绑定文本位置。敲击 `@` 仅作为呼出面板的触发器，一旦选中，面板消失，实体加入上方列表，不强求在 `textarea` 中保留特定的 `@` 字符串（或者将其作为单纯的提示文本）。

## Migration Plan

1. 更新 `ChatV3.css` 增加 `+` 菜单和选择器的样式。
2. 重构 `V3InputArea.tsx` 的左侧图标区。
3. 实现 `V3MentionSelector` 并集成到 `V3InputArea`。
4. 更新 `useV3Messages.ts` 处理新类型的实体发送。
