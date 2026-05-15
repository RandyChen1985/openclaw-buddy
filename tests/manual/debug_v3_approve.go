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

func base64URLNoPadding(data []byte) string {
	return strings.TrimRight(base64.URLEncoding.EncodeToString(data), "=")
}

func main() {
	url := "ws://127.0.0.1:18789/v1/gateway"
	token := "71937201d0ba32c6c14047dd15487a0cbf0cd1f3a05e07f8"

	pubKey, privKey, _ := ed25519.GenerateKey(rand.Reader)
	hash := sha256.Sum256(pubKey)
	deviceId := fmt.Sprintf("%x", hash)

	dialer := websocket.Dialer{}
	header := http.Header{}
	header.Add("Origin", "http://127.0.0.1:18789")
	conn, _, err := dialer.Dial(url, header)
	if err != nil {
		log.Fatal("❌ 连接失败:", err)
	}
	defer conn.Close()
	fmt.Println("🚀 已连接至 Gateway")

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

	signedAt := time.Now().UnixMilli()
	clientId := "openclaw-control-ui"
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
			"client": map[string]interface{}{
				"id":      clientId,
				"version": "2026.4.12",
				"platform": "macos",
				"mode":     "cli",
			},
			"role":   "operator",
			"scopes": strings.Split(scopes, ","),
			"auth":   map[string]interface{}{"token": token},
			"device": map[string]interface{}{
				"id":        deviceId,
				"publicKey": base64URLNoPadding(pubKey),
				"signature": base64URLNoPadding(signature),
				"signedAt":  signedAt,
				"nonce":     challengeNonce,
			},
		},
	}
	conn.WriteJSON(connectReq)

	for {
		_, msg, _ := conn.ReadMessage()
		var resp map[string]interface{}
		json.Unmarshal(msg, &resp)
		if resp["type"] == "res" && resp["id"] == "auth-1" {
			if resp["ok"] == true {
				fmt.Println("✅ 握手成功")
				break
			} else {
				log.Fatal("❌ 握手失败:", string(msg))
			}
		}
	}

	createReq := map[string]interface{}{
		"type": "req",
		"id": "s-create",
		"method": "sessions.create",
		"params": map[string]interface{}{
			"agentId": "main",
			"label": "Debug-Approve-" + time.Now().Format("15:04:05"),
		},
	}
	conn.WriteJSON(createReq)
	
	var sessionKey string
	for {
		_, msg, _ := conn.ReadMessage()
		var resp map[string]interface{}
		json.Unmarshal(msg, &resp)
		if resp["id"] == "s-create" {
			payload := resp["payload"].(map[string]interface{})
			sessionKey = payload["key"].(string)
			fmt.Printf("✅ 会话创建成功: %s\n", sessionKey)
			break
		}
	}

	chatReq := map[string]interface{}{
		"type": "req",
		"id": "c-send",
		"method": "chat.send",
		"params": map[string]interface{}{
			"sessionKey": sessionKey,
			"message": "系统目前配置了哪些模型",
			"idempotencyKey": "debug-" + time.Now().Format("150405"),
		},
	}
	conn.WriteJSON(chatReq)

	fmt.Println("⏳ 等待流式输出与审批请求 (20秒后自动退出)...")
	
	// 设置 20 秒后退出
	go func() {
		time.Sleep(20 * time.Second)
		fmt.Println("\n⏰ 测试超时退出")
		conn.Close()
	}()

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var m map[string]interface{}
		json.Unmarshal(msg, &m)

		// 打印所有收到的原始消息，以便观察结构
		fmt.Printf("\n📥 收到消息: %s\n", string(msg))

		if m["type"] == "event" && m["event"] == "chat" {
			payload := m["payload"].(map[string]interface{})
			state := payload["state"].(string)
			if state == "final" {
				fmt.Println("\n✅ 对话阶段性完成 (final)")
				// 注意：审批请求可能在 final 之后或者作为中间事件
			}
		}
		
		// 如果长时间没消息，或者收到了特定的终止信号，可以退出
		// 这里我们简单设置一个超时或者等待足够长时间
	}
}
