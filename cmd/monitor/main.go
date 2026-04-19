package main

import (
	"context"
	"io"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"openclaw-buddy/internal/api"
	"openclaw-buddy/internal/config"
	"openclaw-buddy/internal/guardian"
	"openclaw-buddy/internal/process"
	"openclaw-buddy/internal/utils"
	"runtime"

	"github.com/natefinch/lumberjack"
)

func maskToken(token string) string {
	t := token
	if len(t) <= 6 {
		return "***"
	}
	return t[:3] + "***" + t[len(t)-3:]
}

func main() {
	// 1. Ensure required directories exist
	_ = os.MkdirAll("data", 0755)
	_ = os.MkdirAll("pid", 0755)

	// 2. Singleton Check
	pidPath := os.Getenv("PID_FILE")
	if pidPath == "" {
		pidPath = filepath.Join("pid", "openclaw-buddy.pid")
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
	server := api.NewServer(cfg, g)
	
	if runtime.GOOS == "windows" && os.Getenv("CLI_MODE") != "true" {
		log.Printf("🚀 Starting GUI mode (Windows)...")
		if err := server.RunGUI(); err != nil {
			log.Fatalf("❌ GUI Failed: %v", err)
		}
	} else {
		log.Printf("🚀 Web Server starting on http://0.0.0.0:%d (Token: %s)", cfg.WebPort, maskToken(cfg.Token))
		go func() {
			if err := server.Run(); err != nil {
				log.Printf("❌ Web Server failed: %v", err)
				stop()
			}
		}()
		<-ctx.Done()
	}
	log.Printf("👋 OpenClaw Buddy 正在退出...")
}
