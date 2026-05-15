package process

import (
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sort"
	"sync"
	"time"

	"openclaw-buddy/internal/utils"
)

var (
	metricsCache     SystemMetrics
	lastMetricsTime  time.Time
	metricsMu        sync.RWMutex

	versionCache string
	versionMu    sync.RWMutex
)

const MetricsTTL = 30 * time.Second

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

func GetStructuredStatus(configDir string, port int) (OpenClawStatus, error) {
	status := OpenClawStatus{
		Plugins:  []ServiceStatus{},
		Channels: []ServiceStatus{},
		Agents:   []ServiceStatus{},
	}

	// 0. 获取版本号 (增加缓存逻辑)
	versionMu.RLock()
	cachedVer := versionCache
	versionMu.RUnlock()

	if cachedVer != "" {
		status.Version = cachedVer
	} else {
		verCmd := exec.Command("openclaw", "--version")
		verOut, _ := verCmd.CombinedOutput()
		status.Version = strings.TrimSpace(StripANSI(string(verOut)))
		
		versionMu.Lock()
		versionCache = status.Version
		versionMu.Unlock()
	}

	// 0.1 获取系统负载 (支持 Mac/Linux)
	status.Metrics = GetSystemMetrics()

	// 1. 解析网关状态
	// 尝试从配置获取所有可能的 host
	hosts := []string{"127.0.0.1"}
	if gw, err := GetOpenClawGatewayConfig(configDir); err == nil {
		hosts = gw.GetGatewayHosts()
	}

	if IsAnyPortListening(hosts, port) {
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
	metricsMu.RLock()
	if time.Since(lastMetricsTime) < MetricsTTL {
		defer metricsMu.RUnlock()
		return metricsCache
	}
	metricsMu.RUnlock()

	metricsMu.Lock()
	defer metricsMu.Unlock()

	// Double check
	if time.Since(lastMetricsTime) < MetricsTTL {
		return metricsCache
	}

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

	metricsCache = metrics
	lastMetricsTime = time.Now()

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

// auditDashboardDefaultWindow 与前端审计大屏初始日期范围一致：从今日 0 点往前共 7 个自然日（含今日）。
// （AuditDashboard 默认 dateRange 为 subtract(6,'day') .. today）
func auditDashboardDefaultWindow() (start string, end string) {
	loc := time.Local
	now := time.Now().In(loc)
	endDT := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 0, loc)
	startDT := endDT.AddDate(0, 0, -6)
	startDT = time.Date(startDT.Year(), startDT.Month(), startDT.Day(), 0, 0, 0, 0, loc)
	return startDT.Format("2006-01-02 15:04:05"), endDT.Format("2006-01-02 15:04:05")
}

func enrichBotRanks(configDir string, ranks []BotRank) []BotRank {
	botsData, _ := GetOpenClawBotsModels(configDir)
	botNames := make(map[string]string)
	botEmojis := make(map[string]string)
	if botsData != nil {
		for _, b := range botsData.Bots {
			botNames[b.ID] = b.Name
			botEmojis[b.ID] = b.Emoji
		}
	}
	for i := range ranks {
		id := ranks[i].ID
		if n, ok := botNames[id]; ok {
			ranks[i].Name = n
		}
		if e, ok := botEmojis[id]; ok {
			ranks[i].Emoji = e
		}
	}
	return ranks
}

// getBotRankingFromAuditDB 按审计库统计：时间窗内各 agent 的去重 session_key 数量（与审计大屏「会话数」同源：
// audit_usage ∪ audit_security_events，再去重 session_key；此处按 agent 分组）。
func getBotRankingFromAuditDB(configDir string) ([]BotRank, error) {
	if utils.DB == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	start, end := auditDashboardDefaultWindow()
	q := `
SELECT agent_id, COUNT(*) AS cnt FROM (
  SELECT DISTINCT agent_id, session_key FROM (
    SELECT agent_id, session_key FROM audit_usage
    WHERE timestamp >= ? AND timestamp <= ?
      AND session_key IS NOT NULL AND TRIM(session_key) != ''
      AND agent_id IS NOT NULL AND TRIM(agent_id) != ''
    UNION
    SELECT agent_id, session_key FROM audit_security_events
    WHERE timestamp >= ? AND timestamp <= ?
      AND session_key IS NOT NULL AND TRIM(session_key) != ''
      AND agent_id IS NOT NULL AND TRIM(agent_id) != ''
  )
) GROUP BY agent_id ORDER BY cnt DESC LIMIT 3`
	rows, err := utils.DB.Query(q, start, end, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ranks []BotRank
	for rows.Next() {
		var agentID string
		var cnt int
		if err := rows.Scan(&agentID, &cnt); err != nil {
			return nil, err
		}
		ranks = append(ranks, BotRank{
			ID:       agentID,
			Name:     agentID,
			Emoji:    "🤖",
			Sessions: cnt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return enrichBotRanks(configDir, ranks), nil
}

func getBotRankingFromOpenClawSessions(configDir string) ([]BotRank, error) {
	sessions, err := GetOpenClawSessions()
	if err != nil {
		return nil, err
	}

	stats := make(map[string]int)
	for _, sess := range sessions {
		stats[sess.AgentID]++
	}

	ranks := []BotRank{}
	for id, count := range stats {
		ranks = append(ranks, BotRank{
			ID:       id,
			Name:     id,
			Emoji:    "🤖",
			Sessions: count,
		})
	}

	sort.Slice(ranks, func(i, j int) bool {
		return ranks[i].Sessions > ranks[j].Sessions
	})

	if len(ranks) > 3 {
		ranks = ranks[:3]
	}

	return enrichBotRanks(configDir, ranks), nil
}

// GetBotRanking 聚合计算机器人活跃榜 (前 3 名)。
// 优先使用 Buddy 审计库（与「审计大屏」相同数据口径）；无库或无数据时回退 OpenClaw CLI 会话列表。
func GetBotRanking(configDir string) ([]BotRank, error) {
	if utils.DB != nil {
		ranks, err := getBotRankingFromAuditDB(configDir)
		if err != nil {
			log.Printf("⚠️ [Ranking] 审计库聚合失败，回退 OpenClaw 会话列表: %v", err)
		} else if len(ranks) > 0 {
			return ranks, nil
		}
	}
	return getBotRankingFromOpenClawSessions(configDir)
}
