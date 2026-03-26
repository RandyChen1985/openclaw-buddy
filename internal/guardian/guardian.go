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
		g.notifyFeishu(context.Background(), "🛡️ 有孚小龙虾监控服务已启动", fmt.Sprintf("节点: %s\n状态: ✅ 监控运行中\n版本: 🦞 OpenClaw Monitor\n\n---\n**OpenClaw 状态详情:**\n%s", hostname, status))
	}

	log.Printf("🛡️ 有孚小龙虾监控服务巡检循环已启动. Every %d seconds.", g.config.CheckIntervalSeconds)

	// 启动时检查：如果服务正常，根据开关状态决定是否备份
	isSelfHealingEnabled := utils.GetSetting("self_healing_enabled", "false") == "true"
	if process.IsPortListening(g.config.HealthPort) {
		if _, err := process.CheckHealth(); err == nil {
			if isSelfHealingEnabled {
				log.Printf("📦 Service is healthy on startup. Performing initial backup...")
				g.backupConfig()
			} else {
				log.Printf("ℹ️ [自愈服务] 当前开关已关闭，启动时跳过配置备份流程。")
			}
		}
	}

	for {
		select {
		case <-ticker.C:
			g.check()
		case <-ctx.Done():
			hostname, _ := os.Hostname()
			g.notifyFeishu(context.Background(), "👋 有孚小龙虾监控服务已停止", fmt.Sprintf("节点: %s\n状态: ⏹️ 服务已正常退出", hostname))
			return
		}
	}
}

func (g *Guardian) check() {
	var lastErr error
	var reason string

	isSelfHealingEnabled := utils.GetSetting("self_healing_enabled", "false") == "true"
	if !isSelfHealingEnabled {
		log.Printf("🔍 [巡检] 自愈服务开关目前处于【关闭】状态，本次巡检将仅记录监控数据，不触发自动修复。")
	}

	for i := 1; i <= g.config.MaxRetries; i++ {
		// 1. Port Check
		if !process.IsPortListening(g.config.HealthPort) {
			reason = "Port Down"
			lastErr = fmt.Errorf("port %d is not listening", g.config.HealthPort)
		} else {
			// 2. Health Check
			elapsed, err := process.CheckHealth()
			responseTimeMs := int(elapsed.Milliseconds())
			
			if err != nil {
				reason = "Health Check Failure"
				lastErr = err
			} else {
				// Success!
				g.recordHealthCheck("Healthy", responseTimeMs, "")
				if isSelfHealingEnabled {
					log.Printf("✅ OpenClaw is healthy (Latency: %dms). Updating configuration backup...", responseTimeMs)
					g.backupConfig()
				} else {
					log.Printf("✅ OpenClaw is healthy (Latency: %dms). [自愈流程已跳过]")
				}
				return
			}
		}

		if i < g.config.MaxRetries {
			log.Printf("⚠️ Check failed (attempt %d/%d): %v. Retrying in 2 seconds...", i, g.config.MaxRetries, lastErr)
			g.recordHealthCheck("Degraded", 0, lastErr.Error())
			time.Sleep(2 * time.Second)
		}
	}

	// If we reach here, all retries failed
	log.Printf("🚨 All %d checks failed. Last error: %v", g.config.MaxRetries, lastErr)
	g.recordHealthCheck("Down", 0, lastErr.Error())
	
	// Only trigger healing if switch is enabled
	if isSelfHealingEnabled {
		log.Printf("🛠️ Initiating self-healing process.")
		g.heal(reason)
	} else {
		log.Printf("ℹ️ [自愈服务] 当前开关已关闭，忽略本次自愈服务流程。")
	}
}

func (g *Guardian) recordHealthCheck(status string, responseTime int, errorMsg string) {
	if utils.DB == nil {
		return
	}
	_, err := utils.DB.Exec(`
		INSERT INTO health_checks (status, response_time_ms, error_msg)
		VALUES (?, ?, ?)
	`, status, responseTime, errorMsg)
	if err != nil {
		log.Printf("❌ Failed to record health check to DB: %v", err)
	}
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
	ourBackupPath := filepath.Join(g.config.BackupDir, "openclaw.json.bak")
	legacyBackupPath := filepath.Join(g.config.OpenClawConfigDir, "openclaw.json.bak")
	errorPath := filepath.Join(g.config.OpenClawConfigDir, "openclaw.json.err")

	// 1. Backup current broken config
	_ = copyFile(configPath, errorPath)

	// 2. Generate Report
	reportPath, err := analyzer.GenerateReport(g.config.ReportDir, g.config.OpenClawConfigDir, configPath, ourBackupPath)
	if err != nil {
		reportPath, err = analyzer.GenerateReport(g.config.ReportDir, g.config.OpenClawConfigDir, configPath, legacyBackupPath)
	}
	reportMsg := ""
	if err == nil {
		reportMsg = fmt.Sprintf("\n- **诊断报表**: %s", reportPath)
	}

	// 3. Rollback
	log.Printf("🔄 Attempting to recover service...")
	recovered := false
	recoveryMethodUsed := ""

	if _, err := os.Stat(ourBackupPath); err == nil {
		if err := copyFile(ourBackupPath, configPath); err == nil {
			recovered = true
			recoveryMethodUsed = "配置回滚 (来自监控备份)"
		}
	}

	if !recovered {
		if _, err := os.Stat(legacyBackupPath); err == nil {
			if err := copyFile(legacyBackupPath, configPath); err == nil {
				recovered = true
				recoveryMethodUsed = "配置回滚 (来自 OpenClaw 备份)"
			}
		}
	}

	if !recovered {
		if err := process.RunDoctorFix(); err == nil {
			recovered = true
			recoveryMethodUsed = "Doctor 修复"
		}
	}

	// 4. Restart
	_ = process.ForceStartGateway()
	time.Sleep(3 * time.Second)
	statusAfter := process.GetGatewayStatus()

	if !recovered {
		recoveryMethodUsed = "强行重启 (未执行配置恢复)"
	}

	g.notifyFeishu(context.Background(), "✅ 小龙虾自愈成功", fmt.Sprintf("节点: %s\n状态: ✅ 已自动恢复上线\n操作: %s 并强行重启%s\n\n---\n**恢复后状态详情:**\n%s", hostname, recoveryMethodUsed, reportMsg, statusAfter))
	
	// Record to DB
	g.recordHealEvent(reason, recoveryMethodUsed, "Success", reportPath)

	log.Printf("🔄 Returning to monitoring loop...")
}

func (g *Guardian) recordHealEvent(reason, method, result, reportPath string) {
	if utils.DB == nil {
		return
	}
	_, err := utils.DB.Exec(`
		INSERT INTO heal_events (reason, method, result, report_path)
		VALUES (?, ?, ?, ?)
	`, reason, method, result, reportPath)
	if err != nil {
		log.Printf("❌ Failed to record heal event to DB: %v", err)
	}
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
