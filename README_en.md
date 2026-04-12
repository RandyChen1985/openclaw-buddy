# 🦞 OpenClaw Buddy Manifesto

![Banner](docs/images/banner.png)

> [🌈!NOTE💗]
> "I've heard people say that if coffee doesn't have a companion, it's not called coffee; it's called bitter water. In this era accustomed to polite rejections, even the air carries the dampness of solitude. But I've always felt that even a little crawfish made of code should have something to lean on.
>
> **OpenClaw Buddy**, it's just 0.01 centimeters away from you. It doesn't speak; it just stays by your side, watching over those little shrimp babies. I hope one day, you too will find someone who makes you no longer need a 'Watchdog Sentinel'." [简体中文](README.md) | [English]

[![Go Report Card](https://goreportcard.com/badge/github.com/yovole/openclaw-monitor)](https://goreportcard.com/report/github.com/yovole/openclaw-monitor) [![Go Version](https://img.shields.io/github/go-mod/go-version/yovole/openclaw-monitor?color=blue)](https://github.com/yovole/openclaw-monitor) [![Build Status](https://img.shields.io/badge/Build-Success-brightgreen)](https://github.com/yovole/openclaw-monitor) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-orange.svg)](https://github.com/yovole/openclaw-monitor/pulls) [![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)](https://github.com/yovole/openclaw-monitor/graphs/commit-activity) [![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](https://opensource.org/licenses/MIT)

**OpenClaw Buddy** is a professional-grade Out-of-band Management (OOB) and self-healing companion system designed specifically for **OpenClaw (Crawfish AI Agent)**.

Facing risks of "disconnection" caused by configuration errors or plugin conflicts, Buddy serves as an independent "Watchdog Sentinel," providing excellent real-time monitoring, streaming login capture, and automated failure recovery—an essential O/M tool for every power user of OpenClaw.

---

## 📸 Feature Preview

|          **System Dashboard**          |    **Streaming Login (Get QR)**    |
| :------------------------------------: | :--------------------------------: |
| ![Dashboard](docs/images/overview.png) |  ![GetQR](docs/images/getqr.png)   |
|        **Secure Login (Auth)**         |    **Scan to Login (Show QR)**     |
|    ![Login](docs/images/login.png)     | ![ShowQR](docs/images/showqr.png)  |
|           **Bots & Models**            | **Conversation Lab (Online Chat)** |
|     ![Bots](docs/images/bots.png)      |   ![Chat](docs/images/chat.png)    |

---

## ✨ Core Highlights

- **🛡️ Independent Sentinel (OOB)**: Runs as an independent process. Even if the OpenClaw gateway crashes, Buddy can remotely restart, rollback, and save the system.
- **⚡ Lightning-Fast Login**: Deep integration with WeChat plugins to capture login QR codes in real-time. Complete authorization in seconds.
- **🤖 Bot & Model Management**: Visually manage all bots and model mappings. Supports forced asset refreshing and real-time synchronization.
- **🩺 Intelligent Self-Healing**: Built-in heartbeat probes and multi-stage self-healing mechanisms. Automatically executes config rollbacks and backup snapshots upon detecting anomalies.
- **📊 O/M Dashboard**: Real-time tracking of CPU, memory load, API latency, and system logs. Monitor every heartbeat of your AI agent.
- **🔔 Feishu/Lark Alerts**: Real-time push for failures, self-healing events, and interactive login cards.

## ✨ Key Features

- **🖥️ Modern Web Control Panel**: Developed with React + Ant Design + Lucide, featuring responsive layout and **WebSocket real-time log tracking**.
- **🧪 Conversation Lab (Online Chat)**: Integrated streaming chat interface with one-click enabling/configuration, quick command management, and Markdown rendering.
- **🛡️ Intelligent Self-Healing System**:
  - **Multi-level Rollback**: Prioritizes recovery from known-healthy config snapshots in the `backups/` directory.
  - **Full Persistence**: Inspection history and self-healing events are persisted in SQLite for auditing and trend analysis.
- **📱 Device Center & Authorization**:
  - **Dual-state Management**: Clearly distinguishes between "Pending Connection Requests" and "Paired Compliant Devices."
  - **Online Approval**: Approve new device access requests directly via the Web interface.
- **🤖 Bots & Models**: Automatically parses `openclaw.json`, visually presents robot architecture, and supports manual synchronization.
- **📺 WeChat Plugin Management**: Automates plugin download and activation. Listens to `openclaw` output to capture login QR codes in real-time.
- **📊 Metric Visualization**: View real-time trends for CPU, memory, disk load, and response latency.
- **🔄 Async Task Management**: Critical operations (like restarts) use asynchronous task modes with task status tracking (Task ID).
- **🔗 Native UI Passthrough**: Integrated Reverse Proxy supports safe public access to the native UI via `EXTERNAL_DASHBOARD_URL`.

---

## 🏗️ System Architecture

OpenClaw Buddy adopts a non-intrusive "Sidecar" architecture, providing all-around reinforcement for OpenClaw through monitoring loops and management links.

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
2. **Get Artifacts**: Found in the `release/` directory. Upload to your server.
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

![Official WeChat Account](docs/images/%20gzh.png)
