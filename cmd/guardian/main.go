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

	// 4. Strong Running Dependency Check
	if !process.IsPortListening(cfg.HealthPort) {
		log.Fatalf("❌ OpenClaw is NOT running. Please start the gateway manually before running the Guardian.")
	}

	if err := process.CheckHealth(); err != nil {
		log.Fatalf("❌ OpenClaw health check failed: %v. Please ensure OpenClaw is working correctly.", err)
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
