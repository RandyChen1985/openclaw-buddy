package main

import (
	"context"
	"io"
	"log"
	"os"
	"os/signal"
	"syscall"
	"openclaw-buddy/internal/api"
	"openclaw-buddy/internal/config"
	"openclaw-buddy/internal/guardian"
	"openclaw-buddy/internal/process"
	"openclaw-buddy/internal/utils"

	"github.com/natefinch/lumberjack"
)

func main() {
	// 1. Singleton Check
	pidPath := os.Getenv("PID_FILE")
	if pidPath == "" {
		pidPath = "/tmp/openclaw-buddy.pid"
	}
	lock := utils.NewFileLock(pidPath)
	if err := lock.Lock(); err != nil {
		log.Fatalf("❌ Error: guardian is already running (locked by %s)", pidPath)
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
	newToken, err := utils.InitDB(cfg.DBFile, cfg.Token)
	if err != nil {
		log.Fatalf("❌ Failed to initialize database: %v", err)
	}
	if newToken != "" {
		cfg.Token = newToken
		log.Printf("🔑 First run detected. Generated new random token: %s", newToken)
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
	log.Printf("👋 OpenClaw Buddy 正在退出...")
}
