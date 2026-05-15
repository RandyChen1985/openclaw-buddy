//go:build manual

package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// ============================================================
// 配置区 - 根据实际情况修改
// ============================================================
const (
	gatewayURL       = "ws://127.0.0.1:18789/v1/gateway"
	gatewayToken     = "71937201d0ba32c6c14047dd15487a0cbf0cd1f3a05e07f8"
	clientID         = "openclaw-control-ui" // 网关允许的客户端 ID
	targetSessionKey = "agent:main:main"
	historyLimit     = 200                 // 拉取最近 N 条消息
	outputFile       = "session_dump.json" // 输出到当前目录
	markdownFile     = "temp.md"           // 对话可读版
)

// ============================================================

func base64URLNoPadding(data []byte) string {
	return strings.TrimRight(base64.URLEncoding.EncodeToString(data), "=")
}

func msgCreatedAtMillis(m map[string]interface{}) int64 {
	for _, k := range []string{"createdAt", "created_at", "timestamp"} {
		v, ok := m[k]
		if !ok || v == nil {
			continue
		}
		switch t := v.(type) {
		case string:
			if parsed, err := time.Parse(time.RFC3339Nano, t); err == nil {
				return parsed.UnixMilli()
			}
			if parsed, err := time.Parse(time.RFC3339, t); err == nil {
				return parsed.UnixMilli()
			}
		case float64:
			return int64(t)
		}
	}
	return 0
}

// formatHistoryPlain 将网关返回的 message.content 转成可读正文（对齐前端 formatMessageContent 的常见形态）。
func formatHistoryPlain(raw interface{}, depth int) string {
	if depth > 6 {
		b, _ := json.Marshal(raw)
		return string(b)
	}
	if raw == nil {
		return ""
	}
	switch v := raw.(type) {
	case string:
		t := strings.TrimSpace(v)
		if t == "" || t == "[]" || t == "{}" {
			return ""
		}
		if strings.HasPrefix(t, "[") || strings.HasPrefix(t, "{") {
			var parsed interface{}
			if json.Unmarshal([]byte(t), &parsed) == nil {
				return formatHistoryPlain(parsed, depth+1)
			}
		}
		return v
	case []interface{}:
		var sb strings.Builder
		for _, c := range v {
			sb.WriteString(formatContentBlockPlain(c, depth+1))
		}
		return sb.String()
	case map[string]interface{}:
		th := ""
		for _, key := range []string{"thought", "thinking", "reasoning"} {
			if x, ok := v[key].(string); ok && strings.TrimSpace(x) != "" {
				th = "> [thinking]\n> " + strings.ReplaceAll(strings.TrimSpace(x), "\n", "\n> ") + "\n\n"
				break
			}
		}
		if c, ok := v["content"]; ok {
			return th + formatHistoryPlain(c, depth+1)
		}
		return th + formatHistoryPlain([]interface{}{v}, depth+1)
	default:
		return fmt.Sprintf("%v", v)
	}
}

func formatContentBlockPlain(c interface{}, depth int) string {
	m, ok := c.(map[string]interface{})
	if !ok {
		return fmt.Sprintf("%v\n\n", c)
	}
	var sb strings.Builder
	typ, _ := m["type"].(string)

	if typ == "thinking" || m["thinking"] != nil || m["thought"] != nil || m["reasoning"] != nil {
		th := pickString(m, "thinking", "thought", "reasoning", "content")
		if th != "" {
			sb.WriteString("> [thinking]\n> ")
			sb.WriteString(strings.ReplaceAll(th, "\n", "\n> "))
			sb.WriteString("\n\n")
		}
	}
	if typ == "plan" || m["plan"] != nil {
		p := pickString(m, "plan", "content")
		if p != "" {
			sb.WriteString("> [plan]\n> ")
			sb.WriteString(strings.ReplaceAll(p, "\n", "\n> "))
			sb.WriteString("\n\n")
		}
	}
	if typ == "command_output" || m["command_output"] != nil || m["commandOutput"] != nil {
		out := pickString(m, "command_output", "commandOutput", "content")
		if out != "" {
			sb.WriteString("> [command]\n> ")
			sb.WriteString(strings.ReplaceAll(out, "\n", "\n> "))
			sb.WriteString("\n\n")
		}
	}
	if typ == "toolCall" || m["toolCall"] != nil || m["tool_call"] != nil {
		tc := m["toolCall"]
		if tc == nil {
			tc = m["tool_call"]
		}
		if tc == nil {
			tc = m
		}
		if tcm, ok := tc.(map[string]interface{}); ok {
			name := ""
			if n, ok := tcm["name"].(string); ok {
				name = n
			} else if fn, ok := tcm["function"].(map[string]interface{}); ok {
				name, _ = fn["name"].(string)
			}
			args := tcm["arguments"]
			argsStr := ""
			if s, ok := args.(string); ok {
				argsStr = s
			} else {
				b, _ := json.MarshalIndent(args, "", "  ")
				argsStr = string(b)
			}
			sb.WriteString("[toolCall] ")
			sb.WriteString(name)
			sb.WriteString("\n```json\n")
			sb.WriteString(argsStr)
			sb.WriteString("\n```\n\n")
		}
	}
	if typ == "toolResult" || m["toolResult"] != nil || m["tool_result"] != nil {
		tr := m["toolResult"]
		if tr == nil {
			tr = m["tool_result"]
		}
		if tr == nil {
			tr = m
		}
		if trm, ok := tr.(map[string]interface{}); ok {
			tn := pickString(trm, "toolName", "tool_name", "name")
			res := trm["content"]
			if res == nil {
				res = trm["result"]
			}
			rs := ""
			if s, ok := res.(string); ok {
				rs = s
			} else {
				b, _ := json.MarshalIndent(res, "", "  ")
				rs = string(b)
			}
			sb.WriteString("[toolResult]")
			if tn != "" {
				sb.WriteString(" ")
				sb.WriteString(tn)
			}
			sb.WriteString("\n```json\n")
			sb.WriteString(rs)
			sb.WriteString("\n```\n\n")
		}
	}

	text := pickString(m, "text")
	if text == "" && typ != "toolCall" && typ != "toolResult" && typ != "thinking" {
		if s, ok := m["content"].(string); ok {
			text = s
		}
	}
	sb.WriteString(text)

	if strings.TrimSpace(sb.String()) == "" && len(m) > 0 {
		b, err := json.MarshalIndent(m, "", "  ")
		if err == nil {
			sb.WriteString("```json\n")
			sb.WriteString(string(b))
			sb.WriteString("\n```\n\n")
		}
	}
	return sb.String()
}

func pickString(m map[string]interface{}, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k].(string); ok && strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func roleLabel(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "user":
		return "User"
	case "assistant":
		return "AI"
	case "system":
		return "System"
	default:
		if role == "" {
			return "(unknown)"
		}
		return role
	}
}

func writeMarkdownTranscript(sessionKey string, histPayload map[string]interface{}) error {
	msgsRaw := histPayload["messages"]
	if msgsRaw == nil {
		msgsRaw = histPayload["items"]
	}
	list, ok := msgsRaw.([]interface{})
	if !ok {
		return fmt.Errorf("history 中没有 messages/items 数组")
	}
	items := make([]map[string]interface{}, 0, len(list))
	for _, it := range list {
		m, ok := it.(map[string]interface{})
		if ok {
			items = append(items, m)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return msgCreatedAtMillis(items[i]) < msgCreatedAtMillis(items[j])
	})

	var sb strings.Builder
	sb.WriteString("# 会话 transcript\n\n")
	sb.WriteString("- **sessionKey**: `" + sessionKey + "`\n")
	sb.WriteString("- **exportedAt**: " + time.Now().Format(time.RFC3339) + "\n")
	sb.WriteString("- **messages**: " + fmt.Sprintf("%d", len(items)) + "\n\n")
	sb.WriteString("---\n\n")

	for _, msg := range items {
		role, _ := msg["role"].(string)
		id, _ := msg["id"].(string)
		when := ""
		for _, k := range []string{"createdAt", "created_at"} {
			if v, ok := msg[k].(string); ok {
				when = v
				break
			}
		}
		label := roleLabel(role)
		sb.WriteString("## ")
		sb.WriteString(label)
		sb.WriteString("\n\n")
		if id != "" || when != "" {
			sb.WriteString("*")
			if id != "" {
				sb.WriteString("id: `" + id + "`")
			}
			if id != "" && when != "" {
				sb.WriteString(" · ")
			}
			if when != "" {
				sb.WriteString(when)
			}
			sb.WriteString("*\n\n")
		}
		body := formatHistoryPlain(msg["content"], 0)
		if strings.TrimSpace(body) == "" {
			body = "_（空内容）_\n"
		}
		sb.WriteString(body)
		if !strings.HasSuffix(body, "\n") {
			sb.WriteString("\n")
		}
		sb.WriteString("\n---\n\n")
	}

	return os.WriteFile(markdownFile, []byte(sb.String()), 0644)
}

func sendAndWait(conn *websocket.Conn, req map[string]interface{}, waitID string) map[string]interface{} {
	conn.WriteJSON(req)
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Fatalf("❌ 读取消息失败: %v", err)
		}
		var resp map[string]interface{}
		json.Unmarshal(msg, &resp)
		if resp["id"] == waitID {
			return resp
		}
		// 忽略心跳等其他消息
	}
}

func main() {
	// --- 1. 建立 WebSocket 连接 ---
	dialer := websocket.Dialer{}
	header := http.Header{}
	header.Add("Origin", "http://127.0.0.1:18789")
	conn, _, err := dialer.Dial(gatewayURL, header)
	if err != nil {
		log.Fatal("❌ 连接失败 (网关可能未运行):", err)
	}
	defer conn.Close()
	fmt.Println("🚀 已连接至 Gateway:", gatewayURL)

	// --- 2. 生成密钥对 ---
	pubKey, privKey, _ := ed25519.GenerateKey(rand.Reader)
	hash := sha256.Sum256(pubKey)
	deviceId := fmt.Sprintf("%x", hash)

	// --- 3. 等待 Challenge ---
	var challengeNonce string
	for {
		_, msg, _ := conn.ReadMessage()
		var m map[string]interface{}
		json.Unmarshal(msg, &m)
		if m["event"] == "connect.challenge" {
			payload := m["payload"].(map[string]interface{})
			challengeNonce = payload["nonce"].(string)
			fmt.Println("📥 收到 Challenge:", challengeNonce)
			break
		}
	}

	// --- 4. 认证 ---
	signedAt := time.Now().UnixMilli()
	scopes := "operator.admin,operator.read,operator.write"
	payloadStr := fmt.Sprintf("v3|%s|%s|cli|operator|%s|%d|%s|%s|macos|",
		deviceId, clientId, scopes, signedAt, token, challengeNonce)
	signature := ed25519.Sign(privKey, []byte(payloadStr))

	conn.WriteJSON(map[string]interface{}{
		"type": "req",
		"id":   "auth-1",
		"method": "connect",
		"params": map[string]interface{}{
			"minProtocol": 4,
			"maxProtocol": 4,
			"client":      map[string]interface{}{"id": clientID, "version": "1.0.0", "platform": "macos", "mode": "cli"},
			"role":        "operator",
			"scopes":      strings.Split(scopes, ","),
			"auth":        map[string]interface{}{"token": gatewayToken},
			"device": map[string]interface{}{
				"id": deviceId, "publicKey": base64URLNoPadding(pubKey),
				"signature": base64URLNoPadding(signature), "signedAt": signedAt, "nonce": challengeNonce,
			},
		},
	}, "auth-1")

	if authResp["error"] != nil {
		log.Fatalf("❌ 认证失败: %v", authResp["error"])
	}
	fmt.Println("✅ 认证成功")

	// --- 5. 查询目标会话的元信息（通过 sessions.list 找到它）---
	fmt.Printf("\n📋 ===== 查询会话元信息 [%s] =====\n", targetSessionKey)
	listResp := sendAndWait(conn, map[string]interface{}{
		"type":   "req",
		"id":     "list-1",
		"method": "sessions.list",
		"params": map[string]interface{}{"limit": 100},
	}, "list-1")

	var foundSession map[string]interface{}
	if payload, ok := listResp["payload"].(map[string]interface{}); ok {
		items := payload["items"]
		if items == nil {
			items = payload["sessions"]
		}
		if list, ok := items.([]interface{}); ok {
			fmt.Printf("📦 共找到 %d 个会话\n", len(list))
			for _, item := range list {
				if s, ok := item.(map[string]interface{}); ok {
					if s["key"] == targetSessionKey {
						foundSession = s
						break
					}
				}
			}
		}
	}

	if foundSession != nil {
		pretty, _ := json.MarshalIndent(foundSession, "", "  ")
		fmt.Printf("\n🎯 找到目标会话:\n%s\n", string(pretty))
	} else {
		fmt.Printf("\n⚠️  sessions.list 中未找到 key=%s (可能超过 limit 或已删除)\n", targetSessionKey)
	}

	// --- 6. 拉取聊天历史 ---
	fmt.Printf("\n📜 ===== chat.history [limit=%d] =====\n", historyLimit)
	histResp := sendAndWait(conn, map[string]interface{}{
		"type":   "req",
		"id":     "hist-1",
		"method": "chat.history",
		"params": map[string]interface{}{
			"sessionKey": targetSessionKey,
			"limit":      historyLimit,
		},
	}, "hist-1")

	if histResp["error"] != nil {
		fmt.Printf("❌ chat.history 报错: %v\n", histResp["error"])
	} else {
		// 构建完整 dump 结构
		dump := map[string]interface{}{
			"queriedAt":    time.Now().Format(time.RFC3339),
			"sessionKey":   targetSessionKey,
			"sessionMeta":  foundSession,
			"historyLimit": historyLimit,
			"history":      histResp["payload"],
		}
		pretty, _ := json.MarshalIndent(dump, "", "  ")

		// 写入文件
		err := os.WriteFile(outputFile, pretty, 0644)
		if err != nil {
			log.Fatalf("❌ 写入文件失败: %v", err)
		}
		fmt.Printf("\n✅ 完整 JSON 已保存到: %s (%d bytes)\n", outputFile, len(pretty))

		if payload, ok := histResp["payload"].(map[string]interface{}); ok {
			msgs := payload["messages"]
			if msgs == nil {
				msgs = payload["items"]
			}
			if list, ok := msgs.([]interface{}); ok {
				fmt.Printf("📨 共 %d 条消息\n", len(list))
			}
			if err := writeMarkdownTranscript(targetSessionKey, payload); err != nil {
				fmt.Printf("⚠️  写入 %s 失败: %v\n", markdownFile, err)
			} else {
				fmt.Printf("✅ 可读对话已保存到: %s\n", markdownFile)
			}
		}
	}

	fmt.Println("\n✅ 查询完成")
}
