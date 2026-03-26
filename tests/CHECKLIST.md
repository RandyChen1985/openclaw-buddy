# 🦞 有孚小龙虾监控 - 自动化与手动测试清单

## 1. 基础认证 (Auth)
- [ ] **Token 校验**: 访问 `/v1/openclaw/status` 无 Token 时应返回 401。
- [ ] **Bearer Token**: 携带正确 `Authorization: Bearer <token>` 时应正常访问。
- [ ] **Cookie 校验**: 设置 `guardian_token` Cookie 后，Web 访问应无需再次登录。

## 2. API 接口 (API V1)
- [ ] **状态查询**: `GET /v1/openclaw/status` 返回结构化 JSON，包含 PID 和 Runtime。
- [ ] **异步控制**: `POST /v1/gateway/restart` 应立即返回 202 并触发后台进程重启。
- [ ] **历史统计**: `GET /v1/stats/health` 应返回至少过去 24 小时的 SQLite 记录。
- [ ] **微信二维码**: `GET /v1/wechat/qrcode` 应返回 `qrcode_url` 且支持 5 分钟缓存。

## 3. Web 界面 (Dashboard)
- [ ] **登录流**: 未登录用户访问根目录应显示登录框。
- [ ] **实时日志**: WebSocket 应能正常接收来自 `guardian.log` 的实时数据。
- [ ] **图表展示**: 仪表盘应能正确渲染 Recharts 健康趋势图。
- [ ] **移动端适配**: 在 Chrome 开发者工具模拟手机尺寸，布局应自适应为单列。

## 4. 守护逻辑 (Guardian)
- [ ] **数据库持久化**: 巡检后检查 SQLite `health_checks` 表是否有新纪录。
- [ ] **自愈记录**: 模拟一次故障，检查 `heal_events` 是否记录了自愈过程。
- [ ] **单例保护**: 尝试再次运行程序，应提示 PID 文件已存在并退出。

## 5. 构建与部署 (Build)
- [ ] **一键打包**: 运行 `./build_release.sh` 后，检查 `release_pkg/` 下是否有完整的静态资源嵌入。
- [ ] **环境隔离**: 检查生成的 `env` 文件是否包含所有必需的新配置项。
