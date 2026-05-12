export type NormalizedTranscriptContent = {
  content: string;
  forceAssistantRole: boolean;
  isExecCompletionTemplate: boolean;
  isSenderMetadataTemplate: boolean;
  isApprovalConfirm: boolean;
  isApproveCommand: boolean;
};

function asToolResult(toolName: string, content: string): string {
  return `> :::toolResult\n> **${toolName}**\n> ${content}\n> :::\n`;
}

/**
 * 网关 transcript 里有一些回执/元信息可能被标成 user 或普通 assistant。
 * 统一改写成 toolResult 格式，让 UI 以隐藏/折叠元信息处理。
 */
export function normalizeTranscriptNoise(content: string): NormalizedTranscriptContent {
  let normalized = content;

  const isExecCompletionTemplate =
    typeof normalized === 'string' &&
    normalized.includes('An async command the user already approved has completed.') &&
    normalized.includes('Exact completion details:') &&
    normalized.includes('Exec finished');

  const isSenderMetadataTemplate =
    typeof normalized === 'string' &&
    (normalized.includes('Sender (untrusted metadata):') || normalized.includes('Sender(untrusted metadata):'));

  let forceAssistantRole = false;

  if (isExecCompletionTemplate || isSenderMetadataTemplate) {
    const safeText = normalized.trim().split('\n').join('\n> ');
    const toolName = isSenderMetadataTemplate ? 'sender_metadata' : 'exec';
    normalized = asToolResult(toolName, safeText);
    forceAssistantRole = true;
  }

  const isApprovalConfirm = /Approval\s+\S+\s+submitted\s+for\s+[a-f0-9-]+/i.test(normalized.trim());
  if (isApprovalConfirm) {
    normalized = asToolResult('approval', normalized.trim());
    forceAssistantRole = true;
  }

  const isApproveCommand = /^\/approve\s+[a-f0-9-]+\s+(allow-once|allow-always)$/i.test(normalized.trim());
  if (isApproveCommand) {
    normalized = asToolResult('approval', normalized.trim());
    forceAssistantRole = true;
  }

  return {
    content: normalized,
    forceAssistantRole,
    isExecCompletionTemplate,
    isSenderMetadataTemplate,
    isApprovalConfirm,
    isApproveCommand,
  };
}
