package tests

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFullAPIRegression(t *testing.T) {
	s, tmpDir := SetupIntegrationTest()
	defer TeardownIntegrationTest(tmpDir)

	// --- 1. 登录模块 ---
	t.Run("LoginAPI", func(t *testing.T) {
		loginBody, _ := json.Marshal(map[string]string{"token": TestToken})
		req, _ := http.NewRequest("POST", "/login", bytes.NewBuffer(loginBody))
		w := httptest.NewRecorder()
		s.GetEngine().ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Errorf("Login 失败: 期望 200, 得到 %d", w.Code)
		}
	})

	// --- 2. 状态查询 ---
	t.Run("StatusAPI", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/v1/openclaw/status", nil)
		req.Header.Set("Authorization", "Bearer "+TestToken)
		w := httptest.NewRecorder()
		s.GetEngine().ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Errorf("Status API 失败: 得到 %d", w.Code)
		}
	})

	// --- 3. 资产管理 (Bots/Models) ---
	t.Run("BotsModelsAPI", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/v1/openclaw/bots-models", nil)
		req.Header.Set("Authorization", "Bearer "+TestToken)
		w := httptest.NewRecorder()
		s.GetEngine().ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Errorf("Bots-Models API 失败: 得到 %d", w.Code)
		}
	})

	// --- 4. 专家市场 ---
	t.Run("ExpertsAPI", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/v1/openclaw/experts", nil)
		req.Header.Set("Authorization", "Bearer "+TestToken)
		w := httptest.NewRecorder()
		s.GetEngine().ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Errorf("Experts API 失败: 得到 %d", w.Code)
		}
	})

	// --- 5. 自愈设置 ---
	t.Run("SelfHealingSettings", func(t *testing.T) {
		// GET
		req, _ := http.NewRequest("GET", "/v1/settings/self-healing", nil)
		req.Header.Set("Authorization", "Bearer "+TestToken)
		w := httptest.NewRecorder()
		s.GetEngine().ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Errorf("GET Self-Healing 失败: 得到 %d", w.Code)
		}

		// POST
		updateBody, _ := json.Marshal(map[string]bool{"enabled": false})
		req, _ = http.NewRequest("POST", "/v1/settings/self-healing", bytes.NewBuffer(updateBody))
		req.Header.Set("Authorization", "Bearer "+TestToken)
		w = httptest.NewRecorder()
		s.GetEngine().ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Errorf("POST Self-Healing 失败: 得到 %d", w.Code)
		}
	})

	// --- 6. 系统负载 ---
	t.Run("SystemInfoAPI", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/v1/system/info", nil)
		req.Header.Set("Authorization", "Bearer "+TestToken)
		w := httptest.NewRecorder()
		s.GetEngine().ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Errorf("System Info API 失败: 得到 %d", w.Code)
		}
	})
}
