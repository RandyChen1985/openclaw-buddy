# 🧩 嵌入式集成与独立对话开发指南 (Embedding.md)

本指南旨在帮助开发者将 **OpenClaw Buddy** 的“对话实验室 (Online Chat)”功能快速集成到现有业务系统中（如 CRM、OA、门户网站），或作为高性能的独立 AI 对话窗口使用。

---

## 1. 💡 为什么使用嵌入模式？

在以下场景中，嵌入模式将为您节省大量的开发与运维成本：

-   **低代码集成**：现有的业务系统（如企业 OA 或客户子系统）需要 AI 问答功能，直接通过 Iframe 接入，无需从零开发复杂的流式对话 UI。
-   **多租户身份隔离**：利用 `user` 参数，您可以在同一个机器人下，为成千上万个业务侧用户提供**互不干扰**的私聊记录（聊天记录基于您的业务 UID 存储在云端）。
-   **沉浸式体验**：通过 `embed=true` 参数，系统会自动剥掉所有管理壳（菜单栏、页眉），使 AI 对话窗口与您的业务系统高度融合。
-   **调试与外链**：您可以为不同的团队发送专属的机器人链接，用户点开即聊，无需关心后台复杂的配置。

---

## 2. ⚙️ URL 参数矩阵

通过灵活组合 URL 参数，您可以从外部精准调控对话环境：

| 参数 | 类型 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- | :--- |
| **`embed`** | `bool` | 是 | **纯净模式开关**。设置为 `true` 时隐藏侧边栏和顶栏。 | `embed=true` |
| **`page`** | `string` | 是 | **路由重定向**。必须设置为 `chat` 才能直接进入对话实验室。 | `page=chat` |
| **`token`** | `string` | 建议 | **身份令牌**。传入 `BUDDY_TOKEN` 实现静默登录（免去手动输入密码）。 | `token=...` |
| **`bot`** | `string` | 否 | **预选机器人**。指定 Bot ID (如 `1001`) 或名称 (如 `运维助手`)。 | `bot=1001` |
| **`user`** | `string` | 否 | **用户标识**。用于区分不同集成方用户的历史记录，实现会话隔离。 | `user=staff_9527` |

---

## 3. 🚀 快速集成示例

### A. Iframe 嵌入方式 (最常见)

您可以直接将以下代码片段嵌入到业务系统的 HTML 中：

```html
<!-- OpenClaw Buddy AI 助手嵌入示例 -->
<iframe 
  src="http://your-server-address:3000/?page=chat&embed=true&token=YOUR_TOKEN&bot=DEFAULT_BOT&user=BUSINESS_UID" 
  width="100%" 
  height="700" 
  frameborder="0"
  style="border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1);"
  allow="clipboard-read; clipboard-write; microphone"
></iframe>
```

### B. 独立对话模式

如果您希望在点击某个按钮后弹出一个新窗口进行对话：

```javascript
const openAiAssistant = (uid) => {
  const baseUrl = "http://your-server-address:3000/";
  const params = new URLSearchParams({
    page: "chat",
    embed: "true",
    token: "YOUR_TOKEN_HERE",
    user: uid, // 传入当前系统的用户ID
    bot: "DeepSeek-V3" // 预选机器人
  });
  window.open(`${baseUrl}?${params.toString()}`, "_blank");
};
```

---

## 🔒 4. 安全最佳实践 (重要)

> [!WARNING]
> **保护您的 Token**
> 由于 `token` 在 URL 中可见，请务必遵守以下原则：

1.  **内网优先**：尽量在内域网或 VPN 环境下使用集成功能。
2.  **HTTPS 强制**：在公网部署时，请务必开启 SSL/TLS 加密，确保 Token 不会在链路中被拦截。
3.  **定时轮转**：定期更换 `env` 文件中的 `BUDDY_TOKEN`。
4.  **代理透传**：如果安全要求极高，建议通过后端代理包装请求，由您的后端生成包含 Token 的 URL，而不是在前端静态硬编码。

---

## 5. 🛠️ 特色交互说明

-   **响应式布局**：即使在高窄的侧边栏窗口（如 Iframe 宽度 < 400px）中，UI 也会自动切换到移动端视图。
-   **流式渲染**：完全支持 SSE (Server-Sent Events)，回复极速流畅。
-   **Markdown 支持**：支持代码高亮、表格、数学公式及流程图渲染。
-   **会话保持**：即使刷新页面，只要 `user` 标识一致且 Token 未失效，之前的对话内容会自动拉回。

---
*OpenClaw Buddy - 为您的业务插上 AI 的翅膀。*
