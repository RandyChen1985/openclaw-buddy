# 🦞 OpenClaw Buddy (Windows GUI 版) 使用指引

欢迎使用 OpenClaw Buddy Windows 桌面版。本版本采用 **Wails + Gin** 架构，为您提供原生的桌面交互体验和后台常驻监控能力。

## 🚀 快速启动

1.  **获取程序**: 
    - 下载并解压 `release/openclaw-buddy-windows-vX.Y.Z.zip`（版本号与仓库根目录 `VERSION` 一致；亦可直接进入同名解压目录）。
2.  **运行程序**:
    - 双击运行 **`openclaw-buddy.exe`**。
    - **首次运行提示**: Windows 可能会弹出防火墙拦截提示，请务必勾选“允许访问”，否则面板将无法正常加载。
3.  **配置与运行**:
    - **配置**: 程序首次运行时会自动在同级目录下生成 `env` 文件及 `logs/`, `data/` 等文件夹。
    - **Token**: 首次启动后，可以通过控制台日志或直接查看 `env` 文件中的 `BUDDY_TOKEN` 获取登录令牌。
    - **WebView2**: 如果您的系统提示缺失组件，请按照引导安装微软的 WebView2 运行时。

## 🛠️ 桌面版说明（与当前实现一致）

-   **关闭主窗口**: 当前版本**未**接入 Windows **系统托盘**（通知区图标）；关闭 Wails 主窗口后，**整个 Buddy 进程会退出**，后台 Guardian 与 Gin 也会随之结束。若需要「无窗口常驻」，请使用 **`CLI_MODE=true`** 启动纯 Web 服务模式，并结合任务计划程序等自行托管。
-   **界面内「任务托盘」**: 面板里的 **TaskTray** 组件是**应用内**的任务/进度入口，与操作系统通知区托盘**不是**同一概念。
-   **一键配置**: 可通过修改 `env` 中的 `GUI_DISABLE_FEATURES` 隐藏部分菜单（如 `terminal`, `logs`）。
-   **API 与端口**: 桌面 WebView 通过运行时注入的 `window.__BUDDY_API_BASE__` 访问本机 Gin，**与 `env` 中的 `WEB_PORT`、`WEB_ROOT` 一致**，无需在浏览器侧写死端口。

## 🏗️ 开发者编译指引 (Windows 环境)

如果您想从源码自行编译，请确保已安装 **Go (1.25.0+)**, **Node.js** 和 **npm**。

1.  **项目主结构**:
    -   为了适配 Wails (v2) 构建系统，入口点已移动到根目录: `main.go`。
2.  **安装 Wails CLI**:
    ```bash
    go install github.com/wailsapp/wails/v2/cmd/wails@latest
    ```
3.  **一键编译（两种方式，任选其一）**  
    在仓库根目录执行。两种脚本**流程已对齐**：清理并同步前端到 `internal/api/dist`、**生产 + Debug** 两次 Wails 构建（均带 `-skipbindings`）、整理 `release/openclaw-buddy-windows-vX.Y.Z/` 并打 ZIP。

    | 方式 | 命令 | 说明 |
    |------|------|------|
    | **PowerShell（推荐）** | `powershell -NoProfile -ExecutionPolicy Bypass -File .\build_windows.ps1` | 默认 `npm` 使用 `--silent`，日志较干净。 |
    | **批处理** | 在 **CMD** 中：`build_windows.bat` 或 `cmd /c build_windows.bat` | 前端 `npm install` / `npm run build`**不**加 `--silent`，便于查看 Vite 完整输出。**勿在 Git Bash 下用 `./build_windows.bat`**。另：CMD 解析时 **`::` 行里的 `)` 仍会参与括号配对**，易弄乱 `if (...)` 块；本仓库脚本已改为 **`REM`** 且避免注释/echo 里多余括号；脚本首行会 **`cd /d "%~dp0"`** 保证在仓库根目录执行。 |

    **ZIP 失败**：若提示某 `.exe` 正被占用，请先**完全退出**已运行的 Buddy（含可能驻留的 `openclaw-buddy-debug.exe` 进程）后再执行脚本。

4.  **产物位置**:
    - 中间产物：`build/bin/openclaw-buddy.exe`（生产）、`build/bin/openclaw-buddy-debug.exe`（调试）。
    - 发布目录：`release/openclaw-buddy-windows-vX.Y.Z/`（上述两个 exe、示例 `env`、`README.md` 等）。
    - 归档：`release/openclaw-buddy-windows-vX.Y.Z.zip`（压缩包根目录为文件夹内**文件列表**，与脚本一致）。

### 📄 典型编译日志参考 (Success Log)
```text
[1/5] Version: 1.0.7
[2/5] Cleaning up internal assets...
[3/5] Building Frontend (React)...
> tsc -b && vite build
vite v5.x.x building for production...
✓ built in 24s
[3.2] Syncing Frontend Build to Internal Assets...
[4/5] Building Wails Binaries (Production & Debug)...
Built '...\build\bin\openclaw-buddy.exe' in ~1m.
Built '...\build\bin\openclaw-buddy-debug.exe' in ~1m.
[5/5] Organizing Release Folder...
[5.1] Creating ZIP archive...
==========================================
[SUCCESS] Windows Release Complete!
Final Package: release\openclaw-buddy-windows-v1.0.7.zip
==========================================
```

## 🔧 最近的重构与修复 (Cross-Platform & API Fixes)

为了支持跨平台并适配 Wails v2.12.0，我们对核心逻辑进行了以下调整：

-   **进程管理解耦**: `internal/api/websocket.go` 中原有的 Unix 特有 `syscall` 已被移除。通过 `process_unix.go` 和 `process_windows.go` (Build Tags) 实现平台差异化处理，**不会影响 Linux 和 Mac 的编译产物**。
-   **Wails API 适配**: 已适配 Wails v2.12.x 的 `AssetServer` 等配置；**系统托盘（TrayMenu）暂未启用**，与上文「关闭即退出」行为一致。
-   **构建环境容错**: 将启动时对 `openclaw` 二进制文件的检测改为警告而非崩溃，以支持在缺少依赖的环境上顺利生成 Wails 绑定。

## ⚠️ 注意事项

-   **防火墙提示**: 首次启动时，Windows 可能会弹出防火墙拦截提示，请允许其访问网络。
-   **单实例运行**: Windows 版支持单实例检测，如果已经启动了一个 Buddy，再次启动会提示。
-   **WebView2**: 如系统未安装，程序会引导下载。
