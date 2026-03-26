# 🦞 有孚小龙虾监控 - 自动化与手动测试清单

## 1. 基础认证 (Auth)
- [ ] **Token 校验**: 访问 `/v1/openclaw/status` 无 Token 时应返回 401。
- [ ] **Bearer Token**: 携带正确 `Authorization: Bearer <token>` 时应正常访问。
- [ ] **Cookie 校验**: 设置 `guardian_token` Cookie 后，Web 访问应无需再次登录。

## 2. API 接口 (API V1)
- [ ] **状态查询**: `GET /v1/openclaw/status` 返回结构化 JSON，包含 PID 和 Runtime。
- [ ] **配置端口检查**: 修改 `env` 中的 `HEALTH_PORT` 后，系统概览应能正确反映该端口的监听状态。
- [ ] **异步控制**: `POST /v1/gateway/restart` 应立即返回 202 并触发后台进程重启。
- [ ] **历史统计**: `GET /v1/stats/health` 应返回至少过去 24 小时的 SQLite 记录。
- [ ] **微信二维码**: `GET /v1/wechat/qrcode` 应返回 `qrcode_url` 且支持 5 分钟缓存。
- [ ] **资产查询**: `GET /v1/openclaw/bots-models` 应正确解析并返回机器人与模型列表。
- [ ] **解析鲁棒性**: `openclaw models list` 输出中包含插件日志（带 ANSI 颜色、时间戳）时，不应将其误识别为模型。
- [ ] **外部地址前缀**: 设置 `EXTERNAL_DASHBOARD_URL` 后，龙虾面板跳转链接应包含该前缀。
- [ ] **Dashboard URL 容错**: `openclaw dashboard` 命令耗时较长（>10s）时，接口应支持 30s 超时控制。

## 3. Web 界面 (Dashboard)
- [ ] **登录流**: 未登录用户访问根目录应显示登录框。
- [ ] **实时日志**: WebSocket 应能正常接收来自 `guardian.log` 的实时数据。
- [ ] **图表展示**: 仪表盘应能正确渲染 Recharts 健康趋势图。
- [ ] **虾兵蟹将**: “虾兵蟹将”页面应能渲染卡片列表，且含有 Emoji 和模型 Tag。
- [ ] **资产详情**: 机器人卡片应展示 Workspace, AgentDir, Routing 等详细属性。
- [ ] **移动端适配**: 在手机端访问时，“刷新”按钮应仅显示图标，列表应自动堆叠布局。
- [ ] **加载反馈**: 点击“刷新”按钮或初始加载时，应显示 Spin 动画且按钮进入 Loading 状态。
- [ ] **页面动画**: 切换页面时，区块应有明显的淡入（Fade-in）过渡。

## 4. 守护逻辑 (Guardian)
- [ ] **数据库持久化**: 巡检后检查 SQLite `health_checks` 表是否有新纪录。
- [ ] **自愈记录**: 模拟一次故障，检查 `heal_events` 是否记录了自愈过程。
- [ ] **数据清理**: 启动时日志应显示“已自动清理超过 7 天的旧监控数据”。
- [ ] **单例保护**: 尝试再次运行程序，应提示 PID 文件已存在并退出。

## 5. 构建与部署 (Build)
- [ ] **多平台打包**: 分别运行 `./build_mac.sh` 和 `./build_linux.sh`，检查 `release/` 下是否存在对应的 `.tar.gz`。
- [ ] **打包清理**: 检查生成的 .tar.gz 压缩包内是否已彻底排除以 `._` 开头的 macOS 元数据文件，且在 Linux 上解压时不应出现 `LIBARCHIVE.xattr` 警告。
- [ ] **产物体积**: 检查 Linux 版二进制文件是否已通过 `ldflags` 压缩（约 27MB 左右）。
- [ ] **环境隔离**: 检查生成的 `env` 文件是否包含新增的 `EXTERNAL_DASHBOARD_URL` 配置项。
