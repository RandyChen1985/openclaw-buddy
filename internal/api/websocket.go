package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/hpcloud/tail"
	"openclaw-buddy/internal/process"
)

var (
	clients   = make(map[*websocket.Conn]bool)
	clientsMu sync.RWMutex
)

func (s *Server) wsUpgrader() websocket.Upgrader {
	return websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return s.isOriginAllowed(r, r.Header.Get("Origin"))
		},
	}
}

func (s *Server) StartWebSocketBroadcaster() {
	log.Println("📡 [WS] WebSocket broadcaster started.")
	for task := range process.TaskUpdateChan {
		msg, _ := json.Marshal(map[string]interface{}{
			"type": "TASK_UPDATE",
			"data": task,
		})

		clientsMu.RLock()
		activeClients := make([]*websocket.Conn, 0, len(clients))
		for conn := range clients {
			activeClients = append(activeClients, conn)
		}
		clientsMu.RUnlock()

		for _, conn := range activeClients {
			_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			err := conn.WriteMessage(websocket.TextMessage, msg)
			if err != nil {
				log.Printf("⚠️ [WS] Failed to send task update, connection might be closed.")
			}
		}
	}
}

func (s *Server) streamLogs(c *gin.Context) {
	upgrader := s.wsUpgrader()
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("❌ [WS] Upgrade failed: %v", err)
		return
	}

	clientsMu.Lock()
	clients[conn] = true
	clientsMu.Unlock()

	defer func() {
		clientsMu.Lock()
		delete(clients, conn)
		clientsMu.Unlock()
		conn.Close()
		log.Printf("🔌 [WS] Client disconnected.")
	}()

	source := c.DefaultQuery("source", "buddy")
	stopChan := make(chan bool)
	var once sync.Once
	stop := func() {
		once.Do(func() {
			close(stopChan)
		})
	}

	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				stop()
				return
			}
		}
	}()

	if source == "gateway" {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		log.Printf("📡 [WS] Starting gateway log streaming...")
		cmd := exec.CommandContext(ctx, "openclaw", "logs", "--follow")
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

		stdout, err := cmd.StdoutPipe()
		if err != nil {
			return
		}
		cmd.Stderr = cmd.Stdout

		if err := cmd.Start(); err != nil {
			return
		}

		go func() {
			scanner := bufio.NewScanner(stdout)
			for scanner.Scan() {
				msg := scanner.Text()
				if err := conn.WriteMessage(websocket.TextMessage, []byte(msg)); err != nil {
					stop()
					return
				}
			}
		}()

		<-stopChan
		pgid, err := syscall.Getpgid(cmd.Process.Pid)
		if err == nil {
			syscall.Kill(-pgid, syscall.SIGKILL)
		}
		_ = cmd.Wait()
		return
	}

	// Buddy：先推送文件末尾若干行历史，再 tail 仅跟新追加内容（见 query history_lines）
	historyLines := 500
	if q := strings.TrimSpace(c.Query("history_lines")); q != "" {
		if v, err := strconv.Atoi(q); err == nil {
			if v < 0 {
				v = 0
			}
			if v > 5000 {
				v = 5000
			}
			historyLines = v
		}
	}
	const maxBuddyHistoryScan = int64(4 << 20)
	if historyLines > 0 {
		lines, err := readLastLines(s.cfg.LogFile, historyLines, maxBuddyHistoryScan)
		if err != nil {
			log.Printf("⚠️ [WS] Buddy log history: %v", err)
		}
		if lines == nil {
			lines = []string{}
		}
		payload, err := json.Marshal(map[string]interface{}{
			"type":  "LOG_HISTORY",
			"lines": lines,
		})
		if err != nil {
			return
		}
		if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
			return
		}
	}

	t, err := tail.TailFile(s.cfg.LogFile, tail.Config{
		Follow:    true,
		ReOpen:    true,
		MustExist: false,
		Poll:      true,
		Location:  &tail.SeekInfo{Offset: 0, Whence: 2},
	})
	if err != nil {
		return
	}
	defer t.Stop()

	for {
		select {
		case line := <-t.Lines:
			if line == nil {
				continue
			}
			if err := conn.WriteMessage(websocket.TextMessage, []byte(line.Text)); err != nil {
				return
			}
			// log.Printf("[WS-Debug] Sent log line: %s", line.Text)
		case <-stopChan:
			return
		case <-time.After(30 * time.Second):
			if err := conn.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(time.Second)); err != nil {
				return
			}
		}
	}
}

func (s *Server) getGatewayHosts(gw *process.OpenClawGatewayConfig) []string {
	// 尝试连接的目标地址列表：优先 127.0.0.1
	hosts := []string{"127.0.0.1"}

	// 1. 如果配置了自定义 host (Buddy 扩展字段)
	if gw.Host != "" && gw.Host != "127.0.0.1" && gw.Host != "localhost" {
		hosts = append(hosts, gw.Host)
	}

	// 2. 如果配置了 OpenClaw 标准的 customBindHost
	if (gw.Bind == "custom" || gw.Bind == "") && gw.CustomBindHost != "" {
		if gw.CustomBindHost != "127.0.0.1" && gw.CustomBindHost != "0.0.0.0" && gw.CustomBindHost != gw.Host {
			hosts = append(hosts, gw.CustomBindHost)
		}
	}

	return hosts
}

// handleGatewayProxy 作为一个透明的 WebSocket 代理，将前端请求转发给本地 OpenClaw 网关，
// 并集成了"静默授权"逻辑，自动批准来自 Buddy 控制台的设备连接。
func (s *Server) handleGatewayProxy(c *gin.Context) {
	upgrader := s.wsUpgrader()
	clientConn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("❌ [WS-Proxy] 升级前端连接失败: %v", err)
		return
	}
	defer clientConn.Close()

	gw, err := process.GetOpenClawGatewayConfig(s.cfg.OpenClawConfigDir)
	if err != nil {
		log.Printf("❌ [WS-Proxy] 无法获取网关配置: %v", err)
		return
	}

	targets := s.getGatewayHosts(gw)
	var gatewayConn *websocket.Conn
	var lastErr error
	var finalTarget string

	for _, target := range targets {
		gatewayURL := fmt.Sprintf("ws://%s:%d/v1/gateway", target, gw.Port)
		dialer := websocket.DefaultDialer
		header := http.Header{}
		header.Add("Origin", fmt.Sprintf("http://%s:%d", target, gw.Port))

		conn, _, err := dialer.Dial(gatewayURL, header)
		if err != nil {
			lastErr = err
			log.Printf("⚠️ [WS-Proxy] 尝试连接网关失败 (%s): %v", gatewayURL, err)
			continue
		}
		gatewayConn = conn
		finalTarget = target
		break
	}

	if gatewayConn == nil {
		log.Printf("❌ [WS-Proxy] 所有尝试均无法连接到 OpenClaw 网关: %v", lastErr)
		return
	}
	defer gatewayConn.Close()

	log.Printf("📡 [WS-Proxy] 已建立隧道: 浏览器 <-> Buddy <-> Gateway (%s:%d)", finalTarget, gw.Port)

	const writeTimeout = 10 * time.Second
	const pongWait = 60 * time.Second
	const pingInterval = 30 * time.Second

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Ping/Pong 心跳：浏览器侧
	clientConn.SetReadDeadline(time.Now().Add(pongWait))
	clientConn.SetPongHandler(func(string) error {
		clientConn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	// Ping/Pong 心跳：网关侧
	gatewayConn.SetReadDeadline(time.Now().Add(pongWait))
	gatewayConn.SetPongHandler(func(string) error {
		gatewayConn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	var lastDeviceId string
	var deviceMu sync.Mutex
	gatewayCloseCode := make(chan int, 1)

	// 协程 C: 定期向两端发送 Ping，防止静默死连接
	go func() {
		ticker := time.NewTicker(pingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				deadline := time.Now().Add(writeTimeout)
				if err := clientConn.WriteControl(websocket.PingMessage, nil, deadline); err != nil {
					cancel()
					return
				}
				if err := gatewayConn.WriteControl(websocket.PingMessage, nil, deadline); err != nil {
					cancel()
					return
				}
			}
		}
	}()

	// 协程 A: 浏览器 -> 网关
	go func() {
		defer cancel()
		handshakeDone := false
		for {
			mt, message, err := clientConn.ReadMessage()
			if err != nil {
				return
			}

			if !handshakeDone {
				var raw map[string]interface{}
				if json.Unmarshal(message, &raw) == nil && raw["method"] == "connect" {
					if params, ok := raw["params"].(map[string]interface{}); ok {
						if device, ok := params["device"].(map[string]interface{}); ok {
							if did, ok := device["id"].(string); ok {
								deviceMu.Lock()
								lastDeviceId = did
								deviceMu.Unlock()
								log.Printf("🛡️ [WS-Proxy] 拦截到连接请求，设备 ID: %s", did)
							}
						}
						if auth, ok := params["auth"].(map[string]interface{}); ok {
							auth["token"] = gw.Auth.Token
							log.Printf("🔑 [WS-Proxy] 已注入 Gateway 真实 Token")
						}
						if patched, err := json.Marshal(raw); err == nil {
							message = patched
						}
						handshakeDone = true
					}
				}
			} else {
				var raw map[string]interface{}
				if json.Unmarshal(message, &raw) == nil {
					method, _ := raw["method"].(string)
					if method == "sessions.patch" || method == "sessions.delete" {
						if params, ok := raw["params"].(map[string]interface{}); ok {
							if key, _ := params["key"].(string); key == "agent:main:main" {
								log.Printf("🛡️ [WS-Proxy] 拦截到主会话 %s 请求并拒绝", method)
								errResp, _ := json.Marshal(map[string]interface{}{
									"type": "res",
									"id":   raw["id"],
									"ok":   false,
									"error": map[string]interface{}{
										"code":    "INVALID_REQUEST",
										"message": "System session is immutable",
									},
								})
								_ = clientConn.SetWriteDeadline(time.Now().Add(writeTimeout))
								_ = clientConn.WriteMessage(mt, errResp)
								continue
							}
						}
					}
				}
			}

			_ = gatewayConn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := gatewayConn.WriteMessage(mt, message); err != nil {
				return
			}
		}
	}()

	// 协程 B: 网关 -> 浏览器
	go func() {
		defer cancel()
		for {
			mt, message, err := gatewayConn.ReadMessage()
			if err != nil {
				if closeErr, ok := err.(*websocket.CloseError); ok {
					select {
					case gatewayCloseCode <- closeErr.Code:
					default:
					}
					if closeErr.Code == 4001 {
						log.Printf("⚠️ [WS-Proxy] 网关认证已轮换 (4001)，通知前端重连")
					}
				}
				return
			}

			trimmed := bytes.TrimLeft(message, " \t\n\r")
			if bytes.HasPrefix(trimmed, []byte(`{"type":"event"`)) {
				// 注入连接目标信息到 health 事件，方便前端展示
				var event struct {
					Type    string                 `json:"type"`
					Event   string                 `json:"event"`
					Payload map[string]interface{} `json:"payload"`
				}
				if json.Unmarshal(message, &event) == nil && event.Event == "health" {
					if event.Payload == nil {
						event.Payload = make(map[string]interface{})
					}
					event.Payload["target"] = finalTarget
					event.Payload["port"] = gw.Port
					if patched, err := json.Marshal(event); err == nil {
						message = patched
					}
				}

				_ = clientConn.SetWriteDeadline(time.Now().Add(writeTimeout))
				if err := clientConn.WriteMessage(mt, message); err != nil {
					return
				}
				continue
			}

			if bytes.HasPrefix(trimmed, []byte(`{"type":"res"`)) {
				var resp struct {
					Type  string      `json:"type"`
					OK    bool        `json:"ok"`
					Error interface{} `json:"error"`
				}
				if json.Unmarshal(message, &resp) == nil && !resp.OK {
					errStr := fmt.Sprintf("%v", resp.Error)
					deviceMu.Lock()
					did := lastDeviceId
					deviceMu.Unlock()
					if strings.Contains(errStr, "NOT_PAIRED") && did != "" {
						log.Printf("🛡️ [WS-Proxy] 检测到设备未授权 (NOT_PAIRED)，触发静默授权逻辑...")
						go func(did string) {
							time.Sleep(300 * time.Millisecond)
							devices, err := process.GetOpenClawDevices()
							if err == nil {
								for _, d := range devices {
									if (d.DeviceId == did || d.RequestId == did) && d.Status == "pending" {
										log.Printf("✅ [WS-Proxy] 自动批准设备请求: %s (DID: %s)", d.RequestId, did)
										_ = process.ApproveDevice(d.RequestId)
										break
									}
								}
							}
						}(did)
					}
				}
			}

			_ = clientConn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := clientConn.WriteMessage(mt, message); err != nil {
				return
			}
		}
	}()

	<-ctx.Done()

	select {
	case code := <-gatewayCloseCode:
		if code == 4001 {
			_ = clientConn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(4001, "gateway auth changed"),
				time.Now().Add(time.Second),
			)
		}
	default:
	}

	log.Printf("🔌 [WS-Proxy] 隧道已关闭")
}
