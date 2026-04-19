package api

import (
	"os"
	"runtime"

	"github.com/gin-gonic/gin"
	"openclaw-buddy/internal/process"
)

type TuiMessage struct {
	Type string `json:"type"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

func (s *Server) handleTUI(c *gin.Context) {
	s.startPTY(c, process.GetOpenClawBinary(), "tui")
}

func (s *Server) handleShell(c *gin.Context) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		if runtime.GOOS == "windows" {
			shell = os.Getenv("COMSPEC")
			if shell == "" {
				shell = "powershell.exe"
			}
		} else {
			// Mac/Linux 兜底
			if _, err := os.Stat("/bin/zsh"); err == nil {
				shell = "/bin/zsh"
			} else if _, err := os.Stat("/bin/bash"); err == nil {
				shell = "/bin/bash"
			} else {
				shell = "/bin/sh"
			}
		}
	}

	s.startPTY(c, shell)
}
