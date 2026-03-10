# 🦞 有孚小龙虾带外服务 (Lobster Guardian)

[![Go Report Card](https://goreportcard.com/badge/github.com/yovole/openclaw-monitor)](https://goreportcard.com/report/github.com/yovole/openclaw-monitor)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**有孚小龙虾带外服务 (Lobster Guardian)** 是一个专为 **OpenClaw (小龙虾 AI Agent)** 设计的企业级带外管理 (Out-of-band Management) 程序。

---

## 📖 项目背景

OpenClaw 是一款强大的个人 AI 代理操作系统。由于其管理接口（Web UI & Channels）深度集成在网关进程中，一旦用户误修改 `openclaw.json` 配置导致网关无法启动，用户将彻底失去修复手段，形成“自闭环”失联。

**有孚小龙虾带外服务** 作为“带外哨兵”运行，确保在极端配置故障下能够通过多级自愈逻辑自动恢复服务。

## ✨ 核心特性

- **🛡️ 环境自检**：启动时自动校验 OpenClaw 环境，若未启动则输出警告并持续守候。
- **🔄 多级自愈 (Multi-tier Healing)**：
    - **Tier 1: 配置回滚**：自动从 `openclaw.json.bak` 恢复上一个稳定配置。
    - **Tier 2: 深度修复**：若回滚失败，调用 `openclaw doctor --fix` 自动修复运行环境。
- **📊 差异分析**：宕机时自动生成 Markdown 格式的故障差异报表（Diff Report）。
- **🔔 主动告警**：集成飞书 WebSocket 长连接模式，实时推送服务启动、故障及自愈成功的交互式卡片消息。
- **🔒 单例保护**：利用 `/tmp/lobster-guardian.pid` 文件锁防止多个实例冲突。

## ⚙️ 运行流程

```text
       [ Start Service ]
               │
       [ Singleton Check ] ──────▶ Fail? ──▶ Exit
               │
    [ Env & Path Check ] ────────▶ Fail? ──▶ Exit
               │
    [ Running Check ] ───────────▶ No? ───▶ Warning & Wait
               │
    ┌───▶ [ Health Probe ] (Every 30s)
    │          │
    │   [ Port & CLI Ok? ] ──────▶ Yes ───▶ Wait 30s ───┐
    │          │                                        │
    │          No                                       │
    │          │                                        │
    │   [ Self-Healing ] ◀──────────────────────────────┘
    │          │
    │   1. Backup current config (.err)
    │   2. Compare Diff & Generate MD Report
    │   3. Rollback (bak -> current)
    │   4. IF Fail -> Run 'openclaw doctor --fix'
    │   5. Force Restart (--force) (Non-blocking)
    │   6. Send Feishu Alert 🔔
    └──────────┘
```

## 📊 运行实例

以下是 `logs/guardian.log` 中记录的一次真实自愈过程：

```text
2026/03/10 12:25:23 🛡️ 有孚小龙虾带外服务已启动 (PID: 30362). 正在监控 OpenClaw...
2026/03/10 12:25:23 🛡️ 有孚小龙虾带外服务巡检循环已启动. Every 30 seconds.
2026/03/10 12:25:58 ✅ OpenClaw is healthy.
...
2026/03/10 12:27:53 ⚠️ Port 18789 is not listening! Service might be down.
2026/03/10 12:27:53 🛠️ Initiating self-healing process for reason: Port Down
2026/03/10 12:27:53 🔄 Attempting to recover service...
2026/03/10 12:27:53 ✅ Config rollback successful.
2026/03/10 12:27:53 🚀 Requesting gateway force start...
2026/03/10 12:27:53 ✨ Gateway start request sent. Self-healing cycle completed.
2026/03/10 12:27:53 🔄 Returning to monitoring loop...
2026/03/10 12:28:27 ✅ OpenClaw is healthy.
```

## 🛠️ 如何编译与打包

### 前提条件
- **Go 1.22 或更高版本**
  - *Linux 快速安装*:
    ```bash
    # 1. 下载并解压到 /usr/local
    wget https://go.dev/dl/go1.22.1.linux-amd64.tar.gz
    sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf go1.22.1.linux-amd64.tar.gz
    
    # 2. 配置环境变量 (写入 .bashrc)
    echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
    # 解决国内下载依赖失败问题 (设置 GOPROXY)
    echo 'export GOPROXY=https://goproxy.cn,direct' >> ~/.bashrc
    source ~/.bashrc
    
    # 3. 验证
    go version
    ```
- **系统已安装 `openclaw` 二进制文件**

### 快速开始
1. **一键构建**:
   ```bash
   ./build_release.sh
   ```
   构建完成后，产物位于：`temp/yovole-openclaw-monitor/`

2. **运行服务**:
   ```bash
   cd temp/yovole-openclaw-monitor
   
   # 编辑配置文件
   vi env
   
   # 启动服务
   ./start.sh
   ```

3. **配置飞书告警 (应用长连接模式)**:
   在 `env` 中配置：
   ```env
   FEISHU_ENABLED=true
   FEISHU_APP_ID="你的AppID"
   FEISHU_APP_SECRET="你的AppSecret"
   FEISHU_CHAT_ID="接收通知的群聊ID (oc_xxx) 或个人 ID (ou_xxx)"
   ```

## 📄 开源协议
基于 **MIT License** 开源。本项目由有孚网络云枢中台团队维护。
