## Context

目前项目采用经典的 Go (Gin) + React 架构。在 Windows 上，我们需要一个更贴近原生桌面体验的载体，以取代 CLI 启动方式。Wails 提供了使用 WebView2 渲染前端并与 Go 后端通信的能力，非常适合本项目。

## Goals / Non-Goals

**Goals:**
- **混合架构**: 保持 Gin HTTP Server 运行，Wails 仅作为 UI 外壳。
- **托盘常驻**: 实现“点击关闭隐藏到托盘”，支持右键菜单（打开、退出）。
- **路径兼容**: 将硬编码路径（如 `/tmp`）改为跨平台兼容路径。
- **自动初始化**: 如果 `env` 不存在，启动时自动创建并生成随机 `BUDDY_TOKEN`。
- **单实例运行**: 确保 Windows 上同时只能运行一个 Buddy 实例。

**Non-Goals:**
- **重构通信协议**: 不会将现有的 REST API 切换为 Wails 的 IPC 绑定（维持方案 A）。
- **复杂安装包**: 初始版本不提供 `.msi` 或安装向导，仅提供绿色版 `.exe` 压缩包。

## Decisions

### 1. 采用 Wails v2 框架
- **Rationale**: 相比 Electron，Wails 生成的体积更小且内存占用更低，且原生支持 Go 逻辑。
- **Alternatives**: 
    - *WebView2 原生绑定*: 过于底层，开发效率低。
    - *Electron*: 体积过大（100MB+），不符合“保镖”轻量化的定位。

### 2. Gin 与 Wails 并行运行
- **Rationale**: 允许用户通过 Wails 窗口直接使用，同时保留局域网内其他设备访问 `http://ip:port` 的能力。
- **Implementation**: Wails 启动时通过 `OnStartup` 回调触发 Gin Server 的协程启动。

### 3. 路径与配置自动化
- **Decision**: 使用 `os.UserHomeDir()` 配合 `filepath.Join` 管理路径。
- **Logic**: 启动时检测 `env`，若缺失则从嵌入的 `env.example` 复制并填充 `BUDDY_TOKEN=sk-<random>`。
- **PID/Lock**: 将锁文件移至 `./data/openclaw-buddy.lock`，避免 Linux 专有的 `/tmp`。

### 4. 托盘交互设计
- **图标**: 使用 `web/public/openclaw2.png`。
- **行为**: 
    - `OnBeforeClose`: 返回 `true` 以拦截关闭事件，改为调用 `WindowHide()`。
    - 托盘菜单: `显示面板` -> `WindowShow()`；`彻底退出` -> `runtime.Quit()`。

## Risks / Trade-offs

- **[Risk] WebView2 缺失** → **Mitigation**: Wails 会自动提示用户下载安装 WebView2 运行时。
- **[Risk] 端口冲突** → **Mitigation**: 若 `WEB_PORT` 被占用，Wails 窗口应显示友好的错误提示而非直接崩溃。
- **[Trade-off] 体积增加** → 引入 Wails 后二进制体积会从 ~10MB 增加到 ~15MB，但在可接受范围内。
