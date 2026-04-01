# OpenClaw Buddy 开发规范与技巧 (Development Skills)

## 1. 快速启动与隔离测试

本项目使用隔离目录 `temp-dev-test/` 进行开发测试，该目录已被 Git 忽略，确保不会污染源代码。

### 启动/重启 (隔离模式)
在根目录下运行：
```bash
./dev.sh
```
**脚本逻辑：**
1.  自动停止并清理旧的隔离目录和进程。
2.  重新创建 `temp-dev-test/` 及其子目录（logs, data, backups）。
3.  编译前端并同步产物。
4.  将二进制文件和 `env` 配置生成到隔离目录中，并从该目录下启动服务。

### 停止并清理
当你完成测试后，可以通过以下命令停止进程并彻底删除测试产物：
```bash
./dev.sh stop
```

## 2. 开发注意事项

- **路径隔离**: 所有巡检日志、数据库记录、配置备份现在都位于 `temp-dev-test/` 下，不会出现在根目录。
- **Token 认证**: 隔离环境的 Token 默认已更新为 `openclaw-buddy-2026`。
- **静态资源**: 每次前端代码修改，都必须通过 `./dev.sh` 触发重新编译。
- **实时日志**: 推荐使用 `tail -f temp-dev-test/logs/guardian.log` 观察运行状态。

## 3. 自动化全量回归测试 (Regression Testing)

在修改核心逻辑（如 API、配置解析或自愈算法）后，必须运行全量测试以确保没有引入 Regression（回归错误）。

### 运行全量测试
```bash
./tests/run_tests.sh
```

**测试特性：**
- **沙箱隔离**: 自动创建随机命名的临时目录作为工作区，绝对不触碰本地 `~/.openclaw` 或生产配置。
- **Mock 模拟**: 自动编译并使用 Mock 二进制文件接管 `openclaw` 命令调用，无需安装或启动真实的 OpenClaw 环境。
- **全量覆盖**: 覆盖从登录鉴权、资产管理（Bots/Models）、专家市场模板、自愈策略配置到系统硬件监控的所有核心接口。

### 测试维护建议
- **更新 Mock**: 如果您修改了 `internal/process` 中调用的 `openclaw` 子命令或预期输出，请同步更新 `tests/mock_openclaw/main.go`。
- **新增用例**: 凡是涉及新功能接口的开发，建议在 `tests/api_integration_test.go` 中追加对应的 `t.Run` 测试分支。
