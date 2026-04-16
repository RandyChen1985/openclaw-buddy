//go:build !windows

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
	"openclaw-buddy/internal/process"
)

func (s *Server) startPTY(c *gin.Context, command string, args ...string) {
	upgrader := s.wsUpgrader()
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("PTY WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// 获取环境配置用于注入子进程
	homeDir, _ := os.UserHomeDir()
	if homeDir == "" {
		homeDir = os.Getenv("HOME")
	}

	configDir := s.cfg.OpenClawConfigDir

	// 智能定位二进制 (如果是 openclaw)
	if command == "openclaw" {
		command = process.GetOpenClawBinary()
	}

	// 启动进程
	cmd := exec.Command(command, args...)

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
		log.Printf("Failed to start process with PTY: %v", err)
		_ = conn.WriteMessage(websocket.TextMessage, []byte("\r\n[Buddy Error] 无法通过 PTY 启动命令: "+command+"\r\n请检查执行文件是否存在且有执行权限。\r\n"))
		return
	}

	log.Printf("PTY(Unix) session started for pid %d (cmd=%s)", cmd.Process.Pid, command)

	defer func() {
		log.Printf("Closing PTY(Unix) for pid %d...", cmd.Process.Pid)
		_ = ptmx.Close()
	}()

	// 监听进程退出
	go func() {
		err := cmd.Wait()
		log.Printf("PTY process (pid %d) exited: %v", cmd.Process.Pid, err)
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
			if err := json.Unmarshal(message, &msg); err == nil && msg.Type == "resize" {
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
	buf := make([]byte, 2048)
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
