//go:build !windows

package process

import (
	"os/exec"
)

// PrepareSilentCommand is a no-op on non-Windows platforms
func PrepareSilentCommand(cmd *exec.Cmd) {
	// Nothing to do on Unix-like systems for hiding console windows
}

// InitJobObject is a no-op on non-Windows platforms
func InitJobObject() {
	// No job object needed on Unix
}

