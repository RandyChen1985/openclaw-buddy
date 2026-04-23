package process

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type ChannelField struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Placeholder string `json:"placeholder"`
	Type        string `json:"type"` // "text", "password", "textarea"
	Required    bool   `json:"required"`
	HelpURL     string `json:"helpUrl,omitempty"` // 引导用户获取该字段值的链接
}

type ChannelMetadata struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Icon        string         `json:"icon"`      // lucide-react icon name
	SetupType   string         `json:"setupType"` // "qr", "form"
	Fields      []ChannelField `json:"fields,omitempty"`
}

// SupportedChannels 列出 openclaw 官方支持的渠道。
// 注意：每个渠道的 ID 必须与 openclaw 源码中的 channel ID 完全一致。
// 已验证渠道（通过 openclaw channels add --help 和 extensions/*/package.json 确认）：
//   - feishu   (loaded, 凭证通过 config set 直接写入)
//   - telegram (stock/disabled until installed, 凭证通过 channels add --token)
//   - qqbot    (stock/disabled until installed, 凭证通过 channels add)
// 注意：dingtalk 不是 openclaw 的有效渠道，已移除。
var SupportedChannels = []ChannelMetadata{
	{
		ID:          "feishu",
		Name:        "飞书 (Feishu/Lark)",
		Description: "支持企业自建应用，配置 AppID 和 Secret 实现消息推送",
		Icon:        "Lark",
		SetupType:   "form",
		Fields: []ChannelField{
			{
				Key: "appId", Label: "App ID", Placeholder: "输入飞书应用的 App ID (cli_...)", Type: "text", Required: true,
				HelpURL: "https://open.feishu.cn/app",
			},
			{
				Key: "appSecret", Label: "App Secret", Placeholder: "输入飞书应用的 App Secret", Type: "password", Required: true,
				HelpURL: "https://open.feishu.cn/app",
			},
		},
	},
	{
		ID:          "telegram",
		Name:        "Telegram",
		Description: "通过 BotFather 获取的 API Token 进行连接",
		Icon:        "Send",
		SetupType:   "form",
		Fields: []ChannelField{
			{
				// openclaw channels add --channel telegram --token <botToken>
				// key 与 channels add 的 --token flag 对应
				Key: "token", Label: "Bot Token", Placeholder: "例如: 123456:ABC-DEF...", Type: "password", Required: true,
				HelpURL: "https://t.me/BotFather",
			},
		},
	},
	{
		ID:          "qqbot",
		Name:        "QQ 机器人",
		Description: "支持 QQ 官方机器人接口（需先安装 @openclaw/qqbot 插件）",
		Icon:        "MessageCircle",
		SetupType:   "form",
		Fields: []ChannelField{
			{
				// openclaw channels add --channel qqbot 中对应 AppID
				Key: "token", Label: "App ID", Placeholder: "", Type: "text", Required: true,
				HelpURL: "https://q.qq.com/qqbot/#/developer/developer-setting",
			},
			{
				// openclaw channels add --channel qqbot 中对应 App Secret
				Key: "password", Label: "Client Secret", Placeholder: "", Type: "password", Required: true,
				HelpURL: "https://q.qq.com/qqbot/#/developer/developer-setting",
			},
		},
	},
}

// ChannelStatus 仅描述 openclaw channels list 中的配置/启用情况；
// 插件是否安装、是否启用由前端调用与插件管理相同的 GET /v1/openclaw/plugins 判定。
type ChannelStatus struct {
	ID           string `json:"id"`
	Configured   bool   `json:"configured"`
	Enabled      bool   `json:"enabled"`
}

func GetChannelsStatus(configDir string) ([]ChannelStatus, error) {
	configPath := filepath.Join(configDir, "openclaw.json")
	env := []string{"OPENCLAW_CONFIG_PATH=" + configPath}
	
	// 调用 openclaw channels list 获取实时状态
	res, _ := RunCommandWithEnvAndTimeout(15*time.Second, env, "openclaw", "channels", "list")
	
	statusMap := make(map[string]bool)
	lines := strings.Split(res.Output, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(StripANSI(line))
		if strings.HasPrefix(trimmed, "- ") {
			namePart := strings.TrimPrefix(trimmed, "- ")
			// 只要包含 configured (且不包含 not configured) 或者显示 enabled，我们都认为已配置
			isConfigured := (strings.Contains(namePart, "configured") && !strings.Contains(namePart, "not configured")) || 
						   (strings.Contains(namePart, "enabled") && !strings.Contains(namePart, "disabled"))
			
			id := strings.Fields(namePart)[0]
			statusMap[id] = isConfigured
		}
	}

	var results []ChannelStatus

	for _, sc := range SupportedChannels {
		results = append(results, ChannelStatus{
			ID:         sc.ID,
			Configured: statusMap[sc.ID],
			Enabled:    statusMap[sc.ID],
		})
	}
	return results, nil
}

func GetGenericQRCode(channelID string) (*WeChatQRCode, error) {
	// 针对飞书等支持交互式登录的渠道
	log.Printf("📥 Executing: openclaw channels login --channel %s", channelID)
	
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "openclaw", "channels", "login", "--channel", channelID)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	var foundURL string
	done := make(chan bool)
	
	// 不同渠道的 URL 匹配正则
	var re *regexp.Regexp
	if channelID == "feishu" || channelID == "lark" {
		re = regexp.MustCompile(`https://(?:accounts|open)\.(?:feishu\.cn|larksuite\.com)/oauth/v1/app/registration\?[^\s\n]*`)
	} else if channelID == "openclaw-weixin" {
		re = regexp.MustCompile(`https://liteapp\.weixin\.qq\.com/q/[^\s\n]*`)
	}

	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			if re != nil {
				match := re.FindString(line)
				if match != "" {
					foundURL = match
					cancel()
					close(done)
					return
				}
			}
		}
		close(done)
	}()

	select {
	case <-done:
	case <-ctx.Done():
	}

	_ = cmd.Wait()

	if foundURL == "" {
		return nil, fmt.Errorf("no QR code URL found for channel %s", channelID)
	}

	return &WeChatQRCode{
		URL:       foundURL,
		ExpiresAt: time.Now().Add(5 * time.Minute),
	}, nil
}

// SaveChannelSecret 保存渠道凭证到 openclaw.json。
// 每个渠道使用不同的官方命令写入凭证，确保格式完全兼容：
//
//   - feishu：直接用 config set channels.feishu.{appId,appSecret}（因为 feishu credentials 是空的，无 channels add 支持）
//   - telegram：openclaw channels add --channel telegram --token <botToken>
//   - qqbot：openclaw channels add --channel qqbot --token <appId> --password <clientSecret>
func SaveChannelSecret(configDir, channelID string, secrets map[string]string) error {
	configPath := filepath.Join(configDir, "openclaw.json")
	env := []string{"OPENCLAW_CONFIG_PATH=" + configPath}
	log.Printf("⚙️ Saving credentials for channel %s (config: %s)", channelID, configPath)

	switch channelID {
	case "feishu":
		// Feishu 的 ChannelSetupWizard.credentials 是空数组，不支持 channels add 非交互模式。
		// 必须直接写 channels.feishu.{appId, appSecret}。
		for k, v := range secrets {
			path := fmt.Sprintf("channels.feishu.%s", k)
			_, err := RunCommandWithEnvAndTimeout(10*time.Second, env, "openclaw", "config", "set", path, v)
			if err != nil {
				log.Printf("❌ Failed to set %s: %v", path, err)
				return fmt.Errorf("failed to set %s: %w", path, err)
			}
			log.Printf("✅ Set %s", path)
		}
		// 启用 feishu 渠道
		_, _ = RunCommandWithEnvAndTimeout(5*time.Second, env, "openclaw", "config", "set", "channels.feishu.enabled", "true")

	case "telegram":
		// openclaw channels add --channel telegram --token <botToken>
		// Telegram 的 inputKey 是 "token"，对应 channels add 的 --token flag
		token, ok := secrets["token"]
		if !ok || token == "" {
			return fmt.Errorf("telegram requires 'token' field")
		}
		_, err := RunCommandWithEnvAndTimeout(15*time.Second, env, "openclaw", "channels", "add",
			"--channel", "telegram",
			"--token", token,
		)
		if err != nil {
			log.Printf("❌ Failed to configure telegram: %v", err)
			return fmt.Errorf("failed to configure telegram: %w", err)
		}
		log.Printf("✅ Telegram configured via channels add")

	case "qqbot":
		// openclaw channels add --channel qqbot --token <appId>:<clientSecret>
		// qqbot 的 --token 需要以 appId:clientSecret 的格式传入
		appId, _ := secrets["token"]
		clientSecret, _ := secrets["password"]
		if appId == "" || clientSecret == "" {
			return fmt.Errorf("qqbot requires 'token' (AppID) and 'password' (ClientSecret) fields")
		}
		token := fmt.Sprintf("%s:%s", appId, clientSecret)
		_, err := RunCommandWithEnvAndTimeout(15*time.Second, env, "openclaw", "channels", "add",
			"--channel", "qqbot",
			"--token", token,
		)
		if err != nil {
			log.Printf("❌ Failed to configure qqbot: %v", err)
			return fmt.Errorf("failed to configure qqbot: %w", err)
		}
		log.Printf("✅ QQBot configured via channels add")

	default:
		// 通用回退：直接写 channels.<id>.<key>
		log.Printf("⚠️ Using generic config set for unknown channel: %s", channelID)
		for k, v := range secrets {
			path := fmt.Sprintf("channels.%s.%s", channelID, k)
			_, _ = RunCommandWithEnvAndTimeout(10*time.Second, env, "openclaw", "config", "set", path, v)
		}
	}

	return nil
}

// BindFeishuToAgent 将飞书渠道绑定到指定 Agent。
// 正确命令：openclaw agents bind --agent <agentID> --bind feishu
// 这会在 openclaw.json 的 bindings 数组中写入：
//   { "type":"route", "agentId":"<agentID>", "match":{"channel":"feishu"} }
func BindFeishuToAgent(configDir, agentID string) error {
	configPath := filepath.Join(configDir, "openclaw.json")
	env := []string{"OPENCLAW_CONFIG_PATH=" + configPath}
	log.Printf("🔗 Binding Feishu to agent %s (config: %s)", agentID, configPath)
	_, err := RunCommandWithEnvAndTimeout(15*time.Second, env, "openclaw", "agents", "bind",
		"--agent", agentID,
		"--bind", "feishu",
	)
	return err
}

// UnbindFeishuFromAgent 解除飞书渠道与指定 Agent 的绑定。
// 正确命令：openclaw agents unbind --agent <agentID> --bind feishu
func UnbindFeishuFromAgent(configDir, agentID string) error {
	configPath := filepath.Join(configDir, "openclaw.json")
	env := []string{"OPENCLAW_CONFIG_PATH=" + configPath}
	log.Printf("🔗 Unbinding Feishu from agent %s", agentID)
	_, err := RunCommandWithEnvAndTimeout(15*time.Second, env, "openclaw", "agents", "unbind",
		"--agent", agentID,
		"--bind", "feishu",
	)
	return err
}

// BindTelegramToAgent 将 Telegram 渠道绑定到指定 Agent。
// 正确命令：openclaw agents bind --agent <agentID> --bind telegram
func BindTelegramToAgent(configDir, agentID string) error {
	configPath := filepath.Join(configDir, "openclaw.json")
	env := []string{"OPENCLAW_CONFIG_PATH=" + configPath}
	log.Printf("🔗 Binding Telegram to agent %s (config: %s)", agentID, configPath)
	_, err := RunCommandWithEnvAndTimeout(15*time.Second, env, "openclaw", "agents", "bind",
		"--agent", agentID,
		"--bind", "telegram",
	)
	return err
}

// UnbindTelegramFromAgent 解除 Telegram 渠道与指定 Agent 的绑定。
func UnbindTelegramFromAgent(configDir, agentID string) error {
	configPath := filepath.Join(configDir, "openclaw.json")
	env := []string{"OPENCLAW_CONFIG_PATH=" + configPath}
	log.Printf("🔗 Unbinding Telegram from agent %s", agentID)
	_, err := RunCommandWithEnvAndTimeout(15*time.Second, env, "openclaw", "agents", "unbind",
		"--agent", agentID,
		"--bind", "telegram",
	)
	return err
}

// BindQQBotToAgent 将 QQBot 渠道绑定到指定 Agent。
// 正确命令：openclaw agents bind --agent <agentID> --bind qqbot
func BindQQBotToAgent(configDir, agentID string) error {
	configPath := filepath.Join(configDir, "openclaw.json")
	env := []string{"OPENCLAW_CONFIG_PATH=" + configPath}
	log.Printf("🔗 Binding QQBot to agent %s (config: %s)", agentID, configPath)
	_, err := RunCommandWithEnvAndTimeout(15*time.Second, env, "openclaw", "agents", "bind",
		"--agent", agentID,
		"--bind", "qqbot",
	)
	return err
}

// UnbindQQBotFromAgent 解除 QQBot 渠道与指定 Agent 的绑定。
func UnbindQQBotFromAgent(configDir, agentID string) error {
	configPath := filepath.Join(configDir, "openclaw.json")
	env := []string{"OPENCLAW_CONFIG_PATH=" + configPath}
	log.Printf("🔗 Unbinding QQBot from agent %s", agentID)
	_, err := RunCommandWithEnvAndTimeout(15*time.Second, env, "openclaw", "agents", "unbind",
		"--agent", agentID,
		"--bind", "qqbot",
	)
	return err
}

// BindDingTalkToAgent 将钉钉渠道绑定到指定 Agent。
// 正确命令：openclaw agents bind --agent <agentID> --bind dingtalk
func BindDingTalkToAgent(configDir, agentID string) error {
	configPath := filepath.Join(configDir, "openclaw.json")
	env := []string{"OPENCLAW_CONFIG_PATH=" + configPath}
	log.Printf("🔗 Binding DingTalk to agent %s (config: %s)", agentID, configPath)
	_, err := RunCommandWithEnvAndTimeout(15*time.Second, env, "openclaw", "agents", "bind",
		"--agent", agentID,
		"--bind", "dingtalk",
	)
	return err
}

// 注意：DingTalk 不是 openclaw 的有效渠道（不在 openclaw extensions 中），
// 因此没有 BindDingTalkToAgent 和 UnbindDingTalkFromAgent 函数。
// 如果将来 openclaw 官方支持 DingTalk，再添加。
