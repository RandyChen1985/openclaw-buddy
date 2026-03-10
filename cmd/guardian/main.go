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
		log.Printf("⚠️ Warning: OpenClaw 未运行. 有孚小龙虾带外服务将等待启动.")
	} else if err := process.CheckHealth(); err != nil {
		log.Printf("⚠️ Warning: OpenClaw 健康检查失败: %v. 有孚小龙虾带外服务将尝试自愈.", err)
	}

	// 6. Setup Context and Signal Handling
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// 7. Start Service
	g := guardian.NewGuardian(cfg)
	
	log.Printf("🛡️ 有孚小龙虾带外服务已启动 (PID: %d). 正在监控 OpenClaw...", os.Getpid())
	
	go g.Run(ctx)

	<-ctx.Done()
	log.Printf("👋 有孚小龙虾带外服务正在退出...")
}
