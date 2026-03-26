package process

import (
	"regexp"
	"sync"
	"time"
)

type WeChatQRCode struct {
	URL       string    `json:"qrcode_url"`
	Cached    bool      `json:"cached"`
	ExpiresAt time.Time `json:"expires_at"`
}

var (
	qrCodeCache *WeChatQRCode
	cacheMutex  sync.Mutex
)

func GetWeChatQRCode(force bool) (*WeChatQRCode, error) {
	cacheMutex.Lock()
	defer cacheMutex.Unlock()

	now := time.Now()
	if !force && qrCodeCache != nil && now.Before(qrCodeCache.ExpiresAt) {
		result := *qrCodeCache
		result.Cached = true
		return &result, nil
	}

	// npx -y @tencent-weixin/openclaw-weixin-cli@latest install
	// This command is slow and may take 30-60s
	res, err := RunCommandWithTimeout(60*time.Second, "npx", "-y", "@tencent-weixin/openclaw-weixin-cli@latest", "install")
	if err != nil {
		return nil, err
	}

	// Extract URL
	re := regexp.MustCompile(`https://liteapp\.weixin\.qq\.com/q/[^\s&]*`)
	match := re.FindString(res.Output)
	if match == "" {
		return nil, nil // Not found
	}

	qrcodeURL := match + "&bot_type=3"
	qrCodeCache = &WeChatQRCode{
		URL:       qrcodeURL,
		Cached:    false,
		ExpiresAt: now.Add(5 * time.Minute),
	}

	return qrCodeCache, nil
}
