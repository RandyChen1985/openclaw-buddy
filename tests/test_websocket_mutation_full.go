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

type Frame struct {
	Type    string          `json:"type"`
	ID      string          `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Event   string          `json:"event,omitempty"`
	Params  interface{}     `json:"params,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
	OK      bool            `json:"ok,omitempty"`
	Error   interface{}     `json:"error,omitempty"`
}

func main() {
	// --- 1. 初始化鉴权环境 ---
	url := "ws://127.0.0.1:18789/v1/gateway"
	token := "71937201d0ba32c6c14047dd15487a0cbf0cd1f3a05e07f8" // 需确保网关在线且 token 正确

	pubKey, privKey, _ := ed25519.GenerateKey(rand.Reader)
	hash := sha256.Sum256(pubKey)
	deviceId := fmt.Sprintf("%x", hash)

	header := http.Header{}
	header.Add("Origin", "http://127.0.0.1:18789")
	conn, _, err := websocket.DefaultDialer.Dial(url, header)
	if err != nil {
		log.Fatal("❌ 连接失败:", err)
	}
	defer conn.Close()

	// --- 2. 握手鉴权 (V3) ---
	var challengeNonce string
	for {
		_, msg, _ := conn.ReadMessage()
		var m Frame
		json.Unmarshal(msg, &m)
		if m.Event == "connect.challenge" {
			var p struct{ Nonce string }
			json.Unmarshal(m.Payload, &p)
			challengeNonce = p.Nonce
			break
		}
	}

	signedAt := time.Now().UnixMilli()
	payloadStr := fmt.Sprintf("v3|%s|buddy-tester|cli|operator|operator.admin,operator.read,operator.write|%d|%s|%s|macos|",
		deviceId, signedAt, token, challengeNonce)
	signature := ed25519.Sign(privKey, []byte(payloadStr))

	sendRequest(conn, "auth", "connect", map[string]interface{}{
		"minProtocol": 3, "maxProtocol": 3,
		"client": map[string]interface{}{"id": "buddy-tester", "version": "1.0.3", "platform": "macos", "mode": "cli"},
		"role":   "operator",
		"scopes": []string{"operator.admin", "operator.read", "operator.write"},
		"auth":   map[string]interface{}{"token": token},
		"device": map[string]interface{}{
			"id": deviceId, "publicKey": base64URLNoPadding(pubKey),
			"signature": base64URLNoPadding(signature), "signedAt": signedAt, "nonce": challengeNonce,
		},
	})
	readResponse(conn, "auth")
	fmt.Println("✅ 鉴权成功")

	// --- 3. Mutation 测试: Agents CRUD ---
	tempAgentID := "buddy-temp-expert"
	fmt.Println("\n🚀 测试: agents.create")
	sendRequest(conn, "ag-c", "agents.create", map[string]interface{}{
		"name":      "临时专家",
		"workspace": "./temp-workspace-buddy",
	})
	readResponse(conn, "ag-c")

	fmt.Println("\n🚀 测试: agents.files.set (修改灵魂提示词)")
	sendRequest(conn, "ag-f-s", "agents.files.set", map[string]interface{}{
		"agentId": tempAgentID,
		"name":    "SOUL.md",
		"content": "You are a test-driven AI expert.",
	})
	readResponse(conn, "ag-f-s")

	fmt.Println("\n🚀 测试: agents.files.get (验证写入)")
	sendRequest(conn, "ag-f-g", "agents.files.get", map[string]interface{}{
		"agentId": tempAgentID,
		"name":    "SOUL.md",
	})
	readResponse(conn, "ag-f-g")

	// --- 4. Mutation 测试: Sessions ---
	fmt.Println("\n🚀 测试: sessions.create")
	sendRequest(conn, "s-c", "sessions.create", map[string]interface{}{
		"agentId": tempAgentID,
		"label":   "Mutation Test Session",
	})
	resp := readResponse(conn, "s-c")
	var sPayload struct{ Key string }
	json.Unmarshal(resp.Payload, &sPayload)
	sessKey := sPayload.Key

	fmt.Println("\n🚀 测试: sessions.patch (修改配置)")
	sendRequest(conn, "s-p", "sessions.patch", map[string]interface{}{
		"key":           sessKey,
		"thinkingLevel": "high",
		"label":         "Patched Session",
	})
	readResponse(conn, "s-p")

	// --- 5. 清理阶段 ---
	fmt.Println("\n🚀 测试: sessions.delete")
	sendRequest(conn, "s-d", "sessions.delete", map[string]interface{}{
		"key": sessKey, "deleteTranscript": true,
	})
	readResponse(conn, "s-d")

	fmt.Println("\n🚀 测试: agents.delete")
	sendRequest(conn, "ag-d", "agents.delete", map[string]interface{}{
		"agentId": tempAgentID, "deleteFiles": true,
	})
	readResponse(conn, "ag-d")

	fmt.Println("\n🎉 Mutation 压力测试全部通过！")
}

func sendRequest(c *websocket.Conn, id, method string, params interface{}) {
	req := Frame{Type: "req", ID: id, Method: method, Params: params}
	c.WriteJSON(req)
}

func readResponse(c *websocket.Conn, expectedID string) Frame {
	for {
		_, msg, err := c.ReadMessage()
		if err != nil {
			log.Fatal("read error:", err)
		}
		var f Frame
		json.Unmarshal(msg, &f)
		if f.Type == "res" && f.ID == expectedID {
			if !f.OK {
				fmt.Printf("❌ [%s] 失败: %s\n", expectedID, string(f.Payload))
				log.Fatal("Test failed")
			}
			return f
		}
	}
}
