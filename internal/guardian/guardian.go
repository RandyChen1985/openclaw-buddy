package guardian

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"
	"yovole-openclaw-monitor/internal/analyzer"
	"yovole-openclaw-monitor/internal/config"
	"yovole-openclaw-monitor/internal/process"
	"yovole-openclaw-monitor/internal/utils"
)

type Guardian struct {
	config *config.Config
	feishu *utils.Feishu
}

func NewGuardian(cfg *config.Config) *Guardian {
	g := &Guardian{config: cfg}
	if cfg.FeishuEnabled {
		g.feishu = utils.NewFeishu(cfg.FeishuAppID, cfg.FeishuAppSecret)
	}
	return g
}

func (g *Guardian) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Duration(g.config.CheckIntervalSeconds) * time.Second)
	defer ticker.Stop()

	// 启动飞书 WebSocket 长链接
	if g.feishu != nil {
		g.feishu.StartLongConnection(ctx)
		hostname, _ := os.Hostname()
		status := process.GetGatewayStatus()
		g.notifyFeishu(context.Background(), "🛡️ 有孚小龙虾带外服务已启动", fmt.Sprintf("节点: %s\n状态: ✅ 监控运行中\n版本: 🦞 OpenClaw Monitor\n\n---\n**OpenClaw 状态详情:**\n%s", hostname, status))
	}

	log.Printf("🛡️ 有孚小龙虾带外服务巡检循环已启动. Every %d seconds.", g.config.CheckIntervalSeconds)

	// 启动时检查：如果服务正常，先备份一份配置
	if process.IsPortListening(g.config.HealthPort) && process.CheckHealth() == nil {
		log.Printf("📦 Service is healthy on startup. Performing initial backup...")
		g.backupConfig()
	}

	for {
		select {
		case <-ticker.C:
			g.check()
		case <-ctx.Done():
			hostname, _ := os.Hostname()
			g.notifyFeishu(context.Background(), "👋 有孚小龙虾带外服务已停止", fmt.Sprintf("节点: %s\n状态: ⏹️ 服务已正常退出", hostname))
			return
		}
	}
}

func (g *Guardian) check() {
	var lastErr error
	var reason string

	for i := 1; i <= g.config.MaxRetries; i++ {
		// 1. Port Check
		if !process.IsPortListening(g.config.HealthPort) {
			reason = "Port Down"
			lastErr = fmt.Errorf("port %d is not listening", g.config.HealthPort)
		} else {
			// 2. Health Check
			if err := process.CheckHealth(); err != nil {
				reason = "Health Check Failure"
				lastErr = err
			} else {
				// Success!
				log.Printf("✅ OpenClaw is healthy. Updating configuration backup...")
				g.backupConfig()
				return
			}
		}

		if i < g.config.MaxRetries {
			log.Printf("⚠️ Check failed (attempt %d/%d): %v. Retrying in 2 seconds...", i, g.config.MaxRetries, lastErr)
			time.Sleep(2 * time.Second)
		}
	}

	// If we reach here, all retries failed
	log.Printf("🚨 All %d checks failed. Initiating self-healing. Last error: %v", g.config.MaxRetries, lastErr)
	g.heal(reason)
}

func (g *Guardian) backupConfig() {
	configPath := filepath.Join(g.config.OpenClawConfigDir, "openclaw.json")
	backupPath := filepath.Join(g.config.BackupDir, "openclaw.json.bak")

	// 确保备份目录存在
	if err := os.MkdirAll(g.config.BackupDir, 0755); err != nil {
		log.Printf("❌ Failed to create backup directory: %v", err)
		return
	}

	if err := copyFile(configPath, backupPath); err != nil {
		log.Printf("❌ Failed to backup configuration: %v", err)
	} else {
		log.Printf("✅ Configuration backed up to %s", backupPath)
	}
}

func (g *Guardian) heal(reason string) {
	log.Printf("🛠️ Initiating self-healing process for reason: %s", reason)

	hostname, _ := os.Hostname()
	statusBefore := process.GetGatewayStatus()
	g.notifyFeishu(context.Background(), "⚠️ 小龙虾故障报警", fmt.Sprintf("节点: %s\n状态: ⚠️ 检测到服务宕机\n原因: %s\n正在尝试自愈...\n\n---\n**当前状态详情:**\n%s", hostname, reason, statusBefore))

	configPath := filepath.Join(g.config.OpenClawConfigDir, "openclaw.json")
	// 仍然从 OpenClaw 目录找 bak 作为兜底，但优先使用我们自己的 BackupDir
	ourBackupPath := filepath.Join(g.config.BackupDir, "openclaw.json.bak")
	legacyBackupPath := filepath.Join(g.config.OpenClawConfigDir, "openclaw.json.bak")
	errorPath := filepath.Join(g.config.OpenClawConfigDir, "openclaw.json.err")

	// 1. Backup current broken config
	_ = copyFile(configPath, errorPath)

	// 2. Generate Report (优先用我们的备份对比)
	reportPath, err := analyzer.GenerateReport(g.config.ReportDir, g.config.OpenClawConfigDir, configPath, ourBackupPath)
	if err != nil {
		// 如果我们自己的备份不存在，回退到 legacy 路径生成报告
		reportPath, err = analyzer.GenerateReport(g.config.ReportDir, g.config.OpenClawConfigDir, configPath, legacyBackupPath)
	}
	reportMsg := ""
	if err == nil {
		reportMsg = fmt.Sprintf("\n- **诊断报表**: %s", reportPath)
	}

	// 3. Rollback config or Doctor Fix
	log.Printf("🔄 Attempting to recover service...")
	recovered := false
	recoveryMethodUsed := ""

	// Tier 1: Try Rollback from OUR backup directory
	if _, err := os.Stat(ourBackupPath); err == nil {
		log.Printf("🔄 Rolling back configuration from our backup directory...")
		if err := copyFile(ourBackupPath, configPath); err == nil {
			recovered = true
			recoveryMethodUsed = "配置回滚 (来自守护进程备份)"
			log.Printf("✅ Config rollback (from our backup) successful.")
		} else {
			log.Printf("❌ Failed to rollback config from our backup: %v", err)
		}
	}

	// Tier 1.5: Fallback to legacy backup if ours failed/missing
	if !recovered {
		if _, err := os.Stat(legacyBackupPath); err == nil {
			log.Printf("🔄 Rolling back configuration from legacy backup...")
			if err := copyFile(legacyBackupPath, configPath); err == nil {
				recovered = true
				recoveryMethodUsed = "配置回滚 (来自 OpenClaw 备份)"
				log.Printf("✅ Config rollback (from legacy backup) successful.")
			}
		}
	}

	// Tier 2: Doctor Fix if rollback skipped or failed
	if !recovered {
		log.Printf("🩺 Running 'openclaw doctor --fix' as secondary recovery strategy...")
		if err := process.RunDoctorFix(); err == nil {
			recovered = true
			recoveryMethodUsed = "Doctor 修复"
			log.Printf("✅ 'openclaw doctor --fix' completed successfully.")
		} else {
			log.Printf("❌ 'openclaw doctor --fix' failed: %v", err)
		}
	}

	// 4. Force restart
	log.Printf("🚀 Requesting gateway force start...")
	if err := process.ForceStartGateway(); err != nil {
		log.Printf("❌ Failed to initiate gateway start: %v", err)
		g.notifyFeishu(context.Background(), "❌ 小龙虾自愈失败", fmt.Sprintf("节点: %s\n严重级别: ERROR\n原因: 进程拉起失败: %v", hostname, err))
		return
	}

	// 稍微等待网关状态更新
	time.Sleep(3 * time.Second)
	statusAfter := process.GetGatewayStatus()

	log.Printf("✨ Gateway start request sent. Self-healing cycle completed.")
	
	if !recovered {
		recoveryMethodUsed = "强行重启 (未执行配置恢复)"
	}

	g.notifyFeishu(context.Background(), "✅ 小龙虾自愈成功", fmt.Sprintf("节点: %s\n状态: ✅ 已自动恢复上线\n操作: %s 并强行重启%s\n\n---\n**恢复后状态详情:**\n%s", hostname, recoveryMethodUsed, reportMsg, statusAfter))
	
	log.Printf("🔄 Returning to monitoring loop...")
}

func (g *Guardian) notifyFeishu(ctx context.Context, title, text string) {
	if g.feishu != nil && g.config.FeishuChatID != "" {
		go func() {
			if err := g.feishu.SendInteractiveCard(ctx, g.config.FeishuChatID, title, text); err != nil {
				log.Printf("❌ Failed to send Feishu notification: %v", err)
			}
		}()
	}
}

func copyFile(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	destFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, sourceFile)
	return err
}
