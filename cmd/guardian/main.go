package main

import (
	"context"
	"io"
	"log"
	"os"
	"os/signal"
	"syscall"
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
	// MultiWriter ensures logs go to both the file and console
	mw := io.MultiWriter(os.Stdout, logRotate)
	log.SetOutput(mw)

	// 4. Environment Check
	if _, err := process.CheckBinaryInPath("openclaw"); err != nil {
		log.Fatalf("❌ %v", err)
	}

	version, err := process.GetVersion()
	if err != nil {
		log.Printf("⚠️ Could not get OpenClaw version: %v", err)
	} else {
		log.Printf("🦞 OpenClaw Version: %s", version)
	}

	// 5. Running Dependency Check (Warning only)
	if !process.IsPortListening(cfg.HealthPort) {
		log.Printf("⚠️ Warning: OpenClaw is NOT running. Guardian will wait for it to start.")
	} else if err := process.CheckHealth(); err != nil {
		log.Printf("⚠️ Warning: OpenClaw health check failed: %v. Guardian will attempt to heal if needed.", err)
	}

	// 6. Setup Context and Signal Handling
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// 7. Start Guardian
	g := guardian.NewGuardian(cfg)
	
	log.Printf("🛡️ Guardian started (PID: %d). Watching OpenClaw...", os.Getpid())
	
	go g.Run(ctx)

	<-ctx.Done()
	log.Printf("👋 Guardian shutting down gracefully...")
}
