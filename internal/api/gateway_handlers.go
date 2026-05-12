package api

import (
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"openclaw-buddy/internal/process"
	"openclaw-buddy/internal/scheduler"
	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

func (s *Server) getDashboardURL(c *gin.Context) {
	// 传入 Request Context，实现前端请求中止时的后端子进程级联取消
	url, err := process.GetDashboardURL(c.Request.Context(), s.cfg.ExternalDashboardURL)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"url": url})
}

func (s *Server) proxyLobsterDashboard(c *gin.Context) {
	// 额外防线：即使已鉴权，也禁止跨站 Origin 直接调用代理（防止被第三方站点利用）
	if !s.isOriginAllowed(c.Request, c.GetHeader("Origin")) {
		s.Error(c, http.StatusForbidden, "Forbidden origin")
		return
	}

	targetPort := s.cfg.HealthPort
	targetURL, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", targetPort))

	proxy := httputil.NewSingleHostReverseProxy(targetURL)

	// 修改响应头以允许嵌入
	proxy.ModifyResponse = func(res *http.Response) error {
		// 不再无条件移除 CSP（风险较高），仅移除会强制禁止 iframe 的 XFO
		res.Header.Del("X-Frame-Options")
		return nil
	}

	// 统一处理路径：动态剥离前缀 (WebRoot + /v1/proxy)
	prefix := s.cfg.WebRoot
	if prefix == "/" {
		prefix = ""
	}
	fullPrefix := prefix + "/v1/proxy"

	c.Request.URL.Path = strings.TrimPrefix(c.Request.URL.Path, fullPrefix)
	if c.Request.URL.Path == "" {
		c.Request.URL.Path = "/"
	}

	proxy.ServeHTTP(c.Writer, c.Request)
}

// getGatewayToken 返回 OpenClaw Gateway 的认证 Token，供前端 V3 WebSocket 握手使用
func (s *Server) getGatewayToken(c *gin.Context) {
	gw, err := process.GetOpenClawGatewayConfig(s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "failed to read gateway config: "+err.Error())
		return
	}
	s.Success(c, gin.H{"token": gw.Auth.Token})
}

func (s *Server) startGateway(c *gin.Context) {
	log.Printf("🎮 [控制] 用户请求: 【启动网关】")
	utils.RecordSystemEvent("CONTROL", "用户手动请求【启动网关】")
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.start_gateway",
		Module: "gateway",
		Action: "start",
	}
	s.runAsyncTaskWithPriority(c, task, scheduler.PriorityHigh, func() (string, error) {
		res, err := process.RunCommandWithTimeout(60*time.Second, "openclaw", "gateway", "start")
		if err != nil {
			return "", err
		}
		return res.Output, nil
	})
}

func (s *Server) stopGateway(c *gin.Context) {
	log.Printf("🎮 [控制] 用户请求: 【停止网关】")
	utils.RecordSystemEvent("CONTROL", "用户手动请求【停止网关】")
	task := &process.Task{
		ID:      fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:    "tasks.stop_gateway",
		Module:  "gateway",
		Action:  "stop",
		Command: "openclaw gateway stop",
	}
	s.runAsyncTaskWithPriority(c, task, scheduler.PriorityHigh, func() (string, error) {
		err := process.StopGateway(s.cfg.HealthPort)
		if err != nil {
			return "", err
		}
		return "tasks.results.stopped", nil
	})
}

func (s *Server) restartGateway(c *gin.Context) {
	log.Printf("🎮 [控制] 用户请求: 【重启网关】")
	utils.RecordSystemEvent("CONTROL", "用户手动请求【重启网关】")
	task := &process.Task{
		ID:      fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:    "tasks.restart_gateway",
		Module:  "gateway",
		Action:  "restart",
		Command: "openclaw gateway restart",
	}
	s.runAsyncTaskWithPriority(c, task, scheduler.PriorityHigh, func() (string, error) {
		err := process.RestartGateway(s.cfg.HealthPort)
		if err != nil {
			return "", err
		}
		return "tasks.results.restarted", nil
	})
}
