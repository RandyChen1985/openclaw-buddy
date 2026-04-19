package process

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
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
	Agents      []ServiceStatus `json:"agents"`
}

type GatewayStatus struct {
	Runtime string `json:"runtime"`
	PID     int    `json:"pid"`
	Status  string `json:"status"` // "Running" or "Stopped"
}

type Device struct {
	RequestId    string   `json:"requestId"` // 仅针对待处理设备
	DeviceId     string   `json:"deviceId"`  // 仅针对已配对设备
	DisplayName  string   `json:"displayName"`
	Platform     string   `json:"platform"`
	ClientId     string   `json:"clientId"`
	ClientMode   string   `json:"clientMode"`
	Role         string   `json:"role"`
	Scopes       []string `json:"scopes"`
	Status       string   `json:"status"` // "pending" 或 "paired"
	CreatedAtMs  int64    `json:"createdAtMs"`
	ApprovedAtMs int64    `json:"approvedAtMs"`
}

type BotRank struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Emoji    string `json:"emoji"`
	Sessions int    `json:"sessions"`
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

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// 0. 获取版本号
	verCmd := exec.CommandContext(ctx, GetOpenClawBinary(), "--version")
	PrepareSilentCommand(verCmd)
	verOut, _ := verCmd.CombinedOutput()
	status.Version = strings.TrimSpace(StripANSI(string(verOut)))

	// 0.1 获取系统负载
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
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		// Windows 不支持 ps，使用简单的活跃标识
		return "Active (Port Monitored)"
	} else {
		cmd = exec.CommandContext(ctx, "ps", "-o", "etime=", "-p", strconv.Itoa(pid))
	}

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

func windowsSystemDriveLetter() string {
	wd, err := os.Getwd()
	if err != nil {
		return "C:"
	}
	v := filepath.VolumeName(wd)
	if v == "" {
		return "C:"
	}
	return strings.ToUpper(v)
}

func execPowerShellFloat(ctx context.Context, psScript string) float64 {
	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NoLogo", "-Command", psScript)
	PrepareSilentCommand(cmd)
	out, err := cmd.Output()
	if err != nil {
		return 0
	}
	s := strings.TrimSpace(string(out))
	s = strings.ReplaceAll(s, ",", ".")
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return v
}

func GetSystemMetrics() SystemMetrics {
	metrics := SystemMetrics{
		CPUUsage:    0,
		MemoryUsage: 0,
		DiskUsage:   0,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// 1. CPU Usage (平台差异化适配)
	if runtime.GOOS == "darwin" {
		// macOS: top -l 1 并匹配 "idle"
		cpuCmd := exec.CommandContext(ctx, "sh", "-c", "top -l 1 | grep 'CPU usage'")
		cpuOut, _ := cpuCmd.Output()
		cpuStr := string(cpuOut)
		idleMatch := regexp.MustCompile(`([\d.]+)% idle`).FindStringSubmatch(cpuStr)
		if len(idleMatch) > 1 {
			idle, _ := strconv.ParseFloat(idleMatch[1], 64)
			metrics.CPUUsage = 100.0 - idle
		}
	} else if runtime.GOOS == "linux" {
		// Linux: top -b -n 1 并匹配 "id"
		cpuCmd := exec.CommandContext(ctx, "sh", "-c", "top -b -n 1 | grep \"Cpu(s)\"")
		cpuOut, _ := cpuCmd.Output()
		cpuStr := string(cpuOut)
		idleMatch := regexp.MustCompile(`([\d.]+)\s+id`).FindStringSubmatch(cpuStr)
		if len(idleMatch) > 1 {
			idle, _ := strconv.ParseFloat(idleMatch[1], 64)
			metrics.CPUUsage = 100.0 - idle
		}
	} else if runtime.GOOS == "windows" {
		// Windows: CIM（替代已弃用的 wmic）
		ps := "[math]::Round((Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average, 2)"
		metrics.CPUUsage = execPowerShellFloat(ctx, ps)
	}

	// 2. Memory Usage
	if runtime.GOOS == "windows" {
		ps := "$o = Get-CimInstance Win32_OperatingSystem; if ($null -ne $o -and $o.TotalVisibleMemorySize -gt 0) { [math]::Round(100 * (1 - $o.FreePhysicalMemory / $o.TotalVisibleMemorySize), 2) } else { 0 }"
		metrics.MemoryUsage = execPowerShellFloat(ctx, ps)
	} else {
		// Unix: Rough estimate using ps
		memCmd := exec.CommandContext(ctx, "sh", "-c", "ps -A -o %mem | awk '{s+=$1} END {print s}'")
		memOut, _ := memCmd.Output()
		memRaw := strings.TrimSpace(string(memOut))
		if memRaw != "" {
			metrics.MemoryUsage, _ = strconv.ParseFloat(memRaw, 64)
		}
	}
	if metrics.MemoryUsage > 100 {
		metrics.MemoryUsage = 95.5 // 封顶保护
	}

	// 3. Disk Usage (Buddy 工作目录所在卷，替代固定 C:)
	if runtime.GOOS == "windows" {
		drive := windowsSystemDriveLetter()
		ps := fmt.Sprintf("$d = Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='%s'\"; if ($null -ne $d -and $d.Size -gt 0) { [math]::Round(100 * (1 - $d.FreeSpace / $d.Size), 2) } else { 0 }", drive)
		metrics.DiskUsage = execPowerShellFloat(ctx, ps)
	} else {
		diskCmd := exec.CommandContext(ctx, "sh", "-c", "df / | tail -1 | awk '{print $5}' | sed 's/%//'")
		diskOut, _ := diskCmd.Output()
		diskRaw := strings.TrimSpace(string(diskOut))
		if diskRaw != "" {
			metrics.DiskUsage, _ = strconv.ParseFloat(diskRaw, 64)
		}
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
	cmd := exec.Command(GetOpenClawBinary(), "devices", "list", "--json")
	PrepareSilentCommand(cmd)
	out, err := cmd.CombinedOutput() // 仅读取 stdout，通常能过滤掉输出到 stderr 的插件日志
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
	cmd := exec.Command(GetOpenClawBinary(), "devices", "approve", requestId)
	PrepareSilentCommand(cmd)
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

// GetBotRanking 聚合计算机器人活跃榜 (前 3 名)
func GetBotRanking(configDir string) ([]BotRank, error) {
	sessions, err := GetOpenClawSessions()
	if err != nil {
		return nil, err
	}

	// 聚合分析：统计每个 Agent 的活跃会话
	stats := make(map[string]int)
	for _, sess := range sessions {
		stats[sess.AgentID]++
	}

	// 获取所有机器人名称信息以丰富结果
	botsData, _ := GetOpenClawBotsModels(configDir)
	botNames := make(map[string]string)
	botEmojis := make(map[string]string)
	if botsData != nil {
		for _, b := range botsData.Bots {
			botNames[b.ID] = b.Name
			botEmojis[b.ID] = b.Emoji
		}
	}

	ranks := []BotRank{}
	for id, count := range stats {
		name := id
		if n, ok := botNames[id]; ok {
			name = n
		}
		emoji := "🤖"
		if e, ok := botEmojis[id]; ok {
			emoji = e
		}
		ranks = append(ranks, BotRank{
			ID:       id,
			Name:     name,
			Emoji:    emoji,
			Sessions: count,
		})
	}

	// 按会话数倒序排序
	sort.Slice(ranks, func(i, j int) bool {
		return ranks[i].Sessions > ranks[j].Sessions
	})

	// 仅返回前 3 名
	if len(ranks) > 3 {
		ranks = ranks[:3]
	}

	return ranks, nil
}
