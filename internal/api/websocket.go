package api

import (
	"bufio"
	"context"
	"log"
	"net/http"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/hpcloud/tail"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Simplified for this project
	},
}

func (s *Server) streamLogs(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

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
		// 注意：这里的 cancel 会在函数退出时由 defer 执行
		defer cancel()

		log.Printf("📡 [WS] Starting gateway log streaming (openclaw logs --follow)...")
		cmd := exec.CommandContext(ctx, "openclaw", "logs", "--follow")
		
		// [加固] 设置进程组，以便后续整体销毁
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

		// 异步读取输出并推送到 WebSocket
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

		// 等待停止信号
		<-stopChan
		
		// [加固] 彻底清理：杀掉整个进程组，而不仅仅是父进程
		pgid, err := syscall.Getpgid(cmd.Process.Pid)
		if err == nil {
			syscall.Kill(-pgid, syscall.SIGKILL)
		}
		
		// [加固] 回收进程资源，防止产生僵尸进程
		_ = cmd.Wait()
		
		log.Println("👋 [WS] Stopped gateway log streaming.")
		return
	}

	// --- 模式 B: 实时获取 Buddy 自身日志 (默认) ---
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
			// 心跳，防止某些防火墙断开连接
			if err := conn.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(time.Second)); err != nil {
				return
			}
		}
	}
}
