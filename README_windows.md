# 🦞 OpenClaw Buddy (Windows GUI 版) 使用指引

欢迎使用 OpenClaw Buddy Windows 桌面版。本版本采用 **Wails + Gin** 架构，为您提供原生的桌面交互体验和后台常驻监控能力。

## 🚀 快速启动

1.  **下载与运行**: 
    - 下载并解压 `openclaw-buddy-windows-vX.Y.Z.zip`。
    - 双击运行 `openclaw-buddy.exe`。
2.  **首次运行初始化**:
    - 如果目录下没有 `env` 文件，程序会自动生成一个。
    - 随机生成的 `BUDDY_TOKEN` 会在首次启动时打印到控制台，或直接在 `env` 文件中查看。
    - Wails 窗口会自动弹出并加载监控面板。
3.  **WebView2 运行时**:
    - 如果您的系统未安装 WebView2（常见于旧版 Windows 10），程序会提示并引导您下载安装。

## 🛠️ 桌面特有功能

-   **隐藏到托盘**: 点击窗口右上角的 `X` 按钮，程序不会退出，而是隐藏到系统托盘（任务栏右下角 🦞 图标），监控任务在后台继续运行。
-   **系统托盘菜单**:
    - **显示面板**: 重新呼出 UI 窗口。
    - **查看日志**: 调用记事本直接查看 `logs/guardian.log`。
    - **彻底退出**: 停止所有监控服务并退出程序。
-   **一键配置**: 您可以通过修改 `env` 中的 `GUI_DISABLE_FEATURES` 来隐藏某些不常用的菜单项（如 `terminal`, `logs`）。

## 🏗️ 开发者编译指引 (Windows 环境)

如果您想从源码自行编译，请确保已安装 **Go (1.21+)**, **Node.js** 和 **npm**。

1.  **安装 Wails CLI**:
    ```bash
    go install github.com/wailsapp/wails/v2/cmd/wails@latest
    ```
2.  **一键编译**:
    在根目录下直接运行：
    ```batch
    build_windows.bat
    ```
3.  **产物位置**:
    编译成功的可执行文件位于 `build/bin/openclaw-buddy.exe`。

## ⚠️ 注意事项

-   **防火墙提示**: 首次启动时，Windows 可能会弹出防火墙拦截提示，请允许其访问网络，否则局域网内的其他设备将无法访问面板。
-   **单实例运行**: Windows 版支持单实例检测，如果您已经启动了一个 Buddy，再次双击 `.exe` 会提示已在运行。
