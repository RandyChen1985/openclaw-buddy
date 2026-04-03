package api

import (
	"bufio"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os/exec"
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
