## Why

当前 OpenClaw Buddy 主要面向 Linux/Mac 用户，Windows 用户仍需依赖 CLI 或手动启动脚本，缺乏直观的桌面交互体验且难以在后台稳定运行。通过提供原生的 Windows GUI，可以显著降低 Windows 用户的上手门槛，并利用系统托盘和桌面通知提供更好的实时监控体验。

## What Changes

- **桌面应用封装**: 引入 Wails (或类似方案) 将现有的 Go 后端与 React 前端打包成单个 `.exe` 文件。
- **系统托盘支持**: 在 Windows 任务栏右下角增加托盘图标，支持“打开面板”、“退出应用”等快捷操作。
- **路径规范化**: 消除代码中硬编码的 `/tmp` 等 Linux 习惯路径，改为跨平台的临时目录或程序本地目录。
- **后台运行能力**: 点击窗口关闭按钮时默认最小化到托盘，而非退出程序；提供注册为 Windows 服务的选项。
- **内置浏览器**: 启动即弹出基于 Webview2 的窗口，直接加载内置的登录/监控页面。

## Capabilities

### New Capabilities
- `windows-desktop-gui`: 提供原生的 Windows 窗口管理、系统托盘集成及 Webview2 容器。
- `cross-platform-path-management`: 统一 Windows、Linux 和 Mac 的文件路径管理逻辑，消除硬编码路径冲突。

### Modified Capabilities
- 无

## Impact

- **构建系统**: 增加 `build_windows.sh` 或类似的构建流程。
- **核心逻辑 (`cmd/monitor/main.go`)**: 需要调整启动流程以支持 GUI 模式。
- **路径管理 (`internal/config`, `internal/process`)**: 需要将所有路径拼接和临时文件位置调整为跨平台兼容模式。
- **依赖库**: 引入 `wails` (或其他 GUI 库) 及 Windows 特定的系统库依赖。
