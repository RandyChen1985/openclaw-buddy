package api

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"time"
	"openclaw-buddy/internal/config"
	"openclaw-buddy/internal/scheduler"
	"openclaw-buddy/internal/guardian"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

type Server struct {
	cfg      *config.Config
	engine   *gin.Engine
	tickets  *TicketStore
	guardian *guardian.Guardian
}

func NewServer(cfg *config.Config, g *guardian.Guardian) *Server {
	gin.DisableConsoleColor()
	engine := gin.New()

	s := &Server{
		cfg:      cfg,
		engine:   engine,
		tickets:  NewTicketStore(1 * time.Minute), // Ticket valid for 1 minute
		guardian: g,
	}

	// Recovery must be first
	engine.Use(gin.Recovery())
	// Reduce noise: only log slow/error requests via standard logger
	engine.Use(s.accessLogMiddleware())

	// Configure CORS (deny-by-default; allow same-host/localhost + explicit allowlist)
	engine.Use(cors.New(cors.Config{
		AllowOriginFunc: func(origin string) bool {
			// gin-contrib/cors only sees the Origin value; we still enforce request-based checks
			// for WS/proxy at handler level.
			// Here we allow empty origin (non-browser) and explicit allowlist/local use-cases.
			if strings.TrimSpace(origin) == "" {
				return true
			}
			for _, allowed := range splitCSV(cfg.CORSAllowOrigins) {
				if strings.EqualFold(allowed, origin) {
					return true
				}
			}
			// Local dev defaults (safe baseline)
			return strings.HasPrefix(origin, fmt.Sprintf("http://localhost:%d", cfg.WebPort)) ||
				strings.HasPrefix(origin, fmt.Sprintf("http://127.0.0.1:%d", cfg.WebPort)) ||
				strings.HasPrefix(origin, fmt.Sprintf("https://localhost:%d", cfg.WebPort)) ||
				strings.HasPrefix(origin, fmt.Sprintf("https://127.0.0.1:%d", cfg.WebPort))
		},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	s.setupRoutes()
	// 显式拉起全局任务调度器，确保串行队列就绪
	_ = scheduler.GetScheduler()
	
	// 移除 s.engine.Static("/v1/openclaw/chat/files", "./data/uploads")
	// 该功能已迁移至 v1 路由组下的 handleGetChatFile 动态处理

	return s
}

func (s *Server) setupRoutes() {
	// Create a group for the configured WebRoot
	root := s.engine.Group(s.cfg.WebRoot)

	// Public routes
	root.GET("/health", func(c *gin.Context) {
		c.JSON(200, APIResponse{Code: 200, Message: "success", Data: gin.H{"status": "ok"}})
	})

	// Login endpoint
	root.POST("/login", func(c *gin.Context) {
		var req struct {
			Token string `json:"token"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		if strings.TrimSpace(req.Token) == s.cfg.Token {
			// Set cookie path to WebRoot to prevent collisions
			cookiePath := s.cfg.WebRoot
			if cookiePath == "" {
				cookiePath = "/"
			}
			c.SetCookie("guardian_token", req.Token, 3600*24*7, cookiePath, "", false, true)
			s.Success(c, gin.H{"status": "success"})
		} else {
			s.Error(c, http.StatusUnauthorized, "Invalid token")
		}
	})

	// V1 API Group
	v1 := root.Group("/v1")
	v1.Use(AuthMiddleware(s.cfg.Token, s.tickets))
	{
		// Auth related
		v1.POST("/auth/ticket", s.handleGetTicket)

		// OpenClaw related routes
		oc := v1.Group("/openclaw")
		{
			oc.GET("/status", s.getOpenClawStatus)
			oc.GET("/gateway-token", s.getGatewayToken)
			oc.GET("/version", s.getOpenClawVersion)
			oc.GET("/dashboard-url", s.getDashboardURL)
			oc.GET("/bots-models", s.getOpenClawBotsModels)
			oc.GET("/devices", s.getOpenClawDevices)
			oc.POST("/devices/approve", s.approveDevice)
			oc.POST("/bots/add", s.addOpenClawBot)
			oc.POST("/bots/set-identity", s.setOpenClawBotIdentity)
			oc.POST("/bots/set-model", s.setOpenClawBotModel)
			oc.POST("/bots/update", s.updateOpenClawBot)
			oc.POST("/bots/delete", s.deleteOpenClawBot)
			oc.GET("/bots/top", s.getTopBots)
			oc.GET("/bots/file", s.getOpenClawBotFile)
			oc.POST("/bots/file", s.updateOpenClawBotFile)
			oc.GET("/bots/memory/list", s.listOpenClawBotMemoryFiles)
			oc.DELETE("/bots/memory/file", s.deleteOpenClawBotMemoryFile)
			oc.POST("/models/set-default", s.setDefaultModel)
			oc.GET("/models/config", s.getOpenClawModelsConfig)
			oc.POST("/models/test-direct", s.testOpenClawModelDirect)
			oc.POST("/models/provider", s.addOpenClawProvider)
			oc.DELETE("/models/provider/:provider", s.deleteOpenClawProvider)
			oc.POST("/models/provider/model", s.addOpenClawModelToProvider)
			oc.DELETE("/models/provider/:provider/model/:id", s.deleteOpenClawModelFromProvider)
			oc.DELETE("/models/provider/model", s.deleteOpenClawModelFromProvider)
			oc.POST("/chat/completions", s.chatProxy)
			oc.POST("/chat/summarize", s.summarizeSession)
			oc.GET("/chat/status", s.getChatStatus)
			oc.POST("/chat/enable", s.enableChat)
			oc.POST("/chat/upload", s.handleChatUpload)
			oc.GET("/chat/files/:botId/:filename", s.handleGetChatFile)
			oc.GET("/chat/quick-commands", s.getQuickCommands)
			oc.POST("/chat/quick-commands", s.addQuickCommand)
			oc.DELETE("/chat/quick-commands/:id", s.deleteQuickCommand)
			oc.GET("/skills", s.getOpenClawSkills)
			oc.DELETE("/skills/:name", s.uninstallSkill)
			oc.POST("/skills/reload", s.reloadSkills)
			oc.GET("/skills/files/list", s.getSkillFilesList)
			oc.GET("/skills/files/get", s.getSkillFileContent)
			oc.POST("/skills/files/save", s.saveSkillFileContent)
			
			// Generic File Explorer
			oc.GET("/files/list", s.getExplorerFilesList)
			oc.GET("/files/get", s.getExplorerFileContent)
			oc.POST("/files/save", s.saveExplorerFileContent)
			oc.DELETE("/files/delete", s.deleteExplorerFile)

			oc.GET("/plugins", s.getOpenClawPlugins)
			oc.POST("/plugins/reload", s.reloadPlugins)
			oc.POST("/plugins/enable", s.enablePlugin)
			oc.POST("/plugins/disable", s.disablePlugin)
			oc.DELETE("/plugins/:id", s.uninstallPlugin)
			oc.POST("/plugins/update", s.updatePlugins)
			oc.GET("/cron-jobs", s.getOpenClawCronJobs)
			oc.POST("/cron-jobs/enable", s.enableCronJob)
			oc.POST("/cron-jobs/disable", s.disableCronJob)
			oc.DELETE("/cron-jobs/:id", s.removeCronJob)
			oc.GET("/experts", s.getOpenClawExperts)
			oc.POST("/bots/template", s.createBotFromExpert)
			oc.GET("/sessions", s.getSessions)
			// Configuration & Maintenance
			oc.GET("/config", s.handleGetConfig)
			oc.POST("/config", s.handleUpdateConfig)
			oc.POST("/config/validate", s.handleValidateConfig)
			oc.POST("/doctor", s.handleRunDoctor)
			// Security related
			oc.GET("/security/status", s.getSecurityStatus)
			oc.POST("/security/task", s.triggerSecurityTask)
		}

		gateway := v1.Group("/gateway")
		{
			gateway.POST("/start", s.startGateway)
			gateway.POST("/stop", s.stopGateway)
			gateway.POST("/restart", s.restartGateway)
			gateway.GET("/usage-cost", s.getUsageCost)
		}

		v1.GET("/stats/health", s.getHealthStats)
		v1.GET("/wechat/qrcode", s.getWeChatQRCode)
		
		channels := v1.Group("/channels")
		{
			channels.GET("/metadata", s.getChannelsMetadata)
			channels.GET("/status", s.getChannelsStatus)
			channels.GET("/:channelId/accounts", s.getChannelAccounts)
			channels.POST("/:channelId/bind", s.bindChannelRoute)
			channels.GET("/qrcode/:id", s.getChannelQRCode)
			channels.POST("/setup", s.saveChannelConfig)
			channels.DELETE("/:channelId/setup", s.unbindChannel)
		}
		v1.GET("/wechat/plugin/status", s.checkWeChatPlugin)
		v1.GET("/wechat/config/status", s.getWeChatConfigStatus)
		v1.POST("/wechat/install", s.installWeChatPlugin)
		v1.DELETE("/wechat/unbind/:id", s.unbindWeChatAccount)
		v1.GET("/ws/logs", s.streamLogs)
		v1.GET("/ws/tui", s.handleTUI)
		v1.GET("/ws/shell", s.handleShell)
		v1.GET("/ws/gateway", s.handleGatewayProxy)

		// Self-healing management
		v1.GET("/settings/self-healing", s.getSelfHealingSetting)
		v1.POST("/settings/self-healing", s.updateSelfHealingSetting)
		v1.GET("/heal/events", s.getHealEvents)
		v1.GET("/heal/reports", s.getHealReports)
		v1.GET("/heal/reports/:name", s.getHealReportDetail)
		v1.GET("/heal/backups", s.getHealBackups)
		v1.GET("/heal/backups/:name", s.getHealBackupDetail)
		v1.GET("/heal/backups/:name/diff", s.getHealBackupDiff)
		v1.GET("/tasks/status", s.getTasksStatus)
		v1.GET("/system/events", s.getSystemEvents)
		v1.GET("/system/version", s.getSystemVersion)
		v1.POST("/system/upgrade", s.handleUpgrade)
		v1.POST("/system/restart", s.handleRestart)
		v1.GET("/system/info", s.getServerInfo)

		// Proxy for external dashboard
		v1.Any("/proxy/*path", s.proxyLobsterDashboard)
	}

	s.setupStaticFiles()
}

//go:embed dist/*
var staticFiles embed.FS

// renderIndexHTML handles the common logic for serving and injecting WebRoot into index.html
func (s *Server) renderIndexHTML(c *gin.Context, distFS fs.FS) {
	content, err := fs.ReadFile(distFS, "index.html")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "index.html not found"})
		return
	}

	html := string(content)

	// Inject window.__WEB_ROOT__ as early as possible
	script := fmt.Sprintf("<script>window.__WEB_ROOT__='%s';</script>", s.cfg.WebRoot)
	html = strings.Replace(html, "<title>", script+"<title>", 1)

	// Fix asset paths in HTML if WebRoot is not /
	if s.cfg.WebRoot != "/" {
		prefix := s.cfg.WebRoot
		// Only replace if it doesn't already have the prefix
		if !strings.Contains(html, "href=\""+prefix) {
			html = strings.ReplaceAll(html, "href=\"/", "href=\""+prefix+"/")
			html = strings.ReplaceAll(html, "src=\"/", "src=\""+prefix+"/")
			html = strings.ReplaceAll(html, "action=\"/", "action=\""+prefix+"/")
			html = strings.ReplaceAll(html, "content=\"/", "content=\""+prefix+"/")
		}
	}

	c.Header("Content-Type", "text/html; charset=utf-8")
	c.String(http.StatusOK, html)
}

func (s *Server) setupStaticFiles() {
	distFS, err := fs.Sub(staticFiles, "dist")
	if err != nil {
		return
	}

	// For root path or files that exist in the dist folder
	s.engine.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path

		// Handle WebRoot prefix
		prefix := s.cfg.WebRoot
		if prefix == "/" {
			prefix = ""
		}

		relPath := path
		if prefix != "" {
			if len(path) < len(prefix) || path[:len(prefix)] != prefix {
				// Not under webroot
				if strings.Contains(path, "/v1/") {
					c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "API not found"})
					return
				}
				return
			}
			relPath = path[len(prefix):]
		}

		// If the relative path starts with /v1/ after prefix, it's an API that wasn't matched
		if strings.HasPrefix(relPath, "/v1/") {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "API not found"})
			return
		}

		if relPath == "/" || relPath == "" {
			s.renderIndexHTML(c, distFS)
			return
		}

		if relPath[0] == '/' {
			relPath = relPath[1:]
		}

		// Try to open the file in embedded FS
		f, err := distFS.Open(relPath)
		if err == nil {
			f.Close()
			// If it's index.html, use the render logic
			if relPath == "index.html" {
				s.renderIndexHTML(c, distFS)
				return
			}

			http.StripPrefix(prefix, http.FileServer(http.FS(distFS))).ServeHTTP(c.Writer, c.Request)
			return
		}

		// Fallback to index.html for SPA routing
		// CRITICAL: Must use renderIndexHTML here to ensure WebRoot injection works on refreshes!
		s.renderIndexHTML(c, distFS)
	})
}

func (s *Server) Run() error {
	go s.StartWebSocketBroadcaster()
	
	addr := fmt.Sprintf(":%d", s.cfg.WebPort)
	log.Printf("🚀 Web Server starting on %s (WebRoot: %s)", addr, s.cfg.WebRoot)
	
	// 为自重启场景增加重试逻辑 (最多等待 15 秒)
	// 使用更宽松的错误判定，确保在任何端口冲突情况下都能坚持等待旧进程退出
	var err error
	for i := 0; i < 30; i++ {
		err = s.engine.Run(addr)
		if err != nil {
			errStr := strings.ToLower(err.Error())
			if strings.Contains(errStr, "address already in use") || 
			   strings.Contains(errStr, "bind") || 
			   strings.Contains(errStr, "permission denied") {
				log.Printf("⚠️ [API] 端口 %s 暂时无法绑定，可能旧进程正在退出，200ms 后重试 (%d/30)...", addr, i+1)
				time.Sleep(200 * time.Millisecond)
				continue
			}
		}
		break
	}
	return err
}

func (s *Server) GetEngine() *gin.Engine {
	return s.engine
}
