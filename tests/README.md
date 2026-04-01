# 🧪 OpenClaw Buddy 全量测试与质量保证指南

本项目采用 **“沙箱隔离 (Sandboxing) + Mock 模拟器 (Binary Mocking)”** 的全量回归测试体系，确保在不破坏生产环境的前提下，实现对 50+ 接口的分钟级自动化验证。

## 1. 测试架构 (Architecture)

为了实现“零侵入”测试，我们构建了以下三层防御体系：

- **沙箱隔离层 (`SetupIntegrationTest`)**: 每次测试自动在 `/tmp` 下创建随机命名的工作目录，并生成测试专用的 `openclaw.json` 和 `SQLite` 数据库。
- **Mock 模拟层 (`mock_openclaw`)**: 这是一个用 Go 编写的极简二进制文件，它接管了 `openclaw` 的所有命令行调用（如 `gateway restart`, `agents list` 等），返回预设的 Mock 数据，不产生任何实际进程副作用。
- **接口集成层 (`api_integration_test.go`)**: 基于 `gin.TestMode` 模拟真实的 HTTP 请求流，覆盖从登录鉴权到资产管理、模型配置及系统监控的全量接口契约。

---

## 2. 自动化测试执行 (Automation)

### 🚀 一键全量回归测试
在项目根目录下运行：
```bash
./tests/run_tests.sh
```

**脚本内部流程：**
1.  **编译 Mock**: 自动将 `tests/mock_openclaw/main.go` 编译为 `tests/bin/openclaw`。
2.  **注入 PATH**: 临时修改环境变量 `PATH`，确保程序调用的是 Mock 模拟器。
3.  **并发测试**: 执行 `go test ./tests/...`，运行所有集成测试用例。
4.  **环境清理**: 测试结束后自动销毁 Mock 产物和沙箱临时目录。

---

## 3. 核心测试模块 (Core Modules)

当前自动化测试已覆盖以下核心模块：

| 模块 | 测试项 (T.Run) | 验证重点 |
| :--- | :--- | :--- |
| **Auth** | `LoginAPI` | 验证 Token 校验及 Session Cookie 设置 |
| **Status** | `StatusAPI` | 验证网关运行状态、版本及负载数据的解析 |
| **Assets** | `BotsModelsAPI` | 验证机器人列表获取、配置同步及资产清单 |
| **Market** | `ExpertsAPI` | 验证专家模板市场的读取与初始化 |
| **Healing** | `SelfHealingSettings` | 验证自愈开关的持久化修改逻辑 |
| **System** | `SystemInfoAPI` | 验证 CPU/内存/磁盘等实时监控指标的提取 |

---

## 4. 开发者维护指南 (Developer Guide)

### 如何扩展 Mock 模拟器？
如果您修改了 `internal/process` 中调用的 `openclaw` 命令或增加了新命令，请同步更新 `tests/mock_openclaw/main.go`。
- **例**：增加一个 `openclaw plugins install` 的 Mock 响应。

### 如何新增 API 测试用例？
在 `tests/api_integration_test.go` 中追加一个新的 `t.Run`：
```go
t.Run("NewFeatureAPI", func(t *testing.T) {
    w := PerformRequest(s, "POST", "/v1/new-feature", body)
    if w.Code != http.StatusOK {
        t.Errorf("接口报错: %d", w.Code)
    }
})
```

---

## 5. 手动测试清单 (Manual Checklist)

对于涉及 **WebSocket 实时流 (Logs/TUI)** 或 **前端 CSS 布局** 的变更，建议参考 `tests/CHECKLIST.md` 进行手动确认。

> [!IMPORTANT]
> **发布前必读**：任何代码提交（PR）前，必须确保 `./tests/run_tests.sh` 的结果为 **PASS**。

