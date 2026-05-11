/**
 * 将多种 content 结构统一格式化为 Markdown 文本，供渲染层消费。
 */
export function formatMessageContent(msg: any, _depth = 0): string {
  if (!msg) return '';
  if (_depth > 5) return typeof msg === 'string' ? msg : JSON.stringify(msg);

  const content = (msg.content !== undefined && msg.content !== null) ? msg.content : msg;
  const topThought = msg.thought || msg.thinking || msg.reasoning || '';

  let prefix = '';
  if (topThought) {
    prefix = `> :::thinking\n> \n> ${String(topThought).replace(/\n/g, '\n> ')}\n> \n> :::\n\n`;
  }

  let body = '';
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed === '[]' || trimmed === '{}') body = '';
    else if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        body = formatMessageContent(parsed, _depth + 1);
      } catch {
        body = content;
      }
    } else {
      body = content;
    }
  } else if (Array.isArray(content)) {
    body = content.map((c: any) => {
      let matched = false;

      let thinkingPart = '';
      if (c.thinking || c.thought || c.reasoning || c.type === 'thinking') {
        const thought = c.thinking || c.thought || c.reasoning || c.content || '';
        thinkingPart = `> :::thinking\n> \n> ${String(thought).replace(/\n/g, '\n> ')}\n> \n> :::\n\n`;
        matched = true;
      }

      let planPart = '';
      if (c.type === 'plan' || c.plan) {
        const plan = c.plan || c.content || '';
        planPart = `> :::plan\n> \n> ${String(plan).replace(/\n/g, '\n> ')}\n> \n> :::\n\n`;
        matched = true;
      }

      let commandOutputPart = '';
      if (c.type === 'command_output' || c.command_output || c.commandOutput) {
        const output = c.command_output || c.commandOutput || c.content || '';
        commandOutputPart = `> :::commandOutput\n> ${String(output).replace(/\n/g, '\n> ')}\n> :::\n\n`;
        matched = true;
      }

      let toolCallPart = '';
      if (c.type === 'toolCall' || c.toolCall || c.tool_call) {
        const tc = c.toolCall || c.tool_call || c;
        const name = tc.name || tc.function?.name || 'unknown_tool';
        const args = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {});
        toolCallPart = `> :::toolCall\n> **${name}**\n> \`\`\`json\n> ${args}\n> \`\`\`\n> :::\n\n`;
        matched = true;
      }

      let toolResultPart = '';
      if (c.type === 'toolResult' || c.toolResult || c.tool_result) {
        const tr = c.toolResult || c.tool_result || c;
        const toolName = tr.toolName || tr.tool_name || tr.name || '';
        const result = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content || tr.result || {});
        toolResultPart = `> :::toolResult\n> ${toolName ? `**${toolName}**\n> ` : ''}\`\`\`json\n> ${result}\n> \`\`\`\n> :::\n\n`;
        matched = true;
      }

      const textPart = c.text || (typeof c.content === 'string' ? c.content : '');
      if (textPart) matched = true;

      let fallbackPart = '';
      if (!matched && typeof c === 'object' && c !== null && Object.keys(c).length > 0) {
        fallbackPart = `\n> :::warning 未知消息块 (${c.type || 'unknown'})\n> \`\`\`json\n> ${JSON.stringify(c, null, 2).split('\n').join('\n> ')}\n> \`\`\`\n> :::\n\n`;
      }

      return thinkingPart + planPart + commandOutputPart + toolCallPart + toolResultPart + fallbackPart + textPart;
    }).join('');
  } else if (typeof content === 'object' && content !== null) {
    body = formatMessageContent([content], _depth + 1);
  } else {
    body = String(content);
  }

  return prefix + body;
}
