# ChatV3 通信协议与数据结构调试指南 (v1.0.5+)

本手册记录了 OpenClaw Buddy ChatV3 模块的底层 WebSocket 通信协议结构、历史记录数据样例及实地调试方法，用于指导后续解析逻辑的排查与优化。

---

## 1. 核心消息结构 (Message Structure)

在 ChatV3 中，消息（Message）的 `content` 存在多种并存形态，解析逻辑必须具备高度的健壮性。

### A. 标准数组块 (Block Array) - 现代模型常用
模型返回的 `content` 是一个对象数组，每个对象表示一段不同类型的内容。

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "正在分析您的请求..." 
    },
    {
      "type": "text",
      "text": "你好，有什么我可以帮您的？"
    }
  ]
}
```
> [!NOTE]
> **变体注意**：
> - 思考字段可能名为 `thinking`, `thought` 或 `reasoning`。
> - 文本字段可能名为 `text` 或 `content`。

### B. 字符串 JSON (Serialized String) - 历史记录兼容
部分老旧的历史记录中，`content` 字段本身是一个被转义的 JSON 字符串数组。

```json
{
  "role": "assistant",
  "content": "[{\"type\":\"text\",\"text\":\"这是一条被转义的历史消息\"}]"
}
```
> [!IMPORTANT]
> 前端 `formatMessageContent` 必须探测到字符串以 `[` 或 `{` 开头时，先进行 `JSON.parse` 递归解包。

### C. 工具调用与结果 (Tool Chain)
当模型使用外部工具时，会插入 `toolCall` 或 `toolResult` 类型的块。

```json
{
  "type": "toolCall",
  "name": "web_search",
  "arguments": { "query": "OpenAI" },
  "id": "call_123456"
}
```

---

## 2. 如何测试与抓取实地数据

若怀疑解析逻辑出现偏差，应优先通过 Go 脚本直连网关抓取 raw 数据。

### 脚本说明
- `tests/manual/test_websocket_full.go`: **基础测试项**。用于验证 V3 握手、鉴权及单次对话的连通性。
- `tests/manual/scanner_v4.go`: **全量扫描器**。用于遍历最近 20 个会话的历史记录，并过滤打印非典型（异常）结构。

### 执行命令
```bash
# 进入项目根目录执行
/opt/homebrew/bin/go run tests/manual/scanner_v4.go
```

---

## 3. 解析逻辑要点 (Frontend Logic)

前端代码位于 `web/src/hooks/useChatV3WebSocket.ts` 中的 `formatMessageContent` 函数。

### 解析策略顺序：
1.  **Null 检查**：空内容返回空串。
2.  **递归 JSON 探测**：如果是以 `[` 开头的字符串，自动解包并进入数组解析流程。
3.  **数组 Block 解析**：
    *   **思考探测**：尝试获取 `thinking || thought || reasoning`，若存在则拼接 `> :::thinking` 容器。
    *   **工具探测**：转换 `toolCall` 和 `toolResult` 为标准 Markdown 引用块。
    *   **正文探测**：尝试获取 `text || content`。
4.  **字符串降级**：若既不是 JSON 字符串也不是数组，直接作为原始文本输出。

---

## 4. 常见问题排查 (Troubleshooting)

| 现象 | 可能原因 | 解决方案 |
| :--- | :--- | :--- |
| 消息气泡变空 | 模型下发的正文字段名既不是 `text` 也不是 `content` | 运行 `scanner_v4.go` 抓取 raw 结构，在 `analyze` 函数中查看 Key 列表 |
| 历史记录显示 JSON | 历史数据嵌套过深或 `JSON.parse` 逻辑未触达 | 增加递归解析层数 |
| 思考过程不显示 | `thinkingLevel` 为 `off` 或思考块 key 未被识别 | 检查 `analyze` 日志中 Thinking 对应的 key |

---
*末笔更新: 2026-04-10 | OpenClaw Buddy 开发团队*
