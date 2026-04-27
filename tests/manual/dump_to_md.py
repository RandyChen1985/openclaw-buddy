#!/usr/bin/env python3
"""
将 session_dump.json 转为按 user 消息分段的 Markdown 文档。
每个 user 消息开启一个新章节，后续 assistant/toolResult 消息紧跟其后，
每条消息以 JSON 代码块渲染。
"""
import json
import sys
import os

INPUT  = "session_dump.json"
OUTPUT = "session_readable.md"

with open(INPUT, "r", encoding="utf-8") as f:
    data = json.load(f)

meta    = data.get("sessionMeta", {})
history = data.get("history", {})
msgs    = history.get("messages") or history.get("items") or []

# 按 user 消息分组：user 消息开启新的段落，后续 assistant/toolResult 追加到该段
groups = []
current_group = []
for msg in msgs:
    role = msg.get("role", "")
    if role == "user" and current_group:
        groups.append(current_group)
        current_group = [msg]
    else:
        current_group.append(msg)
if current_group:
    groups.append(current_group)

lines = []

# ---- 文件头 ----
lines.append(f"# 会话记录：{meta.get('label', meta.get('displayName', '未知'))}\n")
lines.append(f"> **Session Key**: `{data.get('sessionKey', '')}`  ")
lines.append(f"> **Model**: `{meta.get('model', '')}` | **Provider**: `{meta.get('modelProvider', '')}`  ")
started = meta.get('startedAt', 0)
ended   = meta.get('endedAt', 0)
if started:
    from datetime import datetime, timezone
    dt_s = datetime.fromtimestamp(started / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    dt_e = datetime.fromtimestamp(ended  / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC") if ended else "—"
    lines.append(f"> **Started**: {dt_s}  ")
    lines.append(f"> **Ended**: {dt_e}  ")
lines.append(f"> **Total Messages**: {len(msgs)} | **Groups**: {len(groups)}  ")
lines.append(f"> **Input Tokens**: {meta.get('inputTokens', 0):,} | **Output Tokens**: {meta.get('outputTokens', 0):,}\n")
lines.append("---\n")

# ---- 每个对话段 ----
for idx, group in enumerate(groups, 1):
    user_msgs = [m for m in group if m.get("role") == "user"]
    # 取第一条 user 消息的文本作为标题
    preview = ""
    if user_msgs:
        content = user_msgs[0].get("content", "")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    preview = part.get("text", "")[:120].replace("\n", " ")
                    break
        elif isinstance(content, str):
            preview = content[:120].replace("\n", " ")

    lines.append(f"## 对话段 {idx}  {('：' + preview) if preview else ''}\n")

    ts = user_msgs[0].get("timestamp", 0) if user_msgs else 0
    if ts:
        from datetime import datetime, timezone
        dt = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        lines.append(f"*时间：{dt}*\n")

    for msg in group:
        role = msg.get("role", "unknown")
        seq  = msg.get("__openclaw", {}).get("seq", "?")
        lines.append(f"### `[seq={seq}]` role: **{role}**\n")
        lines.append("```json")
        lines.append(json.dumps(msg, ensure_ascii=False, indent=2))
        lines.append("```\n")

    lines.append("---\n")

with open(OUTPUT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print(f"✅ 已生成 {OUTPUT}  ({os.path.getsize(OUTPUT):,} bytes，共 {len(groups)} 个对话段，{len(msgs)} 条消息)")
