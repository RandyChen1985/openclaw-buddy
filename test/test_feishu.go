package main

import (
	"context"
	"log"
	"yovole-openclaw-monitor/internal/utils"
)

func main() {
	appID := "cli_a9143ba2aff8dcc1"
	appSecret := "8e5pr2I8UvBqnGEsgLPPPdhSHC3Uulhp"
	receiveID := "ou_fb4ac42ac255b1b6c33e5efb48898138"

	log.Printf("🚀 准备发送测试消息至飞书 (ID: %s)...", receiveID)
	
	f := utils.NewFeishu(appID, appSecret)
	
	// 测试发送交互式卡片
	err := f.SendInteractiveCard(context.Background(), receiveID, "🧪 Guardian 通信测试", "这是一条来自 Lobster Guardian 的手动测试消息。\n\n- **状态**: 联通性测试\n- **模式**: 自动识别 ID 类型 (OpenID)")
	
	if err != nil {
		log.Fatalf("❌ 发送失败: %v", err)
	}

	log.Println("✅ 发送成功！请检查您的飞书消息。")
}
