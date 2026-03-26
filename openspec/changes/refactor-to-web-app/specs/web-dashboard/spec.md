## ADDED Requirements

### Requirement: 响应式 Web 面板 (Responsive Web Dashboard)
系统必须提供基于 React 的移动端友好界面，支持实时监控、服务控制和日志查看。

#### Scenario: 仪表盘展示 (Dashboard Display)
- **WHEN** 用户登录成功后
- **THEN** 仪表盘展示 OpenClaw 网关状态卡片及健康趋势图。

#### Scenario: 移动端适配 (Mobile Compatibility)
- **WHEN** 用户在手机浏览器（宽度 < 768px）访问
- **THEN** Web 界面自适应调整为单列布局，且交互按钮放大。
