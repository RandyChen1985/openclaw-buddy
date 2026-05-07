package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"openclaw-buddy/internal/config"
	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

// buildTestServer 启动一个最小化的 Server 用于鉴权/用户管理路由烟雾测试。
// 不依赖 openclaw 二进制、guardian、scheduler 等，仅手动注册 setupRoutes。
func buildTestServer(t *testing.T) *Server {
	t.Helper()
	gin.SetMode(gin.TestMode)

	tmp := t.TempDir()
	dbPath := filepath.Join(tmp, "test.db")
	if _, err := utils.InitDB(dbPath, "test-buddy-token"); err != nil {
		t.Fatalf("InitDB: %v", err)
	}

	cfg := &config.Config{
		Token:   "test-buddy-token",
		WebRoot: "/",
		WebPort: 18000,
	}
	s := &Server{
		cfg:     cfg,
		engine:  gin.New(),
		tickets: NewTicketStore(60 * time.Second),
	}
	s.engine.Use(gin.Recovery())
	s.setupRoutes()
	return s
}

func doJSON(t *testing.T, s *Server, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	s.engine.ServeHTTP(w, req)
	return w
}

func decode(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode body: %v\nbody=%s", err, w.Body.String())
	}
	return out
}

func TestRBACEndToEnd(t *testing.T) {
	// 隔离 env：避免污染仓库根目录
	originalDir, _ := os.Getwd()
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatalf("chdir: %v", err)
	}
	defer os.Chdir(originalDir)

	s := buildTestServer(t)

	// 1. /health 公共路由
	if w := doJSON(t, s, http.MethodGet, "/health", "", nil); w.Code != 200 {
		t.Fatalf("health: got %d", w.Code)
	}

	// 2. token 登录（BUDDY_TOKEN）
	w := doJSON(t, s, http.MethodPost, "/login", "", map[string]any{"token": "test-buddy-token"})
	if w.Code != 200 {
		t.Fatalf("token login: got %d body=%s", w.Code, w.Body.String())
	}
	resp := decode(t, w)
	if resp["data"] == nil {
		t.Fatalf("token login: no data: %v", resp)
	}

	// 3. /v1/auth/me 用 BUDDY_TOKEN → superadmin
	w = doJSON(t, s, http.MethodGet, "/v1/auth/me", "test-buddy-token", nil)
	if w.Code != 200 {
		t.Fatalf("auth/me with super: got %d body=%s", w.Code, w.Body.String())
	}
	d := decode(t, w)["data"].(map[string]any)
	if d["is_superadmin"] != true {
		t.Fatalf("expected superadmin: %v", d)
	}

	// 4. 创建一个 admin 用户
	w = doJSON(t, s, http.MethodPost, "/v1/system/users", "test-buddy-token", map[string]any{
		"username":  "alice",
		"real_name": "Alice",
		"remark":    "管理员",
		"password":  "alicepwd",
		"role_keys": []string{"admin"},
	})
	if w.Code != 200 {
		t.Fatalf("create admin: got %d body=%s", w.Code, w.Body.String())
	}

	// 5. 创建一个普通用户
	w = doJSON(t, s, http.MethodPost, "/v1/system/users", "test-buddy-token", map[string]any{
		"username":  "bob",
		"real_name": "Bob",
		"password":  "bobpwd1",
		"role_keys": []string{"user"},
	})
	if w.Code != 200 {
		t.Fatalf("create user: got %d body=%s", w.Code, w.Body.String())
	}

	// 5.1 权限点列表（menu 类型）
	w = doJSON(t, s, http.MethodGet, "/v1/system/permissions?type=menu", "test-buddy-token", nil)
	if w.Code != 200 {
		t.Fatalf("list permissions: got %d body=%s", w.Code, w.Body.String())
	}

	// 6. 列表
	w = doJSON(t, s, http.MethodGet, "/v1/system/users", "test-buddy-token", nil)
	if w.Code != 200 {
		t.Fatalf("list users: got %d body=%s", w.Code, w.Body.String())
	}
	listData := decode(t, w)["data"].(map[string]any)
	items, _ := listData["items"].([]any)
	if len(items) < 2 {
		t.Fatalf("expected at least 2 users, got %d body=%s", len(items), w.Body.String())
	}

	// 7. 用 alice 用户名/密码登录拿 session token
	w = doJSON(t, s, http.MethodPost, "/login", "", map[string]any{
		"username": "alice",
		"password": "alicepwd",
	})
	if w.Code != 200 {
		t.Fatalf("password login alice: got %d body=%s", w.Code, w.Body.String())
	}
	loginData := decode(t, w)["data"].(map[string]any)
	aliceToken, _ := loginData["token"].(string)
	if !strings.HasPrefix(aliceToken, "sess_") {
		t.Fatalf("expected session token, got %q", aliceToken)
	}

	// 8. 用 alice 的 session token 访问 /v1/auth/me 应非 superadmin 但有权限 key
	w = doJSON(t, s, http.MethodGet, "/v1/auth/me", aliceToken, nil)
	if w.Code != 200 {
		t.Fatalf("auth/me alice: got %d body=%s", w.Code, w.Body.String())
	}
	me := decode(t, w)["data"].(map[string]any)
	if me["is_superadmin"] == true {
		t.Fatalf("alice should not be superadmin: %v", me)
	}
	perms, _ := me["permissions"].([]any)
	hasManage := false
	for _, p := range perms {
		if p == "menu:system:user:manage" {
			hasManage = true
		}
	}
	// 8. 给 alice 直接授予菜单权限（用户直绑权限模型）
	// 找 alice id
	var aliceID int64
	for _, it := range items {
		m, ok := it.(map[string]any)
		if !ok {
			continue
		}
		if m["username"] == "alice" {
			if v, ok := m["id"].(float64); ok {
				aliceID = int64(v)
			}
		}
	}
	if aliceID == 0 {
		t.Fatalf("cannot resolve alice id from %v", items)
	}
	// admin 角色默认拥有所有权限，不需要显式授予
	if !hasManage {
		t.Fatalf("alice (admin) missing menu:system:user:manage: %v", perms)
	}

	// 9. 用 bob 登录 → 普通用户
	w = doJSON(t, s, http.MethodPost, "/login", "", map[string]any{
		"username": "bob",
		"password": "bobpwd1",
	})
	if w.Code != 200 {
		t.Fatalf("password login bob: got %d body=%s", w.Code, w.Body.String())
	}
	bobToken, _ := decode(t, w)["data"].(map[string]any)["token"].(string)
	if bobToken == "" {
		t.Fatalf("bob token empty")
	}

	// 10. bob 访问用户管理列表 → 应该 403
	w = doJSON(t, s, http.MethodGet, "/v1/system/users", bobToken, nil)
	if w.Code != http.StatusForbidden {
		t.Fatalf("bob list users: expected 403, got %d body=%s", w.Code, w.Body.String())
	}

	// 10.1 给 bob 直接授予菜单权限后，应可访问；收回后再变 403
	var bobID int64
	for _, it := range items {
		m, ok := it.(map[string]any)
		if !ok {
			continue
		}
		if m["username"] == "bob" {
			if v, ok := m["id"].(float64); ok {
				bobID = int64(v)
			}
		}
	}
	if bobID == 0 {
		t.Fatalf("cannot resolve bob id")
	}
	w = doJSON(t, s, http.MethodPut, "/v1/system/users/"+itoa(bobID)+"/permissions", "test-buddy-token", map[string]any{
		"permission_keys": []string{"menu:system:user:manage"},
	})
	if w.Code != 200 {
		t.Fatalf("grant bob perms: got %d body=%s", w.Code, w.Body.String())
	}
	w = doJSON(t, s, http.MethodGet, "/v1/system/users", bobToken, nil)
	if w.Code != 200 {
		t.Fatalf("bob list after grant: expected 200, got %d body=%s", w.Code, w.Body.String())
	}
	w = doJSON(t, s, http.MethodPut, "/v1/system/users/"+itoa(bobID)+"/permissions", "test-buddy-token", map[string]any{
		"permission_keys": []string{},
	})
	if w.Code != 200 {
		t.Fatalf("revoke bob perms: got %d body=%s", w.Code, w.Body.String())
	}
	w = doJSON(t, s, http.MethodGet, "/v1/system/users", bobToken, nil)
	if w.Code != http.StatusForbidden {
		t.Fatalf("bob list after revoke: expected 403, got %d body=%s", w.Code, w.Body.String())
	}

	// 11. bob 访问 /v1/auth/me 应有效
	w = doJSON(t, s, http.MethodGet, "/v1/auth/me", bobToken, nil)
	if w.Code != 200 {
		t.Fatalf("bob auth/me: got %d body=%s", w.Code, w.Body.String())
	}

	// 12. 错误密码登录 → 401
	w = doJSON(t, s, http.MethodPost, "/login", "", map[string]any{
		"username": "alice",
		"password": "wrong",
	})
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password: expected 401, got %d body=%s", w.Code, w.Body.String())
	}

	// 13. 无 token 访问 /v1/auth/me → 401
	w = doJSON(t, s, http.MethodGet, "/v1/auth/me", "", nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("no token auth/me: expected 401, got %d", w.Code)
	}

	// 14. 重置 alice 密码并验证旧 token 失效
	// aliceID 已在上面解析
	w = doJSON(t, s, http.MethodPost,
		"/v1/system/users/"+itoa(aliceID)+"/reset-password",
		"test-buddy-token",
		map[string]any{"password": "newalice"},
	)
	if w.Code != 200 {
		t.Fatalf("reset password: got %d body=%s", w.Code, w.Body.String())
	}
	// 旧 alice token 应失效（session 已被清理）
	w = doJSON(t, s, http.MethodGet, "/v1/auth/me", aliceToken, nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("old session after reset: expected 401, got %d body=%s", w.Code, w.Body.String())
	}
	// 新密码登录应成功
	w = doJSON(t, s, http.MethodPost, "/login", "", map[string]any{
		"username": "alice",
		"password": "newalice",
	})
	if w.Code != 200 {
		t.Fatalf("new password login: got %d body=%s", w.Code, w.Body.String())
	}

	// 15. 删除 bob
	w = doJSON(t, s, http.MethodDelete, "/v1/system/users/"+itoa(bobID), "test-buddy-token", nil)
	if w.Code != 200 {
		t.Fatalf("delete bob: got %d body=%s", w.Code, w.Body.String())
	}
}

func itoa(i int64) string {
	// 简单 int64 转字符串，避免引入 strconv 多余依赖
	if i == 0 {
		return "0"
	}
	var b [20]byte
	pos := len(b)
	for i > 0 {
		pos--
		b[pos] = byte('0' + i%10)
		i /= 10
	}
	return string(b[pos:])
}
