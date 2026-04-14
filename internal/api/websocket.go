package api

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
	"bytes"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/hpcloud/tail"
	"openclaw-buddy/internal/process"
)

var (
	clients   = make(map[*websocket.Conn]bool)
	clientsMu sync.RWMutex // 使用读写锁提升性能
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// 如果是同源请求（没有 Origin 头），直接允许
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}

		// 否则，目前采取宽松策略允许所有 Origin，
		// 但由于我们引入了一次性 Ticket 机制，即使 Origin 被伪造，
		// 攻击者也无法通过 CSRF 获取有效 Ticket，从而保证了 WebSocket 的安全性。
		return true
	},
}

func (s *Server) StartWebSocketBroadcaster() {
	log.Println("📡 [WS] WebSocket broadcaster started.")
	for task := range process.TaskUpdateChan {
		msg, _ := json.Marshal(map[string]interface{}{
			"type": "TASK_UPDATE",
			"data": task,
		})

		clientsMu.RLock()
		// 复制一份活跃连接，避免在发送时长期占用锁
		activeClients := make([]*websocket.Conn, 0, len(clients))
		for conn := range clients {
			activeClients = append(activeClients, conn)
		}
		clientsMu.RUnlock()

		for _, conn := range activeClients {
			// 设置写入超时，防止慢客户端阻塞整个广播
			_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			err := conn.WriteMessage(websocket.TextMessage, msg)
			if err != nil {
				log.Printf("⚠️ [WS] Failed to send task update, connection might be closed.")
				// 这里不手动 delete，由 streamLogs 的 defer 负责清理
			}
		}
	}
}

func (s *Server) streamLogs(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("❌ [WS] Upgrade failed: %v", err)
		return
	}
	
	// 注册客户端
	clientsMu.Lock()
	clients[conn] = true
	clientsMu.Unlock()

	// 注销并彻底关闭
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

	// 监听断开
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

	// 默认 Buddy 日志
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
		case <-stopChan:
			return
		case <-time.After(30 * time.Second):
			// 心跳保持
			if err := conn.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(time.Second)); err != nil {
				return
			}
		}
	}
}

// handleGatewayProxy 作为一个透明的 WebSocket 代理，将前端请求转发给本地 OpenClaw 网关，
// 并集成了“静默授权”逻辑，自动批准来自 Buddy 控制台的设备连接。
func (s *Server) handleGatewayProxy(c *gin.Context) {
	// 1. 升级前端连接
	clientConn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("❌ [WS-Proxy] 升级前端连接失败: %v", err)
		return
	}
	defer clientConn.Close()

	// 2. 获取网关配置 (端口和令牌)
	gw, err := process.GetOpenClawGatewayConfig(s.cfg.OpenClawConfigDir)
	if err != nil {
		log.Printf("❌ [WS-Proxy] 无法获取网关配置: %v", err)
		return
	}

	// 3. 连接到本地 OpenClaw 网关
	gatewayURL := fmt.Sprintf("ws://127.0.0.1:%d/v1/gateway", gw.Port)
	dialer := websocket.DefaultDialer
	// 增加 Origin 头，满足网关的安全检查
	header := http.Header{}
	header.Add("Origin", fmt.Sprintf("http://127.0.0.1:%d", gw.Port))

	gatewayConn, _, err := dialer.Dial(gatewayURL, header)
	if err != nil {
		log.Printf("❌ [WS-Proxy] 无法连接到 OpenClaw 网关 (%s): %v", gatewayURL, err)
		return
	}
	defer gatewayConn.Close()

	log.Printf("📡 [WS-Proxy] 已建立隧道: 浏览器 <-> Buddy <-> Gateway (%d)", gw.Port)

	// 使用上下文控制双向转发协程的生命周期
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var lastDeviceId string

	// 协程 A: 浏览器 -> 网关 (拦截 connect 请求以记录 DeviceID 并注入真实 Token)
	go func() {
		defer cancel()
		handshakeDone := false
		for {
			mt, message, err := clientConn.ReadMessage()
			if err != nil {
				return
			}

			// 只有在未完成握手时才尝试拦截 V3 connect 请求以注入 Token
			if !handshakeDone {
				var raw map[string]interface{}
				if json.Unmarshal(message, &raw) == nil && raw["method"] == "connect" {
					if params, ok := raw["params"].(map[string]interface{}); ok {
						// 记录 DeviceID
						if device, ok := params["device"].(map[string]interface{}); ok {
							if did, ok := device["id"].(string); ok {
								lastDeviceId = did
								log.Printf("🛡️ [WS-Proxy] 拦截到连接请求，设备 ID: %s", lastDeviceId)
							}
						}
						// 关键：将前端的 guardian token 替换为 OpenClaw Gateway 的真实 token
						if auth, ok := params["auth"].(map[string]interface{}); ok {
							auth["token"] = gw.Auth.Token
							log.Printf("🔑 [WS-Proxy] 已注入 Gateway 真实 Token")
						}
						// 重新序列化
						if patched, err := json.Marshal(raw); err == nil {
							message = patched
						}
						handshakeDone = true // 标记握手已处理，后续包直接转发
					}
				}
			}

			if err := gatewayConn.WriteMessage(mt, message); err != nil {
				return
			}
		}
	}()

	// 协程 B: 网关 -> 浏览器 (拦截 NOT_PAIRED 错误以触发静默授权)
	go func() {
		defer cancel()
		for {
			mt, message, err := gatewayConn.ReadMessage()
			if err != nil {
				return
			}

			// --- 性能优化：快速路径转发 ---
			// V3 协议中，99% 的包是 "type":"event" (流式输出)。
			// 我们直接通过字节流判断，跳过 JSON 反序列化以节省 CPU 和降低延迟。
			if bytes.Contains(message, []byte(`"type":"event"`)) {
				if err := clientConn.WriteMessage(mt, message); err != nil {
					return
				}
				continue
			}

			// 只有可能是响应消息 (res) 时，才进行反序列化检查
			if bytes.Contains(message, []byte(`"type":"res"`)) {
				var resp struct {
					Type  string      `json:"type"`
					OK    bool        `json:"ok"`
					Error interface{} `json:"error"`
				}
				if json.Unmarshal(message, &resp) == nil && !resp.OK {
					errStr := fmt.Sprintf("%v", resp.Error)
					if strings.Contains(errStr, "NOT_PAIRED") && lastDeviceId != "" {
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
						}(lastDeviceId)
					}
				}
			}

			if err := clientConn.WriteMessage(mt, message); err != nil {
				return
			}
		}
	}()

	// 阻塞直到上下文被取消
	<-ctx.Done()
	log.Printf("🔌 [WS-Proxy] 隧道已关闭")
}
