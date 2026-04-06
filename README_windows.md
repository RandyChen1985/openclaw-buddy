# 🦞 OpenClaw Buddy (Windows GUI 版) 使用指引

欢迎使用 OpenClaw Buddy Windows 桌面版。本版本采用 **Wails + Gin** 架构，为您提供原生的桌面交互体验和后台常驻监控能力。

## 🚀 快速启动

1.  **获取程序**: 
    - 下载并解压 `release/openclaw-buddy-windows-v1.0.4.zip` (或直接进入 `release/openclaw-buddy-windows-v1.0.4/` 目录)。
2.  **运行程序**:
    - 双击运行 **`openclaw-buddy.exe`**。
    - **首次运行提示**: Windows 可能会弹出防火墙拦截提示，请务必勾选“允许访问”，否则面板将无法正常加载。
3.  **配置与运行**:
    - **配置**: 程序首次运行时会自动在同级目录下生成 `env` 文件及 `logs/`, `data/` 等文件夹。
    - **Token**: 首次启动后，可以通过控制台日志或直接查看 `env` 文件中的 `BUDDY_TOKEN` 获取登录令牌。
    - **WebView2**: 如果您的系统提示缺失组件，请按照引导安装微软的 WebView2 运行时。

## 🛠️ 桌面特有功能

-   **隐藏到托盘**: 点击窗口右上角的 `X` 按钮，程序不会退出，而是隐藏到系统托盘（任务栏右下角 🦞 图标），监控任务在后台继续运行。
-   **系统托盘菜单**:
    - **显示面板**: 重新呼出 UI 窗口。
    - **查看日志**: 调用记事本直接查看 `logs/guardian.log`。
    - **彻底退出**: 停止所有监控服务并退出程序。
-   **一键配置**: 您可以通过修改 `env` 中的 `GUI_DISABLE_FEATURES` 来隐藏某些不常用的菜单项（如 `terminal`, `logs`）。

## 🏗️ 开发者编译指引 (Windows 环境)

如果您想从源码自行编译，请确保已安装 **Go (1.25.0+)**, **Node.js** 和 **npm**。

1.  **项目主结构**:
    -   为了适配 Wails (v2) 构建系统，入口点已移动到根目录: `main.go`。
2.  **安装 Wails CLI**:
    ```bash
    go install github.com/wailsapp/wails/v2/cmd/wails@latest
    ```
3.  **一键编译**:
    在根目录下直接运行（使用 PowerShell）：
    ```powershell
    # 推荐方法 (绕过脚本执行策略限制):
    powershell -ExecutionPolicy Bypass -File .\build_windows.ps1

    # 或者使用传统批处理 (CMD/PowerShell 均可):
    .\build_windows.bat
    ```
    该脚本会自动处理 `npm install`、资源同步、Wails 打包以及 `release` 目录的自动生成。
4.  **产物位置**:
    编译成功的可执行文件位于 `build/bin/openclaw-buddy.exe`。
    最终打包归档位位于 `release/openclaw-buddy-windows-vX.Y.Z.zip`。

### 📄 典型编译日志参考 (Success Log)
```text
[1/5] Version: 1.0.4
[2/5] Cleaning up internal assets...
[3/5] Building Frontend (React)...
✓ built in 1m 6s
[3.2] Syncing Frontend Build to Internal Assets...
[4/5] Starting Wails Build...
  • Generating bindings: Done.
  • Installing frontend dependencies: Done.
  • Compiling frontend: Done.
  • Generating application assets: Done.
  • Compiling application: Done.
Built '...\build\bin\openclaw-buddy.exe' in 2m.
[5/5] Organizing Release Folder...
[5.1] Creating ZIP archive...
==========================================
[SUCCESS] Windows Release Complete!
Final Package: release\openclaw-buddy-windows-v1.0.4.zip   
==========================================
```

## 🔧 最近的重构与修复 (Cross-Platform & API Fixes)

为了支持跨平台并适配 Wails v2.12.0，我们对核心逻辑进行了以下调整：

-   **进程管理解耦**: `internal/api/websocket.go` 中原有的 Unix 特有 `syscall` 已被移除。通过 `process_unix.go` 和 `process_windows.go` (Build Tags) 实现平台差异化处理，**不会影响 Linux 和 Mac 的编译产物**。
-   **Wails API 适配**: 修复了 `gui_windows.go` 在 Wails v2.12.0 下的 API 不兼容问题（如 `TrayMenu` 和 `URL` 字段），目前通过 `OnStartup` 钩子动态加载 UI 页面。
-   **构建环境容错**: 将启动时对 `openclaw` 二进制文件的检测改为警告而非崩溃，以支持在缺少依赖的环境上顺利生成 Wails 绑定。

## ⚠️ 注意事项

-   **防火墙提示**: 首次启动时，Windows 可能会弹出防火墙拦截提示，请允许其访问网络。
-   **单实例运行**: Windows 版支持单实例检测，如果已经启动了一个 Buddy，再次启动会提示。
-   **WebView2**: 如系统未安装，程序会引导下载。
