## 1. 基础准备与工具函数

- [x] 1.1 在 `V3SessionList.tsx` 中实现 `parseSessionKey` 工具函数，用于提取 `botId` 和 `source`
- [x] 1.2 定义 `SourceConfig` 映射表，包含 `dashboard`, `weixin`, `feishu`, `openai-user` 的图标和颜色配置
- [x] 1.3 实现 `getSourceMeta` 函数，支持未知来源的兜底逻辑（`Globe` 图标 + 灰色背景）

## 2. UI 组件改造

- [x] 2.1 改造 `V3SessionList` 中的普通会话项头像渲染，支持基于来源的动态图标与背景色
- [x] 2.2 实现右下角微型机器人身份勋章 (Bot Badge) 的渲染逻辑
- [x] 2.3 改造置顶会话（主会话）的头像渲染，保留金黄色调并优化图标显示
- [x] 2.4 优化会话项中的文本布局，确保在显示来源信息时不产生重叠
- [x] 2.5 改造 `ChatV3.tsx` 的 Header 区域，实现基于来源的彩色 Tag 展示
- [x] 2.6 在 Header 中增加机器人身份（名称+Emoji）的显性展示
- [x] 2.7 针对移动端优化 Header 布局：隐藏 Session ID，精简 Tag 文字，防止标题溢出
- [x] 2.8 进一步优化移动端：在 Header 中完全移除来源 Tag 以极致节省空间

## 3. 验证与润色

- [x] 3.1 验证不同来源（如 `agent:main:weixin:...` 和 `agent:main:openai-user:...`）的视觉呈现是否正确
- [x] 3.2 验证未知来源的兜底显示效果
- [x] 3.3 在移动端模式下进行视觉回归测试，确保复合头像的尺寸和间距适中
