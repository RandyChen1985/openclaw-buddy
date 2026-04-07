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
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// Base64URL no padding 编码
func base64URLNoPadding(data []byte) string {
	return strings.TrimRight(base64.URLEncoding.EncodeToString(data), "=")
}

func main() {
	// 1. 配置参数 - 请根据实际情况调整
	url := "ws://127.0.0.1:18789/v1/gateway"
	token := "71937201d0ba32c6c14047dd15487a0cbf0cd1f3a05e07f8"

	// 2. 生成密钥对
	pubKey, privKey, _ := ed25519.GenerateKey(rand.Reader)
	hash := sha256.Sum256(pubKey)
	deviceId := fmt.Sprintf("%x", hash)

	// 3. 建立连接
	dialer := websocket.Dialer{}
	header := http.Header{}
	header.Add("Origin", "http://127.0.0.1:18789")
	conn, _, err := dialer.Dial(url, header)
	if err != nil {
		log.Fatal("❌ 连接失败 (网关可能未运行):", err)
	}
	defer conn.Close()
	fmt.Println("🚀 已连接至 Gateway")

	// 4. 等待 Challenge
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

	// 5. 构造 V3 签名并认证
	signedAt := time.Now().UnixMilli()
	clientId := "openclaw-control-ui"
	scopes := "operator.admin,operator.read,operator.write"
	payloadStr := fmt.Sprintf("v3|%s|%s|cli|operator|%s|%d|%s|%s|macos|",
		deviceId, clientId, scopes, signedAt, token, challengeNonce)
	signature := ed25519.Sign(privKey, []byte(payloadStr))

	connectReq := map[string]interface{}{
		"type": "req",
		"id":   "auth-1",
		"method": "connect",
		"params": map[string]interface{}{
			"minProtocol": 3,
			"maxProtocol": 3,
			"client": map[string]interface{}{
				"id": clientId, "version": "1.0.0", "platform": "macos", "mode": "cli",
			},
			"role": "operator",
			"scopes": strings.Split(scopes, ","),
			"auth": map[string]interface{}{"token": token},
			"device": map[string]interface{}{
				"id": deviceId, "publicKey": base64URLNoPadding(pubKey),
				"signature": base64URLNoPadding(signature), "signedAt": signedAt, "nonce": challengeNonce,
			},
		},
	}
	conn.WriteJSON(connectReq)

	// 等待认证成功
	for {
		_, msg, _ := conn.ReadMessage()
		var resp map[string]interface{}
		json.Unmarshal(msg, &resp)
		if resp["id"] == "auth-1" {
			if resp["error"] != nil {
				log.Fatalf("❌ 认证失败: %v", resp["error"])
			}
			fmt.Println("✅ 认证成功")
			break
		}
	}

	// 6. 获取会话列表
	fmt.Println("\n--- 请求 sessions.list ---")
	listReq := map[string]interface{}{
		"type": "req",
		"id":   "list-1",
		"method": "sessions.list",
		"params": map[string]interface{}{
			"limit": 5,
		},
	}
	conn.WriteJSON(listReq)

	var firstKey string
	for {
		_, msg, _ := conn.ReadMessage()
		var resp map[string]interface{}
		json.Unmarshal(msg, &resp)
		if resp["id"] == "list-1" {
			// 提取 Session Key
			if result, ok := resp["payload"].(map[string]interface{}); ok {
				if list, ok := result["sessions"].([]interface{}); ok {
					if len(list) > 0 {
						if sess, ok := list[0].(map[string]interface{}); ok {
							firstKey = sess["key"].(string)
						}
					}
				}
			}
			break
		}
	}

	var sessionKeys []string
	if firstKey != "" {
		sessionKeys = append(sessionKeys, firstKey)
		fmt.Printf("\n--- 尝试修改会话 Label: %s ---\n", firstKey)
		patchReq := map[string]interface{}{
			"type": "req",
			"id":   "patch-label",
			"method": "sessions.patch",
			"params": map[string]interface{}{
				"key":   firstKey,
				"label": "Renamed by Explorer " + time.Now().Format("15:04:05"),
			},
		}
		conn.WriteJSON(patchReq)

		for {
			_, msg, _ := conn.ReadMessage()
			var resp map[string]interface{}
			json.Unmarshal(msg, &resp)
			if resp["id"] == "patch-label" {
				pretty, _ := json.MarshalIndent(resp, "", "  ")
				fmt.Printf("📦 sessions.patch 结果:\n%s\n", string(pretty))
				break
			}
		}
	}

	// 7. 获取每个会话的历史记录
	for _, key := range sessionKeys {
		fmt.Printf("\n--- 请求 chat.history for %s ---\n", key)
		histReq := map[string]interface{}{
			"type": "req",
			"id":   "hist-" + key,
			"method": "chat.history",
			"params": map[string]interface{}{
				"sessionKey": key,
				"limit":      10,
			},
		}
		conn.WriteJSON(histReq)

		for {
			_, msg, _ := conn.ReadMessage()
			var resp map[string]interface{}
			json.Unmarshal(msg, &resp)
			if resp["id"] == "hist-"+key {
				pretty, _ := json.MarshalIndent(resp, "", "  ")
				fmt.Printf("📜 chat.history 结果:\n%s\n", string(pretty))
				break
			}
		}
	}
}
