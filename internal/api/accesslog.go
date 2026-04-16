package api

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type accessLogConfig struct {
	skipPaths map[string]struct{}
	slow      time.Duration
}

func newAccessLogConfig(webRoot string) accessLogConfig {
	// 这些接口在前端会高频轮询/刷新，刷屏但排障价值低
	paths := []string{
		"/health",
		"/v1/openclaw/status",
		"/v1/tasks/status",
		"/v1/stats/health",
		"/v1/system/events",
		"/v1/system/info",
	}

	// 兼容 WebRoot 前缀
	prefix := strings.TrimSpace(webRoot)
	if prefix == "" || prefix == "/" {
		prefix = ""
	}

	skip := make(map[string]struct{}, len(paths)*2)
	for _, p := range paths {
		skip[p] = struct{}{}
		if prefix != "" {
			skip[prefix+p] = struct{}{}
		}
	}

	return accessLogConfig{
		skipPaths: skip,
		slow:      500 * time.Millisecond,
	}
}

// accessLogMiddleware logs only meaningful requests:
// - status >= 400
// - or slow requests (> cfg.slow)
// and skips noisy polling endpoints.
func (s *Server) accessLogMiddleware() gin.HandlerFunc {
	cfg := newAccessLogConfig(s.cfg.WebRoot)
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		path := c.Request.URL.Path
		if _, ok := cfg.skipPaths[path]; ok {
			return
		}

		latency := time.Since(start)
		status := c.Writer.Status()
		if status < http.StatusBadRequest && latency < cfg.slow {
			return
		}

		clientIP := c.ClientIP()
		method := c.Request.Method
		query := c.Request.URL.RawQuery
		if query != "" {
			path = path + "?" + query
		}

		// 统一格式，便于 grep：含状态码与耗时；错误请求会更显眼
		log.Printf("[HTTP] %3d | %10s | %s | %s %s", status, latency.Round(time.Millisecond), clientIP, method, path)
	}
}

