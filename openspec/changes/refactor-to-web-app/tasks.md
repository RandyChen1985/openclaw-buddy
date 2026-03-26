# 任务列表：重构为 Web 应用与 API 服务 (refactor-to-web-app)

## 1. 后端基础设施搭建

- [x] 1.1 引入 Gin 框架及相关依赖 (Gin, CORS, godotenv)
- [x] 1.2 引入 SQLite 驱动 (`modernc.org/sqlite`) 并初始化数据库连接
- [x] 1.3 实现基于静态 Token 的 Gin 中间件 (Auth Middleware)
- [x] 1.4 创建 `internal/api` 目录，搭建基础路由结构

## 2. CLI 封装与结构化解析

- [x] 2.1 增强 `internal/process`，实现 ANSI 字符过滤工具函数
- [x] 2.2 实现 `openclaw status` 的正则解析逻辑，转化为 Go 结构体
- [x] 2.3 封装带超时和日志捕获的 `exec.Command` 通用执行器
- [x] 2.4 实现微信二维码获取逻辑及 5 分钟内存缓存

## 3. API 接口实现 (V1)

- [x] 3.1 实现 `GET /v1/openclaw/status` 接口
- [x] 3.2 实现 `POST /v1/gateway/restart` 等控制类接口（异步执行）
- [x] 3.3 实现 `GET /v1/stats/health` 接口，从 SQLite 读取历史数据
- [x] 3.4 实现 WebSocket 接口 `/v1/ws/logs`，支持实时日志推送

## 4. 后台巡检逻辑重构 (Guardian Worker)

- [x] 4.1 将原有的 `guardian.Run` 改写为可受控的 Background Worker
- [x] 4.2 在每次巡检后，将结果写入 SQLite `health_checks` 表
- [x] 4.3 实现自愈事件记录，写入 SQLite `heal_events` 表

## 5. 前端开发 (Web Dashboard)

- [x] 5.1 初始化 `web/` 目录 (Vite + React + Tailwind + AntD)
- [x] 5.2 实现登录页面，支持 Token 认证并持久化到 localStorage
- [x] 5.3 开发 Dashboard 首页，集成 ECharts 展示健康趋势图
- [x] 5.4 开发服务控制与实时日志查看界面
- [x] 5.5 完成移动端响应式适配及交互优化

## 6. 整合、打包与验证

- [x] 6.1 配置 Go `embed`，将 `web/dist` 资源嵌入后端程序
- [x] 6.2 更新 `build_release.sh` 和 `Makefile`，支持前后端一键编译
- [x] 6.3 更新 `tests/CHECKLIST.md`，增加 Web API 和 UI 的自动化测试项
- [x] 6.4 执行全流程验证，确保 Token 认证、自愈逻辑和 Web 控制正常工作
