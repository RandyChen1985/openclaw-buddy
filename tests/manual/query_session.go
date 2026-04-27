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

// ============================================================
// 配置区 - 根据实际情况修改
// ============================================================
const (
	gatewayURL = "ws://127.0.0.1:18789/v1/gateway"
	gatewayToken = "71937201d0ba32c6c14047dd15487a0cbf0cd1f3a05e07f8"
	clientID         = "openclaw-control-ui" // 网关允许的客户端 ID
	targetSessionKey = "agent:main:dashboard:abb6ee52-3716-4bde-b2a2-ea5180390a05"
	historyLimit     = 200 // 拉取最近 N 条消息
	outputFile       = "session_dump.json" // 输出到当前目录
)

// ============================================================

func base64URLNoPadding(data []byte) string {
	return strings.TrimRight(base64.URLEncoding.EncodeToString(data), "=")
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
		deviceId, clientID, scopes, signedAt, gatewayToken, challengeNonce)
	signature := ed25519.Sign(privKey, []byte(payloadStr))

	authResp := sendAndWait(conn, map[string]interface{}{
		"type":   "req",
		"id":     "auth-1",
		"method": "connect",
		"params": map[string]interface{}{
			"minProtocol": 3,
			"maxProtocol": 3,
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

		// 顺便打印消息条数
		if payload, ok := histResp["payload"].(map[string]interface{}); ok {
			msgs := payload["messages"]
			if msgs == nil {
				msgs = payload["items"]
			}
			if list, ok := msgs.([]interface{}); ok {
				fmt.Printf("📨 共 %d 条消息\n", len(list))
			}
		}
	}

	fmt.Println("\n✅ 查询完成")
}
