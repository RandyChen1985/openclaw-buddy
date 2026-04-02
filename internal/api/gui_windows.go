//go:build windows

package api

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
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
		if err := a.s.Run(); err != nil {
			log.Printf("❌ Web Server failed: %v", err)
		}
	}()
}

func (s *Server) RunGUI() error {
	app := NewApp(s)

	// Create a custom menu
	appMenu := menu.NewMenu()
	if os.Getenv("DEBUG") == "true" {
		appMenu.Append(menu.WindowMenu())
	}

	// Define tray menu
	trayMenu := menu.NewMenu()
	trayMenu.Append(menu.Text("显示面板", nil, func(_ *menu.CallbackData) {
		wruntime.WindowShow(app.ctx)
	}))
	trayMenu.Append(menu.Text("查看日志", keys.CmdOrCtrl("l"), func(_ *menu.CallbackData) {
		logPath, _ := filepath.Abs(s.cfg.LogFile)
		_ = exec.Command("notepad.exe", logPath).Start()
	}))
	trayMenu.Append(menu.Separator())
	trayMenu.Append(menu.Text("彻底退出", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
		wruntime.Quit(app.ctx)
	}))

	startURL := fmt.Sprintf("http://localhost:%d%s", s.cfg.WebPort, s.cfg.WebRoot)

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "OpenClaw Buddy",
		Width:  1280,
		Height: 800,
		AssetServer: &assetserver.Options{
			Assets: staticFiles,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnBeforeClose: func(ctx context.Context) (prevent bool) {
			// Instead of closing, hide the window to tray
			wruntime.WindowHide(ctx)
			return true
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
		TrayMenu: trayMenu,
		// We point Wails to the local Gin server URL
		URL: startURL,
	})

	if err != nil {
		return err
	}
	return nil
}
