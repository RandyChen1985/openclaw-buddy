package process

import (
	"fmt"
	"net"
	"os/exec"
	"strings"
	"time"
)

func CheckBinaryInPath(name string) (string, error) {
	path, err := exec.LookPath(name)
	if err != nil {
		return "", fmt.Errorf("binary %s not found in PATH", name)
	}
	return path, nil
}

func GetVersion() (string, error) {
	cmd := exec.Command("openclaw", "--version")
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get openclaw version: %v", err)
	}
	return strings.TrimSpace(string(out)), nil
}

func IsPortListening(port int) bool {
	timeout := 2 * time.Second
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), timeout)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func CheckHealth() error {
	cmd := exec.Command("openclaw", "health")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("openclaw health check failed: %v", err)
	}
	return nil
}
