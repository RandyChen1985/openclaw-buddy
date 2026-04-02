## ADDED Requirements

### Requirement: 混合模式启动 (Go + Wails)
系统在 Windows 平台上启动时，必须同时启动 Gin HTTP 服务（作为后端）和 Wails GUI 窗口（作为 UI 壳子）。

#### Scenario: 成功加载初始页面
- **WHEN** 用户双击 `openclaw-buddy.exe`
- **THEN** 系统启动 Gin 服务并根据 `env` 的 `WEB_PORT` 和 `WEB_ROOT` 动态生成 URL，Wails 窗口应自动加载该地址。

### Requirement: 系统托盘集成与行为
系统必须在 Windows 任务栏显示托盘图标，并拦截窗口关闭事件。

#### Scenario: 隐藏至托盘
- **WHEN** 用户点击 Wails 窗口右上角的关闭按钮 (X)
- **THEN** 窗口不应退出，而是隐藏到托盘，后台监控任务继续运行。

#### Scenario: 托盘右键菜单
- **WHEN** 用户右键点击托盘图标
- **THEN** 菜单应显示“显示面板”、“查看日志”、“彻底退出”等选项。

### Requirement: 平台特异性功能开关
系统必须支持在 Windows 平台上通过配置或自动识别，关闭某些不兼容或不建议的功能菜单（如远程终端、实时日志等）。

#### Scenario: 根据配置隐藏菜单
- **WHEN** 环境变量 `GUI_DISABLE_FEATURES` 包含 `terminal` 时
- **THEN** Wails 窗口显示的前端页面中，远程终端菜单项应处于不可见或不可用状态。

### Requirement: 配置自动初始化
若启动目录下不存在 `env` 配置文件，系统必须自动创建一个默认模板并生成随机 Token。

#### Scenario: 首次运行自动生成配置
- **WHEN** 启动目录下不存在 `env` 文件时
- **THEN** 系统根据嵌入的 `env.example` 自动生成 `env` 文件，并填充 `BUDDY_TOKEN` 为随机生成的 `sk-` 字符串。

### Requirement: 跨平台路径管理
系统必须消除所有硬编码的 `/tmp` 路径，统一使用跨平台的路径拼接方式。

#### Scenario: Windows 下的锁文件路径
- **WHEN** 在 Windows 上运行时
- **THEN** 锁文件应位于用户临时目录 `%TEMP%\openclaw-buddy.lock` 或程序数据目录 `./data/openclaw-buddy.lock`，而非 `/tmp`。
