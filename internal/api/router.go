package api

import (
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"time"
	"yovole-openclaw-monitor/internal/config"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

type Server struct {
	cfg    *config.Config
	engine *gin.Engine
}

func NewServer(cfg *config.Config) *Server {
	engine := gin.Default()

	// Configure CORS
	engine.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	s := &Server{
		cfg:    cfg,
		engine: engine,
	}

	s.setupRoutes()
	return s
}

func (s *Server) setupRoutes() {
	// Public routes
	s.engine.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Login endpoint
	s.engine.POST("/login", func(c *gin.Context) {
		var req struct {
			Token string `json:"token"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		if req.Token == s.cfg.Token {
			c.SetCookie("guardian_token", req.Token, 3600*24*7, "/", "", false, true)
			c.JSON(200, gin.H{"status": "success"})
		} else {
			c.JSON(401, gin.H{"error": "Invalid token"})
		}
	})

	// V1 API Group
	v1 := s.engine.Group("/v1")
	v1.Use(AuthMiddleware(s.cfg.Token))
	{
		v1.GET("/openclaw/status", s.getOpenClawStatus)
		v1.GET("/openclaw/dashboard-url", s.getDashboardURL)
		v1.GET("/openclaw/bots-models", s.getOpenClawBotsModels)
		v1.GET("/openclaw/devices", s.getOpenClawDevices)
		v1.POST("/openclaw/devices/approve", s.approveDevice)
		
		gateway := v1.Group("/gateway")
		{
			gateway.POST("/start", s.startGateway)
			gateway.POST("/stop", s.stopGateway)
			gateway.POST("/restart", s.restartGateway)
		}

		v1.GET("/stats/health", s.getHealthStats)
		v1.GET("/wechat/qrcode", s.getWeChatQRCode)
		v1.GET("/wechat/plugin/status", s.checkWeChatPlugin)
		v1.GET("/wechat/config/status", s.getWeChatConfigStatus)
		v1.POST("/wechat/install", s.installWeChatPlugin)
		v1.GET("/ws/logs", s.streamLogs)

		// Self-healing management
		v1.GET("/settings/self-healing", s.getSelfHealingSetting)
		v1.POST("/settings/self-healing", s.updateSelfHealingSetting)
		v1.GET("/heal/events", s.getHealEvents)

		// Proxy for external dashboard
		v1.Any("/proxy/*path", s.proxyLobsterDashboard)
	}

	s.setupStaticFiles()
}

//go:embed dist/*
var staticFiles embed.FS

func (s *Server) setupStaticFiles() {
	distFS, err := fs.Sub(staticFiles, "dist")
	if err != nil {
		return
	}

	s.engine.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if path == "/" || path == "" {
			path = "index.html"
		} else if path[0] == '/' {
			path = path[1:]
		}
		
		if f, err := distFS.Open(path); err == nil {
			f.Close()
			http.FileServer(http.FS(distFS)).ServeHTTP(c.Writer, c.Request)
			return
		}
		
		c.FileFromFS("index.html", http.FS(distFS))
	})
}

func (s *Server) Run() error {
	return s.engine.Run(fmt.Sprintf(":%d", s.cfg.WebPort))
}

func (s *Server) GetEngine() *gin.Engine {
	return s.engine
}
