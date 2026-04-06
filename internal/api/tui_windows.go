//go:build windows

package api

import (
	"encoding/json"
	"io"
	"log"
	"os"

	gopty "github.com/aymanbagabas/go-pty"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"openclaw-buddy/internal/process"
)

func (s *Server) startPTY(c *gin.Context, command string, args ...string) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("PTY WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// 1. 创建一个新的 PTY 实例 (Windows 下为 ConPTY)
	ptmx, err := gopty.New()
	if err != nil {
		log.Printf("Failed to open Windows PTY: %v", err)
		_ = conn.WriteMessage(websocket.TextMessage, []byte("\r\n[Buddy Error] 无法创建 Windows PTY 实例，请确保系统支持 ConPTY。\r\n"))
		return
	}
	defer ptmx.Close()

	// 2. 获取环境配置用于注入子进程
	homeDir, _ := os.UserHomeDir()
	if homeDir == "" {
		homeDir = os.Getenv("USERPROFILE")
	}
	configDir := s.cfg.OpenClawConfigDir

	// 3. 智能定位二进制 (如果是 openclaw)
	if command == "openclaw" {
		command = process.GetOpenClawBinary()
	}

	// 4. 使用 pty 实例创建命令
	cmd := ptmx.Command(command, args...)

	// 4. 配置环境变量与工作目录
	cmd.Env = os.Environ()
	if homeDir != "" {
		// 在 Windows 上 HOME 可能没用，但很多工具会看这个
		cmd.Env = append(cmd.Env, "HOME="+homeDir)
		cmd.Env = append(cmd.Env, "USERPROFILE="+homeDir)
	}
	cmd.Env = append(cmd.Env, "OPENCLAW_CONFIG_DIR="+configDir)
	cmd.Dir = homeDir

	// 5. 启动进程
	if err := cmd.Start(); err != nil {
		log.Printf("Failed to start process in Windows PTY: %v", err)
		_ = conn.WriteMessage(websocket.TextMessage, []byte("\r\n[Buddy Error] 无法启动命令: "+command+"\r\n请检查执行文件是否存在且有执行权限。\r\n"))
		return
	}

	log.Printf("PTY(Windows) session started for pid %d (cmd=%s)", cmd.Process.Pid, command)

	// 6. 监听进程退出
	go func() {
		_ = cmd.Wait()
		log.Printf("PTY process (pid %d) exited", cmd.Process.Pid)
		_ = conn.Close()
	}()

	// 7. 读取 WebSocket 并处理消息 (写入 PTY)
	go func() {
		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				return
			}

			// 尝试解析为 JSON 用于 Resize
			var msg TuiMessage
			if err := json.Unmarshal(message, &msg); err == nil && msg.Type == "resize" {
				_ = ptmx.Resize(int(msg.Cols), int(msg.Rows))
				continue
			}

			// 否则作为原始输入写入 PTY
			_, _ = ptmx.Write(message)
		}
	}()

	// 8. 读取 PTY 并写入 WebSocket
	buf := make([]byte, 2048)
	for {
		n, err := ptmx.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Printf("PTY read error: %v", err)
			}
			return
		}
		if err := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
			return
		}
	}
}
