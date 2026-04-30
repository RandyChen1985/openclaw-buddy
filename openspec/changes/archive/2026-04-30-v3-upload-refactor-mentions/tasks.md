## 1. UI 基础与样式准备

- [x] 1.1 在 `web/src/styles/ChatV3.css` 中增加 `+` 菜单、提及选择器（Mention Selector）及 Chip 徽标的相关样式。
- [x] 1.2 重构 `web/src/components/Chat/V3InputArea.tsx`，将现有的 `Upload` 按钮包装进一个新的 `+` 号 `Dropdown` 菜单中。

## 2. 提及选择器组件实现

- [x] 2.1 创建 `web/src/components/Chat/V3MentionSelector.tsx`，实现精简版的搜索列表，支持 Tab 切换“文件”和“技能”。
- [x] 2.2 实现搜索过滤逻辑：调用 `/v1/openclaw/files/list` (针对当前工作区) 和 `/v1/openclaw/skills` 获取数据并支持模糊匹配。
- [x] 2.3 在选择器中实现基本的键盘导航（上下键切换、回车选中）。

## 3. 输入框集成逻辑

- [x] 3.1 在 `V3InputArea.tsx` 中实现对 `@` 键的监听逻辑，并计算弹出层位置（Popover）。
- [x] 3.2 扩展 `V3InputArea` 的 `files` 状态数组，支持 `workspace_file` 和 `skill` 类型的实体对象。
- [x] 3.3 更新预览区域渲染逻辑：为工作区文件和技能实体渲染对应的 Chip 徽标。

## 4. 发送逻辑适配

- [x] 4.1 更新 `web/src/hooks/chatV3/useV3Messages.ts` 中的 `handleSend` 方法，使其能识别并处理新类型的附件实体。
- [x] 4.2 确保在发送时，工作区文件的绝对路径能以约定格式（如 `File: [path]`）正确组装进最终的消息内容中。

## 5. 验证与优化

- [x] 5.1 验证通过 `+` 菜单触发提及功能的完整流程。
- [x] 5.2 验证在输入框手敲 `@` 呼出面板并选中实体的交互流程。
- [x] 5.3 验证带引用实体的消息发送后，后端能否正确接收并处理。
