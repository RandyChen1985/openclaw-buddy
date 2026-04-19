package main

import (
	"fmt"
	"os"
	"strings"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Mock OpenClaw v1.2.0")
		return
	}

	cmd := strings.Join(os.Args[1:], " ")
	switch {
	case strings.Contains(cmd, "--version"):
		fmt.Println("openclaw version 1.2.0 (mock)")
	case strings.Contains(cmd, "gateway status"):
		fmt.Println("Gateway is running (mock)")
	case strings.Contains(cmd, "health"):
		fmt.Println("Healthy")
	case strings.Contains(cmd, "agents list"):
		fmt.Println(`[{"id":"mock_bot","identityName":"模拟机器人","identityEmoji":"🤖","model":"gpt-4","workspace":"/tmp","agentDir":"/tmp","bindings":1,"routes":["Mock"]}]`)
	case strings.Contains(cmd, "models list"):
		fmt.Println(`[{"id":"gpt-4","name":"GPT-4","isDefault":true}]`)
	case strings.Contains(cmd, "plugins list"):
		fmt.Println(`[{"id":"wechat-control","name":"微信控制","version":"1.0.0","enabled":true}]`)
	case strings.Contains(cmd, "skills list"):
		fmt.Println(`[]`)
	case strings.Contains(cmd, "devices list"):
		fmt.Println(`{"pending":[], "authorized":[]}`)
	case strings.Contains(cmd, "gateway stop"):
		fmt.Println("Gateway stopped (mock)")
	default:
		fmt.Printf("Command '%s' executed successfully (mock)\n", cmd)
	}
}
