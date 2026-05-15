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
	// 1. 配置参数 (使用 Buddy 代理地址)
	url := "ws://127.0.0.1:3000/console/claw/v1/ws/gateway?token=openclaw-buddy-2026"
	// 网关 Token (通常在首次部署时由 openclaw 自动生成，此处尝试使用测试脚本中的常用值)
	token := "71937201d0ba32c6c14047dd15487a0cbf0cd1f3a05e07f8"

	// 2. 生成密钥对和设备 ID
	pubKey, privKey, _ := ed25519.GenerateKey(rand.Reader)
	hash := sha256.Sum256(pubKey)
	deviceId := fmt.Sprintf("%x", hash)

	// 3. 建立连接
	dialer := websocket.Dialer{}
	header := http.Header{}
	header.Add("Origin", "http://127.0.0.1:3000") // 模拟 Buddy 页面来源
	conn, _, err := dialer.Dial(url, header)
	if err != nil {
		log.Fatal("❌ 连接失败:", err)
	}
	defer conn.Close()
	fmt.Println("🚀 已连接至 Buddy V3 Proxy")

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

	// 5. 构造签名并认证
	signedAt := time.Now().UnixMilli()
	clientId := "openclaw-control-ui"
	scopes := "operator.admin,operator.read"
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
				"version": "1.0.0",
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

	// 6. 等待认证结果
	for {
		_, msg, _ := conn.ReadMessage()
		var resp map[string]interface{}
		json.Unmarshal(msg, &resp)
		if resp["type"] == "res" && resp["id"] == "auth-1" {
			if resp["ok"] == true {
				fmt.Println("✅ 认证成功!")
				break
			} else {
				log.Fatal("❌ 认证失败:", string(msg))
			}
		}
	}

	// 7. 测试监控方法
	fmt.Println("\n--- 🧐 开始验证监控指标 ---")

	testMethods := []struct {
		Name   string
		Method string
		Params map[string]interface{}
	}{
		{"测试健康状态 (基本)", "health", nil},
		{"测试健康状态 (深度探测)", "health", map[string]interface{}{"probe": true}},
		{"测试系统摘要", "status", nil},
	}

	for _, tm := range testMethods {
		fmt.Printf("\n[RPC] 发送 %s (%s)...\n", tm.Method, tm.Name)
		reqID := "req-" + tm.Method + "-" + fmt.Sprintf("%d", time.Now().Unix())
		req := map[string]interface{}{
			"type":   "req",
			"id":     reqID,
			"method": tm.Method,
			"params": tm.Params,
		}
		if tm.Params == nil {
			req["params"] = map[string]interface{}{}
		}
		
		conn.WriteJSON(req)

		// 等待响应或一段时间内的事件
		deadline := time.After(2 * time.Second)
	WaitLoop:
		for {
			select {
			case <-deadline:
				fmt.Printf("⚠️ %s 等待响应超时\n", tm.Method)
				break WaitLoop
			default:
				_, msg, _ := conn.ReadMessage()
				var resp map[string]interface{}
				json.Unmarshal(msg, &resp)

				if resp["type"] == "res" && resp["id"] == reqID {
					fmt.Printf("✅ %s 响应成功!\n", tm.Method)
					payload, _ := json.MarshalIndent(resp["payload"], "", "  ")
					fmt.Println("Payload 内容:")
					fmt.Println(string(payload))
					break WaitLoop
				} else if resp["type"] == "event" && resp["event"] == "health" {
					fmt.Println("📡 [Event] 收到实时推送的 health 事件:")
					payload, _ := json.MarshalIndent(resp["payload"], "", "  ")
					fmt.Println(string(payload))
				}
			}
		}
	}

	fmt.Println("\n🎉 测试结束")
}
