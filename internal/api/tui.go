package api

import (
	"os"
	"os/exec"
	"runtime"

	"github.com/gin-gonic/gin"
)

type TuiMessage struct {
	Type string `json:"type"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

func (s *Server) handleTUI(c *gin.Context) {
	// 动态查找 openclaw 命令路径
	openclawPath, err := exec.LookPath("openclaw")
	if err != nil {
		openclawPath = "openclaw" // 兜底
	}

	s.startPTY(c, openclawPath, "", "tui")
}

func (s *Server) handleShell(c *gin.Context) {
	cwd := c.Query("cwd")
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

	s.startPTY(c, shell, cwd)
}
