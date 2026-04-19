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
	// --- 1. 环境准备 ---
	url := "ws://127.0.0.1:18789/v1/gateway"
	token := "71937201d0ba32c6c14047dd15487a0cbf0cd1f3a05e07f8" 

	pubKey, privKey, _ := ed25519.GenerateKey(rand.Reader)
	hash := sha256.Sum256(pubKey)
	deviceId := fmt.Sprintf("%x", hash)

	header := http.Header{}
	header.Add("Origin", "http://127.0.0.1:18789")
	conn, _, err := websocket.DefaultDialer.Dial(url, header)
	if err != nil {
		log.Fatal("❌ 物理连接失败 (请确保 Gateway 已启动):", err)
	}
	defer conn.Close()

	// --- 2. 握手鉴权 (V3 Challenge-Response) ---
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
	
	// 精确匹配网关 V3 签名逻辑 (参考 test_websocket_full.go):
	// v3|{deviceId}|{clientId}|{clientMode}|{role}|{scopes}|{signedAtMs}|{token}|{nonce}|{platform}|{deviceFamily}
	clientId := "openclaw-control-ui"
	clientMode := "cli"
	role := "operator"
	scopes := "operator.admin,operator.read,operator.write"
	platform := "macos"
	deviceFamily := "" // 留空
	
	// 注意末尾的管道符表示空 deviceFamily
	payloadStr := fmt.Sprintf("v3|%s|%s|%s|%s|%s|%d|%s|%s|%s|%s",
		deviceId, clientId, clientMode, role, scopes, signedAt, token, challengeNonce, platform, deviceFamily)
	
	signature := ed25519.Sign(privKey, []byte(payloadStr))

	fmt.Println("🔑 发起 V3 握手认证 (ClientID: openclaw-control-ui, Role: operator)...")
	sendRequest(conn, "auth", "connect", map[string]interface{}{
		"minProtocol": 3,
		"maxProtocol": 3,
		"role": role,
		"scopes": strings.Split(scopes, ","),
		"auth": map[string]interface{}{
			"token": token,
		},
		"client": map[string]interface{}{
			"id": clientId,
			"mode": clientMode,
			"platform": platform,
			// "deviceFamily" 留空会导致校验失败，故省略
			"version": "1.0.3",
		},
		"device": map[string]interface{}{
			"id": deviceId,
			"publicKey": base64URLNoPadding(pubKey),
			"signature": base64URLNoPadding(signature),
			"signedAt": signedAt,
			"nonce": challengeNonce,
		},
	})
	readResponse(conn, "auth")
	fmt.Println("✅ 鉴权通过")

	// --- 3. 基础发现方法测试 ---
	fmt.Println("\n🔍 测试: models.list")
	sendRequest(conn, "mod-l", "models.list", nil)
	readResponse(conn, "mod-l")

	fmt.Println("\n🔍 测试: skills.status")
	sendRequest(conn, "ski-s", "skills.status", nil)
	readResponse(conn, "ski-s")

	fmt.Println("\n🔍 测试: cron.list")
	sendRequest(conn, "cro-l", "cron.list", map[string]interface{}{"includeDisabled": true})
	readResponse(conn, "cro-l")

	fmt.Println("\n🔍 测试: node.list")
	sendRequest(conn, "nod-l", "node.list", nil)
	readResponse(conn, "nod-l")

	// --- 4. 核心增删改查测试 ---
	tempAgentID := "" // 将由创建响应填充
	fmt.Println("\n🚀 测试: agents.create")
	resp_ag := sendRequestAndRead(conn, "ag-c", "agents.create", map[string]interface{}{
		"name":      "protocol-expert", // 使用英文名避免 ID 冲突
		"workspace": "/Users/chenxiaolong/资料/有孚网络/1云枢中台/openclaw-buddy/temp-test-ws",
	})
	var agPayload struct{ AgentId string }
	json.Unmarshal(resp_ag.Payload, &agPayload)
	tempAgentID = agPayload.AgentId
	fmt.Printf("   -> 创建成功, AgentID: %s\n", tempAgentID)

	fmt.Println("\n🚀 测试: agents.files.set")
	sendRequest(conn, "ag-f-s", "agents.files.set", map[string]interface{}{
		"agentId": tempAgentID,
		"name":    "SOUL.md",
		"content": "Protocol consistency test content.",
	})
	readResponse(conn, "ag-f-s")

	fmt.Println("\n🚀 测试: sessions.create")
	sendRequest(conn, "s-c", "sessions.create", map[string]interface{}{
		"agentId": tempAgentID,
	})
	resp := readResponse(conn, "s-c")
	var sPayload struct{ Key string }
	json.Unmarshal(resp.Payload, &sPayload)
	sessKey := sPayload.Key

	fmt.Println("\n🚀 测试: sessions.patch")
	sendRequest(conn, "s-p", "sessions.patch", map[string]interface{}{
		"key": sessKey,
		"thinkingLevel": "high",
	})
	readResponse(conn, "s-p")

	// --- 5. 清理 ---
	fmt.Println("\n🧹 测试: sessions.delete")
	sendRequest(conn, "s-d", "sessions.delete", map[string]interface{}{"key": sessKey})
	readResponse(conn, "s-d")

	fmt.Println("\n🧹 测试: agents.delete")
	sendRequest(conn, "ag-d", "agents.delete", map[string]interface{}{"agentId": tempAgentID})
	readResponse(conn, "ag-d")

	fmt.Println("\n🎉 全量协议一致性验证通过！")
}

func sendRequestAndRead(c *websocket.Conn, id, method string, params interface{}) Frame {
	sendRequest(c, id, method, params)
	return readResponse(c, id)
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
				fmt.Printf("❌ [%s] 失败!\n", expectedID)
				fmt.Printf("   Error: %v\n", f.Error)
				fmt.Printf("   Payload: %s\n", string(f.Payload))
				log.Fatal("Test failed")
			}
			fmt.Printf("   -> [%s] 响应正常\n", expectedID)
			return f
		}
	}
}
