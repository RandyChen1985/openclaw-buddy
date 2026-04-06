//go:build windows

package api

import (
	"os/exec"
)

func setSysProcAttr(cmd *exec.Cmd) {
	// On Windows, background processes don't need Setpgid as on Unix.
	// Wails/Go will manage the process lifecycle.
}

func killProcessGroup(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	// On Windows, cmd.Process.Kill() is sufficient for common binaries.
	_ = cmd.Process.Kill()
}
