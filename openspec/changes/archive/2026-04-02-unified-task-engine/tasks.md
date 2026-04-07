## 1. 数据库与底层模型准备

- [x] 1.1 在 `internal/utils/db.go` 中新增 `tasks` 表结构定义
- [x] 1.2 实现 `tasks` 表的初始化迁移逻辑与 `InitDB` 联调
- [x] 1.3 在 `internal/process/tasks.go` 中定义持久化版本的 `Task` 结构体

## 2. 任务引擎核心逻辑重构

- [x] 2.1 重写 `RegisterTask`，支持将任务信息写入数据库
- [x] 2.2 实现 `UpdateTaskProgress` 方法，支持实时更新进度百分比
- [x] 2.3 在 `internal/guardian/guardian.go` 启动时增加孤儿任务清理逻辑
- [x] 2.4 实现基于模块名的并发互斥锁（Mutex Map）

## 3. WebSocket 实时推送增强

- [x] 3.1 修改 `internal/api/websocket.go`，支持推送结构化 JSON 消息
- [x] 3.2 封装 `pushTaskUpdate` 工具函数，方便协程内部快速推送进度
- [x] 3.3 实现 WebSocket 消息类型的分发逻辑，确保兼容旧的文本日志

## 4. 后端 API 异步化适配

- [x] 4.1 将机器人增删改接口（Bots Manager）改为异步模式并返回 `taskID`
- [x] 4.2 将插件与技能管理接口改为异步模式
- [x] 4.3 统一 `start/stop/restart` 网关接口的任务持久化逻辑

## 5. 前端任务中心基础架构

- [x] 5.1 创建 `web/src/hooks/useTaskCenter.ts`，管理全局任务状态
- [x] 5.2 增强 `web/src/App.tsx` 中的 WebSocket 接收逻辑，解析任务更新
- [x] 5.3 实现页面首次加载时自动拉取活跃任务列表的同步机制

## 6. 前端 UI 组件实现

- [x] 6.1 创建 `TaskTray` 任务托盘组件，显示任务计数与缩略进度
- [x] 6.2 创建 `TaskNotification` 气泡通知组件，处理成功/失败反馈
- [x] 6.3 替换 `App.tsx` 中各页面的全屏遮罩为非阻断式加载状态

## 7. 验证与集成测试

- [x] 7.1 更新 `tests/CHECKLIST.md`，增加异步任务状态流转测试项
- [x] 7.2 执行并发冲突测试：连续触发同模块任务，验证 409 返回
- [x] 7.3 执行全链路冒烟测试：从专家克隆到网关重启
