package utils

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"
)

type Feishu struct {
	AppID     string
	AppSecret string
	client    *lark.Client
}

func NewFeishu(appID, appSecret string) *Feishu {
	client := lark.NewClient(appID, appSecret)
	f := &Feishu{
		AppID:     appID,
		AppSecret: appSecret,
		client:    client,
	}
	return f
}

// StartLongConnection 启动 WebSocket 长链接
func (f *Feishu) StartLongConnection(ctx context.Context) {
	wsClient := larkws.NewClient(f.AppID, f.AppSecret)

	go func() {
		log.Printf("🔗 Feishu WebSocket Long-connection starting...")
		err := wsClient.Start(ctx)
		if err != nil {
			log.Printf("❌ Feishu WebSocket failed: %v", err)
		}
	}()
}

// SendInteractiveCard 发送交互式卡片消息
func (f *Feishu) SendInteractiveCard(ctx context.Context, receiveID, title, text string) error {
	// 使用 map 构建卡片结构，确保序列化时自动转义特殊字符
	cardMap := map[string]interface{}{
		"config": map[string]interface{}{
			"wide_screen_mode": true,
		},
		"header": map[string]interface{}{
			"title": map[string]interface{}{
				"tag":     "plain_text",
				"content": title,
			},
			"template": "blue",
		},
		"elements": []interface{}{
			map[string]interface{}{
				"tag":     "markdown",
				"content": text,
			},
		},
	}

	cardBytes, err := json.Marshal(cardMap)
	if err != nil {
		return fmt.Errorf("failed to marshal feishu card: %v", err)
	}

	receiveIdType := larkim.ReceiveIdTypeChatId
	if len(receiveID) > 3 && receiveID[:3] == "ou_" {
		receiveIdType = larkim.ReceiveIdTypeOpenId
	}

	req := larkim.NewCreateMessageReqBuilder().
		ReceiveIdType(receiveIdType).
		Body(larkim.NewCreateMessageReqBodyBuilder().
			ReceiveId(receiveID).
			MsgType(larkim.MsgTypeInteractive).
			Content(string(cardBytes)).
			Build()).
		Build()

	resp, err := f.client.Im.Message.Create(ctx, req)
	if err != nil {
		return err
	}

	if !resp.Success() {
		return fmt.Errorf("feishu API failed, code: %d, msg: %s", resp.Code, resp.Msg)
	}

	return nil
}
