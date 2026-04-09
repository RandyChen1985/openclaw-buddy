package tests

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"openclaw-buddy/internal/api"
	"openclaw-buddy/internal/config"
	"openclaw-buddy/internal/process"

	"github.com/gin-gonic/gin"
)

// TestAuthVerify 验证 API 认证逻辑
func TestAuthVerify(t *testing.T) {
	gin.SetMode(gin.TestMode)
	token := "verify-token"
	router := gin.New()
	router.Use(api.AuthMiddleware(token, nil))
	router.GET("/v1/secure", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	// 1. 测试 Bearer Token
	req, _ := http.NewRequest("GET", "/v1/secure", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("认证失败：期望 200, 实际得到 %d", w.Code)
	}

	// 2. 测试错误 Token
	req, _ = http.NewRequest("GET", "/v1/secure", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("安全漏洞：错误 Token 竟然通过了 (得到 %d)", w.Code)
	}
}

// TestStatusParsing 验证 CLI 解析工具函数 (仅限公开导出的)
func TestStatusParsingUtils(t *testing.T) {
	input := "\x1b[32mHealthy\x1b[0m"
	expected := "Healthy"
	result := process.StripANSI(input)
	if result != expected {
		t.Errorf("ANSI 过滤失败：期望 %s, 实际 %s", expected, result)
	}
}

// TestHealthEndpoint 验证健康检查接口
func TestHealthEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := &config.Config{Token: "test", WebPort: 3000}
	s := api.NewServer(cfg)
	
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/health", nil)
	s.GetEngine().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("健康检查接口不可用：得到 %d", w.Code)
	}
}
