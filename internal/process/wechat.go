package process

import (
	"bufio"
	"context"
	"log"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

type WeChatQRCode struct {
	URL       string    `json:"qrcode_url"`
	Cached    bool      `json:"cached"`
	ExpiresAt time.Time `json:"expires_at"`
}

type WeChatPluginStatus struct {
	Installed bool      `json:"installed"`
	Status    string    `json:"status"`
	Version   string    `json:"version"`
	LastCheck time.Time `json:"last_check"`
}

var (
	qrCodeCache     *WeChatQRCode
	statusCache     *WeChatPluginStatus
	statusCacheTime time.Time
	cacheMutex      sync.Mutex
)

func GetWeChatQRCode(force bool) (*WeChatQRCode, error) {
	cacheMutex.Lock()
	defer cacheMutex.Unlock()

	now := time.Now()
	// 如果不强制刷新且缓存有效且 URL 不为空，直接返回
	if !force && qrCodeCache != nil && now.Before(qrCodeCache.ExpiresAt) && qrCodeCache.URL != "" {
		result := *qrCodeCache
		result.Cached = true
		return &result, nil
	}

	// 使用新命令: openclaw channels login --channel openclaw-weixin
	log.Printf("📥 Executing: openclaw channels login --channel openclaw-weixin (Streaming Mode, Force: %v)", force)
	
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// 我们需要手动管理进程以在获取到 URL 后立即杀死它，因为该命令会一直等待扫码结果
	var args []string = []string{"channels", "login", "--channel", "openclaw-weixin"}
	cmd := exec.CommandContext(ctx, "openclaw", args...)
	
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = cmd.Stdout // 合并 stderr 到 stdout

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	// 异步读取输出
	var foundURL string
	done := make(chan bool)
	
	re := regexp.MustCompile(`https://liteapp\.weixin\.qq\.com/q/[^\s\n]*`)

	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			// log.Printf("[CLI-OUT] %s", line) // 调试日志
			match := re.FindString(line)
			if match != "" {
				foundURL = match
				log.Printf("🎯 Captured QR URL from stream: %s", foundURL)
				cancel() // 找到 URL 后立即发出取消信号杀死进程
				close(done)
				return
			}
		}
		close(done)
	}()

	// 等待结果或超时
	select {
	case <-done:
		// 正常结束或找到 URL
	case <-ctx.Done():
		if ctx.Err() == context.DeadlineExceeded {
			log.Printf("⚠️ GetWeChatQRCode timed out after 30s")
		}
	}

	// 尝试等待进程结束（已经被 cancel 杀死或自行结束）
	_ = cmd.Wait()

	if foundURL == "" {
		log.Printf("⚠️ No QR code URL found in streaming output")
		return nil, nil
	}

	qrcodeURL := foundURL
	if !strings.Contains(qrcodeURL, "bot_type") {
		qrcodeURL += "&bot_type=3"
	}
	
	qrCodeCache = &WeChatQRCode{
		URL:       qrcodeURL,
		Cached:    false,
		ExpiresAt: now.Add(5 * time.Minute),
	}

	return qrCodeCache, nil
}

func GetWeChatPluginStatus() (*WeChatPluginStatus, error) {
	cacheMutex.Lock()
	// 如果缓存存在且未超过 5 分钟，直接返回
	if statusCache != nil && time.Since(statusCacheTime) < 5*time.Minute {
		defer cacheMutex.Unlock()
		return statusCache, nil
	}
	cacheMutex.Unlock()

	// 执行 openclaw plugins list
	log.Printf("🔍 Executing: openclaw plugins list (Detecting WeChat Plugin Status)")
	res, _ := RunCommandWithTimeout(15*time.Second, "openclaw", "plugins", "list")
	
	lines := strings.Split(res.Output, "\n")
	
	status := &WeChatPluginStatus{
		Installed: false,
		Status:    "Not Installed",
		Version:   "Unknown",
		LastCheck: time.Now(),
	}

	// 处理换行问题：有些终端宽度受限，表格行会被截断/分行
	// 我们尝试将所有包含 │ 的行合并成一个大字符串，移除换行后再解析
	var combinedRows []string
	for _, line := range lines {
		if strings.Contains(line, "│") {
			combinedRows = append(combinedRows, StripANSI(line))
		}
	}
	
	// 如果由于换行导致 "weixin" 被切分，简单的 strings.Contains(line, "weixin") 会失败
	// 我们合并后再按起始标记 ┌ 或 ├ 重新切分（或者简单地看合集）
	fullTable := strings.Join(combinedRows, "")
	
	// 更粗放但健壮的匹配：只要表格里出现了 weixin 且有 loaded 字样
	if (strings.Contains(strings.ToLower(fullTable), "weixin")) {
		status.Installed = true
		if strings.Contains(strings.ToLower(fullTable), "loaded") {
			status.Status = "loaded"
		}
		// 版本号匹配: 查找类似 2.0.0 的模式
		versionRe := regexp.MustCompile(`\d+\.\d+\.\d+`)
		if v := versionRe.FindString(fullTable); v != "" {
			status.Version = v
		}
	}

	// 更新缓存
	cacheMutex.Lock()
	statusCache = status
	statusCacheTime = time.Now()
	statusCache.LastCheck = statusCacheTime
	cacheMutex.Unlock()

	return status, nil
}

type ChatChannel struct {
	Name       string `json:"name"`
	Configured bool   `json:"configured"`
}

func GetChatChannels() ([]ChatChannel, error) {
	log.Printf("🔍 Executing: openclaw channels list (Detecting Configured Channels)")
	res, _ := RunCommandWithTimeout(20*time.Second, "openclaw", "channels", "list")

	var channels []ChatChannel
	lines := strings.Split(res.Output, "\n")
	isChannelSection := false

	for _, line := range lines {
		trimmedLine := strings.TrimSpace(StripANSI(line))
		if strings.Contains(trimmedLine, "Chat channels:") {
			isChannelSection = true
			continue
		}

		if isChannelSection && strings.HasPrefix(trimmedLine, "- ") {
			namePart := strings.TrimPrefix(trimmedLine, "- ")
			// 格式通常为: - Name: configured, ... 或 - Name: not configured, ...
			isConfigured := strings.Contains(namePart, ": configured")
			
			// 提取名称 (冒号之前的部分)
			name := namePart
			if idx := strings.Index(namePart, ":"); idx != -1 {
				name = strings.TrimSpace(namePart[:idx])
			}

			channels = append(channels, ChatChannel{
				Name:       name,
				Configured: isConfigured,
			})
		}
	}

	return channels, nil
}

func InstallWeChatPlugin() error {
	// 1. 安装插件
	log.Printf("📦 Installing WeChat plugin...")
	_, err := RunCommandWithTimeout(120*time.Second, "openclaw", "plugins", "install", "@tencent-weixin/openclaw-weixin")
	if err != nil {
		return err
	}

	// 2. 启用插件
	log.Printf("⚙️ Enabling WeChat plugin in config...")
	_, err = RunCommandWithTimeout(10*time.Second, "openclaw", "config", "set", "plugins.entries.openclaw-weixin.enabled", "true")
	return err
}
