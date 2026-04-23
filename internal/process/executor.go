package process

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type CommandResult struct {
	Success    bool   `json:"success"`
	Output     string `json:"output"` // Combined output (legacy)
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	ReturnCode int    `json:"return_code"`
	Error      string `json:"error,omitempty"`
}

// OpenClawConfigEnv 返回注入子进程的环境变量，使 openclaw CLI 读写指定目录下的 openclaw.json。
// 与 Buddy 的 OPENCLAW_CONFIG_DIR 及 CheckConfig 中 OPENCLAW_CONFIG_DIR 用法一致；若只设置
// OPENCLAW_CONFIG_PATH 而部分 CLI 仍认「配置目录」，可能把变更写到默认 ~/.openclaw。
func OpenClawConfigEnv(configDir string) ([]string, error) {
	raw := strings.TrimSpace(configDir)
	if raw == "" {
		return nil, fmt.Errorf("openclaw config dir is empty")
	}
	dir := filepath.Clean(expandUserConfigDir(raw))
	if dir == "" {
		return nil, fmt.Errorf("openclaw config dir is empty")
	}
	absDir, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	cfgPath := filepath.Join(absDir, "openclaw.json")
	return []string{
		"OPENCLAW_CONFIG_DIR=" + absDir,
		"OPENCLAW_STATE_DIR=" + absDir,
		"OPENCLAW_CONFIG_PATH=" + cfgPath,
	}, nil
}

func trimRunOutputForErr(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

// expandUserConfigDir 展开 ~/ 前缀，避免 filepath.Abs("~/.openclaw") 把 ~ 当成普通目录名。
func expandUserConfigDir(dir string) string {
	d := strings.TrimSpace(dir)
	if d == "" {
		return d
	}
	if strings.HasPrefix(d, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, d[2:])
		}
	}
	if d == "~" {
		if home, err := os.UserHomeDir(); err == nil {
			return home
		}
	}
	return d
}

// RunCommandWithTimeout executes a command and captures its output with a timeout.
func RunCommandWithTimeout(timeout time.Duration, name string, args ...string) (*CommandResult, error) {
	return RunCommandWithEnvAndTimeout(timeout, nil, name, args...)
}

// RunCommandWithEnvAndTimeout executes a command with custom environment variables and captures its output with a timeout.
func RunCommandWithEnvAndTimeout(timeout time.Duration, env []string, name string, args ...string) (*CommandResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, name, args...)
	if env != nil {
		cmd.Env = append(os.Environ(), env...)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	stdoutStr := StripANSI(stdout.String())
	stderrStr := StripANSI(stderr.String())
	combinedOutput := stdoutStr + stderrStr

	result := &CommandResult{
		Success: err == nil && ctx.Err() == nil,
		Output:  combinedOutput,
		Stdout:  stdoutStr,
		Stderr:  stderrStr,
	}

	if exitErr, ok := err.(*exec.ExitError); ok {
		result.ReturnCode = exitErr.ExitCode()
	} else if err != nil {
		result.Error = err.Error()
	}

	if ctx.Err() == context.DeadlineExceeded {
		result.Success = false
		if result.Error == "" {
			result.Error = "Command timed out"
		}
		return result, fmt.Errorf("%s: %w (%s)", name, ctx.Err(), trimRunOutputForErr(combinedOutput, 800))
	}

	if err != nil {
		result.Success = false
		hint := trimRunOutputForErr(combinedOutput, 800)
		if result.ReturnCode != 0 {
			return result, fmt.Errorf("%s %v: exit %d: %s", name, args, result.ReturnCode, hint)
		}
		return result, fmt.Errorf("%s %v: %v; %s", name, args, err, hint)
	}

	return result, nil
}

// StreamCommand runs a command and pipes its output to the provided writer.
func StreamCommand(ctx context.Context, w io.Writer, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	
	// Create a writer that strips ANSI codes before writing to the output
	ansiStripper := &ansiStrippingWriter{w: w}
	
	cmd.Stdout = ansiStripper
	cmd.Stderr = ansiStripper

	return cmd.Run()
}

type ansiStrippingWriter struct {
	w io.Writer
}

func (asw *ansiStrippingWriter) Write(p []byte) (n int, err error) {
	stripped := StripANSI(string(p))
	return asw.w.Write([]byte(stripped))
}
