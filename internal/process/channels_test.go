package process

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func setupTestEnv(t *testing.T) string {
	// 创建临时目录作为隔离的测试环境
	tempDir, err := os.MkdirTemp("", "openclaw-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}

	// 生成一个基础的 openclaw.json
	configPath := filepath.Join(tempDir, "openclaw.json")
	initialConfig := `{
		"agents": {
			"list": [{"id": "main", "name": "main bot"}]
		},
		"channels": {
			"feishu": {"enabled": true, "appId": "test"}
		}
	}`
	if err := os.WriteFile(configPath, []byte(initialConfig), 0644); err != nil {
		t.Fatalf("Failed to write initial config: %v", err)
	}

	return tempDir
}

func validateConfig(t *testing.T, configDir string) {
	configPath := filepath.Join(configDir, "openclaw.json")
	env := []string{"OPENCLAW_CONFIG_PATH=" + configPath}
	
	timeout := 10 * time.Second
	if testing.Short() {
		timeout = 1 * time.Second
	}
	_, err := RunCommandWithEnvAndTimeout(timeout, env, "openclaw", "config", "validate")
	if err != nil {
		t.Fatalf("Config validation failed: %v", err)
	}
}

func TestBindAndUnbindFeishu(t *testing.T) {
	configDir := setupTestEnv(t)
	defer os.RemoveAll(configDir) // 测试结束后清理

	agentID := "main"

	// 1. 测试绑定
	t.Log("Testing BindFeishuToAgent...")
	err := BindFeishuToAgent(configDir, agentID)
	if err != nil {
		t.Errorf("BindFeishuToAgent failed: %v", err)
	}

	// 验证绑定后的配置合法性
	validateConfig(t, configDir)

	// 2. 测试解绑
	t.Log("Testing UnbindFeishuFromAgent...")
	err = UnbindFeishuFromAgent(configDir, agentID)
	if err != nil {
		t.Errorf("UnbindFeishuFromAgent failed: %v", err)
	}

	// 验证解绑后的配置合法性
	validateConfig(t, configDir)
}
