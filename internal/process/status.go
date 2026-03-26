package process

import (
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

type SystemMetrics struct {
	CPUUsage    float64 `json:"cpu_usage"`
	MemoryUsage float64 `json:"memory_usage"`
	DiskUsage   float64 `json:"disk_usage"`
}

type OpenClawStatus struct {
	Version  string          `json:"version"`
	Gateway  GatewayStatus   `json:"gateway"`
	Metrics  SystemMetrics   `json:"metrics"`
	Plugins  []ServiceStatus `json:"plugins"`
	Channels []ServiceStatus `json:"channels"`
	Agents   []ServiceStatus `json:"agents"`
}

type GatewayStatus struct {
	Runtime string `json:"runtime"`
	PID     int    `json:"pid"`
	Status  string `json:"status"` // "Running" or "Stopped"
}

type ServiceStatus struct {
	Name    string `json:"name"`
	Online  bool   `json:"online"`
	Details string `json:"details,omitempty"`
}

func GetStructuredStatus(port int) (OpenClawStatus, error) {
	status := OpenClawStatus{
		Plugins:  []ServiceStatus{},
		Channels: []ServiceStatus{},
		Agents:   []ServiceStatus{},
	}

	// 0. 获取版本号
	verCmd := exec.Command("openclaw", "--version")
	verOut, _ := verCmd.CombinedOutput()
	status.Version = strings.TrimSpace(StripANSI(string(verOut)))

	// 0.1 获取系统负载 (针对 Mac 优化)
	status.Metrics = getSystemMetrics()

	// 1. 解析网关状态：仅使用端口监听判断，确保最快响应速度
	if IsPortListening(port) {
		status.Gateway.Status = "Running"
		pid, _ := GetPIDByPort(port)
		status.Gateway.PID = pid
		status.Gateway.Runtime = "Active (Port Monitored)"
	} else {
		status.Gateway.Status = "Stopped"
		status.Gateway.Runtime = "Inactive"
	}

	// 2. 解析插件/渠道/Agent 表格：移除依赖项扫描逻辑，直接返回空列表以提升性能
	// 已按用户要求关闭 openclaw status 调用

	return status, nil
}

func getSystemMetrics() SystemMetrics {
	metrics := SystemMetrics{
		CPUUsage:    0,
		MemoryUsage: 0,
		DiskUsage:   0,
	}

	// 1. CPU Usage (from top)
	cpuCmd := exec.Command("sh", "-c", "top -l 1 | grep 'CPU usage'")
	cpuOut, _ := cpuCmd.Output()
	cpuStr := string(cpuOut)
	idleMatch := regexp.MustCompile(`([\d.]+)% idle`).FindStringSubmatch(cpuStr)
	if len(idleMatch) > 1 {
		idle, _ := strconv.ParseFloat(idleMatch[1], 64)
		metrics.CPUUsage = 100.0 - idle
	}

	// 2. Memory Usage (Rough estimate using ps)
	memCmd := exec.Command("sh", "-c", "ps -A -o %mem | awk '{s+=$1} END {print s}'")
	memOut, _ := memCmd.Output()
	memRaw := strings.TrimSpace(string(memOut))
	if memRaw != "" {
		metrics.MemoryUsage, _ = strconv.ParseFloat(memRaw, 64)
		if metrics.MemoryUsage > 100 {
			metrics.MemoryUsage = 95.5
		}
	}

	// 3. Disk Usage (Root partition)
	diskCmd := exec.Command("sh", "-c", "df / | tail -1 | awk '{print $5}' | sed 's/%//'")
	diskOut, _ := diskCmd.Output()
	diskRaw := strings.TrimSpace(string(diskOut))
	if diskRaw != "" {
		metrics.DiskUsage, _ = strconv.ParseFloat(diskRaw, 64)
	}

	return metrics
}

func parseValue(input, pattern string) string {
	re := regexp.MustCompile(pattern)
	matches := re.FindStringSubmatch(input)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	return ""
}

func splitTableLine(line string) []string {
	parts := strings.Split(line, "│")
	var result []string
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
