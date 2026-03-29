package api

import (
	"encoding/json"
	"io"
	"log"
	"os"
	"os/exec"

	"github.com/creack/pty"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

type TuiMessage struct {
	Type string `json:"type"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

func (s *Server) handleTUI(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("TUI WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// 获取环境配置用于注入子进程
	homeDir, _ := os.UserHomeDir()
	if homeDir == "" {
		homeDir = os.Getenv("HOME")
	}

	configDir := s.cfg.OpenClawConfigDir
	
	// 动态查找 openclaw 命令路径
	openclawPath, err := exec.LookPath("openclaw")
	if err != nil {
		openclawPath = "openclaw" // 兜底
	}

	log.Printf("Starting openclaw tui process (Path=%s, HOME=%s, ConfigDir=%s)...", openclawPath, homeDir, configDir)
	
	// 启动 openclaw tui 进程
	cmd := exec.Command(openclawPath, "tui")
	
	// 继承主进程的所有环境变量
	cmd.Env = os.Environ()
	// 额外确保 HOME 和 OPENCLAW_CONFIG_DIR 被正确注入
	if homeDir != "" {
		cmd.Env = append(cmd.Env, "HOME="+homeDir)
	}
	cmd.Env = append(cmd.Env, "OPENCLAW_CONFIG_DIR="+configDir)
	// 设置工作目录为配置目录或家目录
	cmd.Dir = homeDir

	// 通过 PTY 启动命令
	ptmx, err := pty.Start(cmd)
	if err != nil {
		log.Printf("Failed to start TUI with PTY: %v", err)
		return
	}
	
	log.Printf("PTY session started for pid %d", cmd.Process.Pid)
	
	defer func() { 
		log.Printf("Closing PTY for pid %d...", cmd.Process.Pid)
		_ = ptmx.Close() 
	}()

	// 监听进程退出
	go func() {
		err := cmd.Wait()
		log.Printf("openclaw tui process (pid %d) exited: %v", cmd.Process.Pid, err)
		_ = conn.Close()
	}()

	// 读取 WebSocket 并处理消息
	go func() {
		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				return
			}

			// 尝试解析为 JSON 用于 Resize
			var msg TuiMessage
			if err := json.Unmarshal(message, &msg) ; err == nil && msg.Type == "resize" {
				log.Printf("PTY resize for pid %d: cols=%d, rows=%d", cmd.Process.Pid, msg.Cols, msg.Rows)
				_ = pty.Setsize(ptmx, &pty.Winsize{
					Rows: uint16(msg.Rows),
					Cols: uint16(msg.Cols),
				})
				continue
			}

			// 否则作为原始输入写入 PTY
			_, _ = ptmx.Write(message)
		}
	}()

	// 读取 PTY 并写入 WebSocket
	buf := make([]byte, 2048) // 稍微增大缓冲区减少 IO 次数
	for {
		n, err := ptmx.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Printf("PTY read error for pid %d: %v", cmd.Process.Pid, err)
			}
			return
		}
		if err := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
			return
		}
	}
}
