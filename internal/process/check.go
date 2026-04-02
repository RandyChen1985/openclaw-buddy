package process

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

func GetOpenClawBinary() string {
	// 1. 优先检查当前目录下是否存在 (适用于 Windows 绿色版部署)
	exeName := "openclaw"
	if runtime.GOOS == "windows" {
		exeName = "openclaw.exe"
	}
	
	if _, err := os.Stat(exeName); err == nil {
		absPath, _ := filepath.Abs(exeName)
		return absPath
	}

	// 2. 检查环境变量 PATH
	if path, err := exec.LookPath("openclaw"); err == nil {
		return path
	}

	// 默认返回名称，依靠系统查找
	return "openclaw"
}

func CheckBinaryInPath(name string) (string, error) {
	path, err := exec.LookPath(name)
	if err != nil {
		return "", fmt.Errorf("binary %s not found in PATH", name)
	}
	return path, nil
}

func GetVersion() (string, error) {
	cmd := exec.Command(GetOpenClawBinary(), "--version")
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get openclaw version: %v", err)
	}
	return strings.TrimSpace(string(out)), nil
}

func GetGatewayStatus() string {
	cmd := exec.Command(GetOpenClawBinary(), "gateway", "status")
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
	cmd := exec.Command(GetOpenClawBinary(), "health")
	err := cmd.Run()
	elapsed := time.Since(start)
	if err != nil {
		return elapsed, fmt.Errorf("openclaw health check failed: %v", err)
	}
	return elapsed, nil
}

// CheckConfig 执行 openclaw health 并检查配置内容是否有效
func CheckConfig() (bool, string, error) {
	cmd := exec.Command(GetOpenClawBinary(), "health")
	out, err := cmd.CombinedOutput()
	output := string(out)

	// 如果输出包含 "Problem:" 或 "Config invalid"，则认为配置无效
	if strings.Contains(output, "Problem:") || strings.Contains(output, "Config invalid") {
		// 提取 Problem 之后的内容
		lines := strings.Split(output, "\n")
		var problemDetails []string
		foundProblem := false
		for _, line := range lines {
			trimmedLine := strings.TrimSpace(line)
			if trimmedLine == "" {
				continue
			}
			if strings.Contains(line, "Problem:") {
				foundProblem = true
			}
			if foundProblem {
				problemDetails = append(problemDetails, trimmedLine)
			}
		}

		detail := "配置校验失败"
		if len(problemDetails) > 0 {
			detail = strings.Join(problemDetails, " | ")
		}
		return false, detail, nil
	}

	// 如果有错误但没捕获到 Problem，可能是命令本身执行失败
	if err != nil {
		return false, fmt.Sprintf("命令执行异常: %v", err), nil
	}

	return true, "", nil
}

func GetDashboardURL(ctx context.Context, externalPrefix string) (string, error) {
	// 将外部 Context 与 30 秒超时控制合并，支持前端主动中断及后端安全超时
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	bin := GetOpenClawBinary()
	log.Printf("[Dashboard] 执行命令: %s dashboard --no-open", bin)
	cmd := exec.CommandContext(ctx, bin, "dashboard", "--no-open")
	out, err := cmd.CombinedOutput()
	output := string(out)
	
	if err != nil {
		log.Printf("[Dashboard] 命令执行失败: %v, 输出: %s", err, output)
		return "", fmt.Errorf("failed to execute dashboard command: %v", err)
	}

	log.Printf("[Dashboard] 命令执行成功，输出长度: %d", len(output))

	// 使用正则匹配 Dashboard URL: http://...
	re := regexp.MustCompile(`Dashboard URL: (https?://[^\s\n]+)`)
	matches := re.FindStringSubmatch(output)
	if len(matches) > 1 {
		rawURL := strings.TrimSpace(matches[1])
		log.Printf("[Dashboard] 匹配到原始 URL: %s", rawURL)
		
		// 如果配置了外部前缀，执行替换
		if externalPrefix != "" {
			// 找到 # 符号的位置（Token 的起点）
			if idx := strings.Index(rawURL, "#"); idx != -1 {
				// 拼接：外部前缀 + Token 部分
				// 确保前缀结尾处理正确
				prefix := strings.TrimSuffix(externalPrefix, "/")
				finalURL := prefix + "/" + rawURL[idx:]
				log.Printf("[Dashboard] 应用外部前缀后 URL: %s", finalURL)
				return finalURL, nil
			}
		}
		
		return rawURL, nil
	}

	log.Printf("[Dashboard] 未在输出中找到 URL 模式")
	return "", fmt.Errorf("dashboard URL not found in command output")
}

func GetPIDByPort(port int) (int, error) {
	if runtime.GOOS == "windows" {
		// Windows: netstat -ano | findstr LISTENING
		// 我们过滤出 LISTENING 状态且包含指定端口的行
		cmd := exec.Command("cmd", "/c", "netstat -ano | findstr LISTENING")
		out, err := cmd.Output()
		if err != nil {
			return 0, fmt.Errorf("failed to run netstat: %v", err)
		}
		
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		portPattern := fmt.Sprintf(":%d", port)
		
		for _, line := range lines {
			fields := strings.Fields(line)
			if len(fields) >= 5 {
				addr := fields[1]
				// 确保端口完全匹配（如 :80 不匹配 :8080）
				if strings.HasSuffix(addr, portPattern) {
					pid, err := strconv.Atoi(fields[len(fields)-1])
					if err == nil {
						return pid, nil
					}
				}
			}
		}
		return 0, fmt.Errorf("no process found listening on port %d", port)
	}

	// Linux/Mac: lsof -t -i :port
	cmd := exec.Command("sh", "-c", fmt.Sprintf("lsof -t -i :%d", port))
	out, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("no process listening on port %d", port)
	}
	pidStr := strings.TrimSpace(string(out))
	if pidStr == "" {
		return 0, fmt.Errorf("empty PID for port %d", port)
	}
	firstPid := strings.Split(pidStr, "\n")[0]
	pid, err := strconv.Atoi(firstPid)
	if err != nil {
		return 0, fmt.Errorf("invalid PID format: %s", firstPid)
	}
	return pid, nil
}
