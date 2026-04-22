# 🦞 OpenClaw Buddy 使用指南 (HOWTO)
> ![Banner](docs/mobile/howto.png)
> [🌈!NOTE💗]
> “其实了解一个系统并不代表什么，逻辑是会变的。今天它可能因为网络波动而沉默，明天它也可以因为配置冲突而任性。但我相信，有些守护是不会过期的。
>
> 这份指南不是为了教你如何完全控制，而是为了教你如何与它优雅地共处。即便在最孤独的深夜，当日志流如雨般落下，你也会在 **OpenClaw Buddy** 的引导下发现：原来运维，也可以是一场精准到 0.01 公分的重逢。”
>


欢迎使用 **OpenClaw Buddy**！本指南将带你深入了解如何高效使用这款专为 **OpenClaw (小龙虾 AI Agent)** 打造的自愈伴侣系统。

---

## 0. 安装与部署 (Installation & Deployment)

### 0.1 获取与解压
从 [GitHub Releases](https://github.com/RandyChen1985/openclaw-buddy/releases) 下载预编译包，或在本地执行 `./build_linux.sh` 后从 `release/` 目录获取 **Linux 全量包**（文件名形如 `openclaw-buddy-linux-<版本号>.tar.gz`，版本号随构建递增）。解压后进入与压缩包同名的目录即可：

```bash
tar -xzf openclaw-buddy-linux-1.0.0.tar.gz
cd openclaw-buddy-linux-1.0.0
```

> **Windows 桌面版**：为独立安装包（如 `openclaw-buddy-windows-vX.Y.Z.zip`），解压后运行 `openclaw-buddy.exe`，无 `start.sh`/`stop.sh`；详见仓库根目录下的 [README_windows.md](README_windows.md)。

### 0.2 配置指南
在运行目录下编辑 **`env`** 文件（文件名即为 `env`，不是 `.env`）。若该文件尚不存在，**首次启动**时会由程序自动生成一份模板；其中 **`BUDDY_TOKEN`** 在自动生成场景下为 `sk-` 前缀加随机十六进制串。Linux 发布包内附带的示例 `env` 可能为占位符 `sk-replace-me-on-first-run`，部署到生产环境前请务必改为强随机令牌；你也可以改为任意复杂字符串，不限于 `sk-` 前缀。

#### 关键配置项解读：
- **`WEB_PORT`**: Guardian 控制面板的 HTTP 监听端口，默认 `3000`。
- **`WEB_ROOT`**: 面板挂载的 URL 基础路径，默认 `/`；若设为子路径（如 `/claw`），访问地址需带上该前缀。
- **`BUDDY_TOKEN`**: **[安全]** 访问面板的认证令牌。
- **`DB_FILE`**: SQLite 数据库路径，默认 `./data/guardian.db`。
- **`OPENCLAW_CONFIG_DIR`**: **[核心]** OpenClaw 配置根目录（通常为 `~/.openclaw`），Buddy 会读取并监控其中的 `openclaw.json`。
- **`CHECK_INTERVAL_SECONDS`**: 健康巡检间隔（秒），代码默认 **`60`**（与发布包模板一致）。
- **`HEALTH_PORT`**: 网关健康检查 TCP 端口，默认 **`18789`**（须与 `openclaw.json` 中网关配置一致）。
- **`MAX_RETRIES`**: 自愈等逻辑的最大重试次数，默认 `3`。
- **`BACKUP_DIR` / `REPORT_DIR` / `LOG_FILE`**: 配置备份、故障报表与守护进程日志路径；日志轮转可通过 **`LOG_MAX_SIZE`**、**`LOG_MAX_BACKUPS`**、**`LOG_MAX_AGE`**、**`LOG_COMPRESS`** 调整（均有代码默认值，未写入 `env` 时即生效）。
- **`EXTERNAL_DASHBOARD_URL`**: 可选，填写后用于侧栏「外部工具」中安全跳转/透传原生 OpenClaw 面板等场景。
- **`SHOW_EXTERNAL_TOOLS`**: 是否显示「外部工具」菜单组，默认 `false`。
- **`GUI_DISABLE_FEATURES`**: 逗号分隔的功能开关，用于隐藏部分菜单（如 `terminal`、`logs`），Windows 图形版常用。
- **`CORS_ALLOW_ORIGINS`**: 嵌入或跨域访问时的 Origin 白名单（逗号分隔）；自动生成 `env` 时默认示例为 `https://yovole.com`，集成到自有域名时请改为包含实际业务 Origin 的列表。
- **`FEISHU_ENABLED`**: 是否开启飞书通知；为 `true` 时需同时配置 **`FEISHU_APP_ID`**、**`FEISHU_APP_SECRET`**、**`FEISHU_CHAT_ID`**。

### 0.3 启动与停止
**Linux 发布包**解压后，根目录内由 `build_linux.sh` 生成的 **`start.sh` / `stop.sh`** 与二进制 **`lib/openclaw-buddy`** 配套使用：

- **启动服务**（后台运行，PID 写入 `./pid/openclaw-buddy.pid`）:
  ```bash
  ./start.sh
  ```
- **停止服务**:
  ```bash
  ./stop.sh
  ```

从**源码**本地预览或调试，请使用仓库根目录的 **`./dev.sh`**（隔离目录、编译前后端），说明见 [README.md](README.md)。仓库源码根目录**默认不包含** `start.sh`/`stop.sh`，它们仅出现在打好的 Linux 包内。

### 0.4 查看日志
若需观察系统自愈过程或诊断异常，请查看 `logs/guardian.log`（路径可通过 `LOG_FILE` 修改）：

```bash
tail -f ./logs/guardian.log
```

### 0.5 访问
在浏览器中打开 `http://<主机>:<WEB_PORT><WEB_ROOT>/`（`WEB_ROOT` 为 `/` 时可简写为 `http://<主机>:<WEB_PORT>/`），使用 `env` 中的 `BUDDY_TOKEN` 登录。支持 URL 参数 `?token=...` 自动登录（常用于嵌入），详见下文第 9 节。

---

## 1. 登录与访问 (Login)

### 模块说明
这是进入 Buddy 系统的门户，确保只有持有正确 `BUDDY_TOKEN` 的管理员可以访问监控面板。

### 功能点
- **令牌认证**：输入在 `env` 文件中配置的 `BUDDY_TOKEN` 即可登录。
- **自动登录**：支持通过 URL 参数 `?token=xxx` 直接认证（常用于嵌入模式）。

![登录页面](docs/images/login.png)

---

## 2. 系统概览 (Dashboard)

### 模块说明
提供全方位的实时监控看板，让你对小龙虾网关的运行状态一目了然。

### 功能点
- **负载监控**：实时查看 CPU、内存占用以及工作区磁盘剩余空间。
- **健康指标**：展示系统运行状态（Running/Stopped）及连续运行时长（Uptime）。
- **生命周期控制**：直接在面板上执行网关的 **启动 (Start)**、**停止 (Stop)** 和 **异步重启 (Restart)**（重启等关键操作为异步任务，可结合界面上的任务提示查看进度）。
- **实时日志与终端**：支持 WebSocket 日志流、远程交互式终端（TUI）等能力，便于在网关异常时仍能从 Buddy 侧排查；具体菜单是否展示可通过 `GUI_DISABLE_FEATURES` 控制。
- **外部工具**：当 `SHOW_EXTERNAL_TOOLS=true` 且配置好 `EXTERNAL_DASHBOARD_URL` 等时，可从侧栏访问原生 OpenClaw 面板等外链能力。

![仪表盘](docs/images/overview.png)

---

## 3. 虾兵蟹将 (Bots & Models)

### 模块说明
管理 OpenClaw 的核心资产——机器人 (Bots) 与模型提供商 (Providers)。

### 功能点
- **机器人管理**：
  - **动态添加**：快速创建新的 Bot，并为其分配独立的隔离工作区。
  - **身份设置**：在线修改 Bot 的显示名称。
  - **模型分配**：为指定 Bot 覆盖默认的模型路由。
- **模型提供商 (Providers)**：
  - **多渠道配置**：支持添加自定义 BaseURL 和 API Key。
  - **连通性测试 (TTFT)**：由服务器发起直连测试，真实测量模型响应延迟，绕过浏览器跨域限制。
- **默认模型**：一键设定全局默认模型，简化新 Bot 的初始化流程。

![虾兵蟹将管理](docs/images/bots.png)

---

## 4. 对话实验室 (Online Chat)

### 模块说明
一个高度集成的 OpenAI 兼容对话测试环境，用于验证 Bot 与模型的响应质量。

### 功能点
- **流式对话**：支持流式 (Streaming) 响应，提供极致的打字机输入体验。
- **快捷指令**：管理预设的消息模板，点击即可快速发送常用调优指令。
- **会话监控**：实时查看当前网关中所有活跃会话的上下文使用情况。
- **一键嵌入**：提供嵌入代码，方便将对话窗口集成到你的其他业务平台。

### 4.1 V3 聊天：快捷按钮与 `quick:` 协议（给模型 / 集成方）

**对话实验室 V3** 除底部「快捷指令」按钮外，还支持在 **助手 Markdown 正文**里放置可点击的「伪链接」，点击后会把约定内容当作用户消息发出（与底部按钮同属「一键填充并发送」体验）。

1. **底部快捷指令条**  
   - 数据来自 Buddy API：`GET/POST/DELETE /v1/openclaw/chat/quick-commands`（每条含 **按钮名称 `label`** 与 **发送内容 `prompt`**）。  
   - 在已连接网关且非「新建会话占用」等阻塞态时，点击按钮即调用 `onSend(prompt)`，等价于你在输入框里粘贴 `prompt` 并发送。  
   - 展开/折叠状态在 V3 会写入浏览器 `localStorage`（键名 `v3_show_quick_actions`），与经典版实验室互不混用。

2. **Markdown 内联：`quick:` 链接**  
   - 语法：`[用户看到的文字](quick:这里是要发送的正文)`。  
   - 若正文含空格、中文、换行或特殊字符，请对 **`quick:` 之后的整段 payload** 先做 `encodeURIComponent` 再写入 `href`；前端会用 `decodeURIComponent` 还原后再发送。简单英文/数字也可不编码，例如：`[总结上文](quick:请用三句话总结上文)`。  
   - 实现上只要 `href` 以 `quick:` 开头，或 **任意位置包含** `quick:`（用于兼容少数被包在更长 URL 里的写法），都会截取 **最后一次出现的 `quick:`** 之后的字符串作为 payload。  
   - 该协议仅在 **V3 消息 Markdown 渲染器**中生效（`react-markdown` 的 `urlTransform` 会放行 `quick:`，避免被默认安全策略剥掉）。

更完整的 HTTP 字段与返回体见仓库 [API.md](API.md) 中「快捷指令」小节。

![对话实验室](docs/images/chat.png)

---

## 5. 微信插件与渠道 (WeChat & Channels)

### 模块说明
深度管理小龙虾的微信连接能力，解决扫码登录的痛点。

### 功能点
- **自动化安装**：一键触发微信插件的下载与启用。
- **二维码捕获**：实时监控网关日志，自动解析并渲染登录二维码，无需查看控制台。
- **连接状态**：直观展示微信插件当前的运行及绑定状态。

![获取二维码](docs/images/getqr.png)
![扫码登录](docs/images/showqr.png)

---

## 6. 设备中心 (Device Center)

### 模块说明
管理所有尝试连接到 OpenClaw 的客户端设备，确保接入安全。

### 功能点
- **联机批准**：实时捕获新设备的“待处理连接请求”。
- **双态管理**：清晰区分已配对的合法设备与恶意/未知的接入尝试。
- **一键授权**：点击即可批准通过认证的移动端或桌面端设备。

![设备中心](docs/images/device.png)

---

## 7. 智能自愈系统 (Self-Healing)

### 模块说明
这是 Buddy 的“灵魂”模块，负责在小龙虾遭遇故障时自动进行修复。

### 功能点
- **巡检审计**：记录每一次健康检查的结果及其响应时间（Latency）。
- **事件追踪**：详细展示自愈事件触发的原因、处理过程及最终结果。
- **故障报表**：当网关崩溃时，自动生成包含配置差异分析的 Markdown 报表，帮助精准定位问题。
- **开关管理**：支持手动开启或禁用自动巡检与自愈功能。

![自愈记录与恢复](docs/images/recover.png)

---

## 8. 技能管理 (Skills)

### 模块说明
管理已安装的小龙虾插件与技能扩展。

### 功能点
- **清单概览**：列出所有已加载的技能及其详细配置。
- **热重载**：修改文件后无需重启服务，通过“重载规则”即可将变更立即应用到运行中的 Bot。
- **插件卸载**：安全清理不再需要的技能插件。

![技能管理](docs/images/skills.png)

---

## 9. 高级：嵌入式集成 (Embed Support)

### 功能说明
Buddy 支持以嵌入模式运行，你可以将特定功能无缝挂载到自己的网站中。更完整的参数说明、Iframe 示例与跨域注意项见仓库中的 [Embedding.md](Embedding.md)。

### 常用参数
- `embed=true`：开启**纯净模式**，隐藏主导航与页眉，便于嵌入 Iframe。
- `page=chat`：直接进入对话实验室页面。
- `token=<BUDDY_TOKEN>`：静默登录（**请勿**将带真实 Token 的页面暴露在不受信任的公网路径）。
- `bot=<机器人 ID 或名称>`：预设默认对话的机器人。
- `user=<业务侧用户标识>`：用于区分不同终端用户的会话上下文（多租户/集成场景）。

![嵌入模式示例](docs/images/embed.png)

---

## 10. 移动端体验 (Mobile Experience)

### 模块说明
Buddy 专为移动端操作进行了极致优化，支持响应式布局，让你在手机上也能优雅地掌控 AI 服务。无需常驻电脑前，随时随地管理你的 Agent。

### 效果预览

| **仪表盘/操作面板 (Dashboard)** | **实时对话实验室 (Online Chat)** |
| :---: | :---: |
| ![仪表盘](docs/mobile/dashboard.png) | ![对话](docs/mobile/chat.png) |
| **运行环境监控 (Runtime)** | **动态技能管理 (Skills)** |
| ![运行环境](docs/mobile/operater.png) | ![技能](docs/mobile/skills.png) |
| **微信渠道交互 (Channels)** | **秒级添加机器人 (Add Bot)** |
| ![渠道](docs/mobile/channel.png) | ![添加机器人](docs/mobile/addbot.png) |
| **模型源管理 (Models)** | **智能自愈监控 (Self-Healing)** |
| :---: | :---: |
| ![添加模型](docs/mobile/addmodel.png) | ![自愈监控](docs/mobile/recover.png) |

---

*“让 OpenClaw 的运维从此优雅，让每一个 AI 代理都有不灭的灯塔。”*
