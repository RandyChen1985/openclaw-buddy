## 1. 基础设施与 Wails 初始化

- [x] 1.1 在根目录下创建 `wails.json` 配置文件，并将前端指向 `web/` 目录。
- [x] 1.2 创建 `build_windows.sh` 脚本，用于在类 Unix 环境下进行交叉编译（或准备 Windows 编译指引）。
- [x] 1.3 准备 `openclaw2.png` 的嵌入式资源 (Embedding)。

## 2. 跨平台路径与配置优化

- [x] 2.1 优化 `internal/config/config.go`，引入 `GUI_DISABLE_FEATURES` 环境变量。
- [x] 2.2 增加配置自动初始化逻辑：若 `env` 缺失，则从模板自动生成并填充随机 Token。
- [x] 2.3 修改 `cmd/monitor/main.go`，将 `/tmp/openclaw-buddy.pid` 替换为跨平台的 `filepath.Join` 路径（如 `./data/openclaw-buddy.lock`）。

## 3. Windows GUI 核心实现 (Wails)

- [x] 3.1 编写 `internal/api/gui_windows.go`，实现 Wails 窗口初始化逻辑。
- [x] 3.2 实现系统托盘功能：右键菜单（显示、查看日志、彻底退出）。
- [x] 3.3 实现窗口行为逻辑：拦截关闭事件并最小化到托盘。
- [x] 3.4 调整 `main.go` 启动流程：根据平台和编译参数决定是启动 GUI 还是 CLI。

## 4. 前端适配与功能开关

- [x] 4.1 修改前端 `web/src/App.tsx` 或相关组件，根据 `GUI_DISABLE_FEATURES` 隐藏特定菜单。
- [x] 4.2 确保前端构建产物与 Wails 资源嵌入流程兼容。

## 5. 验证与文档

- [x] 5.1 在 Windows 环境下执行编译并进行功能验收。
- [x] 5.2 更新 `tests/CHECKLIST.md`，增加 Windows GUI 自动化/手动测试清单。
- [x] 5.3 编写 `README_windows.md` 使用指引。
