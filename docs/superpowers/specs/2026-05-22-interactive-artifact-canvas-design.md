# 💡 Interactive Artifact Canvas (IAC) 实时交互画布设计规格书 (Spec)

本文档定义了 OpenClaw Buddy 中基于**渐进式 iframe 安全沙箱**的 **Interactive Artifact Canvas (IAC)** 实时交互画布的设计与实现规范。该功能旨在捕获大模型输出的 HTML/JS/SVG/Mermaid 内容，在右侧提供沉浸式的沙箱运行与可视化预览，打造媲美一流 AI 平台的“一键生成、实时执行”体验。

---

## 1. 业务目标与价值

*   **极客级交互手感**：消除聊天流中超长代码块对阅读的阻碍。代码生成后，用户可一键开启右侧画布查看渲染效果（如单页应用、动态图表、小游戏等）。
*   **全景架构可视化**：聊天中的 Mermaid 流程图或 SVG 矢量图能秒级解析渲染，免去用户手动复制或借助第三方工具二次渲染的麻烦。
*   **流式渐进展示**：在大模型打字流式输出代码的过程中，右侧画布以节流（Throttle）的频次同步渲染，使用户能直观见证应用的生成历程。
*   **绝对安全屏障**：引入严格的 iframe unique-origin 沙箱，确保生成的任意未知 JS 脚本在绝对物理隔离的环境下运行，100% 无法劫持宿主系统的终端或 LocalStorage。

---

## 2. 核心架构与数据流

本方案采用纯前端组件内聚与 React Context 跨组件通讯架构。

```mermaid
graph TD
    subgraph 聊天面板 (V3MessagePane)
        A[大模型消息流] -->|实时解析识别| B(代码块拦截器 Parser Interceptor)
        B -->|折叠代码块| C[交互卡片 Component Card]
        C -->|点击 预览 / 自动激活| D(广播 setActiveArtifact)
    end

    subgraph 共享状态 (ActiveArtifactContext)
        D -->|广播更新| E[共享状态: activeArtifact & canvasVisible]
    end

    subgraph 画布面板 (V3CanvasPane)
        E -->|React 渲染驱动| F[V3CanvasPane 容器]
        F -->|HTML/JS| G[iframe 独占沙箱 + srcDoc]
        F -->|Mermaid| H[Mermaid.js 运行时动态解析]
        F -->|SVG| I[原生 SVG DOM 安全注入]
    end
```

### 数据契约 (State Schema)

```typescript
export interface Artifact {
  id: string;          // 唯一ID (由 messageId + 索引组合)
  title: string;       // 文件名或图表名 (如 index.html, diagram.mermaid)
  type: 'html' | 'mermaid' | 'svg';
  code: string;        // 实时/最终代码内容
  messageId: string;   // 关联的消息ID
}
```

---

## 3. 拦截与提取引擎 (Parser Interceptor)

在 `web/src/views/chatV3/V3MessagePane.tsx` 的 Markdown 渲染器中，拦截所有 ` ```html `、` ```mermaid ` 与 ` ```svg ` 代码块：
1.  **提取内容**：使用非贪婪正则实时提取完整代码段。
2.  **折叠刷屏**：在聊天气泡中将原有代码块重构为以下卡片：
    ```
    +-------------------------------------------------------------+
    │  📄  交互画布: [贪吃蛇游戏.html]   (大小: 12.4 KB)          │
    +-------------------------------------------------------------+
    │  [ 👁️ 预览此应用 ]  [ 📋 复制代码 ]  [ 💾 下载文件 ]         │
    +-------------------------------------------------------------+
    ```
3.  **流式自适应**：如果消息是 `isTyping` 状态，拦截器会实时监听末尾未闭合的代码块，提取已生成的部分并维持实时更新。

---

## 4. UI 布局与端自适应 (UI Layout)

### 4.1 右侧面板扩容
*   **平滑宽度调节**：当 `canvasVisible === true` 且激活预览时，右侧 Dock（`V3RightDock`）会自动展开。为提供完美的视觉体验，宽度会自动从默认的 400px **平滑动画拉伸至 650px (或占用 50% 屏幕宽度)**。
*   支持用户自由拖拽分栏的拉伸手柄调节尺寸。

### 4.2 画布面板 (V3CanvasPane) 的交互架构
*   **顶部控制条 (Control Header)**：
    *   **版本归档下拉框**：同一会话多次修改生成同一文件名的代码时，归档为 `v1`, `v2`, `v3 (最新)`，点击可快速回溯。
    *   **预览/代码双态 Tab**：可在 `[ 👁️ 预览 ]` 和 `[ 💻 代码 ]` 之间以优雅的扁平动效自由切换。
    *   **动作组**：
        *   `[ ↗ 独立标签页全屏打开 ]`：通过 `window.open` 一个临时的 `Blob URL`，使用户脱离侧边栏以 100% 全屏无干扰形式运行游戏或网页。
        *   `[ 📋 复制代码 ]`。
*   **主视口 (Main Viewport)**：包含 iframe 独立渲染窗口、Mermaid 挂载 DOM 或代码高亮容器。
*   **底部操作栏 (Footer)**：提供一键打包下载、或 Mermaid/SVG 导出为 PNG/SVG 的便捷工具。

### 4.3 移动端适配
*   在屏幕宽度小于 768px 的移动端，不再展示左右分栏。
*   点击预览时，系统将弹出一个 **100vh 的全屏覆盖高斯沉浸式抽屉**，提供清晰大字号的 `[关闭返回]` 按钮，保证单手掌控感。

---

## 5. 安全沙箱与防护 (Security Sandbox)

### 5.1 物理隔离
所有的 HTML/JS 渲染必须强制限制在 `iframe` 中运行：
```html
<iframe
  srcDoc={safeHtmlContent}
  sandbox="allow-scripts allow-downloads allow-modals allow-popups allow-forms"
/>
```
*   **禁止 `allow-same-origin`**：使得 iframe 拥有独立的 `unique origin`。无法读取父级 LocalStorage、IndexedDB 和 Cookie，也无法操作 `window.parent` 执行任何宿主系统提权操作。

### 5.2 报错自愈提示 (Error Boundaries)
在 iframe 的 `srcDoc` 生成时，HTML 头部会自动注入一段小型报错捕捉脚本：
```javascript
window.onerror = function(message, source, lineno, colno, error) {
  window.parent.postMessage({
    type: 'CLAW_SANDBOX_ERROR',
    error: { message, lineno, colno }
  }, '*');
};
```
主页面监听此消息，并在画布底部友好展示错误堆栈小横幅，点击直接跳转至“代码态”并高亮对应行。

---

## 6. 主题与样式自适应 (Theme Adaptation)

*   **Mermaid 护眼自适应**：
    渲染 Mermaid 时根据全局的 `isDarkMode` 动态进行初始化，确保在暗色背景下不会出现黑线黑字：
    ```typescript
    mermaid.initialize({
      theme: isDarkMode ? 'dark' : 'default',
      themeVariables: isDarkMode ? { background: '#0f172a' } : {}
    });
    ```
*   **SVG 文字反转滤镜**：
    在暗色模式下，对渲染的原生 SVG 代码动态添加 CSS 滤镜 `filter: invert(0.95) hue-rotate(180deg)`，低成本、零闪烁实现完美暗化。

---

## 7. 实施路线图 (Roadmap)

1.  **Phase 1: React Context 与数据捕获**：在 `V3MessagePane` 中编写 Parser Interceptor，定义卡片 UI，建立顶层共享 Context。
2.  **Phase 2: 画布骨架与 Iframe 沙箱**：构建 `V3CanvasPane.tsx`，编写带 `sandbox` 及注入错误监控的 `srcDoc` 逻辑，处理 iframe Blob 全屏动作。
3.  **Phase 3: 整合 Right Dock 与动画扩容**：将 Canvas 注册为 Right Dock 的选项卡，实现 Dock 面板宽度的平滑扩宽动效。
4.  **Phase 4: 多功能适配与调优**：完成 Mermaid 动态渲染逻辑、移动端全屏抽屉开发，以及 SVG 滤镜智能反色。
