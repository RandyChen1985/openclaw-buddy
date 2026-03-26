# 🦞 有孚小龙虾带外监控服务 (Lobster Guardian)

[![Go Report Card](https://goreportcard.com/badge/github.com/yovole/openclaw-monitor)](https://goreportcard.com/report/github.com/yovole/openclaw-monitor)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**有孚小龙虾带外监控服务 (Lobster Guardian)** 是一个专为 **OpenClaw (小龙虾 AI Agent)** 设计的企业级、全功能带外管理 (Out-of-band Management) 与自愈系统。

---

## 📖 项目背景

OpenClaw 是一款强大的个人 AI 代理操作系统。由于其管理接口（Web UI & Channels）深度集成在网关进程中，一旦用户误修改 `openclaw.json` 配置或插件冲突导致网关崩溃，用户将失联。

**有孚小龙虾带外服务** 作为“带外哨兵”独立运行，提供实时监控、一键部署、流式登录捕获及自动故障恢复，确保 AI 代理始终在线。

## ✨ 核心特性

- **🖥️ 现代 Web 控制面板**：基于 React + Ant Design + Lucide 开发，支持响应式布局（移动端适配）。
- **🛡️ 智能自愈系统 (Self-Healing)**：
    - **多级回滚**：优先从 `backups/` 目录恢复已知健康的配置快照。
    - **软开关管理**：通过 SQLite 持久化存储自愈开关，支持“仅监测”或“全自动修复”模式。
    - **故障诊断**：自动生成差异报表 (Report) 并归档异常配置 (`.err`)。
- **📺 微信插件深度管理**：
    - **一键安装/配置**：自动化执行插件下载与启用配置。
    - **流式登录捕获**：实时监听 `openclaw` 输出，通过缓存与流解析技术，实现 **<5s** 的二维码秒出。
    - **状态固化**：提供插件运行状态及“上次成功检测时间”展示。
- **📊 运行指标可视化**：
    - **延迟统计**：即便在自愈禁用时，系统仍会持续收集心跳延迟指标并绘制趋势图。
    - **资源监控**：实时查看 CPU、内存、磁盘及系统健康日志。
- **🔗 龙虾面板透传**：集成 Reverse Proxy，在 Guardian 界面内通过反向代理直接访问 OpenClaw 原生 Dashboard。
- **🔔 飞书全能报警**：实时推送启动、故障、自愈及登录码获取等交互式卡片消息。

## 🏗️ 系统架构

```text
       [ 浏览器 / 移动端 ]
               │
       [ Guardian Web Server ] (Gin + React)
               │
    ┌──────────┴──────────┐
    │                    │
[ 监控回路 ]         [ 插件管理 ]
    │                    │
- 端口探针 (18789)    - 微信插件流式捕获
- 健康检查请求        - 插件生命周期控制
- 自动备份/回滚       - SQLite 配置持久化
- 趋势指标入库        - 反向代理 (Native UI)
```

## 🚀 快速开始

### 前提条件
- **Go 1.22+**
- **Node.js 18+** (用于前端编译)
- **OpenClaw** 环境已就绪

### 快速开发与预览
项目提供了一键开发脚本 `dev.sh`：
```bash
# 进入隔离开发模式（编译前端、构建后端、并在独立的 ./temp-dev-test 目录运行）
./dev.sh
```

### 生产部署 (Release)
项目支持在 Mac 上直接编译出适用于本地或 Linux 生产环境的安装包：

1.  **执行构建**:
    - **macOS (本地测试)**:
      ```bash
      ./build_mac.sh
      ```
    - **Linux (生产环境 - 交叉编译)**:
      ```bash
      ./build_linux.sh
      ```
2.  **获取产物**:
    构建完成后，产物位于 `release/` 目录下，形如 `lobster-guardian-linux-YYYYMMDD.tar.gz`。
3.  **部署至服务器**:
    将生成的 `.tar.gz` 压缩包上传并解压。
4.  **参数配置**:
    修改解压后目录内的 `env` 配置文件（如令牌 `GUARDIAN_TOKEN`）。
5.  **启动服务**:
    ```bash
    ./start.sh
    ```

## ⚙️ 配置文件说明 (env)

```env
WEB_PORT=3000                 # Guardian 面板端口
GUARDIAN_TOKEN="xxx"          # 访问面板所需的令牌
HEALTH_PORT=18789             # 小龙虾 (OpenClaw) 监听的地址
OPENCLAW_CONFIG_DIR="~/.openclaw" # 配置目录
CHECK_INTERVAL_SECONDS=30     # 监控扫描频率 (秒)
```

## 📄 开源协议

本项目基于 **MIT License** 开源，由有孚网络云枢中台团队维护。
