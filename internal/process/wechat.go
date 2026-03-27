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
	
	status := &WeChatPluginStatus{
		Installed: false,
		Status:    "Not Installed",
		Version:   "Unknown",
		LastCheck: time.Now(),
	}

	// 1. 按行处理输出
	lines := strings.Split(res.Output, "\n")
	
	for _, line := range lines {
		cleanLine := strings.ToLower(StripANSI(line))
		// 2. 只有包含 weixin 的行才进行解析
		if strings.Contains(cleanLine, "weixin") {
			status.Installed = true
			if strings.Contains(cleanLine, "loaded") {
				status.Status = "loaded"
			}
			// 3. 在这一行内提取版本号
			versionRe := regexp.MustCompile(`\d+\.\d+\.\d+`)
			if v := versionRe.FindString(line); v != "" {
				status.Version = v
			}
			// 如果已经找到了加载状态和版本号，就可以退出了
			if status.Status == "loaded" && status.Version != "Unknown" {
				break
			}
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
	// 使用正则匹配渠道行: - name: status, ... 或 - name id: status
	channelRe := regexp.MustCompile(`^-\s+([\w\d\-_]+)(?:\s+[\w\d\-]+)?:\s+([\w\d\s,]+)`)

	for _, line := range lines {
		trimmed := strings.TrimSpace(StripANSI(line))
		if strings.Contains(trimmed, "Chat channels:") {
			isChannelSection = true
			continue
		}
		if isChannelSection && trimmed == "" && len(channels) > 0 {
			// Section divider
			isChannelSection = false
			continue
		}

		if isChannelSection && strings.HasPrefix(trimmed, "- ") {
			matches := channelRe.FindStringSubmatch(trimmed)
			if len(matches) >= 3 {
				channel := ChatChannel{
					Name:       matches[1],
					Configured: strings.Contains(matches[2], "configured"),
				}
				channels = append(channels, channel)
			}
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
