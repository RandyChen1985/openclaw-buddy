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

func IsPortListening(host string, port int) bool {
	if host == "" {
		host = "127.0.0.1"
	}
	timeout := 2 * time.Second
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", host, port), timeout)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func IsAnyPortListening(hosts []string, port int) bool {
	if len(hosts) == 0 {
		return IsPortListening("127.0.0.1", port)
	}
	for _, host := range hosts {
		if IsPortListening(host, port) {
			return true
		}
	}
	return false
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

// CheckConfig 执行 openclaw config validate 并检查配置内容是否有效
func CheckConfig(configDir string) (bool, string, error) {
	bin := GetOpenClawBinary()
	
	// 1. 优先尝试专有的 config validate 命令 (2024.Q4+ 版本支持)
	cmd := exec.Command(bin, "config", "validate")
	
	// 2. 注入环境变量
	// 继承当前进程环境，并注入/覆盖关键变量
	env := os.Environ()
	
	// 补丁：确保 MacOS 下能找到 /opt/homebrew/bin/node 或 /usr/local/bin/node
	if runtime.GOOS == "darwin" {
		extraPath := "/opt/homebrew/bin:/usr/local/bin"
		foundPath := false
		for i, e := range env {
			if strings.HasPrefix(e, "PATH=") {
				env[i] = "PATH=" + extraPath + ":" + strings.TrimPrefix(e, "PATH=")
				foundPath = true
				break
			}
		}
		if !foundPath {
			env = append(env, "PATH="+extraPath)
		}
	}
	
	// 注入配置目录
	if configDir != "" {
		absConfigDir, _ := filepath.Abs(configDir)
		env = append(env, "OPENCLAW_CONFIG_DIR="+absConfigDir)
		env = append(env, "OPENCLAW_STATE_DIR="+absConfigDir)
	}
	cmd.Env = env

	out, err := cmd.CombinedOutput()
	output := string(out)

	// 如果输出包含 "Config valid"，则认为校验通过 (config validate 模式)
	if strings.Contains(output, "Config valid") {
		return true, "", nil
	}

	// 如果命令不存在或不支持 validate 子命令，回退到 health 模式
	if err != nil && (strings.Contains(output, "unknown command") || strings.Contains(output, "Display help")) {
		cmdHealth := exec.Command(bin, "health")
		cmdHealth.Env = env
		outHealth, errHealth := cmdHealth.CombinedOutput()
		output = string(outHealth)
		err = errHealth
	}

	// 解析错误详情
	if err != nil || strings.Contains(output, "Problem:") || strings.Contains(output, "Config invalid") {
		// 提取关键错误行
		lines := strings.Split(output, "\n")
		var problemDetails []string
		foundIntro := false
		
		for _, line := range lines {
			trimmedLine := strings.TrimSpace(line)
			if trimmedLine == "" || strings.Contains(line, "OpenClaw") {
				continue
			}
			// 匹配 Problem: 之后的内容或核心错误信息
			if strings.Contains(line, "Problem:") || strings.Contains(line, "Error:") || strings.Contains(line, "invalid") {
				foundIntro = true
			}
			if foundIntro {
				// 过滤 ANSI 转义字符
				cleanLine := StripANSI(trimmedLine)
				if cleanLine != "" {
					problemDetails = append(problemDetails, cleanLine)
				}
			}
		}

		if len(problemDetails) > 0 {
			return false, strings.Join(problemDetails, " | "), nil
		}
		
		// 兜底：如果没有匹配到特征行，则返回全部输出 (限制长度)
		if len(output) > 500 {
			output = output[:500] + "..."
		}
		return false, fmt.Sprintf("校验失败 (Exit %v): %s", err, strings.TrimSpace(output)), nil
	}

	return true, "", nil
}

func GetDashboardURL(ctx context.Context, externalPrefix string) (string, error) {
	// 将外部 Context 与 30 秒超时控制合并，支持前端主动中断及后端安全超时
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
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

// IsProcessRunning checks if a process with the given name is currently running.
func IsProcessRunning(name string) bool {
	if runtime.GOOS == "windows" {
		cmd := exec.Command("cmd", "/c", "tasklist /FI \"IMAGENAME eq "+name+"\" /NH")
		out, _ := cmd.Output()
		return strings.Contains(string(out), name)
	}

	// Linux/Mac: ps -ef | grep [name] (avoiding grep itself)
	// We use a simple pgrep if available, or ps with grep
	cmd := exec.Command("sh", "-c", "ps -ef | grep \""+name+"\" | grep -v grep")
	err := cmd.Run()
	return err == nil
}

// looksLikeOpenclawPackageInstallCommand detects package-manager installs of the openclaw npm package
// (e.g. "npm i openclaw@latest", node .../npm-cli.js install openclaw).
func looksLikeOpenclawPackageInstallCommand(cmd string) bool {
	l := strings.ToLower(strings.TrimSpace(cmd))
	if l == "" || !strings.Contains(l, "openclaw") {
		return false
	}
	// Handled by dedicated process checks; avoid false positives on their argv.
	if strings.Contains(l, "openclaw-update") || strings.Contains(l, "openclaw-doctor") {
		return false
	}
	hasPM := strings.HasPrefix(l, "npm ") || strings.Contains(l, " npm ") ||
		strings.Contains(l, "/npm ") || strings.Contains(l, "npm-cli") ||
		strings.HasPrefix(l, "pnpm ") || strings.Contains(l, " pnpm ") ||
		strings.HasPrefix(l, "yarn ") || strings.Contains(l, " yarn ")
	if !hasPM {
		return false
	}
	if strings.Contains(l, "openclaw@") {
		return true
	}
	return strings.Contains(l, " install openclaw") ||
		strings.Contains(l, " i openclaw") ||
		strings.Contains(l, " add openclaw") ||
		strings.Contains(l, " ci openclaw")
}

func readUnixProcessCommandLines() ([]string, error) {
	argvCandidates := [][]string{
		{"ps", "ax", "-ww", "-o", "command="},
		{"ps", "-ewwo", "args="},
		{"ps", "-eo", "args="},
	}
	for _, argv := range argvCandidates {
		out, err := exec.Command(argv[0], argv[1:]...).Output()
		if err != nil {
			continue
		}
		s := strings.TrimSpace(string(out))
		if s == "" {
			continue
		}
		return strings.Split(s, "\n"), nil
	}
	return nil, fmt.Errorf("unable to list process command lines")
}

func isOpenClawPackageInstallRunningUnix() bool {
	lines, err := readUnixProcessCommandLines()
	if err != nil {
		return false
	}
	for _, line := range lines {
		if looksLikeOpenclawPackageInstallCommand(strings.TrimSpace(line)) {
			return true
		}
	}
	return false
}

func isOpenClawPackageInstallRunningWindows() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// One-shot filter avoids pulling every CommandLine into Go on large machines.
	script := `$ErrorActionPreference = 'Stop'
foreach ($p in Get-CimInstance Win32_Process) {
  $l = $p.CommandLine
  if ($null -eq $l) { continue }
  $x = $l.ToLower()
  if ($x -notlike '*openclaw*') { continue }
  if ($x -notmatch 'npm|pnpm|yarn|npm-cli') { continue }
  if ($x -like '*openclaw-update*' -or $x -like '*openclaw-doctor*') { continue }
  if ($x -like '*openclaw@*') { exit 0 }
  if ($x -match '\s(i|install|add|ci)\s+[^\s]{0,48}openclaw') { exit 0 }
}
exit 1`
	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	if err := cmd.Run(); err == nil {
		return true
	}
	return false
}

func isOpenClawPackageInstallRunning() bool {
	if runtime.GOOS == "windows" {
		return isOpenClawPackageInstallRunningWindows()
	}
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" && runtime.GOOS != "freebsd" {
		return false
	}
	return isOpenClawPackageInstallRunningUnix()
}

// IsOpenClawUpgradeOrInstallBusy is true while official update/doctor or package-manager install
// of openclaw is in progress. The guardian should defer self-healing in these windows.
func IsOpenClawUpgradeOrInstallBusy() bool {
	if IsProcessRunning("openclaw-update") || IsProcessRunning("openclaw-doctor") {
		return true
	}
	return isOpenClawPackageInstallRunning()
}
