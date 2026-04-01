package tests

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"openclaw-buddy/internal/api"
	"openclaw-buddy/internal/config"
	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

const TestToken = "regression-test-token"

// SetupIntegrationTest 创建一个隔离的 API 测试环境
func SetupIntegrationTest() (*api.Server, string) {
	gin.SetMode(gin.TestMode)

	// 1. 创建沙箱
	tmpDir, err := os.MkdirTemp("", "openclaw-integration-*")
	if err != nil {
		panic(err)
	}

	// 2. 初始化模拟配置
	configDir := filepath.Join(tmpDir, "config")
	os.MkdirAll(configDir, 0755)
	
	// 初始化 SQLite (测试用)
	dbPath := filepath.Join(tmpDir, "test.db")
	// 修正 InitDB 调用，传入测试 Token
	_, _ = utils.InitDB(dbPath, TestToken)

	// 3. 准备初始配置文件 (openclaw.json)
	openClawConfig := map[string]interface{}{
		"bots": []interface{}{},
		"models": map[string]interface{}{
			"providers": []interface{}{},
		},
	}
	configContent, _ := json.Marshal(openClawConfig)
	os.WriteFile(filepath.Join(configDir, "openclaw.json"), configContent, 0644)

	// 4. 注入配置
	cfg := &config.Config{
		Token:             TestToken,
		WebPort:           3333,
		HealthPort:        18789,
		OpenClawConfigDir: configDir,
		WebRoot:           "/",
	}

	// 5. 启动 Server
	s := api.NewServer(cfg)
	return s, tmpDir
}

// TeardownIntegrationTest 清理测试环境
func TeardownIntegrationTest(tmpDir string) {
	os.RemoveAll(tmpDir)
}

// PerformRequest 助手函数：执行 HTTP 请求并返回响应体
func PerformRequest(s *api.Server, method, path string, body []byte) *httptest.ResponseRecorder {
	var req *http.Request
	if body != nil {
		req, _ = http.NewRequest(method, path, bytes.NewBuffer(body))
	} else {
		req, _ = http.NewRequest(method, path, nil)
	}
	req.Header.Set("Authorization", "Bearer "+TestToken)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.GetEngine().ServeHTTP(w, req)
	return w
}
