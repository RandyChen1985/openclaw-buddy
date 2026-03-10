package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"yovole-openclaw-monitor/internal/config"
	"yovole-openclaw-monitor/internal/guardian"
	"yovole-openclaw-monitor/internal/process"
	"yovole-openclaw-monitor/internal/utils"
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

	// 3. Environment Check
	if _, err := process.CheckBinaryInPath("openclaw"); err != nil {
		log.Fatalf("❌ %v", err)
	}

	version, err := process.GetVersion()
	if err != nil {
		log.Printf("⚠️ Could not get OpenClaw version: %v", err)
	} else {
		log.Printf("🦞 OpenClaw Version: %s", version)
	}

	// 4. Running Dependency Check (Warning only)
	if !process.IsPortListening(cfg.HealthPort) {
		log.Printf("⚠️ Warning: OpenClaw is NOT running. Guardian will wait for it to start.")
	} else if err := process.CheckHealth(); err != nil {
		log.Printf("⚠️ Warning: OpenClaw health check failed: %v. Guardian will attempt to heal if needed.", err)
	}

	// 5. Setup Context and Signal Handling
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// 6. Start Guardian
	g := guardian.NewGuardian(cfg)
	
	log.Printf("🛡️ Guardian started (PID: %d). Watching OpenClaw...", os.Getpid())
	
	go g.Run(ctx)

	<-ctx.Done()
	log.Printf("👋 Guardian shutting down gracefully...")
}
