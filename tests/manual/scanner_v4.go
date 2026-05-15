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
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

func base64URLNoPadding(data []byte) string {
	return strings.TrimRight(base64.URLEncoding.EncodeToString(data), "=")
}

func main() {
	url := "ws://127.0.0.1:18789/v1/gateway"
	token := "71937201d0ba32c6c14047dd15487a0cbf0cd1f3a05e07f8"

	dialer := websocket.Dialer{}
	header := http.Header{}
	header.Add("Origin", "http://127.0.0.1:18789")
	conn, _, err := dialer.Dial(url, header)
	if err != nil { log.Fatal("❌ 连接失败:", err) }
	defer conn.Close()

	var challengeNonce string
	for {
		_, msg, _ := conn.ReadMessage()
		var m map[string]interface{}; json.Unmarshal(msg, &m)
		if m["event"] == "connect.challenge" {
			challengeNonce = m["payload"].(map[string]interface{})["nonce"].(string)
			break
		}
	}

	pubKey, privKey, _ := ed25519.GenerateKey(rand.Reader)
	hash := sha256.Sum256(pubKey)
	deviceId := fmt.Sprintf("%x", hash)
	signedAt := time.Now().UnixMilli()
	clientId := "openclaw-control-ui"
	scopes := "operator.admin,operator.read,operator.write"
	payloadStr := fmt.Sprintf("v3|%s|%s|cli|operator|%s|%d|%s|%s|macos|", deviceId, clientId, scopes, signedAt, token, challengeNonce)
	signature := ed25519.Sign(privKey, []byte(payloadStr))

	conn.WriteJSON(map[string]interface{}{
		"type": "req", "id": "auth-1", "method": "connect",
		"params": map[string]interface{}{
			"minProtocol": 4, "maxProtocol": 4, "role": "operator", "scopes": strings.Split(scopes, ","),
			"auth": map[string]interface{}{"token": token},
			"device": map[string]interface{}{
				"id": deviceId, "publicKey": base64URLNoPadding(pubKey),
				"signature": base64URLNoPadding(signature), "signedAt": signedAt, "nonce": challengeNonce,
			},
			"client": map[string]interface{}{ "id": clientId, "version": "1.0.0", "platform": "macos", "mode": "cli" },
		},
	})

	for {
		_, msg, _ := conn.ReadMessage()
		var resp map[string]interface{}; json.Unmarshal(msg, &resp)
		if resp["id"] == "auth-1" { break }
	}

	conn.WriteJSON(map[string]interface{}{ "type": "req", "id": "list", "method": "sessions.list", "params": map[string]interface{}{"limit": 20} })
	var sessionKeys []string
	for {
		_, msg, _ := conn.ReadMessage()
		var resp map[string]interface{}; json.Unmarshal(msg, &resp)
		if resp["id"] == "list" {
			list := resp["payload"].(map[string]interface{})["sessions"].([]interface{})
			for _, s := range list { sessionKeys = append(sessionKeys, s.(map[string]interface{})["key"].(string)) }
			break
		}
	}

	fmt.Printf("🔍 扫描开始：遍历 %d 个会话...\n", len(sessionKeys))
	for i, key := range sessionKeys {
		id := fmt.Sprintf("h-%d", i)
		conn.WriteJSON(map[string]interface{}{ "type": "req", "id": id, "method": "chat.history", "params": map[string]interface{}{ "sessionKey": key, "limit": 20 } })
		for {
			_, msg, _ := conn.ReadMessage()
			var resp map[string]interface{}; json.Unmarshal(msg, &resp)
			if resp["id"] == id {
				messages := resp["payload"].(map[string]interface{})["messages"].([]interface{})
				for _, m := range messages { analyze(m.(map[string]interface{})) }
				break
			}
		}
	}
	fmt.Println("\n✨ 扫描完成！")
}

func analyze(m map[string]interface{}) {
	role := m["role"].(string)
	content := m["content"]
	if blocks, ok := content.([]interface{}); ok {
		for _, b := range blocks {
			block := b.(map[string]interface{})
			bType := block["type"]
			if bType == "text" && block["text"] == nil && block["content"] != nil {
				fmt.Printf("⚠️  [Assistant-Mixed] 使用了 content 字段代替 text: %v\n", block)
			}
			if block["thinking"] != nil || block["thought"] != nil || block["reasoning"] != nil {
				fmt.Printf("💡 [Thinking-Found] Role: %s | Keys: %v\n", role, block)
			}
			if bType == "toolCall" || bType == "toolResult" {
				fmt.Printf("🛠️  [Tool-Found] Type: %v | Keys: %v\n", bType, block)
			}
		}
	} else if s, ok := content.(string); ok {
		if strings.HasPrefix(s, "[") || strings.HasPrefix(s, "{") {
			fmt.Printf("📄 [String-JSON] Role: %s | Content: %s\n", role, s[:30]+"...")
		}
	}
}
