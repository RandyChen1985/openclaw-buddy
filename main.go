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
	"fmt"
	"time"
	"os/exec"
)

// showError helper to show a Windows Message Box
func showError(title, message string) {
	fmt.Fprintf(os.Stderr, "❌ ERROR: %s - %s\n", title, message)
	if runtime.GOOS == "windows" {
		// Use PowerShell to show a message box
		cmd := fmt.Sprintf("Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('%s', '%s', 'OK', 'Error')", message, title)
		cmdObj := exec.Command("powershell", "-Command", cmd)
		process.PrepareSilentCommand(cmdObj)
		_ = cmdObj.Run()
	}
}

func main() {
	// 初始化 Windows 进程作业对象 (Job Object)，确保及其子进程在退出时能被系统自动清理
	process.InitJobObject()

	// 0. Ensure working directory is the executable's directory

	ex, err := os.Executable()
	if err == nil {
		exPath := filepath.Dir(ex)
		_ = os.Chdir(exPath)
	}

	// 1. Ensure required directories exist
	currentDir, _ := os.Getwd()
	fmt.Fprintf(os.Stdout, "📂 Starting Guardian... CWD: %s\n", currentDir)

	for _, dir := range []string{"data", "pid", "logs"} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Failed to create required directory '%s': %v\n", dir, err)
		} else {
			fmt.Fprintf(os.Stdout, "✅ Directory ready: %s\n", dir)
		}
	}

	// Double-force log file visibility
	logFile := filepath.Join("logs", "guardian.log")
	if f, err := os.OpenFile(logFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644); err == nil {
		f.WriteString("--- OpenClaw Buddy Init " + time.Now().Format("2006-01-02 15:04:05") + " ---\n")
		f.Close()
		fmt.Fprintf(os.Stdout, "📝 Log file initialized: %s\n", logFile)
	} else {
		fmt.Fprintf(os.Stderr, "❌ Failed to touch log file: %v\n", err)
	}

	// 2. Singleton Check
	fmt.Fprintf(os.Stdout, "DEBUG 🔐: Performing singleton check...\n")
	// Skip lock check during Wails binding generation
	if os.Getenv("WAILS_GENERATE_BINDINGS") != "true" && os.Getenv("WAILS_BINDINGS_ONLY") != "true" {
		pidPath := os.Getenv("PID_FILE")
		if pidPath == "" {
			pidPath = filepath.Join("pid", "openclaw-buddy.pid")
		}
		lock := utils.NewFileLock(pidPath)
		if err := lock.Lock(); err != nil {
			msg := fmt.Sprintf("Error: guardian is already running (locked by %s). Please check Task Manager.", pidPath)
			showError("Launch Error", msg)
			log.Fatalf("❌ %s", msg)
		}
		defer lock.Unlock()
	}

	// 3. Load Config
	fmt.Fprintf(os.Stdout, "DEBUG ⚙️: Loading configuration...\n")
	cfg, err := config.LoadConfig()
	if err != nil {
		showError("Config Error", fmt.Sprintf("Failed to load config: %v", err))
		log.Fatalf("❌ Failed to load config: %v", err)
	}
	fmt.Fprintf(os.Stdout, "DEBUG ✅: Config loaded successfully (LogFile: %s)\n", cfg.LogFile)

	// 4. Dynamic Log Directory Creation
	logDir := filepath.Dir(cfg.LogFile)
	if err := os.MkdirAll(logDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Failed to create log directory: %v\n", err)
	}

	// 5. Initialize Logger
	fmt.Fprintf(os.Stdout, "DEBUG 📔: Initializing logger with rotation...\n")
	logRotate := &lumberjack.Logger{
		Filename:   cfg.LogFile,
		MaxSize:    cfg.LogMaxSize,
		MaxBackups: cfg.LogMaxBackups,
		MaxAge:     cfg.LogMaxAge,
		Compress:   cfg.LogCompress,
	}
	mw := io.MultiWriter(os.Stdout, logRotate)
	log.SetOutput(mw)
	log.Println("✅ --- Physical Logger Initialized Successfully ---")

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
		log.Printf("⚠️ %v (This is expected during build/binding generation if openclaw is missing)", err)
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
	server.SetShutdownHook(stop)

	if runtime.GOOS == "windows" && os.Getenv("CLI_MODE") != "true" {
		log.Printf("🚀 Starting GUI mode (Windows)...")
		if err := server.RunGUI(); err != nil {
			log.Fatalf("❌ GUI Failed: %v", err)
		}
	} else {
		log.Printf("🚀 Web Server starting on http://0.0.0.0:%d (Token: %s)", cfg.WebPort, cfg.Token)
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
