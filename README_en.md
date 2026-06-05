# 🦞 OpenClaw Buddy Manifesto

![Banner](docs/images/banner.png)

> [🌈!NOTE💗]
> "I've heard people say that if coffee doesn't have a companion, it's not called coffee; it's called bitter water. In this era accustomed to polite rejections, even the air carries the dampness of solitude. But I've always felt that even a little crawfish made of code should have something to lean on.
>
> **OpenClaw Buddy**, it's just 0.01 centimeters away from you. It doesn't speak; it just stays by your side, watching over those little shrimp babies. I hope one day, you too will find someone who makes you no longer need a 'Watchdog Sentinel'." [简体中文](README.md) | [English]

[![GitHub stars](https://img.shields.io/github/stars/RandyChen1985/openclaw-buddy?style=flat-square&logo=github)](https://github.com/RandyChen1985/openclaw-buddy/stargazers) [![GitHub forks](https://img.shields.io/github/forks/RandyChen1985/openclaw-buddy?style=flat-square&logo=github)](https://github.com/RandyChen1985/openclaw-buddy/network/members) [![GitHub Release](https://img.shields.io/github/v/release/RandyChen1985/openclaw-buddy?label=release&logo=github&style=flat-square)](https://github.com/RandyChen1985/openclaw-buddy/releases) [![Go Report Card](https://goreportcard.com/badge/github.com/RandyChen1985/openclaw-buddy?style=flat-square)](https://goreportcard.com/report/github.com/RandyChen1985/openclaw-buddy) [![Go Version](https://img.shields.io/github/go-mod/go-version/RandyChen1985/openclaw-buddy?color=blue&style=flat-square)](https://github.com/RandyChen1985/openclaw-buddy/blob/main/go.mod) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-orange.svg?style=flat-square)](https://github.com/RandyChen1985/openclaw-buddy/pulls) [![Last Commit](https://img.shields.io/github/last-commit/RandyChen1985/openclaw-buddy?style=flat-square)](https://github.com/RandyChen1985/openclaw-buddy/commits) [![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg?style=flat-square)](https://opensource.org/licenses/MIT)

**OpenClaw Buddy** is a **zero-barrier Web console and conversation companion** built for **OpenClaw (Crawfish AI Agent)**.

No CLI memorization required—**non-technical users can get started too**: configure Bots, models, plugins, and channels with clicks in the panel. **Chat V3** delivers a **Codex-like unified experience**—**chat, Workspace files, Skills, and Console terminal** on one screen: edit files, tune skills, and watch output while you talk. When the gateway misbehaves, independent guardian & self-healing has your back. One browser for daily manage, chat, and channel binding.

---

## 📸 Feature Preview

|        **System Dashboard**        |       **Audit Monitoring**       |
| :--------------------------------: | :--------------------------------: |
| ![Dashboard](docs/images/overview.png) |   ![Audit](docs/images/audit.png)   |
|      **Expert Templates**       |       **Channel Binding**        |
| ![Template](docs/images/template.png) | ![Channel](docs/images/channel.png) |
|         **Bots & Models**          |        **Conversation Lab**        |
|    ![Bots](docs/images/bots.png)     |    ![Chat](docs/images/chat.png)    |

---

## ✨ Core Features

- **🎯 Zero Barrier to Entry**: Skip the CLI and hand-edited configs—visual wizards for Bot creation, model binding, channel setup, and device approval. No ops background required; open a browser and go.
- **🧪 Codex-Style Dialog Workspace (Chat V3)**: Streaming chat, multi-session and channel filtering, **LLM auto-generated session titles**; **Workspace files, Skills, and Console terminal** on the same screen—edit files, tune skills, and run commands while you chat; quick commands, Markdown, and **`?embed=true` clean embedding** (see below).
- **🖥️ Modern Web Control Panel**: React + Ant Design + Lucide, responsive layout, and **WebSocket real-time log streaming**.
- **🤖 Bots & Models**: Parses `openclaw.json` for architecture visualization, manages model mappings, and supports forced asset refresh and live sync.
- **🧩 Visual Skills & Plugin Management**: View, install, enable Skills and underlying plugins (WeChat, Telegram, etc.) from the Web UI; hot-reload configs without editing files or running commands.
- **📡 Multi-channel binding & visual setup**: **WeChat, Feishu/Lark, Telegram, QQ Bot**, and more—install/enable plugins, binding status, and options from the Web UI; for QR-based logins (e.g. WeChat), the console listens to gateway output and **streams the login QR code** for near-instant authorization.
- **🛡️ Independent Guardian**: Buddy runs as its own process. If the OpenClaw gateway fails, you can still remotely restart, roll back, and recover the system.
- **🩺 Intelligent Self-Healing**: Heartbeat probes and multi-stage recovery with automatic rollback and snapshots; prefers healthy configs from `backups/`; inspection and healing events **persisted in SQLite** for audit and trends.
- **📱 Device Center & Authorization**: Separates pending connection requests from paired devices; approve new devices from the Web UI.
- **📊 O/M Dashboard & Metrics**: CPU, memory, disk, API latency, and system/audit logs at a glance, with trend views where applicable.
- **🔔 Feishu/Lark Alerts**: Push failures, healing outcomes, and interactive cards for login and other flows.
- **🔄 Async Tasks**: Gateway restart and similar operations run asynchronously with **Task ID** status tracking.
- **🔗 Native UI Passthrough**: Built-in reverse proxy; pair with `EXTERNAL_DASHBOARD_URL` for safe public access to the native OpenClaw UI.

## 🧪 Codex-Style Dialog Workspace (Chat V3)

> 💡 **"Like Codex: chat, files, skills, and terminal in one view—no commands to memorize, no window hopping."**

![Chat V3 Premium Panel](docs/images/chat_v3_premium.png)

Native OpenClaw leans on CLI and a basic UI, which raises the bar for non-technical users. **Buddy's Chat V3** puts **conversation, Workspace, Skills, and Console** on one canvas: sessions on the left, chat in the center, files/skills/terminal on the right—a **Codex-like unified experience** with six core capabilities:

### 1. 📂 Workspace Files on the Same Screen (Deep Workspace Integration)
* **Bi-directional flow**: The system detects the active bot's workspace. An **online Workspace file explorer** lives in the right sidebar—create, rename, and edit/save files **without memorizing paths; click to edit**.
* **Isolated file uploads**: Uploaded files land in the bot's `workspace/uploads/` folder; each bot's files stay isolated while backend scripts can use the physical path (`absPath`).
* **Quick actions**: Attach files to the chat in one click, or save conversation content back to the Workspace from the explorer.
* **Skills in context**: **Skills** bound to the bot stay visible alongside workspace files—tune skills and keep chatting without switching tools.

### 2. 📟 Console Terminal on the Same Screen (Terminal Integration)
* A **remote Console / PTY terminal** (WebSocket) is embedded in the right sidebar—open with one click, no SSH or path juggling.
* **Smart path awareness**: The terminal auto-locates the active bot's Workspace. Non-technical users can watch output while chatting; power users can run builds and deploys when needed.

### 3. 💬 Channel & Session Management
* **Intelligent Title Summary (Auto-summarize)**：Powered by LLM, the system dynamically analyzes the first few exchanges in a conversation to auto-generate a precise, contextual title under 10 words, putting an end to generic "Untitled Sessions."
* **Full-Channel Streaming Capture**: Consolidates and clearly tags sessions routed from WeChat (`weixin`), Feishu/Lark (`feishu`), Telegram (`telegram`), System Dashboard (`dashboard`), API keys (`openai-user`), and sub-agents (`subagent`). Users can quickly classify, search, and filter sessions by channel icons and distinct colors.

### 4. ⚡ Quick Commands & Prompt Templates
* A visual quick-command bar above the input—**send common prompts in one click, no commands required**.
* System presets for frequent tasks; power users can add, edit, or remove custom prompts and insert them instantly.

### 5. 🔌 Seamless Standalone Embedding Support
* **Zero-Auth iframe Integration**: Perfect for integrating chat interfaces into dashboards, portals, or other systems. Simply append `?embed=true` to enable **Clean Mode**, hiding headers, sidebars, and all unnecessary controls.
* **Automatic Auth & Locking**: Seamlessly log in and lock onto specific Bots by passing URL parameters (`token`, `bot`, `user`). A "Get Embed Code" button inside the chat interface allows one-click generation of fully pre-configured `<iframe>` integration snippets.

### 6. 📊 Developer Aesthetics & Diagnostics
* **Smooth Resize Interaction**: Sidebar panes support smooth mouse drag-and-resize with automatic width memory (between 300px and 800px).
* **Streaming Formulas & WAF Penetration**: Built-in LaTeX/KaTeX formula rendering, code block syntax highlighting, and smooth Markdown formatting. The backend features **WAF penetration enhancement** (`X-Accel-Buffering no`), completely bypassing streaming buffers of intermediate proxies or Nginx gateways.
* **Transparent Performance Diagnostics**: The debugging pane provides real-time tracking of WebSocket heartbeat latency, TPS (Tokens Per Second) live graphs, and HTTP payload logs for direct performance auditing.


---

## 🏗️ System Architecture

OpenClaw Buddy uses a non-intrusive sidecar architecture: in the browser, it merges OpenClaw's **Workspace, Skills, Console, and chat** into one low-barrier entry point, with independent guardian capabilities when things go wrong.

```text
       [ Modern Browser / Mobile ]
                   │
       [ OpenClaw Buddy Server ] (Go + Gin + React)
                   │
    ┌────────────┼────────────┐
    │            │            │
[ Monitoring ] [ Asset Mgmt ] [ Plugin/Auth ]
    │            │            │
- Port Probe(TCP) - Model Test   - WeChat Login Capture
- Failure Analysis- Asset Sync   - Online Approval
- Auto Rollback   - Model Dist.  - Reverse Proxy (Native UI)
- Trend Reports   - Route Config - SQLite Persistence
```

---

## 🚀 Quick Start

### Prerequisites

- **Go 1.22+**
- **Node.js 18+** (for frontend compilation)
- **OpenClaw** environment ready

### Development & Preview

Use the provided one-click development script `dev.sh`:

```bash
# Enter isolated dev mode (compiles UI, builds backend, and runs in ./temp-dev-test)
./dev.sh
```

### Production Deployment (Release)

1. **Execute Build**: `./build_linux.sh` (cross-compile for Linux)
2. **Get Artifacts**: Prebuilt packages: [GitHub Releases](https://github.com/RandyChen1985/openclaw-buddy/releases). If you build from source, artifacts are under `release/`. Extract and upload to your server.
3. **Configuration**: Modify the `env` file (a random 16-character `BUDDY_TOKEN` is generated on first run).
4. **Start Service**: `./start.sh`

---

## 📂 Directory Structure

OpenClaw Buddy uses a standard modular design to ensure decoupling between monitoring and managed logic.

```text
.
├── cmd/monitor/             # [Entry] Main entry point, config loading, signal monitoring
├── internal/
│   ├── api/                 # [Service] Core Web API (Gin) with auth and static assets
│   ├── guardian/            # [Guardian] Sentinel logic for health checks and self-healing
│   ├── process/             # [Process] OpenClaw CLI interaction and WeChat/Bot management
│   ├── config/              # [Config] Environment variable parsing and global config
│   └── utils/               # [Utils] Shared utilities (SQLite, file locks, log rotation)
├── web/                     # [Frontend] React + Antd + Lucide dashboard
├── tests/                   # [Test] Integration tests, Feishu simulator, and CHECKLIST.md
├── docs/                    # [Docs] Images and supplementary documentation
├── openspec/                # [Spec] Design specs, features, and detailed changelogs
├── release/                 # [Release] Final production deployment packages
├── dev.sh                   # [Dev Script] Isolated full-stack dev script
├── Makefile                 # [Makefile] Cross-compilation and fast release workflows
├── Embedding.md             # [Doc] Integration guide for Online Chat embedding
├── API.md                   # [Doc] Detailed RESTful API definitions
└── README.md                # [Doc] Core manifesto and guide (this file)
```

---

## 🔌 API Specification

OpenClaw Buddy provides a set of standard RESTful APIs for external integration.

> [!TIP]
> For complete API definitions, request parameters, and response examples, please refer to the [API.md](API.md) document.

### Authentication

All V1 interfaces require authentication via HTTP Header:

- **Header**: `Authorization`
- **Value**: `Bearer <YOUR_BUDDY_TOKEN>`

### Core Interfaces (By Module)

#### 📊 Dashboard & Status

| Path                         | Method | Description                                     |
| :--------------------------- | :----- | :---------------------------------------------- |
| `/v1/openclaw/status`        | GET    | Get core gateway status, version, and uptime    |
| `/v1/openclaw/dashboard-url` | GET    | Calculate and return External Dashboard URL     |
| `/v1/gateway/start`          | POST   | Start OpenClaw gateway process                  |
| `/v1/gateway/stop`           | POST   | Stop OpenClaw gateway process                   |
| `/v1/gateway/restart`        | POST   | Restart gateway (**Async**, returns `taskId`)   |
| `/v1/tasks/status`           | GET    | Query progress of an async task (`?taskId=...`) |
| `/v1/stats/health`           | GET    | Get 24h heartbeat latency statistics            |

#### 💬 Online Chat

| Path                               | Method       | Description                                    |
| :--------------------------------- | :----------- | :--------------------------------------------- |
| `/v1/openclaw/chat/completions`    | POST         | **OpenAI compatible streaming chat service**   |
| `/v1/openclaw/chat/quick-commands` | GET/POST/DEL | Manage quick command phrases                   |
| `/v1/openclaw/chat/status`         | GET          | Check if gateway has `chatCompletions` enabled |
| `/v1/openclaw/sessions`            | GET          | Get active sessions and context usage          |

#### 🤖 Bots & Models

| Path                                 | Method   | Description                                        |
| :----------------------------------- | :------- | :------------------------------------------------- |
| `/v1/openclaw/bots-models`           | GET      | Get bot/model list (`?refresh=true` to force sync) |
| `/v1/openclaw/models/provider`       | POST     | Dynamically add API Provider config                |
| `/v1/openclaw/models/provider/model` | POST/DEL | Add or delete models for a specific channel        |
| `/v1/openclaw/models/set-default`    | POST     | Set system-wide default model                      |
| `/v1/openclaw/bots/add`              | POST     | Create and initialize a new bot                    |
| `/v1/openclaw/bots/set-identity`     | POST     | Modify bot display name                            |
| `/v1/openclaw/bots/set-model`        | POST     | Modify default model assignment for a bot          |
| `/v1/openclaw/bots/delete`           | POST     | Permanently remove a bot and its data              |

#### 🕹️ Skills

| Path                         | Method | Description                                         |
| :--------------------------- | :----- | :-------------------------------------------------- |
| `/v1/openclaw/skills`        | GET    | Get installed skills list (`?refresh=true` to sync) |
| `/v1/openclaw/skills/:name`  | DELETE | Uninstall a specific skill plugin                   |
| `/v1/openclaw/skills/reload` | POST   | Reload system rules and all skill plugins           |

#### 🔌 Channels

| Path                       | Method | Description                                       |
| :------------------------- | :----- | :------------------------------------------------ |
| `/v1/wechat/config/status` | GET    | Get current WeChat channel status                 |
| `/v1/wechat/install`       | POST   | Automate download and install of WeChat plugin    |
| `/v1/wechat/qrcode`        | GET    | **Stream capture** of WeChat plugin login QR code |

#### 📱 Devices

| Path                           | Method | Description                             |
| :----------------------------- | :----- | :-------------------------------------- |
| `/v1/openclaw/devices`         | GET    | Get device list (pending and paired)    |
| `/v1/openclaw/devices/approve` | POST   | Approve a new device connection request |

#### 🩺 Self-Healing

| Path                        | Method   | Description                                         |
| :-------------------------- | :------- | :-------------------------------------------------- |
| `/v1/heal/events`           | GET      | Query historical self-healing events and results    |
| `/v1/settings/self-healing` | GET/POST | Enable or disable automatic inspection and recovery |

---

## ⚙️ Configuration (env)

```env
WEB_PORT=3000                 # Guardian panel port
BUDDY_TOKEN="sk-xxx"          # Auth token for panel access
HEALTH_PORT=18789             # OpenClaw listening address
OPENCLAW_CONFIG_DIR="~/.openclaw" # Config directory
CHECK_INTERVAL_SECONDS=30     # Scan frequency (seconds)
EXTERNAL_DASHBOARD_URL="https://claw.yourdomain.com" # External URL prefix
```

---

## 🔌 Embedding Support

**OpenClaw Buddy** supports flexible external integration. You can embed specific modules (like Online Chat) as **Standalone** components into your business systems or dashboards using iframes.

> [!TIP]
> **🌈 Advanced User & Session Isolation:**
> For embedded environments, if you need to maintain separate conversation contexts for the same external user across different iframe views, you can combine the `user` parameter to achieve this. For example, use `?user=randy-session-001` to isolate a temporary session, or use `?user=randy` for standard persistent chat. This is exceptionally powerful for cross-system user mapping.

### Query Parameters

Control the behavior of the embedded page via URL parameters:

| Parameter | Required | Description                                             | Example                   |
| :-------- | :------: | :------------------------------------------------------ | :------------------------ |
| `embed`   |   Yes    | Set to `true` for **Clean Mode** (hides sidebar/header) | `?embed=true`             |
| `page`    |    No    | Specify target page, e.g.,`chat`                        | `?page=chat`              |
| `token`   |  Yes/No  | **Auto Auth**. Automatically logs in and records token  | `?token=YOUR_BUDDY_TOKEN` |
| `bot`     |    No    | Auto-select a specific**Bot ID** in chat                | `?bot=my_gpt4_bot`        |
| `user`    |    No    | Identify the current user for context tracking          | `?user=Randy`             |

### Iframe Example

To embed a chat window with a preset bot and auto-login:

```html
<iframe 
  src="http://your-buddy-ip:3000/?page=chat&embed=true&token=sk-xxx&bot=my-bot-id" 
  width="100%" 
  height="600" 
  frameborder="0"
></iframe>
```

> [!TIP]
> You can also click the **"Get Embed Code"** button in the top-right corner of the **Online Chat** page to generate a complete `<iframe>` snippet.

---

## 📄 License

This project is licensed under the **MIT License**. Maintained by randychen. Contact: [cexlong@gmail.com](mailto:cexlong@gmail.com)

---

### 💬 Contact & Community

If you have any questions, feature suggestions, or want to get the latest technical news about OpenClaw during use, you are welcome to scan the QR code to follow our **Official WeChat Account**:

<img src="docs/images/%20gzh.png" width="200" alt="Official WeChat Account" />
 
 ---
 
 ## 📈 Star History
 
 [![Star History Chart](https://api.star-history.com/svg?repos=RandyChen1985/openclaw-buddy&type=Date)](https://star-history.com/#RandyChen1985/openclaw-buddy&Date)
 
 ### Point ⭐ to Support
 
 If you find **OpenClaw Buddy** helpful, please give it a **Star** on GitHub 🌟. Your support is our motivation to keep improving!

