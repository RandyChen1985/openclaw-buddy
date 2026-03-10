package utils

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type DingTalk struct {
	Token  string
	Secret string
}

func NewDingTalk(token, secret string) *DingTalk {
	return &DingTalk{
		Token:  token,
		Secret: secret,
	}
}

func (d *DingTalk) SendMarkdown(title, text string) error {
	timestamp := time.Now().UnixNano() / 1e6
	url := fmt.Sprintf("https://oapi.dingtalk.com/robot/send?access_token=%s", d.Token)

	if d.Secret != "" {
		stringToSign := fmt.Sprintf("%d\n%s", timestamp, d.Secret)
		h := hmac.New(sha256.New, []byte(d.Secret))
		h.Write([]byte(stringToSign))
		sign := base64.StdEncoding.EncodeToString(h.Sum(nil))
		url = fmt.Sprintf("%s&timestamp=%d&sign=%s", url, timestamp, sign)
	}

	msg := map[string]interface{}{
		"msgtype": "markdown",
		"markdown": map[string]string{
			"title": title,
			"text":  text,
		},
	}

	payload, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	resp, err := http.Post(url, "application/json", bytes.NewBuffer(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("dingtalk API returned status: %s", resp.Status)
	}

	return nil
}
