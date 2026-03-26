package process

import (
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

type OpenClawStatus struct {
	Gateway  GatewayStatus   `json:"gateway"`
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

func GetStructuredStatus() (OpenClawStatus, error) {
	cmd := exec.Command("openclaw", "status")
	out, _ := cmd.CombinedOutput()
	output := StripANSI(string(out))

	status := OpenClawStatus{
		Plugins:  []ServiceStatus{},
		Channels: []ServiceStatus{},
		Agents:   []ServiceStatus{},
	}

	// 1. Parse Gateway Info
	status.Gateway.Runtime = parseValue(output, `Runtime:\s*([^\n]+)`)
	pidStr := parseValue(output, `PID:\s*(\d+)`)
	if pidStr != "" {
		pid, _ := strconv.Atoi(pidStr)
		status.Gateway.PID = pid
		status.Gateway.Status = "Running"
	} else {
		status.Gateway.Status = "Stopped"
	}

	// 2. Parse Tables
	lines := strings.Split(output, "\n")
	currentSection := ""

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "Plugins") {
			currentSection = "plugins"
		} else if strings.Contains(line, "Channels") {
			currentSection = "channels"
		} else if strings.Contains(line, "Agents") {
			currentSection = "agents"
		}

		if strings.HasPrefix(line, "│") && (strings.Contains(line, "✓") || strings.Contains(line, "✗")) {
			parts := splitTableLine(line)
			if len(parts) >= 2 {
				online := strings.Contains(parts[0], "✓")
				name := parts[1]
				svc := ServiceStatus{Name: name, Online: online}
				
				switch currentSection {
				case "plugins":
					status.Plugins = append(status.Plugins, svc)
				case "channels":
					status.Channels = append(status.Channels, svc)
				case "agents":
					status.Agents = append(status.Agents, svc)
				}
			}
		}
	}

	return status, nil
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
