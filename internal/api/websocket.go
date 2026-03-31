package api

import (
	"bufio"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os/exec"
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
	clientsMu sync.Mutex
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Simplified for this project
	},
}

func (s *Server) StartWebSocketBroadcaster() {
	log.Println("📡 [WS] WebSocket broadcaster started.")
	for task := range process.TaskUpdateChan {
		msg, _ := json.Marshal(map[string]interface{}{
			"type": "TASK_UPDATE",
			"data": task,
		})

		clientsMu.Lock()
		for conn := range clients {
			err := conn.WriteMessage(websocket.TextMessage, msg)
			if err != nil {
				log.Printf("⚠️ [WS] Failed to send task update to client: %v", err)
			}
		}
		clientsMu.Unlock()
	}
}

func (s *Server) streamLogs(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// 注册客户端
	clientsMu.Lock()
	clients[conn] = true
	clientsMu.Unlock()

	// 注销客户端
	defer func() {
		clientsMu.Lock()
		delete(clients, conn)
		clientsMu.Unlock()
	}()

	source := c.DefaultQuery("source", "buddy")
	stopChan := make(chan bool)
	var once sync.Once
	stop := func() {
		once.Do(func() {
			close(stopChan)
		})
	}

	// 监听客户端主动关闭连接
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				stop()
				return
			}
		}
	}()

	if source == "gateway" {
		// --- 模式 A: 实时获取小龙虾网关日志 ---
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		log.Printf("📡 [WS] Starting gateway log streaming (openclaw logs --follow)...")
		cmd := exec.CommandContext(ctx, "openclaw", "logs", "--follow")
		
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			log.Printf("❌ Failed to get stdout pipe: %v", err)
			return
		}
		cmd.Stderr = cmd.Stdout

		if err := cmd.Start(); err != nil {
			log.Printf("❌ Failed to start openclaw logs: %v", err)
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
		
		log.Println("👋 [WS] Stopped gateway log streaming.")
		return
	}

	// --- 模式 B: 实时获取 Buddy 自身日志 ---
	// [优化] 连接建立时，先行推送最后 50 行日志，提供即时上下文
	preLogCmd := exec.Command("tail", "-n", "50", s.cfg.LogFile)
	if preLogOut, err := preLogCmd.Output(); err == nil {
		scanner := bufio.NewScanner(strings.NewReader(string(preLogOut)))
		for scanner.Scan() {
			_ = conn.WriteMessage(websocket.TextMessage, []byte(scanner.Text()))
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
		log.Printf("TailFile failed: %v", err)
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
			if err := conn.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(time.Second)); err != nil {
				return
			}
		}
	}
}
