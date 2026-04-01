# 专家市场 (Expert Market) 与克隆工作站设计指南

## 1. 设计哲学：从“对话模板”到“思维操作系统”

在 OpenClaw Buddy 的愿景中，专家（Expert）不再仅仅是一段简单的 System Prompt 或对话范例，而被定义为一个完整的 **“思维操作系统 (Thinking OS)”**。

### 核心转变：
- **过去**: 机器人只知道“如何说话”。
- **现在**: 通过 `IDENTITY.md` 与 `SOUL.md` 的双重注入，机器人知道了“我是谁”、“我的边界在哪里”以及“我该如何思考”。

---

## 2. 核心架构逻辑

专家定义的标准化由两个核心 Markdown 文件驱动，确保了定义的高度可扩展性与 LLM 兼容性。

### 2.1 身份定义 (IDENTITY.md) —— 行为边界与权限
其逻辑借鉴了企业级安全审计思路，包含：
- **角色标识 (Identity)**: 明确职级与核心职责。
- **权限定义 (Capabilities)**: 明确定义 AI 的物理操作边界（如只读路径、允许执行的终端指令、被禁止的操作）。
- **技能绑定 (Skills)**: 定义该专家原生具备的专业工具调用能力。

### 2.2 思维之魂 (SOUL.md) —— 认知模型与哲学
这是专家的“底层驱动引擎”，包含：
- **存在哲学 (Core Philosophy)**: 专家的核心价值观（如：架构师的“权衡为王”、律师的“绝对合规”）。
- **认知循环 (Reasoning Loop)**: 规定了 AI 在处理问题时的标准思维路径（如：感知 -> 检索 -> 推演 -> 表达）。
- **禁止行为 (Negative Constraints)**: 设立硬性防护栏，防止 AI 输出过时或低质量内容。

---

## 3. 功能模块实现

### 3.1 专家市场 (Expert Marketplace)
- **多维色谱布局**: 采用类别专属配色方案（Pastel Colors），通过色彩直观区分技术、法律、创意等领域。
- **高密度网格**: 针对桌面端优化的一行 4 列 (或更多) 紧凑布局，提升信息获取效率。
- **高对比度标签**: 采用毛玻璃背景与深色文字，确保在任何主题色下标签均清晰可辩。

### 3.2 克隆工作站 (Clone Station - Wizard)
引入了仪式感极强的“三步走”机器人初始化向导：
1.  **Step 0: 核心锚定**: 配置机器人工作区 ID 与首选 LLM 模型。
2.  **Step 1: 大脑重塑**: 提供 1100px 宽屏编辑环境。
    - **分屏预览**: 左侧编辑 Markdown 源码，右侧实时渲染最终视觉效果。
    - **Token 治理**: 实时估算 `IDENTITY` 与 `SOUL` 的 Token 消耗，提供上下文安全阈值预警。
3.  **Step 2: 启动克隆**: 最终配置审查，确认为所见即所得。

---

## 4. 技术架构实现细节 (Technical Details)

### 4.1 后端结构体演进 (Expert Struct)
在 `internal/process/openclaw.go` 中，`Expert` 结构体进行了关键扩展，以支持原生 Markdown 描述：
```go
type Expert struct {
    ID          string   `json:"id"`
    // ... 基础属性 ...
    Soul        string   `json:"soul"`        // 思维之魂 Markdown
    IdentityMD  string   `json:"identity_md"` // 身份定义全量 Markdown
    Identity    struct {                      // 旧版兼容结构
        Name string `json:"name"`
        Bio  string `json:"bio"`
    } `json:"identity"`
    Skills      []string `json:"skills"`
}
```

### 4.2 异步创建与降级渲染逻辑
`CreateBotFromExpert` 函数采用“多级回退策略”确保数据完整性：
1.  **优先级 1 (Custom Payload)**: 优先采用前端通过 API `handlers.go` 传入的实时修改内容。
2.  **优先级 2 (Template Markdown)**: 使用内置 JSON 模板中的 `identity_md`。
3.  **优先级 3 (Legacy Fallback)**: 若上述均缺失，触发 **降级渲染器**：将旧版 JSON 属性通过 `fmt.Sprintf` 渲染为标准的 Markdown 身份卡片。

### 4.3 前端三阶段向导状态机
`ExpertMarket.tsx` 通过 Ant Design 的 `Steps` 组件驱动向导流程，并维持核心状态：
- **`currentStep`**: 驱动 UI 切换（0: 锚定, 1: 重塑, 2: 启动）。
- **`Token Estimation`**: 
  - 算法：`chineseChars + (nonChineseChars / 2.8)`。
  - 动态反馈：通过 `onChange` 钩子实时重新计算，并根据阈值（3k Tokens）改变 UI 提示色（Green -> Orange）。
- **分屏渲染**: 利用 `ReactMarkdown` 与 `remarkGfm` 插件实现编辑器与预览区的 1:1 对照。

### 4.4 API 协议契约 (API Contract)
接口 `POST /v1/openclaw/bot/create_from_expert` 的 Payload 结构：
```json
{
  "expert_id": "architect",
  "bot_id": "my_new_bot",
  "model_id": "deepseek-chat",
  "soul": "# Custom Soul 内容...",      // 可选：覆盖模板
  "identity_md": "# Custom Identity..." // 可选：覆盖模板
}
```

### 4.5 文件系统落盘 (File System Architecture)
每个机器人克隆后，其核心“意识文件”将严格按照以下路径进行持久化存储：
- **根目录**: `~/.openclaw/workspace_[bot_id]/`
- **身份文件**: `IDENTITY.md` (定义角色、权限、边界)
- **性格文件**: `SOUL.md` (定义认知循环、哲学、禁止行为)
- **隔离性**: 每个机器人的意识文件相互独立，支持在克隆后进行二次手动微调。

---
*文档版本：v1.5.0*  
*更新日期：2026-03-30*
*维护者：Antigravity Agent*
