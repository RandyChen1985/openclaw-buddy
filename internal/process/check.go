package process

import (
	"fmt"
	"net"
	"os/exec"
	"strconv"
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

func GetGatewayStatus() string {
	cmd := exec.Command("openclaw", "gateway", "status")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Sprintf("获取状态失败: %v", err)
	}
	return strings.TrimSpace(string(out))
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

func CheckHealth() (time.Duration, error) {
	start := time.Now()
	cmd := exec.Command("openclaw", "health")
	err := cmd.Run()
	elapsed := time.Since(start)
	if err != nil {
		return elapsed, fmt.Errorf("openclaw health check failed: %v", err)
	}
	return elapsed, nil
}

func GetPIDByPort(port int) (int, error) {
	cmd := exec.Command("sh", "-c", fmt.Sprintf("lsof -t -i :%d", port))
	out, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("no process listening on port %d", port)
	}
	pidStr := strings.TrimSpace(string(out))
	if pidStr == "" {
		return 0, fmt.Errorf("empty PID for port %d", port)
	}
	// lsof -t might return multiple PIDs if multiple processes are bound (unlikely for TCP LISTEN)
	// we take the first one
	firstPid := strings.Split(pidStr, "\n")[0]
	pid, err := strconv.Atoi(firstPid)
	if err != nil {
		return 0, fmt.Errorf("invalid PID format: %s", firstPid)
	}
	return pid, nil
}
