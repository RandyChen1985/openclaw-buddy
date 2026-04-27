//go:build manual

// 手动验证 chat 流式协议中与「完成」相关的语义（对齐 docs/md/openclaw-websocket-protocol.md）：
//
// 与部分 OpenClaw 发行版里「block / tool / kind」拆帧的说明对照：本仓库 WebSocket 文档约定的是
// event=chat 下 payload.state=delta|final|…，delta 里常带累计正文；工具进度还可能在 event=agent。
// 因此不要用「仅当 final 且 message 为 string 才算结束」这类与本文档不一致的判别式；以 state=final 为主，
// 并观察 final 上 message 的实际 JSON 形态（多为 assistant 对象）。
//
//   1) 同一 chat.send 的 runId 下，会出现若干 state=delta，随后出现 state=final（或 error/aborted）。
//   2) final 上的 message 为可选：记录其 JSON 形态（缺失 / object / string 等）。
//   3) 收到首个同 runId 的 final 后，在短窗口内继续读帧：若仍出现同 runId 的 delta，打印告警（Buddy 前端以 agent lifecycle.end 为主结束生成态，此处仍观测尾包 delta）。
//
// 可调环境变量（尽量触发「thought 事件」或「final 后仍来 delta」等边界）：
//   CHAT_FINAL_SEM_PROFILE=stress|weather|longlist — stress 默认（多步检索）；weather 单句天气；
//       longlist 长列表输出，易拉高 delta 次数（对照「超长输出分块」类场景；网关仍可能只发 delta/final）。
//   CHAT_FINAL_SEM_USER_MESSAGE=...         — 若设置则覆盖 profile 默认文案。
//   CHAT_FINAL_SEM_THINKING_LEVEL=high      — 会话 thinkingLevel（默认 high；不支持时会自动尝试 xhigh→…→minimal；off 跳过 patch）。
//   CHAT_FINAL_SEM_POST_FINAL_DRAIN_MS=3000 — final 后额外观察窗口毫秒数（默认 3000）。
//
// 运行前请启动 Gateway。Token 优先级：
//   1) 环境变量 OPENCLAW_GATEWAY_TOKEN
//   2) 读取 $OPENCLAW_CONFIG_DIR/openclaw.json（未设置时默认 ~/.openclaw/openclaw.json）的 gateway.auth.token
//
// 可选：OPENCLAW_GATEWAY_URL（默认 ws://127.0.0.1:18789/v1/gateway）
//
//	go run -tags manual ./tests/manual/test_chat_final_semantics.go
//
// 注意：会创建临时会话、patch 思考等级、发送偏复杂问题（易多轮工具 + 长流式），结束后删除会话。

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
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

func base64URLNoPadding(data []byte) string {
	return strings.TrimRight(base64.URLEncoding.EncodeToString(data), "=")
}

// defaultStressChatUserMessage：多子任务 + 显式要「检索/依据」，拉长工具链与流式，便于出现 thought 与多段 delta。
const defaultStressChatUserMessage = `请按顺序完成下面任务（允许使用联网检索工具），并在正文里简要写出每步依据（标题或站点名即可，无需编造链接）：

1）检索「上海」最近一个自然周（7 天）的总体天气：晴雨比例、最高气温与最低气温的大致区间；
2）再检索同一时段是否出现过气象预警（如暴雨、大风、高温、雷电等），若有请概括类型与大致日期；
3）最后给出 4～6 条给本地居民的生活建议（穿衣、出行、健康风险提示等）。

要求：三个小节都要有内容，不要只给一句话结论。`

// defaultWeatherChatUserMessage：单句天气，作为对照 profile。
const defaultWeatherChatUserMessage = "看看上海最近一周的天气情况"

// defaultLongListChatUserMessage：偏长答案请求，便于出现大量 delta（服务端若做分块，对本协议仍多表现为多次 delta）。
const defaultLongListChatUserMessage = `请用中文编号列表输出「至少 70 条」常用 Linux/Unix shell 命令，每条格式为：
「序号. 命令 — 不超过 18 字的简要说明」。
不要中途省略为「其余略」；若篇幅仍不足，可降低到 50 条但必须真实常用命令。`

func loadGatewayToken() string {
	if t := strings.TrimSpace(os.Getenv("OPENCLAW_GATEWAY_TOKEN")); t != "" {
		return t
	}
	configDir := strings.TrimSpace(os.Getenv("OPENCLAW_CONFIG_DIR"))
	if configDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		configDir = filepath.Join(home, ".openclaw")
	}
	data, err := os.ReadFile(filepath.Join(configDir, "openclaw.json"))
	if err != nil {
		return ""
	}
	var cfg struct {
		Gateway struct {
			Auth struct {
				Token string `json:"token"`
			} `json:"auth"`
		} `json:"gateway"`
	}
	if json.Unmarshal(data, &cfg) != nil {
		return ""
	}
	return strings.TrimSpace(cfg.Gateway.Auth.Token)
}

func parseDurationMsEnv(key string, def time.Duration) time.Duration {
	s := strings.TrimSpace(os.Getenv(key))
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 0 {
		return def
	}
	return time.Duration(n) * time.Millisecond
}

func main() {
	token := loadGatewayToken()
	if token == "" {
		log.Fatal("未找到网关 token：请设置 OPENCLAW_GATEWAY_TOKEN，或配置 ~/.openclaw/openclaw.json 中 gateway.auth.token")
	}
	url := os.Getenv("OPENCLAW_GATEWAY_URL")
	if url == "" {
		url = "ws://127.0.0.1:18789/v1/gateway"
	}

	pubKey, privKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		log.Fatal(err)
	}
	hash := sha256.Sum256(pubKey)
	deviceID := fmt.Sprintf("%x", hash)

	header := http.Header{}
	header.Add("Origin", "http://127.0.0.1:18789")
	conn, _, err := websocket.DefaultDialer.Dial(url, header)
	if err != nil {
		log.Fatal("连接失败（请确认 Gateway 已启动）:", err)
	}
	defer conn.Close()

	var challengeNonce string
	for {
		_, msg, rerr := conn.ReadMessage()
		if rerr != nil {
			log.Fatal("读 challenge 失败:", rerr)
		}
		var m map[string]interface{}
		if json.Unmarshal(msg, &m) != nil {
			continue
		}
		if m["event"] == "connect.challenge" {
			p, _ := m["payload"].(map[string]interface{})
			challengeNonce, _ = p["nonce"].(string)
			break
		}
	}

	signedAt := time.Now().UnixMilli()
	clientID := "openclaw-control-ui"
	scopes := "operator.admin,operator.read,operator.write"
	payloadStr := fmt.Sprintf("v3|%s|%s|cli|operator|%s|%d|%s|%s|macos|",
		deviceID, clientID, scopes, signedAt, token, challengeNonce)
	signature := ed25519.Sign(privKey, []byte(payloadStr))

	connectReq := map[string]interface{}{
		"type":   "req",
		"id":     "auth-1",
		"method": "connect",
		"params": map[string]interface{}{
			"minProtocol": 3,
			"maxProtocol": 3,
			"client": map[string]interface{}{
				"id":       clientID,
				"version":  "2026.4.2",
				"platform": "macos",
				"mode":     "cli",
			},
			"role":   "operator",
			"scopes": strings.Split(scopes, ","),
			"auth":   map[string]interface{}{"token": token},
			"device": map[string]interface{}{
				"id":        deviceID,
				"publicKey": base64URLNoPadding(pubKey),
				"signature": base64URLNoPadding(signature),
				"signedAt":  signedAt,
				"nonce":     challengeNonce,
			},
		},
	}
	if err := conn.WriteJSON(connectReq); err != nil {
		log.Fatal(err)
	}

	for {
		_, msg, rerr := conn.ReadMessage()
		if rerr != nil {
			log.Fatal(rerr)
		}
		var resp map[string]interface{}
		if json.Unmarshal(msg, &resp) != nil {
			continue
		}
		if resp["type"] == "res" && resp["id"] == "auth-1" {
			if resp["ok"] != true {
				log.Fatal("握手失败:", string(msg))
			}
			fmt.Println("✅ 鉴权通过")
			break
		}
	}

	// 临时会话
	sessionKey := createSession(conn)
	defer deleteSession(conn, sessionKey)

	thinkingLevel := strings.TrimSpace(os.Getenv("CHAT_FINAL_SEM_THINKING_LEVEL"))
	if thinkingLevel == "" {
		thinkingLevel = "high"
	}
	applyThinkingLevelBestEffort(conn, sessionKey, thinkingLevel)

	const chatReqID = "c-final-sem"
	userMsg := strings.TrimSpace(os.Getenv("CHAT_FINAL_SEM_USER_MESSAGE"))
	if userMsg == "" {
		switch strings.ToLower(strings.TrimSpace(os.Getenv("CHAT_FINAL_SEM_PROFILE"))) {
		case "weather", "simple":
			userMsg = defaultWeatherChatUserMessage
		case "longlist", "long", "chunk":
			userMsg = defaultLongListChatUserMessage
		case "stress", "", "default":
			userMsg = defaultStressChatUserMessage
		default:
			log.Fatalf("未知 CHAT_FINAL_SEM_PROFILE，请使用 stress|weather|simple|longlist 或留空（默认 stress）")
		}
	}
	postFinalDrain := parseDurationMsEnv("CHAT_FINAL_SEM_POST_FINAL_DRAIN_MS", 3000*time.Millisecond)
	fmt.Printf("📝 用户问题: %q\n", userMsg)
	fmt.Printf("⏱️  final 后观察窗口: %v（CHAT_FINAL_SEM_POST_FINAL_DRAIN_MS）\n", postFinalDrain)
	sendChat(conn, chatReqID, sessionKey, userMsg, fmt.Sprintf("final-sem-%d", time.Now().UnixNano()))

	var runID string
	var sawSendOK bool
	deltaCount := 0
	finalCount := 0
	var finalMessageKinds []string
	var statesTrail []string
	stateHistogram := make(map[string]int)

	// 天气 + 工具链可能较慢，整体等待放宽
	deadline := time.Now().Add(15 * time.Minute)
	var firstFinalAt time.Time
	postFinalDelta := 0
	postFinalExtraFinal := 0
	drainDone := false

	for time.Now().Before(deadline) {
		_ = conn.SetReadDeadline(time.Now().Add(6 * time.Minute))
		_, msg, rerr := conn.ReadMessage()
		if rerr != nil {
			log.Fatal("读消息失败:", rerr)
		}

		var root map[string]interface{}
		if json.Unmarshal(msg, &root) != nil {
			continue
		}

		if root["type"] == "res" && root["id"] == chatReqID {
			if root["ok"] != true {
				log.Fatalf("chat.send 失败: %v\n%s", root["error"], string(msg))
			}
			sawSendOK = true
			if p, ok := root["payload"].(map[string]interface{}); ok {
				if rid, ok := p["runId"].(string); ok && rid != "" {
					runID = rid
				}
			}
			continue
		}

		if root["type"] != "event" || root["event"] != "chat" {
			continue
		}

		payload, _ := root["payload"].(map[string]interface{})
		if sk, ok := payload["sessionKey"].(string); ok && sk != sessionKey {
			continue
		}
		state, _ := payload["state"].(string)
		rid, _ := payload["runId"].(string)
		if runID == "" && rid != "" {
			runID = rid
		}
		if runID != "" && rid != runID {
			continue
		}

		stateHistogram[state]++
		if len(statesTrail) < 48 {
			statesTrail = append(statesTrail, state)
		}

		switch state {
		case "delta":
			if !firstFinalAt.IsZero() {
				postFinalDelta++
			} else {
				deltaCount++
			}
		case "final", "finished", "done":
			if !firstFinalAt.IsZero() {
				postFinalExtraFinal++
				break
			}
			firstFinalAt = time.Now()
			finalCount++
			finalMessageKinds = append(finalMessageKinds, describeMessageField(payload["message"]))
		case "error", "failed":
			log.Fatalf("收到错误终态 state=%s payload=%s", state, string(mustJSON(payload)))
		case "aborted":
			log.Fatal("收到 aborted，本次用例未主动中止")
		default:
			// thought / thinking 等：仅体现在 statesTrail，不中断
		}

		if state == "final" || state == "finished" || state == "done" {
			// 收到首个 final 后短窗口排空，观察是否还有同 runId 的 delta
			if !drainDone && finalCount == 1 {
				drainPostFinal(conn, sessionKey, runID, postFinalDrain, &postFinalDelta, &postFinalExtraFinal)
				drainDone = true
			}
			goto doneLoop
		}
	}

doneLoop:
	// 事件可能先于 chat.send 的同步 res 到达，这里补齐等待
	if !sawSendOK {
		fmt.Println("⏳ 尚未收到 chat.send 同步响应，继续等待 res…")
		waitUntil := time.Now().Add(20 * time.Second)
		for time.Now().Before(waitUntil) {
			_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
			_, msg, rerr := conn.ReadMessage()
			if rerr != nil {
				break
			}
			var root map[string]interface{}
			if json.Unmarshal(msg, &root) != nil {
				continue
			}
			if root["type"] == "res" && root["id"] == chatReqID {
				if root["ok"] != true {
					log.Fatalf("chat.send 失败: %v\n%s", root["error"], string(msg))
				}
				sawSendOK = true
				if runID == "" {
					if p, ok := root["payload"].(map[string]interface{}); ok {
						if rid, ok := p["runId"].(string); ok {
							runID = rid
						}
					}
				}
				break
			}
		}
	}
	if !sawSendOK {
		log.Fatal("未收到 chat.send 的同步 res(ok)")
	}
	if runID == "" {
		log.Fatal("未能解析 runId")
	}
	if finalCount == 0 {
		log.Fatal("在超时内未收到 state=final（或 finished/done）")
	}

	fmt.Println("\n─── 统计结果 ───")
	fmt.Printf("runId:              %s\n", runID)
	fmt.Printf("delta 条数:         %d\n", deltaCount)
	fmt.Printf("final 条数:         %d\n", finalCount)
	fmt.Printf("final.message 形态: %v  （每项对应一次 final 事件；协议上 message 可选）\n", finalMessageKinds)
	fmt.Printf("前 48 个 state 序列: %v\n", statesTrail)
	keys := make([]string, 0, len(stateHistogram))
	for k := range stateHistogram {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	fmt.Println("chat 事件 state 计数（整轮，同 sessionKey+runId）：")
	for _, k := range keys {
		fmt.Printf("  %-14s %d\n", k, stateHistogram[k])
	}
	thN := stateHistogram["thought"] + stateHistogram["thinking"]
	if thN > 0 {
		fmt.Printf("✅ 观测到思考类 state（thought/thinking）合计 %d 次\n", thN)
	} else {
		fmt.Println("ℹ️  本轮未在 chat 事件里观测到 thought/thinking（与模型/网关实现有关，可换模型或提高 thinkingLevel 再试）")
	}
	if postFinalDelta > 0 {
		fmt.Printf("⚠️  首个 final 之后的短窗口内仍收到同 runId 的 delta 共 %d 条（若实现「绝不再发」则不应出现）\n", postFinalDelta)
	} else {
		fmt.Println("✅ 首个 final 后短窗口内未见同 runId 的尾随 delta")
	}
	if postFinalExtraFinal > 0 {
		fmt.Printf("ℹ️  首个 final 后还收到同 runId 的额外 final 共 %d 条\n", postFinalExtraFinal)
	}
	fmt.Println("\n结论（本仓库协议）：以 payload.state ∈ {final,finished,done} 作为一轮流结束信号；勿仅凭 message 是否为 string 判断（本网关常见为 assistant 对象）。")
	fmt.Println("🎉 测试完成")
}

func drainPostFinal(conn *websocket.Conn, sessionKey, runID string, d time.Duration, postDelta, postFinal *int) {
	end := time.Now().Add(d)
	for time.Now().Before(end) {
		_ = conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var root map[string]interface{}
		if json.Unmarshal(msg, &root) != nil {
			continue
		}
		if root["type"] != "event" || root["event"] != "chat" {
			continue
		}
		payload, _ := root["payload"].(map[string]interface{})
		if sk, ok := payload["sessionKey"].(string); ok && sk != sessionKey {
			continue
		}
		rid, _ := payload["runId"].(string)
		if rid != runID {
			continue
		}
		state, _ := payload["state"].(string)
		switch state {
		case "delta":
			*postDelta++
		case "final", "finished", "done":
			*postFinal++
		}
	}
}

func describeMessageField(v interface{}) string {
	if v == nil {
		return "null"
	}
	switch v.(type) {
	case string:
		return "string"
	case map[string]interface{}:
		return "object"
	case []interface{}:
		return "array"
	default:
		return fmt.Sprintf("%T", v)
	}
}

// applyThinkingLevelBestEffort 先尝试用户期望的等级，失败则按梯度降级，避免部分模型不支持 xhigh 时直接中断。
func applyThinkingLevelBestEffort(conn *websocket.Conn, sessionKey, preferredRaw string) {
	if strings.EqualFold(strings.TrimSpace(preferredRaw), "off") {
		fmt.Println("🔧 跳过 sessions.patch（CHAT_FINAL_SEM_THINKING_LEVEL=off）")
		return
	}
	preferred := strings.TrimSpace(preferredRaw)
	if preferred == "" {
		preferred = "high"
	}
	seen := make(map[string]bool)
	var order []string
	add := func(level string) {
		level = strings.TrimSpace(strings.ToLower(level))
		if level == "" || level == "off" || seen[level] {
			return
		}
		seen[level] = true
		order = append(order, level)
	}
	add(preferred)
	for _, fb := range []string{"xhigh", "high", "medium", "low", "minimal"} {
		if !strings.EqualFold(fb, preferred) {
			add(fb)
		}
	}
	for i, lv := range order {
		reqID := fmt.Sprintf("s-patch-fs-%d-%d", i, time.Now().UnixNano())
		err := patchSession(conn, reqID, sessionKey, map[string]interface{}{"thinkingLevel": lv})
		if err == nil {
			if !strings.EqualFold(lv, preferred) {
				fmt.Printf("🔧 已 sessions.patch thinkingLevel=%q（首选 %q 不可用，已自动降级）\n", lv, preferred)
			} else {
				fmt.Printf("🔧 已 sessions.patch thinkingLevel=%q\n", lv)
			}
			return
		}
		fmt.Printf("⚠️  thinkingLevel=%q 未生效: %v\n", lv, err)
	}
	fmt.Println("⚠️  未能 patch 任意 thinkingLevel，将以网关默认策略继续")
}

func patchSession(conn *websocket.Conn, reqID, sessionKey string, fields map[string]interface{}) error {
	params := map[string]interface{}{"key": sessionKey}
	for k, v := range fields {
		params[k] = v
	}
	req := map[string]interface{}{
		"type":   "req",
		"id":     reqID,
		"method": "sessions.patch",
		"params": params,
	}
	if err := conn.WriteJSON(req); err != nil {
		return err
	}
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		var resp map[string]interface{}
		if json.Unmarshal(msg, &resp) != nil {
			continue
		}
		if resp["type"] == "res" && resp["id"] == reqID {
			if resp["ok"] != true {
				return fmt.Errorf("%s", string(msg))
			}
			return nil
		}
	}
}

func createSession(conn *websocket.Conn) string {
	req := map[string]interface{}{
		"type":   "req",
		"id":     "s-create-final-sem",
		"method": "sessions.create",
		"params": map[string]interface{}{
			"agentId": "main",
			"label":   "final-sem-" + time.Now().Format("15:04:05"),
		},
	}
	_ = conn.WriteJSON(req)
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Fatal(err)
		}
		var resp map[string]interface{}
		if json.Unmarshal(msg, &resp) != nil {
			continue
		}
		if resp["type"] == "res" && resp["id"] == "s-create-final-sem" {
			if resp["ok"] != true {
				log.Fatal("sessions.create 失败:", string(msg))
			}
			p := resp["payload"].(map[string]interface{})
			return p["key"].(string)
		}
	}
}

func deleteSession(conn *websocket.Conn, key string) {
	req := map[string]interface{}{
		"type":   "req",
		"id":     "s-del-final-sem",
		"method": "sessions.delete",
		"params": map[string]interface{}{"key": key},
	}
	_ = conn.WriteJSON(req)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var resp map[string]interface{}
		if json.Unmarshal(msg, &resp) != nil {
			continue
		}
		if resp["type"] == "res" && resp["id"] == "s-del-final-sem" {
			return
		}
	}
}

func sendChat(conn *websocket.Conn, id, sessionKey, message, idempotencyKey string) {
	req := map[string]interface{}{
		"type":   "req",
		"id":     id,
		"method": "chat.send",
		"params": map[string]interface{}{
			"sessionKey":     sessionKey,
			"message":        message,
			"idempotencyKey": idempotencyKey,
		},
	}
	_ = conn.WriteJSON(req)
	fmt.Println("📤 已发送 chat.send，等待事件…")
}

func mustJSON(v interface{}) []byte {
	b, _ := json.Marshal(v)
	return b
}
