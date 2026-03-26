# Lobster Guardian 开发规范与技巧 (Development Skills)

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
- **Token 认证**: 隔离环境的 Token 默认依然是 `lobster-guardian-2026`。
- **静态资源**: 每次前端代码修改，都必须通过 `./dev.sh` 触发重新编译。
- **实时日志**: 推荐使用 `tail -f temp-dev-test/logs/guardian.log` 观察运行状态。
