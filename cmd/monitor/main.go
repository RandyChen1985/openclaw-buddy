package main

import (
	"context"
	"io"
	"log"
	"os"
	"os/signal"
	"syscall"
	"yovole-openclaw-monitor/internal/api"
	"yovole-openclaw-monitor/internal/config"
	"yovole-openclaw-monitor/internal/guardian"
	"yovole-openclaw-monitor/internal/process"
	"yovole-openclaw-monitor/internal/utils"

	"github.com/natefinch/lumberjack"
)

const pidFilePath = "/tmp/lobster-guardian.pid"

func main() {
	// 1. Singleton Check
	lock := utils.NewFileLock(pidFilePath)
	if err := lock.Lock(); err != nil {
		log.Fatalf("❌ Error: %v", err)
	}
	defer lock.Unlock()

	// 2. Load Config
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("❌ Failed to load config: %v", err)
	}

	// 3. Initialize Logger with Rotation
	logRotate := &lumberjack.Logger{
		Filename:   cfg.LogFile,
		MaxSize:    cfg.LogMaxSize,
		MaxBackups: cfg.LogMaxBackups,
		MaxAge:     cfg.LogMaxAge,
		Compress:   cfg.LogCompress,
	}
	mw := io.MultiWriter(os.Stdout, logRotate)
	log.SetOutput(mw)

	// 4. Initialize SQLite DB
	if err := utils.InitDB(cfg.DBFile); err != nil {
		log.Fatalf("❌ Failed to initialize database: %v", err)
	}
	log.Printf("📦 Database initialized at %s", cfg.DBFile)

	// 5. Environment Check
	if _, err := process.CheckBinaryInPath("openclaw"); err != nil {
		log.Fatalf("❌ %v", err)
	}

	// 6. Setup Context and Signal Handling
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// 7. Start Guardian Worker (Background)
	g := guardian.NewGuardian(cfg)
	log.Printf("🛡️ Guardian Worker starting...")
	go g.Run(ctx)

	// 8. Start Web Server
	server := api.NewServer(cfg)
	log.Printf("🚀 Web Server starting on http://0.0.0.0:%d (Token: %s)", cfg.WebPort, cfg.Token)
	
	go func() {
		if err := server.Run(); err != nil {
			log.Printf("❌ Web Server failed: %v", err)
			stop()
		}
	}()

	<-ctx.Done()
	log.Printf("👋 有孚小龙虾监控服务正在退出...")
}
