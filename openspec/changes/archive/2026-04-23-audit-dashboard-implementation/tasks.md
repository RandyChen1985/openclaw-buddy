## 1. 数据库与存储准备 (Database & Storage Setup)

- [x] 1.1 在 `internal/utils/db.go` 中新增审计相关表结构（`audit_usage`, `audit_tool_calls`, `audit_security_events`, `audit_log_offsets`）
- [x] 1.2 实现数据库初始化逻辑，确保 Buddy 启动时自动创建表并开启 WAL 模式

## 2. 后端日志采集器实现 (Log Shipper Implementation)

- [x] 2.1 在 `internal/analyzer/` 下创建日志采集器核心逻辑，支持递归扫描 `~/.openclaw/agents/` 目录
- [x] 2.2 实现 JSONL 增量读取功能：基于 `audit_log_offsets` 表记录的文件偏移量（Offset）进行 `io.Seek` 读取
- [x] 2.3 编写 JSONL 解析器：准确提取 `message` (usage), `tool_calls`, `system_run_command` 等关键事件
- [x] 2.4 实现采集器调度器：每 10 秒（或可配置时间）执行一次增量同步扫描

## 3. 安全审计与自动化清理 (Audit Logic & Cleanup)

- [x] 3.1 实现危险指令正则过滤引擎：预置常用高危关键词（`rm`, `chmod`, `reboot` 等）
- [x] 3.2 实现 7 天滚动清理协程（TTL Worker）：每日凌晨自动清理超过 7 天的审计表记录
- [x] 3.3 确保清理逻辑仅针对 Buddy 数据库，严禁触碰 OpenClaw 底层原始日志

## 4. API 接口开发 (API Layer)

- [x] 4.1 开发审计大屏汇总接口：`/v1/audit/dashboard/summary`，支持按日期范围聚合 Token、消息量和危险事件数
- [x] 4.2 开发工具调用热力图接口：`/v1/audit/dashboard/tools`，按日期范围聚合 Top 10 工具使用情况
- [x] 4.3 开发审计日志流水接口：`/v1/audit/logs`，支持分页展示详细的审计记录和风险分级

## 5. 前端审计大屏开发 (Frontend UI)

- [x] 5.1 在项目中引入 `echarts` 依赖，并配置基础图表组件
- [x] 5.2 构建审计大屏布局：包含顶部汇总卡片、中部趋势图（ECharts 折线图）和下部热力图（ECharts 饼图/柱状图）
- [x] 5.3 实现日期选择器组件：支持用户自定义查询时间范围，并联动刷新所有图表数据
- [x] 5.4 编写实时高危操作告警列表组件

## 6. 测试与验证 (Verification)

- [x] 6.1 编写单元测试：验证 JSONL 解析器对各种事件类型的正确提取
- [x] 6.2 编写集成测试：模拟 OpenClaw 写入新日志，验证 Buddy 能否在 10 秒内增量同步入库
- [x] 6.3 验证 7 天清理策略：通过手动修改数据库时间戳，确认数据能被正确删除
- [x] 6.4 最终验收：在前端大屏确认各维度数据统计准确无误
