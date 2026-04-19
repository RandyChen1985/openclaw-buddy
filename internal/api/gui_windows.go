//go:build windows

package api

import (
	"context"
	"errors"
	"log"
	"os"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx context.Context
	s   *Server
}

// NewApp creates a new App struct
func NewApp(s *Server) *App {
	return &App{
		s: s,
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// Start the Gin server in a separate goroutine
	go func() {
		log.Printf("🚀 Starting Web Server for GUI...")
		if err := a.s.Run(); err != nil {
			log.Printf("❌ Web Server failed: %v", err)
		}
	}()
}

func (a *App) domReady(ctx context.Context) {
	// 移除强制重定向到 http://localhost:3000 的逻辑，
	// 避免在登录过程中发生 Origin 切换导致 localStorage 丢失。
	wruntime.WindowShow(ctx)
	wruntime.WindowCenter(ctx)
}


func (s *Server) RunGUI() error {
	app := NewApp(s)

	// Get a clean filesystem for Wails (without 'dist/' prefix)
	distFS, err := GetStaticFiles()
	if err != nil {
		log.Printf("❌ Failed to get static assets for GUI: %v", err)
		return err
	}

	// Create a custom menu
	appMenu := menu.NewMenu()
	if os.Getenv("DEBUG") == "true" {
		appMenu.Append(menu.WindowMenu())
	}

	// Create application with options
	err = wails.Run(&options.App{
		Title:  "OpenClaw Buddy",
		Width:  1280,
		Height: 800,
		AssetServer: &assetserver.Options{
			Assets: distFS,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnDomReady:       app.domReady,
		OnShutdown: func(ctx context.Context) {
			log.Printf("🛑 [GUI] OnShutdown: 正在关闭 HTTP 并停止 Guardian 上下文...")
			shutCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			if err := s.ShutdownHTTP(shutCtx); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("⚠️ [GUI] HTTP Shutdown: %v", err)
			}
			if s.shutdownHook != nil {
				s.shutdownHook()
			}
		},
		OnBeforeClose: func(ctx context.Context) (prevent bool) {
			// Instead of closing, hide the window to tray
			// Note: If no tray icon is available, this might make the app "hidden"
			// Only hide if we actually have a tray (currently disabled)
			// wruntime.WindowHide(ctx)
			// return true
			return false
		},
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			DisableWindowIcon:    false,
		},
		Menu: appMenu,
		// TrayMenu is handled differently in Wails v2, temporarily disabling it for build stability
		// TrayMenu: trayMenu,
	})

	if err != nil {
		log.Printf("❌ Wails initialization failed: %v", err)
		return err
	}
	log.Printf("✅ Wails window closed normally.")
	return nil
}
