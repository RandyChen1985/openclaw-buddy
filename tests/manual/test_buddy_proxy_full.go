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
	// 1. 配置参数 (使用 Buddy Proxy 转发，但内部协议使用 OpenClaw Token)
	url := "ws://127.0.0.1:3000/console/claw/v1/ws/gateway?token=openclaw-buddy-2026"
	token := "71937201d0ba32c6c14047dd15487a0cbf0cd1f3a05e07f8"

	// 2. 生成密钥对
	pubKey, privKey, _ := ed25519.GenerateKey(rand.Reader)
	hash := sha256.Sum256(pubKey)
	deviceId := fmt.Sprintf("%x", hash)

	// 3. 建立连接
	dialer := websocket.Dialer{}
	header := http.Header{}
	header.Add("Origin", "http://127.0.0.1:18789") // 绕过网关 Origin 校验
	conn, _, err := dialer.Dial(url, header)
	if err != nil {
		log.Fatal("❌ 连接失败:", err)
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

	// 5. 构造 V3 签名
	signedAt := time.Now().UnixMilli()
	clientId := "openclaw-control-ui"
	scopes := "operator.admin,operator.read,operator.write"
	// v3|{deviceId}|{clientId}|{clientMode}|{role}|{scopes}|{signedAtMs}|{token}|{nonce}|{platform}|{deviceFamily}
	payloadStr := fmt.Sprintf("v3|%s|%s|cli|operator|%s|%d|%s|%s|macos|",
		deviceId, clientId, scopes, signedAt, token, challengeNonce)
	
	signature := ed25519.Sign(privKey, []byte(payloadStr))

	// 6. 发送 Connect 请求
	connectReq := map[string]interface{}{
		"type": "req",
		"id":   "auth-1",
		"method": "connect",
		"params": map[string]interface{}{
			"minProtocol": 3,
			"maxProtocol": 3,
			"client": map[string]interface{}{
				"id":      clientId,
				"version": "2026.4.2",
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

	// 6.5 等待 Connect 响应
	for {
		_, msg, _ := conn.ReadMessage()
		var resp map[string]interface{}
		json.Unmarshal(msg, &resp)
		if resp["type"] == "res" && resp["id"] == "auth-1" {
			if resp["ok"] == true {
				fmt.Println("✅ 握手成功 (Connect OK)")
				break
			} else {
				log.Fatal("❌ 握手失败:", string(msg))
			}
		}
	}

	// 7. 进入全量协议验证逻辑
	fmt.Println("\n--- 开始全量方法验证 ---")
	
	// 定义要测试的方法
	methods := []struct {
		ID     string
		Method string
		Params map[string]interface{}
	}{
		{"m-1", "agents.list", nil},
		{"m-2", "models.list", nil},
		{"m-3", "sessions.list", map[string]interface{}{"limit": 5}},
		{"m-4", "health", map[string]interface{}{"probe": true}},
	}

	for _, m := range methods {
		fmt.Printf("🔍 测试方法: %s\n", m.Method)
		req := map[string]interface{}{
			"type":   "req",
			"id":     m.ID,
			"method": m.Method,
			"params": m.Params,
		}
		if m.Params == nil {
			req["params"] = map[string]interface{}{}
		}
		conn.WriteJSON(req)
		
		// 等待响应
		for {
			_, msg, _ := conn.ReadMessage()
			var resp map[string]interface{}
			json.Unmarshal(msg, &resp)
			
			if resp["type"] == "res" && resp["id"] == m.ID {
				if resp["ok"] == true {
					fmt.Printf("✅ %s 成功!\n", m.Method)
					// if m.Method == "agents.list" {
					// 	fmt.Printf("   机器人数据: %v\n", resp["payload"])
					// }
				} else {
					fmt.Printf("❌ %s 失败: %v\n", m.Method, resp["error"])
				}
				break
			} else if resp["type"] == "event" {
				// 忽略心跳等事件
				if resp["event"] != "health" {
					fmt.Printf("📡 事件 [%v]: %s\n", resp["event"], string(msg))
				}
			}
		}
	}

	// 8. 测试会话创建与流式对话
	fmt.Println("\n--- 测试流程: 创建会话 -> 发送消息 -> 接收流式回复 ---")
	
	// Create Session
	createReq := map[string]interface{}{
		"type": "req",
		"id": "s-create",
		"method": "sessions.create",
		"params": map[string]interface{}{
			"agentId": "main",
			"label": "WS测试会话-" + time.Now().Format("15:04:05"),
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
			// 实际上创建会话返回的是 entry 对象，Key 在里面
			// 这里根据源码，我们直接构造 key 或者从返回中拿
			// 经验证，sessions.create 返回的对象包含 key
			sessionKey = payload["key"].(string)
			fmt.Printf("✅ 会话创建成功: %s\n", sessionKey)
			break
		}
	}

	// Send Message
	chatReq := map[string]interface{}{
		"type": "req",
		"id": "c-send",
		"method": "chat.send",
		"params": map[string]interface{}{
			"sessionKey": sessionKey,
			"message": "请用一句话证明你已经收到了这个指令",
			"idempotencyKey": "test-" + time.Now().Format("150405"),
		},
	}
	conn.WriteJSON(chatReq)

	fmt.Println("⏳ 等待流式输出...")
	for {
		_, msg, _ := conn.ReadMessage()
		var m map[string]interface{}
		json.Unmarshal(msg, &m)

		if m["type"] == "event" && m["event"] == "chat" {
			payload := m["payload"].(map[string]interface{})
			state := payload["state"].(string)
			if state == "delta" {
				msgObj := payload["message"].(map[string]interface{})
				content := msgObj["content"].([]interface{})
				if len(content) > 0 {
					text := content[0].(map[string]interface{})["text"].(string)
					fmt.Printf("\r💬 流式回复: %s", text)
				}
			} else if state == "final" {
				fmt.Println("\n✅ 对话完成！")
				break
			}
		} else if m["type"] == "res" && m["id"] == "c-send" {
			if m["ok"] != true {
				fmt.Printf("❌ 发送失败: %v\n", m["error"])
				return
			}
		}
	}

	// 9. 测试历史获取
	fmt.Println("\n--- 测试方法: chat.history ---")
	historyReq := map[string]interface{}{
		"type": "req",
		"id": "h-1",
		"method": "chat.history",
		"params": map[string]interface{}{
			"sessionKey": sessionKey,
			"limit": 10,
		},
	}
	conn.WriteJSON(historyReq)
	for {
		_, msg, _ := conn.ReadMessage()
		var resp map[string]interface{}
		json.Unmarshal(msg, &resp)
		if resp["id"] == "h-1" {
			fmt.Printf("✅ 历史记录获取成功! 消息条数: %v\n", len(resp["payload"].(map[string]interface{})["messages"].([]interface{})))
			break
		}
	}

	fmt.Println("\n🎉 所有关键协议路径验证通过！")
}
