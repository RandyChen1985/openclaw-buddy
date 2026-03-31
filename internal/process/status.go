package process

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
)

type SystemMetrics struct {
	CPUUsage    float64 `json:"cpu_usage"`
	MemoryUsage float64 `json:"memory_usage"`
	DiskUsage   float64 `json:"disk_usage"`
}

type OpenClawStatus struct {
	Version     string          `json:"version"`
	InstalledAt string          `json:"installed_at"`
	Gateway     GatewayStatus   `json:"gateway"`
	Metrics     SystemMetrics   `json:"metrics"`
	Plugins     []ServiceStatus `json:"plugins"`
	Channels    []ServiceStatus `json:"channels"`
	Agents      []ServiceStatus   `json:"agents"`
}

type GatewayStatus struct {
	Runtime string `json:"runtime"`
	PID     int    `json:"pid"`
	Status  string `json:"status"` // "Running" or "Stopped"
}

type Device struct {
	RequestId   string   `json:"requestId"` // 仅针对待处理设备
	DeviceId    string   `json:"deviceId"`  // 仅针对已配对设备
	DisplayName string   `json:"displayName"`
	Platform    string   `json:"platform"`
	ClientId    string   `json:"clientId"`
	ClientMode  string   `json:"clientMode"`
	Role        string   `json:"role"`
	Scopes      []string `json:"scopes"`
	Status      string   `json:"status"` // "pending" 或 "paired"
	CreatedAtMs int64    `json:"createdAtMs"`
	ApprovedAtMs int64   `json:"approvedAtMs"`
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

	// 0.1 获取系统负载 (支持 Mac/Linux)
	status.Metrics = GetSystemMetrics()

	// 1. 解析网关状态
	if IsPortListening(port) {
		status.Gateway.Status = "running"
		pid, _ := GetPIDByPort(port)
		status.Gateway.PID = pid
		status.Gateway.Runtime = GetProcessRuntime(pid)
	} else {
		status.Gateway.Status = "stopped"
		status.Gateway.Runtime = "Inactive"
	}

	return status, nil
}

// GetProcessRuntime 获取指定 PID 进程的已运行时间
func GetProcessRuntime(pid int) string {
	if pid <= 0 {
		return "Unknown"
	}
	cmd := exec.Command("ps", "-o", "etime=", "-p", strconv.Itoa(pid))
	out, err := cmd.Output()
	if err != nil {
		return "Active (Port Monitored)"
	}
	runtimeStr := strings.TrimSpace(string(out))
	if runtimeStr == "" {
		return "Active (Port Monitored)"
	}
	return runtimeStr
}

func GetSystemMetrics() SystemMetrics {
	metrics := SystemMetrics{
		CPUUsage:    0,
		MemoryUsage: 0,
		DiskUsage:   0,
	}

	// 1. CPU Usage (平台差异化适配)
	if runtime.GOOS == "darwin" {
		// macOS: top -l 1 并匹配 "idle"
		cpuCmd := exec.Command("sh", "-c", "top -l 1 | grep 'CPU usage'")
		cpuOut, _ := cpuCmd.Output()
		cpuStr := string(cpuOut)
		idleMatch := regexp.MustCompile(`([\d.]+)% idle`).FindStringSubmatch(cpuStr)
		if len(idleMatch) > 1 {
			idle, _ := strconv.ParseFloat(idleMatch[1], 64)
			metrics.CPUUsage = 100.0 - idle
		}
	} else if runtime.GOOS == "linux" {
		// Linux: top -b -n 1 (批处理模式单次采样) 并匹配 "id"
		cpuCmd := exec.Command("sh", "-c", "top -b -n 1 | grep \"Cpu(s)\"")
		cpuOut, _ := cpuCmd.Output()
		cpuStr := string(cpuOut)
		// Linux 示例: %Cpu(s):  5.0 us,  2.0 sy,  0.0 ni, 93.0 id, ...
		idleMatch := regexp.MustCompile(`([\d.]+)\s+id`).FindStringSubmatch(cpuStr)
		if len(idleMatch) > 1 {
			idle, _ := strconv.ParseFloat(idleMatch[1], 64)
			metrics.CPUUsage = 100.0 - idle
		}
	}

	// 2. Memory Usage (Rough estimate using ps, 跨平台通用)
	memCmd := exec.Command("sh", "-c", "ps -A -o %mem | awk '{s+=$1} END {print s}'")
	memOut, _ := memCmd.Output()
	memRaw := strings.TrimSpace(string(memOut))
	if memRaw != "" {
		metrics.MemoryUsage, _ = strconv.ParseFloat(memRaw, 64)
		if metrics.MemoryUsage > 100 {
			metrics.MemoryUsage = 95.5 // 封顶保护
		}
	}

	// 3. Disk Usage (Root partition, df 指令跨平台语义一致)
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

func GetOpenClawDevices() ([]Device, error) {
	cmd := exec.Command("openclaw", "devices", "list", "--json")
	out, err := cmd.Output() // 仅读取 stdout，通常能过滤掉输出到 stderr 的插件日志
	if err != nil {
		return nil, err
	}

	var resp struct {
		Pending []Device `json:"pending"`
		Paired  []Device `json:"paired"`
	}

	// 过滤 ANSI 码并精准定位 JSON 起始位置
	raw := StripANSI(string(out))
	// 设备列表是个对象，所以我们寻找第一个 '{'。
	// 使用 strings.Index("{") 避免误匹配日志标签如 "[plugins]"
	idx := strings.Index(raw, "{")
	if idx != -1 {
		raw = raw[idx:]
	}

	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		return nil, err
	}

	var all []Device
	for _, d := range resp.Pending {
		d.Status = "pending"
		all = append(all, d)
	}
	for _, d := range resp.Paired {
		d.Status = "paired"
		all = append(all, d)
	}

	return all, nil
}

func ApproveDevice(requestId string) error {
	cmd := exec.Command("openclaw", "devices", "approve", requestId)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("批准设备失败: %s", string(out))
	}
	return nil
}

func finalizeList(list []string) []string {
	if len(list) == 0 {
		return []string{}
	}
	s := strings.Join(list, "")
	parts := strings.Split(s, ",")
	var result []string
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
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
