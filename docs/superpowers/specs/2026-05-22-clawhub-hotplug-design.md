# ClawHub 技能商城双模一键热装配系统设计规范

本设计文档规范了 OpenClaw Buddy 中“ClawHub 技能一键热装配与商城拉取”系统的实现方案。该系统旨在为开发者和用户提供极速的技能发现、自动物理目录装配，以及在服务器隔离内网环境下的智能“自愈网桥中转”，构建全自动的心智进化闭环。

---

## 1. ⚙️ 系统架构与数据拓扑

该系统采用**双模智能自适应装配机制**。系统会自动检测后端服务器的互联网连通性，并在“服务器直连下载”与“前端浏览器网桥中转”间无感切换，确保离线与在线环境下体验的完全对账。

```mermaid
graph TD
    User([👨‍💻 用户浏览器]) -->|1. 切换至探索市场| FE[💻 Frontend: V3SkillsDrawer]
    FE -->|2. GET /v1/openclaw/skills/market| BE[🐹 Backend Go: openclaw-buddy]
    
    %% 在线模式
    BE -->|3. 连通性测试| NetCheck{🌐 服务器外网连通?}
    NetCheck -->|A. 在线 (Online)| CH[☁️ ClawHub.ai Market API]
    CH -->|4. 返回 JSON 元数据| BE
    BE -->|5. 组装网关状态并返回| FE
    
    %% 安装流
    FE -->|6. 点击一键装配| BEInstall{POST /skills/install}
    BEInstall -->|连通➔直接流式下载| Tarball[📦 CDN 压缩包]
    BEInstall -->|解包到目标工作区| PathCheck[🔒 VerifySkillPath 越权校验]
    PathCheck -->|安全写入| TargetDir[(📂 bot_id/skills/ 专属目录)]
    
    %% 离线模式
    NetCheck -->|B. 离线 (Offline)| LocalFallback[⚠️ 触发前端网桥模式]
    LocalFallback -->|7. 浏览器静默代理下载| FE
    FE -->|8. POST /skills/upload 文件流| BE
    BE -->|9. 解压装配并审计| TargetDir
    
    %% 引擎同步
    TargetDir -->|10. 触发重载| Reload[🔄 ReloadOpenClawSkills]
    Reload -->|11. 广播通知| Event['openclaw:skills-updated']
    Event -->|12. UI 秒级无感重载| FE
```

---

## 2. 🔌 核心 API 接口定义

所有 API 均以统一的 `/v1` 为前缀，并严格受 `guardian_token` 认证及 RBAC 权限体系保护。

### 2.1 获取商城技能列表及连通性探测
* **请求路径**：`GET /v1/openclaw/skills/market`
* **接口说明**：后端探测与外部 `https://api.clawhub.ai` 的连接性，代理抓取最新商城数据，用于彻底防范前端跨域 (CORS) 限制。
* **响应 JSON 示例**：
```json
{
  "status": "success",
  "network_status": "online", // "online" (服务器可联网) | "offline" (服务器隔离内网)
  "data": [
    {
      "name": "EchartsPlotter",
      "description": "高颜值 Echarts 数据自动制图技能",
      "emoji": "📊",
      "version": "1.0.2",
      "tarball_url": "https://cdn.clawhub.ai/packages/echarts_plotter.tar.gz",
      "author": "ClawHub Team",
      "rating": 4.9,
      "requirements": {
        "bins": ["python3"],
        "env": ["PYTHONPATH"]
      }
    }
  ]
}
```

### 2.2 服务器直连静默热装配（在线模式）
* **请求路径**：`POST /v1/openclaw/skills/install`
* **接口说明**：后端发起流式网络下载与安全解包，采用异步任务队列机制防止 HTTP 超时挂起。
* **请求参数**：
```json
{
  "name": "EchartsPlotter",
  "tarball_url": "https://cdn.clawhub.ai/packages/echarts_plotter.tar.gz",
  "scope": "private", // "private" (私有专属) | "global" (系统共享)
  "bot_id": "current-bot-id" // 仅在 scope 为 private 时必填
}
```
* **响应**：`202 Accepted`，返回 `taskID` 用于前端异步状态轮询。

### 2.3 前端网桥流式中转上传装配（离线自愈模式）
* **请求路径**：`POST /v1/openclaw/skills/upload`
* **Content-Type**：`multipart/form-data`
* **接口说明**：当服务器无法访问外网时，由前端浏览器后台异步拉取 tarball 二进制包，并以此流式上传接口直接推送装配。
* **表单参数**：
  - `file`：压缩包二进制流（支持 `.tar.gz` 与 `.zip`）；
  - `scope`：`"private"` | `"global"`；
  - `bot_id`：要绑定并装配的目标 Bot 专属 ID。

---

## 3. 🔒 后端流式安全提取与目录穿越防护

为了保障物理路径安全，后端在执行解压提取时实施**零信任路径边界审计**：

1. **绝对前缀对账**：
   - 首先通过 `filepath.Abs` 计算解压目标根目录的绝对路径 `allowedPrefix`（例如：`/Users/username/.openclaw/workspace_bot1/skills`）。
2. **清除穿越字符**：
   - 提取 tarball/zip 内的每一项 header 时，通过 `filepath.Clean` 清理，强行过滤掉 `../` 等欺骗性相对路径符号。
3. **白名单前缀校对**：
   - 严密计算文件的最终写入绝对路径 `targetFileAbsPath`。
   - 强制校对 `strings.HasPrefix(targetFileAbsPath, allowedPrefix)`，一旦判定前缀不一致（入侵企图），**立即熔断中止解压**，抛出 `403 Forbidden`，并自动对已解压的临时垃圾文件实施强力物理清场与状态回滚自愈。

---

## 4. 🎨 前端极客级 WOW 进度交互 UI

1. **双模智能切流提示**：
   - 当 `network_status === "offline"` 时，用户点击一键装配，前端自动拉起磨砂毛玻璃半透明轻卡片，提示“服务器处于隔离环境，正在智能唤起【本地网桥】中转...”，整个下载与网桥传输完全自动进行，无需手动。
2. **科幻进度状态环 (Status Spinner)**：
   - 按钮在装配过程中通过过渡动画流畅流转：
     `[ ⏳ 正在校验 ]` ➔ `[ 📥 下载中 (45%) ]` ➔ `[ 🔒 安全提取中 ]` ➔ `[ 🔄 同步引擎 ]` ➔ `[ ✨ 装配成功 ]`。
   - 颜色随状态从青色（Teal）渐变至极客紫（Purple），最终显示绿色带呼吸效的成功态。
3. **全局无感刷新对账**：
   - 成功装配后，广播全局 `'openclaw:skills-updated'` 事件，可用技能抽屉列表毫秒级响应并自动重载。
