package process

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
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
//
// 注意：dingtalk 不是 openclaw 的有效渠道，已移除。
var SupportedChannels = []ChannelMetadata{
	{
		ID:          "feishu",
		Name:        "飞书 (Feishu/ Lark)",
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

// ChannelStatus 描述渠道：CLI channels list + openclaw.json 凭证快照合并。
// 插件是否安装、是否启用由前端调用 GET /v1/openclaw/plugins 判定。
type ChannelStatus struct {
	ID                   string `json:"id"`
	Configured           bool   `json:"configured"`
	Enabled              bool   `json:"enabled"`
	Installed            bool   `json:"installed"`
	CredentialConfigured bool   `json:"credentialConfigured"`
	CredentialHint       string `json:"credentialHint,omitempty"`
}

type ChannelAccount struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	IsConfigured bool   `json:"isConfigured"`
}

func getChannelsConfig(configDir string) (map[string]interface{}, error) {
	configPath := filepath.Join(configDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}
	var root map[string]interface{}
	if err := json.Unmarshal(data, &root); err != nil {
		return nil, err
	}
	ch, _ := root["channels"].(map[string]interface{})
	return ch, nil
}

// channelCredentialSnapshot 从 openclaw.json 的 channels.<id> 解析（不返回密钥明文）。
type channelCredentialSnapshot struct {
	HasCredentials bool
	ChannelEnabled bool
	Hint           string
}

func jsonStringish(v interface{}) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case bool:
		return ""
	case float64:
		return strings.TrimSpace(fmt.Sprint(t))
	case json.Number:
		return strings.TrimSpace(t.String())
	default:
		return strings.TrimSpace(fmt.Sprint(t))
	}
}

func jsonBoolish(v interface{}) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return false
}

func maskMiddle(s string, keepPrefix, keepSuffix int) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if len(s) <= keepPrefix+keepSuffix+3 {
		return "***"
	}
	return s[:keepPrefix] + "…" + s[len(s)-keepSuffix:]
}

// coalesceSecretValue 兼容 OpenClaw 将密钥写成字符串或 { "value": "..." } 等形式。
func coalesceSecretValue(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s)
	}
	if m, ok := v.(map[string]interface{}); ok {
		if v2, ok := m["value"].(string); ok {
			return strings.TrimSpace(v2)
		}
	}
	return strings.TrimSpace(jsonStringish(v))
}

// telegramCredentialFromMap 对齐 openclaw resolveTelegramToken：botToken、accounts.*.botToken、tokenFile、旧版 token。
func telegramCredentialFromMap(tg map[string]interface{}) (has bool, hint string) {
	tok := coalesceSecretValue(tg["botToken"])
	if tok == "" {
		tok = coalesceSecretValue(tg["token"])
	}
	if tok == "" && jsonStringish(tg["tokenFile"]) != "" {
		return true, "Token file"
	}
	if accs, ok := tg["accounts"].(map[string]interface{}); ok {
		for _, v := range accs {
			bm, ok := v.(map[string]interface{})
			if !ok {
				continue
			}
			if t := coalesceSecretValue(bm["botToken"]); t != "" {
				tok = t
				break
			}
			if t := coalesceSecretValue(bm["token"]); t != "" {
				tok = t
				break
			}
			if jsonStringish(bm["tokenFile"]) != "" {
				return true, "Token file (account)"
			}
		}
	}
	if accs, ok := tg["accounts"].([]interface{}); ok {
		for _, a := range accs {
			bm, ok := a.(map[string]interface{})
			if !ok {
				continue
			}
			if t := coalesceSecretValue(bm["botToken"]); t != "" {
				tok = t
				break
			}
			if t := coalesceSecretValue(bm["token"]); t != "" {
				tok = t
				break
			}
			if jsonStringish(bm["tokenFile"]) != "" {
				return true, "Token file (account)"
			}
		}
	}
	if tok == "" {
		return false, ""
	}
	return true, "Bot " + maskMiddle(tok, 4, 4)
}

func qqbotSecretString(m map[string]interface{}) string {
	s := coalesceSecretValue(m["clientSecret"])
	if s != "" {
		return s
	}
	s = coalesceSecretValue(m["appSecret"])
	if s != "" {
		return s
	}
	return coalesceSecretValue(m["password"])
}

// qqbotCredentialFromMap 对齐 qqbot 插件：顶层或 accounts.* 下 appId + clientSecret（或 secret 文件占位）。
func qqbotCredentialFromMap(qq map[string]interface{}) (has bool, hint string) {
	appID := jsonStringish(qq["appId"])
	if appID == "" {
		appID = jsonStringish(qq["token"])
	}
	sec := qqbotSecretString(qq)
	if appID != "" && sec != "" {
		return true, "App " + maskMiddle(appID, 4, 4)
	}
	if jsonStringish(qq["clientSecretFile"]) != "" && appID != "" {
		return true, "App " + maskMiddle(appID, 4, 4) + " (secret file)"
	}
	if accs, ok := qq["accounts"].(map[string]interface{}); ok {
		for _, v := range accs {
			bm, ok := v.(map[string]interface{})
			if !ok {
				continue
			}
			aid := jsonStringish(bm["appId"])
			s := qqbotSecretString(bm)
			if aid != "" && s != "" {
				return true, "App " + maskMiddle(aid, 4, 4)
			}
			if jsonStringish(bm["clientSecretFile"]) != "" && aid != "" {
				return true, "App " + maskMiddle(aid, 4, 4) + " (secret file)"
			}
		}
	}
	if accs, ok := qq["accounts"].([]interface{}); ok {
		for _, a := range accs {
			bm, ok := a.(map[string]interface{})
			if !ok {
				continue
			}
			aid := jsonStringish(bm["appId"])
			s := qqbotSecretString(bm)
			if aid != "" && s != "" {
				return true, "App " + maskMiddle(aid, 4, 4)
			}
			if jsonStringish(bm["clientSecretFile"]) != "" && aid != "" {
				return true, "App " + maskMiddle(aid, 4, 4) + " (secret file)"
			}
		}
	}
	return false, ""
}

func GetChannelAccounts(configDir, channelID string) ([]ChannelAccount, error) {
	switch channelID {
	case "feishu":
		return listLarkAccounts(configDir, channelID)
	case "qqbot":
		return listQQBotAccounts(configDir)
	case "telegram":
		return listGenericAccounts(configDir, "telegram")
	default:
		return listGenericAccounts(configDir, channelID)
	}
}

// readChannelCredentialSnapshots 读取 openclaw.json 中各渠道是否已写入凭证（比 CLI 文本解析可靠）。
func readChannelCredentialSnapshots(configDir string) map[string]channelCredentialSnapshot {
	out := make(map[string]channelCredentialSnapshot)
	configPath := filepath.Join(configDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return out
	}
	var root map[string]interface{}
	if err := json.Unmarshal(data, &root); err != nil {
		return out
	}
	chRoot, _ := root["channels"].(map[string]interface{})
	pluginsRoot, _ := root["plugins"].(map[string]interface{})
	pluginsEntries, _ := pluginsRoot["entries"].(map[string]interface{})

	// 遍历 SupportedChannels 自动填充快照
	for _, sc := range SupportedChannels {
		if sc.ID == "feishu" {
			// 针对飞书系列，按优先级 (openclaw-lark > lark > feishu) 聚合状态
			for _, id := range []string{"openclaw-lark", "lark", "feishu"} {
				// 1. 检查 channels 节点（配置与启用状态）
				if fs, ok := chRoot[id].(map[string]interface{}); ok {
					appID := jsonStringish(fs["appId"])
					secret := jsonStringish(fs["appSecret"])
					if appID != "" && secret != "" {
						snap := out[sc.ID]
						snap.HasCredentials = true
						if snap.Hint == "" {
							snap.Hint = "AppID " + maskMiddle(appID, 6, 4)
						}
						// 只要 channels 里开启了，就视为启用
						if jsonBoolish(fs["enabled"]) {
							snap.ChannelEnabled = true
						}
						out[sc.ID] = snap
					}
				}
				// 2. 检查 plugins.entries 节点（很多时候插件级开启即代表渠道开启）
				if pe, ok := pluginsEntries[id].(map[string]interface{}); ok {
					if jsonBoolish(pe["enabled"]) {
						snap := out[sc.ID]
						snap.ChannelEnabled = true
						out[sc.ID] = snap
					}
				}
			}
		} else {
			// 通用逻辑：优先检查 channels 节点
			if fs, ok := chRoot[sc.ID].(map[string]interface{}); ok {
				out[sc.ID] = channelCredentialSnapshot{
					HasCredentials: true,
					ChannelEnabled: jsonBoolish(fs["enabled"]),
					Hint:           "",
				}
			}
			// 补充检查 plugins.entries 节点
			if pe, ok := pluginsEntries[sc.ID].(map[string]interface{}); ok {
				if jsonBoolish(pe["enabled"]) {
					snap := out[sc.ID]
					snap.ChannelEnabled = true
					out[sc.ID] = snap
				}
			}
		}
	}

	// telegram：OpenClaw 使用 channels.telegram.botToken，多账号为 accounts.<id>.botToken（accounts 为对象，非数组）；亦支持 tokenFile。
	if tg, ok := chRoot["telegram"].(map[string]interface{}); ok {
		has, hint := telegramCredentialFromMap(tg)
		out["telegram"] = channelCredentialSnapshot{
			HasCredentials: has,
			ChannelEnabled: jsonBoolish(tg["enabled"]),
			Hint:           hint,
		}
	}

	// qqbot：schema 为 appId + clientSecret；多账号在 accounts.<id> 下（与 openclaw extensions/qqbot 一致）。
	if qq, ok := chRoot["qqbot"].(map[string]interface{}); ok {
		has, hint := qqbotCredentialFromMap(qq)
		out["qqbot"] = channelCredentialSnapshot{
			HasCredentials: has,
			ChannelEnabled: jsonBoolish(qq["enabled"]),
			Hint:           hint,
		}
	}

	return out
}

func listLarkAccounts(configDir string, channelID string) ([]ChannelAccount, error) {
	channels, err := getChannelsConfig(configDir)
	if err != nil {
		return nil, err
	}

	var accounts []ChannelAccount
	fs, ok := channels[channelID].(map[string]interface{})
	if !ok {
		return accounts, nil
	}

	// 1. 检查根级全局配置
	appID := jsonStringish(fs["appId"])
	if appID != "" {
		accounts = append(accounts, ChannelAccount{
			ID:           "default",
			Name:         "默认账号 (" + appID + ")",
			IsConfigured: true,
		})
	}

	// 2. 检查 accounts 映射表
	if accs, ok := fs["accounts"].(map[string]interface{}); ok {
		for accID, val := range accs {
			name := accID
			if m, ok := val.(map[string]interface{}); ok {
				if n := jsonStringish(m["name"]); n != "" {
					name = n
				} else if aid := jsonStringish(m["appId"]); aid != "" {
					name = accID + " (" + aid + ")"
				}
			}
			accounts = append(accounts, ChannelAccount{
				ID:           accID,
				Name:         name,
				IsConfigured: true,
			})
		}
	}

	return accounts, nil
}

func listQQBotAccounts(configDir string) ([]ChannelAccount, error) {
	channels, err := getChannelsConfig(configDir)
	if err != nil {
		return nil, err
	}

	var accounts []ChannelAccount
	qq, ok := channels["qqbot"].(map[string]interface{})
	if !ok {
		return accounts, nil
	}

	// 1. 检查根级
	appID := jsonStringish(qq["appId"])
	if appID != "" {
		accounts = append(accounts, ChannelAccount{
			ID:           "default",
			Name:         "默认账号 (" + appID + ")",
			IsConfigured: true,
		})
	}

	// 2. 检查 accounts 映射表
	if accs, ok := qq["accounts"].(map[string]interface{}); ok {
		for id, val := range accs {
			name := id
			if m, ok := val.(map[string]interface{}); ok {
				if n := jsonStringish(m["name"]); n != "" {
					name = n
				} else if aid := jsonStringish(m["appId"]); aid != "" {
					name = id + " (" + aid + ")"
				}
			}
			accounts = append(accounts, ChannelAccount{
				ID:           id,
				Name:         name,
				IsConfigured: true,
			})
		}
	}

	return accounts, nil
}

func listGenericAccounts(configDir, channelID string) ([]ChannelAccount, error) {
	channels, err := getChannelsConfig(configDir)
	if err != nil {
		return nil, err
	}
	ch, ok := channels[channelID].(map[string]interface{})
	if !ok {
		return nil, nil
	}

	var accounts []ChannelAccount
	hasDefault := false
	if jsonStringish(ch["token"]) != "" || jsonStringish(ch["botToken"]) != "" || jsonStringish(ch["appId"]) != "" {
		hasDefault = true
	}
	if hasDefault {
		accounts = append(accounts, ChannelAccount{
			ID:           "default",
			Name:         "默认账号",
			IsConfigured: true,
		})
	}

	if accs, ok := ch["accounts"].(map[string]interface{}); ok {
		for id, val := range accs {
			name := id
			if m, ok := val.(map[string]interface{}); ok {
				if n := jsonStringish(m["name"]); n != "" {
					name = n
				}
			}
			accounts = append(accounts, ChannelAccount{
				ID:           id,
				Name:         name,
				IsConfigured: true,
			})
		}
	}
	return accounts, nil
}

type agentListJSONRow struct {
	ID            string   `json:"id"`
	IdentityName  string   `json:"identityName"`
	IdentityEmoji string   `json:"identityEmoji"`
	Routes        []string `json:"routes"`
	Bindings      int      `json:"bindings"`
}

func listAgentsJSONWithConfig(configDir string) ([]agentListJSONRow, error) {
	env, err := OpenClawConfigEnv(configDir)
	if err != nil {
		return nil, err
	}
	res, err := RunCommandWithEnvAndTimeout(25*time.Second, env, "openclaw", "agents", "list", "--json")
	if err != nil {
		return nil, fmt.Errorf("agents list: %w", err)
	}
	clean := StripANSI(res.Output)
	js := ExtractJSON(clean)
	var rows []agentListJSONRow
	if err := json.Unmarshal([]byte(js), &rows); err != nil {
		return nil, fmt.Errorf("parse agents json: %w", err)
	}
	return rows, nil
}

func routesMentionChannel(routes []string, channelID string) bool {
	if len(routes) == 0 {
		return false
	}
	needle := strings.ToLower(channelID)
	for _, r := range routes {
		if strings.Contains(strings.ToLower(r), needle) {
			return true
		}
	}
	return false
}

// normalizeChannelIDForBinding 与 OpenClaw normalizeAnyChannelId 的常见别名对齐（buddy 侧静态表）。
func normalizeChannelIDForBinding(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	if s == "" {
		return ""
	}
	switch s {
	case "lark":
		return "feishu"
	case "qq":
		return "qqbot"
	}
	return s
}

func bindingChannelMatchesRequest(bindingChannelRaw, requestChannel string) bool {
	b := normalizeChannelIDForBinding(bindingChannelRaw)
	r := normalizeChannelIDForBinding(requestChannel)
	return b != "" && r != "" && b == r
}

func describeBindingMatchMap(m map[string]interface{}) string {
	ch := strings.TrimSpace(jsonStringish(m["channel"]))
	parts := []string{ch}
	if a := strings.TrimSpace(jsonStringish(m["accountId"])); a != "" {
		parts = append(parts, "accountId="+a)
	}
	if peer, ok := m["peer"].(map[string]interface{}); ok {
		pk := strings.TrimSpace(jsonStringish(peer["kind"]))
		pid := strings.TrimSpace(jsonStringish(peer["id"]))
		if pk != "" && pid != "" {
			parts = append(parts, fmt.Sprintf("peer=%s:%s", pk, pid))
		}
	}
	if g := strings.TrimSpace(jsonStringish(m["guildId"])); g != "" {
		parts = append(parts, "guild="+g)
	}
	if tm := strings.TrimSpace(jsonStringish(m["teamId"])); tm != "" {
		parts = append(parts, "team="+tm)
	}
	return strings.Join(parts, " ")
}

func bindingDedupeKey(agentID string, match map[string]interface{}) string {
	return strings.TrimSpace(agentID) + "\x1e" + describeBindingMatchMap(match)
}

// channelRouteBindingRow 单条路由规则（与 OpenClaw 根级 bindings[] 或 agents.list[].bindings 中一项对应）。
type channelRouteBindingRow struct {
	AgentID      string
	AccountID    string
	RouteSummary string
	Source       string // "root" | "agentsList"
}

func parseAccountIDFromMatch(m map[string]interface{}) string {
	return strings.TrimSpace(jsonStringish(m["accountId"]))
}

func appendBindingRowsFromSlice(
	raws []interface{},
	requestChannel string,
	source string,
	parentAgentID string,
	out *[]channelRouteBindingRow,
	rootKeys map[string]struct{},
) {
	for _, raw := range raws {
		b, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		match, ok := b["match"].(map[string]interface{})
		if !ok {
			continue
		}
		chRaw := jsonStringish(match["channel"])
		if !bindingChannelMatchesRequest(chRaw, requestChannel) {
			continue
		}
		agentID := strings.TrimSpace(jsonStringish(b["agentId"]))
		if agentID == "" {
			agentID = strings.TrimSpace(parentAgentID)
		}
		if agentID == "" {
			continue
		}
		summary := describeBindingMatchMap(match)
		bindType := strings.TrimSpace(jsonStringish(b["type"]))
		if bindType == "acp" {
			summary = "ACP " + summary
		}
		row := channelRouteBindingRow{
			AgentID:      agentID,
			AccountID:    parseAccountIDFromMatch(match),
			RouteSummary: summary,
			Source:       source,
		}
		key := bindingDedupeKey(agentID, match)
		if source == "agentsList" {
			if rootKeys != nil {
				if _, dup := rootKeys[key]; dup {
					continue
				}
			}
		}
		*out = append(*out, row)
		if source == "root" && rootKeys != nil {
			rootKeys[key] = struct{}{}
		}
	}
}

// listRouteBindingRowsForChannel 从 openclaw.json 读取路由：OpenClaw 实际只消费根级 bindings[]；
// agents.list[].bindings 若存在则一并列出并提示可能不生效（与官方 listRouteBindings 不对齐）。
// getActiveFeishuChannelID 探测当前真正启用的飞书渠道 ID。
// 顺序：openclaw-lark > lark > feishu
func getActiveFeishuChannelID(configDir string) string {
	configPath := filepath.Join(configDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return "feishu"
	}
	var root map[string]interface{}
	if err := json.Unmarshal(data, &root); err != nil {
		return "feishu"
	}
	chRoot, _ := root["channels"].(map[string]interface{})

	// 按优先级探测
	for _, id := range []string{"openclaw-lark", "lark", "feishu"} {
		if fs, ok := chRoot[id].(map[string]interface{}); ok {
			if jsonBoolish(fs["enabled"]) {
				return id
			}
		}
	}
	return "feishu"
}

func listRouteBindingRowsForChannel(configDir, channelID string) ([]channelRouteBindingRow, []string) {
	var out []channelRouteBindingRow
	var notices []string
	configPath := filepath.Join(configDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return out, notices
	}
	var root map[string]interface{}
	if err := json.Unmarshal(data, &root); err != nil {
		return out, notices
	}
	rootKeys := make(map[string]struct{})
	if binds, ok := root["bindings"].([]interface{}); ok {
		appendBindingRowsFromSlice(binds, channelID, "root", "", &out, rootKeys)
	}
	var nestedCount int
	if agents, ok := root["agents"].(map[string]interface{}); ok {
		if list, ok := agents["list"].([]interface{}); ok {
			for _, a := range list {
				amap, ok := a.(map[string]interface{})
				if !ok {
					continue
				}
				agentEntryID := strings.TrimSpace(jsonStringish(amap["id"]))
				if binds, ok := amap["bindings"].([]interface{}); ok && len(binds) > 0 {
					before := len(out)
					appendBindingRowsFromSlice(binds, channelID, "agentsList", agentEntryID, &out, rootKeys)
					nestedCount += len(out) - before
				}
			}
		}
	}
	if nestedCount > 0 {
		notices = append(notices,
			"检测到 agents.list[].bindings 中的路由规则。OpenClaw 网关只读取根级 bindings[]；若实际不生效请将规则迁移到配置文件顶层（与 openclaw agents list 一致）。",
		)
	}
	return out, notices
}

// ChannelBindingAccount 某 Agent 与该渠道在 openclaw.json 中的路由绑定摘要。
type ChannelBindingAccount struct {
	AgentID      string `json:"agentId"`
	AgentName    string `json:"agentName"`
	Emoji        string `json:"emoji"`
	Routes       string `json:"routes"` // 与 RouteSummary 相同，保留兼容前端
	RouteSummary string `json:"routeSummary,omitempty"`
	AccountID    string `json:"accountId,omitempty"`
	Source       string `json:"source,omitempty"` // root | agentsList
	Bindings     int    `json:"bindings"`
}

// ChannelAgentPick 供前端下拉绑定目标 Agent。
type ChannelAgentPick struct {
	ID    string `json:"id"`
	Name  string `json:"name,omitempty"`
	Emoji string `json:"emoji,omitempty"`
}

// ChannelAccountsOverview GET /v1/channels/:id/accounts 返回体。
type ChannelAccountsOverview struct {
	ChannelID            string                  `json:"channelId"`
	CredentialConfigured bool                    `json:"credentialConfigured"`
	CredentialHint       string                  `json:"credentialHint,omitempty"`
	ChannelEnabled       bool                    `json:"channelEnabled"`
	Credentials          []ChannelAccount        `json:"credentials"` // 已配置的凭证列表
	Bindings             []ChannelBindingAccount `json:"bindings"`
	Notices              []string                `json:"notices,omitempty"`
	CandidateAgents      []ChannelAgentPick      `json:"candidateAgents,omitempty"`
}

// GetChannelAccountsOverview 列出绑定到该渠道的 Agent + 凭证是否已写入（脱敏）。
// 路由列表以 openclaw.json 根级 bindings[] 为准（与 OpenClaw listRouteBindings 一致），不再依赖 agents list 的 routes 展示名。
func GetChannelAccountsOverview(configDir, channelID string) (*ChannelAccountsOverview, error) {
	snapAll := readChannelCredentialSnapshots(configDir)
	snap := snapAll[channelID]

	ov := &ChannelAccountsOverview{
		ChannelID:            channelID,
		CredentialConfigured: snap.HasCredentials,
		CredentialHint:       snap.Hint,
		ChannelEnabled:       snap.ChannelEnabled,
		Credentials:          nil,
		Bindings:             nil,
	}

	// 获取所有已配置的凭证
	creds, _ := GetChannelAccounts(configDir, channelID)
	ov.Credentials = creds
	rows, notices := listRouteBindingRowsForChannel(configDir, channelID)
	ov.Notices = notices

	// 1. 优先从缓存获取机器人列表 (与“虾兵蟹将”页面同步)
	var agents []agentListJSONRow
	if cached, _, err := GetCachedData("bots_models"); err == nil && cached != nil {
		// 尝试解析缓存数据
		if m, ok := cached.(map[string]interface{}); ok {
			if bots, ok := m["bots"].([]interface{}); ok {
				for _, b := range bots {
					if bm, ok := b.(map[string]interface{}); ok {
						agents = append(agents, agentListJSONRow{
							ID:            jsonStringish(bm["id"]),
							IdentityName:  jsonStringish(bm["name"]),
							IdentityEmoji: jsonStringish(bm["emoji"]),
						})
					}
				}
			}
		}
	}

	// 2. 如果缓存没拿到，则实时获取一次
	if len(agents) == 0 {
		var err error
		agents, err = listAgentsJSONWithConfig(configDir)
		if err != nil {
			// 如果实时也失败了，不报错，仅返回空列表（可能 openclaw 未启动）
			agents = []agentListJSONRow{}
		}
	}

	agentMeta := make(map[string]agentListJSONRow)
	for _, a := range agents {
		agentMeta[a.ID] = a
	}
	for _, a := range agents {
		name := a.IdentityName
		if name == "" {
			name = a.ID
		}
		em := a.IdentityEmoji
		if em == "" {
			em = "🤖"
		}
		ov.CandidateAgents = append(ov.CandidateAgents, ChannelAgentPick{
			ID:    a.ID,
			Name:  name,
			Emoji: em,
		})
	}
	for _, row := range rows {
		am := agentMeta[row.AgentID]
		name := am.IdentityName
		if name == "" {
			name = row.AgentID
		}
		em := am.IdentityEmoji
		if em == "" {
			em = "🤖"
		}
		ov.Bindings = append(ov.Bindings, ChannelBindingAccount{
			AgentID:      row.AgentID,
			AgentName:    name,
			Emoji:        em,
			Routes:       row.RouteSummary,
			RouteSummary: row.RouteSummary,
			AccountID:    row.AccountID,
			Source:       row.Source,
			Bindings:     am.Bindings,
		})
	}
	return ov, nil
}

func GetChannelsStatus(configDir string) ([]ChannelStatus, error) {
	var res *CommandResult
	if env, e := OpenClawConfigEnv(configDir); e != nil {
		log.Printf("⚠️ GetChannelsStatus: invalid config dir: %v", e)
		res = &CommandResult{Output: ""}
	} else {
		var err error
		res, err = RunCommandWithEnvAndTimeout(15*time.Second, env, "openclaw", "channels", "list")
		if err != nil {
			log.Printf("⚠️ openclaw channels list failed: %v", err)
		}
	}

	// 调用 openclaw channels list 获取实时状态（与旧逻辑兼容）

	statusMap := make(map[string]bool)
	lines := strings.Split(res.Output, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(StripANSI(line))
		if strings.HasPrefix(trimmed, "- ") {
			namePart := strings.TrimPrefix(trimmed, "- ")
			isConfigured := (strings.Contains(namePart, "configured") && !strings.Contains(namePart, "not configured")) ||
				(strings.Contains(namePart, "enabled") && !strings.Contains(namePart, "disabled"))

			id := strings.Fields(namePart)[0]
			statusMap[id] = isConfigured
		}
	}

	credSnaps := readChannelCredentialSnapshots(configDir)

	var results []ChannelStatus

	// 获取当前插件列表以判定安装状态
	var plugins []OpenClawPlugin
	if pData, err := GetOpenClawPlugins(configDir); err == nil {
		if plist, ok := pData.([]OpenClawPlugin); ok {
			plugins = plist
		}
	}

	for _, sc := range SupportedChannels {
		snap := credSnaps[sc.ID]
		cli := statusMap[sc.ID]

		// 判定是否已安装相关插件
		isInstalled := false
		aliases := []string{sc.ID}
		if sc.ID == "feishu" {
			aliases = append(aliases, "lark", "openclaw-lark", "@openclaw/feishu", "@larksuite/openclaw-lark")
		} else {
			aliases = append(aliases, "@openclaw/"+sc.ID)
		}

		for _, p := range plugins {
			match := false
			for _, alias := range aliases {
				if p.ID == alias {
					match = true
					break
				}
			}
			if !match {
				// 额外检查插件是否声明了对应的 ChannelID
				for _, cid := range p.ChannelIds {
					if cid == sc.ID {
						match = true
						break
					}
				}
			}
			if match {
				isInstalled = true
				break
			}
		}

		// 针对飞书/Lark 进行特殊处理：聚合别名状态
		if sc.ID == "feishu" {
			for _, alias := range []string{"lark", "openclaw-lark"} {
				if statusMap[alias] {
					cli = true
					break
				}
			}
		}

		configured := cli || snap.HasCredentials
		enabled := snap.ChannelEnabled || cli
		results = append(results, ChannelStatus{
			ID:                   sc.ID,
			Configured:           configured,
			Enabled:              enabled,
			Installed:            isInstalled,
			CredentialConfigured: snap.HasCredentials,
			CredentialHint:       snap.Hint,
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
func SaveChannelSecret(configDir, channelID string, creds map[string]string) error {
	env, err := OpenClawConfigEnv(configDir)
	if err != nil {
		return err
	}
	configPath := filepath.Join(configDir, "openclaw.json")
	log.Printf("⚙️ Saving credentials for channel %s (config: %s)", channelID, configPath)

	switch channelID {
	case "feishu":
		// 如果 creds 中包含 accountId，则写入 accounts 映射表，否则写入根部。
		if aid := creds["accountId"]; aid != "" && aid != "default" {
			return saveLarkAccountManual(configDir, channelID, aid, creds["appId"], creds["appSecret"])
		}
		return saveLarkSecretManual(configDir, channelID, creds["appId"], creds["appSecret"])
	case "telegram":
		// Telegram 支持 channels add --token
		token := creds["token"]
		if token == "" {
			return fmt.Errorf("telegram requires 'token' field")
		}
		_, err := RunCommandWithEnvAndTimeout(15*time.Second, env, "openclaw", "channels", "add",
			"--channel", "telegram",
			"--token", token,
		)
		return err
	case "qqbot":
		// QQBot: 如果 creds 中包含 accountId，则写入 accounts 映射表，否则写入根部。
		if aid := creds["accountId"]; aid != "" && aid != "default" {
			return saveQQBotAccountManual(configDir, aid, creds["appId"], creds["token"])
		}
		return saveQQBotSecretManual(configDir, creds["appId"], creds["token"])
	default:
		// 通用回退：直接写 channels.<id>.<key>
		log.Printf("⚠️ Using generic config set for unknown channel: %s", channelID)
		for k, v := range creds {
			path := fmt.Sprintf("channels.%s.%s", channelID, k)
			if _, err := RunCommandWithEnvAndTimeout(10*time.Second, env, "openclaw", "config", "set", path, v); err != nil {
				return fmt.Errorf("set %s: %w", path, err)
			}
		}
	}

	return nil
}

// DeleteChannelAccount 从 openclaw.json 中删除指定账号的凭证。
func DeleteChannelAccount(configDir, channelID, accountID string) error {
	return updateOpenClawConfig(configDir, func(cfg map[string]interface{}) error {
		channels := ensureMap(cfg, "channels")
		ch, ok := channels[channelID].(map[string]interface{})
		if !ok {
			return nil
		}
		if accountID == "default" || accountID == "" {
			// 删除根部关键字段
			delete(ch, "appId")
			delete(ch, "appSecret")
			delete(ch, "token")
			delete(ch, "botToken")
		} else {
			accounts, ok := ch["accounts"].(map[string]interface{})
			if ok {
				delete(accounts, accountID)
			}
		}
		return nil
	})
}

func saveLarkSecretManual(configDir, channelID, appID, appSecret string) error {
	return updateOpenClawConfig(configDir, func(cfg map[string]interface{}) error {
		channels := ensureMap(cfg, "channels")
		ch := ensureMap(channels, channelID)
		ch["appId"] = strings.TrimSpace(appID)
		ch["appSecret"] = strings.TrimSpace(appSecret)
		ch["enabled"] = true
		return nil
	})
}

func saveLarkAccountManual(configDir, channelID, accountID, appID, appSecret string) error {
	return updateOpenClawConfig(configDir, func(cfg map[string]interface{}) error {
		channels := ensureMap(cfg, "channels")
		ch := ensureMap(channels, channelID)
		accounts := ensureMap(ch, "accounts")
		acc := ensureMap(accounts, accountID)
		acc["appId"] = strings.TrimSpace(appID)
		acc["appSecret"] = strings.TrimSpace(appSecret)
		return nil
	})
}

func saveQQBotSecretManual(configDir, appID, token string) error {
	return updateOpenClawConfig(configDir, func(cfg map[string]interface{}) error {
		channels := ensureMap(cfg, "channels")
		qqbot := ensureMap(channels, "qqbot")
		qqbot["appId"] = strings.TrimSpace(appID)
		qqbot["token"] = strings.TrimSpace(token)
		qqbot["enabled"] = true
		return nil
	})
}

func saveQQBotAccountManual(configDir, accountID, appID, token string) error {
	return updateOpenClawConfig(configDir, func(cfg map[string]interface{}) error {
		channels := ensureMap(cfg, "channels")
		qqbot := ensureMap(channels, "qqbot")
		accounts := ensureMap(qqbot, "accounts")
		acc := ensureMap(accounts, accountID)
		acc["appId"] = strings.TrimSpace(appID)
		acc["token"] = strings.TrimSpace(token)
		return nil
	})
}

// BindChannelRouteToAgent 写入根级 bindings[]（openclaw agents bind --bind <channel[:account]>）。
// 如果该渠道已绑定到其它 Agent，则会自动解绑，实现“切换”效果。
func BindChannelRouteToAgent(configDir, channelID, agentID, accountID string) error {
	env, err := OpenClawConfigEnv(configDir)
	if err != nil {
		return err
	}

	// 1. 精准检查冲突：只有当【同一个渠道】且【同一个账号】已经绑定了【不同的 Agent】时，才需要解绑。
	// 这允许不同的账号（AccountId）绑定到不同的 Agent 而不互相干扰。
	rows, _ := listRouteBindingRowsForChannel(configDir, channelID)
	for _, row := range rows {
		// 只要 AccountID 一致，但 Agent 不同，就存在路由冲突（openclaw 不允许同一个端点给两个机器人）
		if row.AccountID == accountID && row.AgentID != agentID {
			log.Printf("⚠️ Found conflicting binding for %s:%s (Current Agent: %s, New Agent: %s), unbinding old one...", channelID, accountID, row.AgentID, agentID)
			_ = UnbindChannelRouteFromAgent(configDir, channelID, row.AgentID, row.AccountID)
		}
	}

	configPath := filepath.Join(configDir, "openclaw.json")
	bindSpec := strings.TrimSpace(channelID)
	if aid := strings.TrimSpace(accountID); aid != "" {
		bindSpec = bindSpec + ":" + aid
	}
	log.Printf("🔗 Binding %s -> agent %s (config: %s)", bindSpec, agentID, configPath)
	_, err = RunCommandWithEnvAndTimeout(15*time.Second, env, "openclaw", "agents", "bind",
		"--agent", strings.TrimSpace(agentID),
		"--bind", bindSpec,
	)
	return err
}

// UnbindChannelRouteFromAgent 从根级 bindings[] 移除路由（openclaw agents unbind --bind <channel[:account]>）。
func UnbindChannelRouteFromAgent(configDir, channelID, agentID, accountID string) error {
	env, err := OpenClawConfigEnv(configDir)
	if err != nil {
		return err
	}
	bindSpec := strings.TrimSpace(channelID)
	if aid := strings.TrimSpace(accountID); aid != "" {
		bindSpec = bindSpec + ":" + aid
	}
	log.Printf("🔗 Unbinding %s from agent %s", bindSpec, agentID)
	_, err = RunCommandWithEnvAndTimeout(15*time.Second, env, "openclaw", "agents", "unbind",
		"--agent", strings.TrimSpace(agentID),
		"--bind", bindSpec,
	)
	return err
}

// BindFeishuToAgent 将飞书渠道绑定到指定 Agent。
// 正确命令：openclaw agents bind --agent <agentID> --bind feishu
// 这会在 openclaw.json 的 bindings 数组中写入：
//
//	{ "type":"route", "agentId":"<agentID>", "match":{"channel":"feishu"} }
func BindFeishuToAgent(configDir, agentID string) error {
	activeID := getActiveFeishuChannelID(configDir)
	return BindChannelRouteToAgent(configDir, activeID, agentID, "")
}

// UnbindFeishuFromAgent 解除飞书渠道与指定 Agent 的绑定。
// 正确命令：openclaw agents unbind --agent <agentID> --bind feishu
func UnbindFeishuFromAgent(configDir, agentID string) error {
	activeID := getActiveFeishuChannelID(configDir)
	return UnbindChannelRouteFromAgent(configDir, activeID, agentID, "")
}

// BindTelegramToAgent 将 Telegram 渠道绑定到指定 Agent。
// 正确命令：openclaw agents bind --agent <agentID> --bind telegram
func BindTelegramToAgent(configDir, agentID string) error {
	return BindChannelRouteToAgent(configDir, "telegram", agentID, "")
}

// UnbindTelegramFromAgent 解除 Telegram 渠道与指定 Agent 的绑定。
func UnbindTelegramFromAgent(configDir, agentID string) error {
	return UnbindChannelRouteFromAgent(configDir, "telegram", agentID, "")
}

// BindQQBotToAgent 将 QQBot 渠道绑定到指定 Agent。
// 正确命令：openclaw agents bind --agent <agentID> --bind qqbot
func BindQQBotToAgent(configDir, agentID string) error {
	return BindChannelRouteToAgent(configDir, "qqbot", agentID, "")
}

// UnbindQQBotFromAgent 解除 QQBot 渠道与指定 Agent 的绑定。
func UnbindQQBotFromAgent(configDir, agentID string) error {
	return UnbindChannelRouteFromAgent(configDir, "qqbot", agentID, "")
}

// BindDingTalkToAgent 将钉钉渠道绑定到指定 Agent。
// 正确命令：openclaw agents bind --agent <agentID> --bind dingtalk
func BindDingTalkToAgent(configDir, agentID string) error {
	return BindChannelRouteToAgent(configDir, "dingtalk", agentID, "")
}

// 注意：DingTalk 不是 openclaw 的有效渠道（不在 openclaw extensions 中），
// 因此没有 BindDingTalkToAgent 和 UnbindDingTalkFromAgent 函数。
// 如果将来 openclaw 官方支持 DingTalk，再添加。

func updateOpenClawConfig(configDir string, fn func(map[string]interface{}) error) error {
	configPath := filepath.Join(configDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}
	var cfg map[string]interface{}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return err
	}
	if err := fn(cfg); err != nil {
		return err
	}
	newData, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath, newData, 0644)
}

func ensureMap(parent map[string]interface{}, key string) map[string]interface{} {
	v, ok := parent[key]
	if !ok || v == nil {
		m := make(map[string]interface{})
		parent[key] = m
		return m
	}
	m, ok := v.(map[string]interface{})
	if !ok {
		m = make(map[string]interface{})
		parent[key] = m
		return m
	}
	return m
}
