package utils

import (
	"context"
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
	// 修正为正确的 SDK 调用方式
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
	card := fmt.Sprintf(`{
		"config": { "wide_screen_mode": true },
		"header": {
			"title": { "tag": "plain_text", "content": "%s" },
			"template": "blue"
		},
		"elements": [
			{ "tag": "markdown", "content": "%s" }
		]
	}`, title, text)

	req := larkim.NewCreateMessageReqBuilder().
		ReceiveIdType(larkim.ReceiveIdTypeChatId). // 默认发送到群组，如果是个人可改为 OpenId
		Body(larkim.NewCreateMessageReqBodyBuilder().
			ReceiveId(receiveID).
			MsgType(larkim.MsgTypeInteractive).
			Content(card).
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

// SendSimpleMarkdown 发送简单的 Markdown 消息到默认频道
func (f *Feishu) SendSimpleMarkdown(ctx context.Context, title, text string) error {
	// 这里可以扩展从配置中读取接收 ID (ChatID)
	// 暂时预留此接口
	return f.SendInteractiveCard(ctx, "oc_xxxxxx", title, text) // 此处 oc_xxxxxx 需替换为真实的 ChatID
}
