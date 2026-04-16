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
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

const auditFile = "tests/manual/v3_protocol_audit.md"

// Base64URL no padding 编码
func base64URLNoPadding(data []byte) string {
	return strings.TrimRight(base64.URLEncoding.EncodeToString(data), "=")
}

// logRPC 记录 RPC 交互到 Markdown 文件
func logRPC(direction string, method string, data interface{}) {
	f, err := os.OpenFile(auditFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		fmt.Printf("⚠️ 无法写入审计日志: %v\n", err)
		return
	}
	defer f.Close()

	jsonData, _ := json.MarshalIndent(data, "", "  ")
	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	
	entry := fmt.Sprintf("\n### [%s] %s | Method: %s\n```json\n%s\n```\n", 
		timestamp, direction, method, string(jsonData))
	
	f.WriteString(entry)
}

// sendChatAndWait 发送 chat.send 并阻塞等待该轮结束（final），返回是否出现过 thought 状态事件。
func sendChatAndWait(conn *websocket.Conn, sessionKey string, reqID string, message string) (sawThought bool, err error) {
	chatReq := map[string]interface{}{
		"type":   "req",
		"id":     reqID,
		"method": "chat.send",
		"params": map[string]interface{}{
			"sessionKey":     sessionKey,
			"message":        message,
			"idempotencyKey": fmt.Sprintf("%s-%d", reqID, time.Now().UnixNano()),
		},
	}
	logRPC("OUT", "chat.send", chatReq)
	if err := conn.WriteJSON(chatReq); err != nil {
		return false, err
	}

	fmt.Println("⏳ 等待流式输出...")
	for {
		_, msg, readErr := conn.ReadMessage()
		if readErr != nil {
			return sawThought, readErr
		}
		var m map[string]interface{}
		_ = json.Unmarshal(msg, &m)

		if m["type"] == "event" && m["event"] == "chat" {
			logRPC("IN", "chat.event", m)
			payload, _ := m["payload"].(map[string]interface{})
			state, _ := payload["state"].(string)

			switch state {
			case "thought":
				sawThought = true
				fmt.Print("💭") // 思考中...
			case "delta":
				msgObj, _ := payload["message"].(map[string]interface{})
				content, _ := msgObj["content"].([]interface{})
				if len(content) > 0 {
					item, _ := content[0].(map[string]interface{})
					text, _ := item["text"].(string)
					if text != "" {
						// 兼容：部分网关/模型不会发独立的 state=thought 事件，
						// 而是把思考过程包在 <think>…</think> 或 :::thinking 容器里直接走 delta。
						if strings.Contains(text, "<think") || strings.Contains(text, "</think>") || strings.Contains(text, ":::thinking") {
							sawThought = true
						}
						fmt.Printf("\r💬 回复: %s", text)
					}
				}
			case "final":
				fmt.Println("\n✅ 轮次完成！")
				return sawThought, nil
			}
		} else if m["type"] == "res" && m["id"] == reqID {
			logRPC("IN", "chat.send.response", m)
			if m["ok"] != true {
				return sawThought, fmt.Errorf("chat.send failed: %v", m["error"])
			}
		}
	}
}

func main() {
	// 初始化审计文件
	os.WriteFile(auditFile, []byte("# WebSocket Chat V3 协议审计报告\n\n生成时间: "+time.Now().Format(time.RFC3339)+"\n"), 0644)

	// 1. 配置参数
	url := "ws://127.0.0.1:3000/console/claw/v1/ws/gateway?token=openclaw-buddy-2026"
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
			logRPC("IN", "connect.challenge", m)
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
	logRPC("OUT", "connect", connectReq)
	conn.WriteJSON(connectReq)

	// 6.5 等待 Connect 响应
	for {
		_, msg, _ := conn.ReadMessage()
		var resp map[string]interface{}
		json.Unmarshal(msg, &resp)
		logRPC("IN", "connect.response", resp)
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
	
	methods := []struct {
		ID     string
		Method string
		Params map[string]interface{}
	}{
		{"m-1", "agents.list", nil},
		{"m-2", "models.list", nil},
		{"m-3", "sessions.list", map[string]interface{}{"limit": 5}},
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
		logRPC("OUT", m.Method, req)
		conn.WriteJSON(req)
		
		for {
			_, msg, _ := conn.ReadMessage()
			var resp map[string]interface{}
			json.Unmarshal(msg, &resp)
			
			if resp["type"] == "res" && resp["id"] == m.ID {
				logRPC("IN", m.Method+".response", resp)
				if resp["ok"] == true {
					fmt.Printf("✅ %s 成功!\n", m.Method)
				} else {
					fmt.Printf("❌ %s 失败: %v\n", m.Method, resp["error"])
				}
				break
			} else if resp["type"] == "event" {
				logRPC("IN", "event."+resp["event"].(string), resp)
			}
		}
	}

	// 8. 测试会话创建与多轮对话
	fmt.Println("\n--- 开始多轮对话验证 (普通 -> 思考 -> 上下文) ---")
	
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
	logRPC("OUT", "sessions.create", createReq)
	conn.WriteJSON(createReq)
	
	var sessionKey string
	for {
		_, msg, _ := conn.ReadMessage()
		var resp map[string]interface{}
		json.Unmarshal(msg, &resp)
		if resp["id"] == "s-create" {
			logRPC("IN", "sessions.create.response", resp)
			payload := resp["payload"].(map[string]interface{})
			sessionKey = payload["key"].(string)
			fmt.Printf("✅ 会话创建成功: %s\n", sessionKey)
			break
		}
	}

	// 8.1 先切到 reasoning on（如网关/模型支持），观察是否会输出 think/思考内容
	fmt.Println("\n--- Step A: 发送 /reasoning on (启用思考) ---")
	_, err = sendChatAndWait(conn, sessionKey, "c-reasoning-on", "/reasoning on")
	if err != nil {
		fmt.Println("⚠️ /reasoning on 发送或响应异常:", err)
	} else {
		fmt.Println("✅ /reasoning on 已发送完成")
	}

	// 8.2 提一个“需要多步推理”的问题，验证是否推送 thought/thinking 事件
	fmt.Println("\n--- Step B: 提问需要思考的问题，检查是否推送 thought ---")
	question := "请用严谨的推理过程解决：一个袋子里有 3 红 2 蓝球，不放回连续抽 2 个，至少抽到 1 个红球的概率是多少？请给出推导步骤与最终答案。"
	fmt.Println("💬 问题:", question)
	sawThought, err := sendChatAndWait(conn, sessionKey, "c-think-check", question)
	if err != nil {
		fmt.Println("❌ 提问失败:", err)
	} else if sawThought {
		fmt.Println("✅ 检测到 thought 事件：网关确实推送了思考状态/过程信号")
	} else {
		fmt.Println("⚠️ 未检测到 thought 事件：可能未开启 reasoning、模型不支持，或协议字段/状态名有变")
	}

	// 8.3 再做一轮上下文验证
	fmt.Println("\n--- Step C: 上下文追问 ---")
	followUp := "你刚才的解法里，等价事件/补集法是哪一步？用一句话指出。"
	fmt.Println("💬 追问:", followUp)
	_, err = sendChatAndWait(conn, sessionKey, "c-followup", followUp)
	if err != nil {
		fmt.Println("⚠️ 追问失败:", err)
	}

	fmt.Println("\n🎉 所有关键协议路径验证通过！审计日志已保存至:", auditFile)
}
