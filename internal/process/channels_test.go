package process

import (
	"encoding/json"
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
	env, err := OpenClawConfigEnv(configDir)
	if err != nil {
		t.Fatalf("OpenClawConfigEnv: %v", err)
	}
	// validate 冷启动可能较慢，过短超时会在 CLI 已输出「Config valid」时仍被判定为 deadline
	timeout := 30 * time.Second
	if testing.Short() {
		timeout = 20 * time.Second
	}
	_, err = RunCommandWithEnvAndTimeout(timeout, env, "openclaw", "config", "validate")
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

func TestTelegramCredentialFromMap(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		wantHas bool
	}{
		{"empty", `{}`, false},
		{"botToken", `{"botToken":"123456789:AA-SECRET"}`, true},
		{"legacy token", `{"token":"123456789:AA-SECRET"}`, true},
		{"tokenFile only", `{"tokenFile":"/path/to/token"}`, true},
		{"accounts map", `{"accounts":{"a":{"botToken":"123456789:AA-SECRET"}}}`, true},
		{"accounts array", `{"accounts":[{"token":"123456789:AA-SECRET"}]}`, true},
		{"account tokenFile", `{"accounts":{"x":{"tokenFile":"/t"}}}`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var m map[string]interface{}
			if err := json.Unmarshal([]byte(tc.raw), &m); err != nil {
				t.Fatal(err)
			}
			has, _ := telegramCredentialFromMap(m)
			if has != tc.wantHas {
				t.Fatalf("has=%v want %v", has, tc.wantHas)
			}
		})
	}
}

func TestQQBotCredentialFromMap(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		wantHas bool
	}{
		{"empty", `{}`, false},
		{"appId+clientSecret", `{"appId":"1024","clientSecret":"sec"}`, true},
		{"cli style token+password", `{"token":"1024","password":"sec"}`, true},
		{"secret object", `{"appId":"1024","clientSecret":{"value":"sec"}}`, true},
		{"clientSecretFile", `{"appId":"1024","clientSecretFile":"/s"}`, true},
		{"accounts map", `{"accounts":{"x":{"appId":"9","clientSecret":"y"}}}`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var m map[string]interface{}
			if err := json.Unmarshal([]byte(tc.raw), &m); err != nil {
				t.Fatal(err)
			}
			has, _ := qqbotCredentialFromMap(m)
			if has != tc.wantHas {
				t.Fatalf("has=%v want %v", has, tc.wantHas)
			}
		})
	}
}

func TestListRouteBindingRowsForChannel(t *testing.T) {
	dir := t.TempDir()
	cfg := `{
	  "bindings": [
	    {"type":"route","agentId":"main","match":{"channel":"feishu"}}
	  ],
	  "agents": {
	    "list": [
	      {
	        "id": "main",
	        "bindings": [
	          {"type":"route","agentId":"main","match":{"channel":"feishu","accountId":"acc1"}}
	        ]
	      }
	    ]
	  }
	}`
	if err := os.WriteFile(filepath.Join(dir, "openclaw.json"), []byte(cfg), 0644); err != nil {
		t.Fatal(err)
	}
	rows, notices := listRouteBindingRowsForChannel(dir, "feishu")
	if len(rows) != 2 {
		t.Fatalf("want 2 rows (root + nested-only), got %d: %+v", len(rows), rows)
	}
	if rows[0].Source != "root" || rows[0].AgentID != "main" {
		t.Fatalf("first row: %+v", rows[0])
	}
	if rows[1].Source != "agentsList" || rows[1].AccountID != "acc1" {
		t.Fatalf("second row: %+v", rows[1])
	}
	if len(notices) == 0 {
		t.Fatal("expected notices for nested bindings")
	}
}

func TestListRouteBindingRowsDedupesNestedWhenSameAsRoot(t *testing.T) {
	dir := t.TempDir()
	cfg := `{
	  "bindings": [
	    {"type":"route","agentId":"main","match":{"channel":"feishu"}}
	  ],
	  "agents": {
	    "list": [
	      {
	        "id": "main",
	        "bindings": [
	          {"type":"route","agentId":"main","match":{"channel":"feishu"}}
	        ]
	      }
	    ]
	  }
	}`
	if err := os.WriteFile(filepath.Join(dir, "openclaw.json"), []byte(cfg), 0644); err != nil {
		t.Fatal(err)
	}
	rows, _ := listRouteBindingRowsForChannel(dir, "feishu")
	if len(rows) != 1 {
		t.Fatalf("want 1 row (nested duplicate of root), got %d %+v", len(rows), rows)
	}
}
