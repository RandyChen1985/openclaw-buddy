# OpenClaw API 接口封装方案

本文档介绍如何将 OpenClaw CLI 命令封装成 RESTful API，便于外部系统管理和调用。

---

## 1. 微信二维码获取 API

### 背景

OpenClaw 的微信插件通过 `npx @tencent-weixin/openclaw-weixin-cli@latest install` 命令生成登录二维码。由于该命令执行耗时约 30 秒，建议加入缓存机制。

### Python 实现

```python
# wechat_qrcode_api.py
import subprocess
import re
import json
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = 3000

# 缓存二维码，5分钟内有效
qr_code_cache = {
    "url": None,
    "expires_at": 0
}

def exec_get_qrcode():
    """执行 CLI 获取二维码"""
    print("[WeChat] 正在启动微信登录流程...")
    
    try:
        result = subprocess.run(
            ["npx", "-y", "@tencent-weixin/openclaw-weixin-cli@latest", "install"],
            capture_output=True,
            text=True,
            timeout=60
        )
        
        output = result.stdout + result.stderr
        
        # 提取二维码链接
        match = re.search(r'https://liteapp\.weixin\.qq\.com/q/[^\s&]*', output)
        if match:
            qrcode_url = match.group(0) + "&bot_type=3"
            print("[WeChat] 二维码生成成功")
            return {"qrcode_url": qrcode_url}
        
        print("[WeChat] 未找到二维码链接")
        return {"error": "QR code not found"}
    
    except subprocess.TimeoutExpired:
        return {"error": "Timeout expired"}
    except Exception as e:
        return {"error": str(e)}


def get_qrcode(force_refresh=False):
    """获取二维码（带缓存）"""
    global qr_code_cache
    
    now = time.time()
    
    # 检查缓存（5分钟有效）
    if not force_refresh and qr_code_cache["url"] and now < qr_code_cache["expires_at"]:
        print("[API] 返回缓存的二维码")
        return {
            "qrcode_url": qr_code_cache["url"],
            "cached": True,
            "expires_in": int(qr_code_cache["expires_at"] - now)
        }
    
    # 执行获取
    result = exec_get_qrcode()
    
    if "qrcode_url" in result:
        # 更新缓存
        qr_code_cache["url"] = result["qrcode_url"]
        qr_code_cache["expires_at"] = now + 5 * 60
        
        return {
            "qrcode_url": result["qrcode_url"],
            "cached": False
        }
    
    return result


class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        
        if parsed.path == "/wechat/qrcode":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            params = parse_qs(parsed.query)
            force = "force" in params and params["force"][0] == "true"
            
            result = get_qrcode(force_refresh=force)
            self.wfile.write(json.dumps(result).encode())
            
        elif parsed.path == "/wechat/qrcode/refresh":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            result = get_qrcode(force_refresh=True)
            self.wfile.write(json.dumps(result).encode())
            
        elif parsed.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            self.wfile.write(json.dumps({"status": "ok"}).encode())
        
        else:
            self.send_response(404)
            self.end_headers()
    
    def log_message(self, format, *args):
        print(f"[HTTP] {args[0]}")


def run_server():
    server = HTTPServer(("0.0.0.0", PORT), RequestHandler)
    print(f"🚀 WeChat QRCode API 运行在 http://0.0.0.0:{PORT}")
    print(f"   GET /wechat/qrcode         - 获取二维码（带缓存）")
    print(f"   GET /wechat/qrcode?force=true - 强制刷新")
    print(f"   GET /wechat/qrcode/refresh - 强制刷新")
    print(f"   GET /health                - 健康检查")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Server] 正在关闭...")
        server.shutdown()


if __name__ == "__main__":
    run_server()
```

### 接口说明

| 接口 | 说明 | 返回示例 |
|------|------|----------|
| `GET /wechat/qrcode` | 获取二维码（带缓存，5分钟有效） | `{"qrcode_url": "https://...", "cached": false}` |
| `GET /wechat/qrcode?force=true` | 强制刷新二维码 | `{"qrcode_url": "https://..."}` |
| `GET /wechat/qrcode/refresh` | 强制刷新二维码 | `{"qrcode_url": "https://..."}` |
| `GET /health` | 健康检查 | `{"status": "ok"}` |

### 启动方式

```bash
# 直接运行
python wechat_qrcode_api.py

# 生产环境用 gunicorn
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:3000 wechat_qrcode_api:app
```

---

## 2. OpenClaw 管理 API

### 背景

将 OpenClaw CLI 的核心命令封装成 API，支持 Gateway 管理、状态查询、Skills/Channels 查看等操作。

### Python 实现

```python
# openclaw_api.py
import subprocess
import json
import re
import shutil
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = 3001

# OpenClaw CLI 路径
OPENCLAW_BIN = shutil.which('openclaw') or 'openclaw'

def run_openclaw_command(args: list, timeout=30):
    """执行 openclaw 命令"""
    cmd = [OPENCLAW_BIN] + args
    print(f"[OpenClaw] 执行: {' '.join(cmd)}")
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        
        return {
            "success": result.returncode == 0,
            "returncode": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "output": result.stdout + result.stderr
        }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "Timeout expired"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def parse_status_output(output: str) -> dict:
    """解析 status 输出为结构化数据"""
    result = {
        "gateway": {},
        "plugins": [],
        "channels": [],
        "agents": []
    }
    
    lines = output.split('\n')
    
    for line in lines:
        line = line.strip()
        
        # Gateway 状态
        if 'Runtime:' in line:
            match = re.search(r'Runtime:\s*(.+)', line)
            if match:
                result["gateway"]["runtime"] = match.group(1).strip()
        
        if 'PID:' in line:
            match = re.search(r'PID:\s*(\d+)', line)
            if match:
                result["gateway"]["pid"] = int(match.group(1))
        
        # 插件状态
        if line.startswith('│') and '✓' in line:
            parts = [p.strip() for p in line.split('│') if p.strip()]
            if len(parts) >= 2 and parts[0] in ['✓', '✗']:
                result["plugins"].append({
                    "enabled": parts[0] == '✓',
                    "name": parts[1] if len(parts) > 1 else ""
                })
    
    return result


class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        
        # ========== 状态相关 ==========
        if path == "/openclaw/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            result = run_openclaw_command(["status"])
            
            if result["success"]:
                parsed_data = parse_status_output(result["output"])
                self.wfile.write(json.dumps(parsed_data).encode())
            else:
                self.wfile.write(json.dumps(result).encode())
            
        elif path == "/openclaw/status/deep":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            result = run_openclaw_command(["status", "--deep"], timeout=60)
            self.wfile.write(json.dumps({
                "success": result["success"],
                "output": result["output"]
            }).encode())
            
        # ========== Gateway 管理 ==========
        elif path == "/openclaw/gateway/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            result = run_openclaw_command(["gateway", "status"])
            self.wfile.write(json.dumps({
                "success": result["success"],
                "output": result["output"]
            }).encode())
            
        elif path == "/openclaw/gateway/restart":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            result = run_openclaw_command(["gateway", "restart"], timeout=30)
            self.wfile.write(json.dumps(result).encode())
            
        elif path == "/openclaw/gateway/start":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            result = run_openclaw_command(["gateway", "start"], timeout=30)
            self.wfile.write(json.dumps(result).encode())
            
        elif path == "/openclaw/gateway/stop":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            result = run_openclaw_command(["gateway", "stop"], timeout=30)
            self.wfile.write(json.dumps(result).encode())
            
        # ========== Skills & Channels ==========
        elif path == "/openclaw/skills/list":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            result = run_openclaw_command(["skills", "list"])
            self.wfile.write(json.dumps({
                "success": result["success"],
                "output": result["output"]
            }).encode())
            
        elif path == "/openclaw/channels/list":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            result = run_openclaw_command(["channels", "list"])
            self.wfile.write(json.dumps({
                "success": result["success"],
                "output": result["output"]
            }).encode())
            
        # ========== 版本信息 ==========
        elif path == "/openclaw/version":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            result = run_openclaw_command(["--version"])
            self.wfile.write(json.dumps({
                "version": result["output"].strip()
            }).encode())
            
        # ========== 健康检查 ==========
        elif path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            status_result = run_openclaw_command(["gateway", "status"], timeout=10)
            self.wfile.write(json.dumps({
                "status": "ok" if status_result["success"] else "degraded"
            }).encode())
        
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Not found"}).encode())
    
    def log_message(self, format, *args):
        print(f"[HTTP] {args[0]}")


def run_server():
    server = HTTPServer(("0.0.0.0", PORT), RequestHandler)
    print(f"🚀 OpenClaw API 运行在 http://0.0.0.0:{PORT}")
    print("""
📋 可用接口:
   GET /openclaw/version              - 版本信息
   GET /openclaw/status               - 状态（结构化）
   GET /openclaw/status/deep          - 详细状态
   GET /openclaw/gateway/status       - Gateway 状态
   POST /openclaw/gateway/restart     - 重启 Gateway
   POST /openclaw/gateway/start       - 启动 Gateway
   POST /openclaw/gateway/stop        - 停止 Gateway
   GET /openclaw/skills/list          - Skills 列表
   GET /openclaw/channels/list        - Channels 列表
   GET /health                        - 健康检查
""")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Server] 正在关闭...")
        server.shutdown()


if __name__ == "__main__":
    run_server()
```

### 接口说明

| 接口 | 方法 | 说明 | 返回格式 |
|------|------|------|----------|
| `/openclaw/version` | GET | 版本信息 | `{"version": "2026.3.23-2"}` |
| `/openclaw/status` | GET | 状态（结构化） | `{"gateway": {...}, "plugins": [...]}` |
| `/openclaw/status/deep` | GET | 详细状态 | `{"success": true, "output": "..."}` |
| `/openclaw/gateway/status` | GET | Gateway 状态 | `{"success": true, "output": "..."}` |
| `/openclaw/gateway/restart` | GET | 重启 Gateway | `{"success": true, ...}` |
| `/openclaw/gateway/start` | GET | 启动 Gateway | `{"success": true, ...}` |
| `/openclaw/gateway/stop` | GET | 停止 Gateway | `{"success": true, ...}` |
| `/openclaw/skills/list` | GET | Skills 列表 | `{"success": true, "output": "..."}` |
| `/openclaw/channels/list` | GET | Channels 列表 | `{"success": true, "output": "..."}` |
| `/health` | GET | 健康检查 | `{"status": "ok"}` |

---

## 3. 合并实现（推荐）

可以将两个 API 合并到一个服务中，统一端口管理：

```python
# openclaw_manager_api.py
import subprocess
import json
import re
import shutil
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = 3000

# ========== 配置 ==========
OPENCLAW_BIN = shutil.which('openclaw') or 'openclaw'

# 微信二维码缓存
qr_code_cache = {
    "url": None,
    "expires_at": 0
}

# ========== 工具函数 ==========
def run_openclaw_command(args: list, timeout=30):
    """执行 openclaw 命令"""
    cmd = [OPENCLAW_BIN] + args
    print(f"[OpenClaw] 执行: {' '.join(cmd)}")
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        
        return {
            "success": result.returncode == 0,
            "returncode": result.returncode,
            "output": result.stdout + result.stderr
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Timeout expired"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def exec_get_wechat_qrcode():
    """执行 CLI 获取微信二维码"""
    print("[WeChat] 正在启动微信登录流程...")
    
    try:
        result = subprocess.run(
            ["npx", "-y", "@tencent-weixin/openclaw-weixin-cli@latest", "install"],
            capture_output=True,
            text=True,
            timeout=60
        )
        
        output = result.stdout + result.stderr
        match = re.search(r'https://liteapp\.weixin\.qq\.com/q/[^\s&]*', output)
        
        if match:
            qrcode_url = match.group(0) + "&bot_type=3"
            print("[WeChat] 二维码生成成功")
            return {"qrcode_url": qrcode_url}
        
        return {"error": "QR code not found"}
    
    except Exception as e:
        return {"error": str(e)}


def get_wechat_qrcode(force_refresh=False):
    """获取微信二维码（带缓存）"""
    global qr_code_cache
    
    now = time.time()
    
    if not force_refresh and qr_code_cache["url"] and now < qr_code_cache["expires_at"]:
        return {
            "qrcode_url": qr_code_cache["url"],
            "cached": True,
            "expires_in": int(qr_code_cache["expires_at"] - now)
        }
    
    result = exec_get_wechat_qrcode()
    
    if "qrcode_url" in result:
        qr_code_cache["url"] = result["qrcode_url"]
        qr_code_cache["expires_at"] = now + 5 * 60
        return {"qrcode_url": result["qrcode_url"], "cached": False}
    
    return result


# ========== HTTP 处理 ==========
class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)
        
        # ----- 微信二维码 -----
        if path == "/wechat/qrcode":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            force = "force" in params and params["force"][0] == "true"
            result = get_wechat_qrcode(force_refresh=force)
            self.wfile.write(json.dumps(result).encode())
            
        elif path == "/wechat/qrcode/refresh":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            result = get_wechat_qrcode(force_refresh=True)
            self.wfile.write(json.dumps(result).encode())
        
        # ----- OpenClaw 状态 -----
        elif path == "/openclaw/version":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            result = run_openclaw_command(["--version"])
            self.wfile.write(json.dumps({"version": result.get("output", "").strip()}).encode())
            
        elif path == "/openclaw/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            result = run_openclaw_command(["status"])
            self.wfile.write(json.dumps(result).encode())
            
        elif path == "/openclaw/gateway/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            result = run_openclaw_command(["gateway", "status"])
            self.wfile.write(json.dumps(result).encode())
            
        elif path == "/openclaw/gateway/restart":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            result = run_openclaw_command(["gateway", "restart"], timeout=30)
            self.wfile.write(json.dumps(result).encode())
            
        elif path == "/openclaw/gateway/start":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            result = run_openclaw_command(["gateway", "start"], timeout=30)
            self.wfile.write(json.dumps(result).encode())
            
        elif path == "/openclaw/gateway/stop":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            result = run_openclaw_command(["gateway", "stop"], timeout=30)
            self.wfile.write(json.dumps(result).encode())
            
        elif path == "/openclaw/skills/list":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            result = run_openclaw_command(["skills", "list"])
            self.wfile.write(json.dumps(result).encode())
            
        elif path == "/openclaw/channels/list":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            result = run_openclaw_command(["channels", "list"])
            self.wfile.write(json.dumps(result).encode())
        
        # ----- 健康检查 -----
        elif path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            status_result = run_openclaw_command(["gateway", "status"], timeout=10)
            self.wfile.write(json.dumps({
                "status": "ok" if status_result["success"] else "degraded"
            }).encode())
        
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Not found"}).encode())
    
    def log_message(self, format, *args):
        print(f"[HTTP] {args[0]}")


# ========== 启动服务 ==========
def run_server():
    server = HTTPServer(("0.0.0.0", PORT), RequestHandler)
    print(f"""
🚀 OpenClaw 管理 API 运行在 http://0.0.0.0:{PORT}

📋 微信二维码:
   GET /wechat/qrcode            - 获取二维码（带缓存）
   GET /wechat/qrcode?force=true - 强制刷新

📋 OpenClaw 管理:
   GET /openclaw/version         - 版本信息
   GET /openclaw/status          - 状态
   GET /openclaw/gateway/status  - Gateway 状态
   GET /openclaw/gateway/restart  - 重启 Gateway
   GET /openclaw/gateway/start    - 启动 Gateway
   GET /openclaw/gateway/stop     - 停止 Gateway
   GET /openclaw/skills/list      - Skills 列表
   GET /openclaw/channels/list    - Channels 列表

📋 系统:
   GET /health                   - 健康检查
""")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Server] 正在关闭...")
        server.shutdown()


if __name__ == "__main__":
    run_server()
```

---

## 4. 部署建议

### 4.1 直接运行

```bash
# 安装依赖（标准库无需安装）
pip install gunicorn

# 后台运行
nohup python openclaw_manager_api.py > /var/log/openclaw_api.log 2>&1 &

# 或用 gunicorn（推荐）
gunicorn -w 2 -b 0.0.0.0:3000 openclaw_manager_api:app
```

### 4.2 Docker 部署

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY openclaw_manager_api.py .

EXPOSE 3000

CMD ["python", "openclaw_manager_api.py"]
```

```bash
# 构建运行
docker build -t openclaw-api .
docker run -d -p 3000:3000 --name openclaw-api openclaw-api
```

### 4.3 Systemd 服务

```ini
# /etc/systemd/system/openclaw-api.service
[Unit]
Description=OpenClaw API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/.openclaw/workspace
ExecStart=/usr/bin/python3 /root/.openclaw/workspace/openclaw_manager_api.py
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
# 启用服务
systemctl daemon-reload
systemctl enable openclaw-api
systemctl start openclaw-api
```

---

## 5. 注意事项

1. **执行权限**：确保运行 API 服务的用户有权限执行 `openclaw` CLI 命令
2. **超时设置**：微信二维码生成约 30 秒，其他命令通常几秒内完成
3. **缓存策略**：微信二维码已加 5 分钟缓存，避免频繁调用
4. **安全建议**：生产环境建议添加认证机制（如 API Key、JWT）
5. **npx 缓存**：首次部署时可预热 `npx -y @tencent-weixin/openclaw-weixin-cli@latest install --help`

---

## 6. 扩展建议

- **WebSocket**：微信扫码结果可以通过 WebSocket 主动推送
- **权限控制**：添加 API Key 验证
- **日志**：集成 structlog 或 loguru
- **监控**：添加 Prometheus 指标
- **OpenAPI**：用 FastAPI 重写，自动生成 Swagger 文档