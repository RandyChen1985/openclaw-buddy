package process

import (
	"bufio"
	"context"
	"encoding/json"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"openclaw-buddy/internal/utils"
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
	PrepareSilentCommand(cmd)
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

func GetWeChatPluginStatus(force bool) (*WeChatPluginStatus, error) {
	cacheMutex.Lock()
	// 1. 内存极速缓存 (30秒内不重复查 DB)
	if !force && statusCache != nil && time.Since(statusCacheTime) < 30*time.Second {
		defer cacheMutex.Unlock()
		return statusCache, nil
	}
	cacheMutex.Unlock()

	// 2. 尝试从数据库加载持久化缓存
	if !force {
		dbVal := utils.GetSetting("wechat_plugin_status", "")
		if dbVal != "" {
			var dbStatus WeChatPluginStatus
			if err := json.Unmarshal([]byte(dbVal), &dbStatus); err == nil {
				// 数据库缓存有效期：1 小时 (除非用户手动刷新)
				if time.Since(dbStatus.LastCheck) < 1*time.Hour {
					cacheMutex.Lock()
					statusCache = &dbStatus
					statusCacheTime = time.Now()
					cacheMutex.Unlock()
					return &dbStatus, nil
				}
			}
		}
	}

	// 3. 执行物理检测: openclaw plugins list
	log.Printf("🔍 Executing: openclaw plugins list (Detecting WeChat Plugin Status, Force: %v)", force)
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

	// 4. 更新数据库和内存缓存
	statusJson, _ := json.Marshal(status)
	_ = utils.SetSetting("wechat_plugin_status", string(statusJson))

	cacheMutex.Lock()
	statusCache = status
	statusCacheTime = time.Now()
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
			// 简化解析：直接取 "- " 之后的所有内容作为名称显示
			// 逻辑解释：如果包含 "configured" 且不包含 "not configured"，则识别为已配置
			isConfigured := strings.Contains(trimmed, "configured") && !strings.Contains(trimmed, "not configured")
			
			channel := ChatChannel{
				Name:       strings.TrimPrefix(trimmed, "- "),
				Configured: isConfigured,
			}
			channels = append(channels, channel)
		}
	}

	return channels, nil
}

func InstallWeChatPlugin() error {
	// 1. 安装插件
	log.Printf("📦 Installing WeChat plugin...")
	_, err := RunCommandWithTimeout(120*time.Second, GetOpenClawBinary(), "plugins", "install", "@tencent-weixin/openclaw-weixin")
	if err != nil {
		return err
	}

	// 2. 启用插件
	log.Printf("⚙️ Enabling WeChat plugin in config...")
	_, err = RunCommandWithTimeout(10*time.Second, GetOpenClawBinary(), "config", "set", "plugins.entries.openclaw-weixin.enabled", "true")
	return err
}
func UnbindWeChatAccount(configDir string, accountID string) error {
	log.Printf("🗑️ [WeChat] 用户请求解绑账号: %s", accountID)

	// 1. 删除 accounts 目录下的相关文件
	accountsDir := filepath.Join(configDir, "openclaw-weixin", "accounts")
	filesToDelete := []string{
		accountID + ".json",
		accountID + ".sync.json",
		accountID + ".context-tokens.json",
	}

	for _, fileName := range filesToDelete {
		filePath := filepath.Join(accountsDir, fileName)
		if _, err := os.Stat(filePath); err == nil {
			log.Printf("   - 物理删除凭证文件: %s", filePath)
			_ = os.Remove(filePath)
		}
	}

	// 2. 从 accounts.json 中移除 ID
	accountsJsonPath := filepath.Join(configDir, "openclaw-weixin", "accounts.json")
	if _, err := os.Stat(accountsJsonPath); err == nil {
		content, err := os.ReadFile(accountsJsonPath)
		if err == nil {
			var accounts []string
			if err := json.Unmarshal(content, &accounts); err == nil {
				newAccounts := []string{}
				changed := false
				for _, acc := range accounts {
					if acc != accountID {
						newAccounts = append(newAccounts, acc)
					} else {
						changed = true
					}
				}
				if changed {
					log.Printf("   - 从 accounts.json 索引中移除账号 ID: %s", accountID)
					newContent, _ := json.MarshalIndent(newAccounts, "", "  ")
					_ = os.WriteFile(accountsJsonPath, newContent, 0644)
				}
			}
		}
	}

	return nil
}
