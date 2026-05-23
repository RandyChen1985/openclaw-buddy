import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Drawer, Input, Tabs, message as antdMessage } from 'antd';
import { Copy, Loader2, RefreshCw, Save, Wand2, X } from 'lucide-react';
import Tooltip from '../../components/common/AppTooltip';
import { streamModelChatCompletions, type ChatCompletionMessage } from '../../api';
import api from '../../api';
import type { Message } from '../../hooks/useChatV3WebSocket';

export interface V3SkillDraftDrawerProps {
  t: any;
  isDarkMode?: boolean;
  open: boolean;
  onClose: () => void;
  status: 'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error';
  messages: Message[];
  sessionLabel?: string | null;
  modelID: string;
  workspacePath?: string;
  copyToClipboard?: (text: string) => void;
}

type DraftParts = {
  skillMd: string;
  readmeMd: string;
};

const PART_SKILL = 'SKILL.md';
const PART_README = 'README.md';

function stripMarker(raw: string, marker: string): string {
  const re = new RegExp(`^\\s*#+\\s*${marker.replace('.', '\\.')}\\s*\\n`, 'i');
  return raw.replace(re, '').trim();
}

function splitSkillDraft(raw: string): DraftParts {
  const text = (raw || '').trim();
  if (!text) return { skillMd: '', readmeMd: '' };

  const skillMatch = text.match(/<SKILL_MD>([\s\S]*?)<\/SKILL_MD>/i);
  const readmeMatch = text.match(/<README_MD>([\s\S]*?)<\/README_MD>/i);
  if (skillMatch || readmeMatch) {
    return {
      skillMd: (skillMatch?.[1] || '').trim(),
      readmeMd: (readmeMatch?.[1] || '').trim(),
    };
  }

  const readmeIdx = text.search(/^#{1,3}\s*README\.md\s*$/im);
  if (readmeIdx >= 0) {
    return {
      skillMd: stripMarker(text.slice(0, readmeIdx), PART_SKILL),
      readmeMd: stripMarker(text.slice(readmeIdx), PART_README),
    };
  }

  return { skillMd: text, readmeMd: '' };
}

function buildTranscript(messages: Message[]): string {
  const rows = messages
    .filter(m => !m._uiMetaOnly && (m.content || '').trim())
    .slice(-36)
    .map(m => {
      const role = m.role === 'assistant' ? 'Assistant' : m.role === 'user' ? 'User' : 'System';
      const content = m.content.replace(/\s+$/g, '').slice(0, 3000);
      return `### ${role}\n${content}`;
    });

  const transcript = rows.join('\n\n');
  return transcript.length > 24000 ? transcript.slice(-24000) : transcript;
}

function buildPrompt(transcript: string, sessionLabel?: string | null): ChatCompletionMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是 OpenClaw Buddy 的高级运维技能沉淀助手。你的核心任务是分析一段排障、配置或系统维护 of 中文工作对话，将其提炼为供 AI Agent 执行的、极其严谨的结构化“可复用技能”草稿。',
        '',
        '你必须遵循以下工程化编写规约：',
        '1. **防止触发不足的描述 (Anti-Undertriggering)**：',
        '   在 YAML 头部的 `description` 中，除了解释此技能是什么，还必须极其明确地写出该技能的“唤醒契机与场景触发说明”，引导 AI 在后续任务中更主动地使用此技能。描述需略带引导性（例如：“当遇到X、检测到Y、或用户提到Z时必须使用该技能”）。',
        '2. **动词起点的祈使句指令 (Imperative Instructions)**：',
        '   `SKILL.md` 中定义的所有排障及自愈执行步骤，必须全量使用动词开头的祈使句（如：“检查端口”、“拉取分支”、“运行自愈脚本”），杜绝生硬的陈述句。',
        '3. **零意外与安全防爆机制 (Principle of Lack of Surprise)**：',
        '   技能中必须包含安全检查流程。对高危、破坏性或提权指令（如 rm -rf, chmod, systemctl 重启核心服务），必须设定明确的拦截探测与安全前置置信度校验步骤，绝不能包含恶意、暗戳戳的提权脚本，确保执行过程零意外。',
        '4. **渐进式披露分层 (Progressive Disclosure)**：',
        '   如果技能流程庞大、包含复杂的外部可执行脚本（Shell, Python 等）或大篇幅参考文档，**必须将其从主干剥离并输出为独立的附属文件**以保持主干精炼（在 500 行内）。',
        '   - 外部可执行脚本应输出在 `scripts/` 目录下（例如：`<FILE path="scripts/clean_log.sh">...</FILE>`）。',
        '   - 大型参考文档或 API 规范应输出在 `references/` 目录下（例如：`<FILE path="references/api_endpoints.md">...</FILE>`）。',
        '5. **必须输出两个核心 XML 标签块与可选的额外 FILE 块**：',
        '   - `<SKILL_MD>`：供 AI Agent 自动读取执行的指令规范。以 YAML front matter 开头，包含：name (英文/拼音横线) 与 description (触发式描述)，后续包含：触发情境、执行前置条件、核心命令式步骤、安全防爆校验、失败自愈预案。',
        '   - `<README_MD>`：供人类运维阅读的说明。包含：用途说明、依赖说明、参数与输入、运行示例、注意事项。',
        '   - `<FILE path="scripts/xxx.sh">...</FILE>` 或 `<FILE path="references/yyy.md">...</FILE>`：如果包含外部脚本或大篇幅参考规范，使用此标签包裹输出。路径中仅支持斜杠 `/`，不支持反斜杠。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `会话标题：${sessionLabel || '未命名会话'}`,
        '',
        '请基于下面的对话提炼并生成一个 OpenClaw 技能草稿。',
        '',
        '要求：',
        '- SKILL.md 必须以 YAML front matter 开头，格式为：---\\nname: "<英文或拼音目录名>"\\ndescription: "<一句话触发引导描述>"\\n---。',
        '- SKILL.md 面向 AI 使用，包含：触发场景、执行步骤（祈使句）、安全校验、失败自愈。',
        '- README.md 面向人使用，包含：用途、输入说明、示例、注意事项。',
        '- 如果有任何特定可执行的辅助脚本或详细的配置模板文档，强制以独立的 `<FILE path="scripts/文件名">` 或 `<FILE path="references/文件名">` 格式包裹输出，保持 SKILL.md 精简。',
        '- 解释清楚每一步骤的逻辑和为什么要这么做的“安全原因”（Theory of Mind），而非强行堆砌“必须”。',
        '- 不要编造不存在的脚本路径；如果对话里没有明确文件，就写“可后续补充”。',
        '- 技能名称要具体，不要叫“通用助手”。',
        '- 全部使用中文。',
        '',
        '<TRANSCRIPT>',
        transcript || '当前会话暂无可用内容。',
        '</TRANSCRIPT>',
      ].join('\n'),
    },
  ];
}

function pickInitialName(sessionLabel?: string | null): string {
  const raw = (sessionLabel || '').trim();
  if (!raw || raw === '新会话' || raw.toLowerCase() === 'untitled') return '从当前对话生成技能';
  return raw.length > 28 ? `${raw.slice(0, 28)}…` : raw;
}

function slugifySkillName(name: string): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || `skill-${new Date().toISOString().slice(0, 10)}`;
}

function escapeYamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').trim()}"`;
}

function extractDraftDescription(markdown: string, fallbackName: string): string {
  const lines = markdown
    .replace(/^---[\s\S]*?---\s*/m, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && !line.startsWith('---'));
  const first = lines.find(line => !line.startsWith('- ') && !line.startsWith('* ')) || lines[0] || '';
  const cleaned = first.replace(/\*\*/g, '').replace(/^[-*]\s*/, '').trim();
  return (cleaned || `${fallbackName}：从对话沉淀的可复用技能。`).slice(0, 180);
}

function ensureSkillFrontmatter(markdown: string, dirName: string, displayName: string): string {
  const text = markdown.trim();
  const safeName = slugifySkillName(dirName || displayName);
  const description = extractDraftDescription(text, displayName || safeName);
  if (/^---\s*[\s\S]*?\bname\s*:\s*.+[\s\S]*?\bdescription\s*:\s*.+[\s\S]*?---/m.test(text)) {
    return text;
  }
  const body = text.replace(/^---[\s\S]*?---\s*/m, '').trim();
  return [
    '---',
    `name: ${escapeYamlString(safeName)}`,
    `description: ${escapeYamlString(description)}`,
    '---',
    '',
    body || `# ${displayName || safeName}`,
  ].join('\n');
}

function joinPath(base: string, child: string): string {
  return `${base.replace(/\/+$/, '')}/${child.replace(/^\/+/, '')}`;
}

export function V3SkillDraftDrawer({
  t,
  isDarkMode = false,
  open,
  onClose,
  status,
  messages,
  sessionLabel,
  modelID,
  workspacePath,
  copyToClipboard,
}: V3SkillDraftDrawerProps) {
  const [rawDraft, setRawDraft] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('skill');
  const [skillName, setSkillName] = useState(() => pickInitialName(sessionLabel));
  const [skillDirName, setSkillDirName] = useState(() => slugifySkillName(pickInitialName(sessionLabel)));
  const abortRef = useRef<AbortController | null>(null);

  const transcript = useMemo(() => buildTranscript(messages), [messages]);
  const draftParts = useMemo(() => splitSkillDraft(rawDraft), [rawDraft]);
  const canGenerate = status === 'authenticated' && !!modelID && !!transcript.trim() && !isGenerating;
  const skillWorkspacePath = workspacePath || '~/.openclaw/workspace';
  const skillRootPath = joinPath(skillWorkspacePath, 'skills');
  const skillTargetPath = skillRootPath && skillDirName ? joinPath(skillRootPath, skillDirName) : '';

  const extraFiles = useMemo(() => {
    const matches = [...rawDraft.matchAll(/<FILE\s+path="([^"]+)">([\s\S]*?)<\/FILE>/gi)];
    return matches.map(m => ({
      path: m[1].trim(),
      content: m[2].trim(),
    }));
  }, [rawDraft]);

  useEffect(() => {
    if (!open) return;
    const nextName = pickInitialName(sessionLabel);
    setSkillName(nextName);
    setSkillDirName(slugifySkillName(nextName));
  }, [open, sessionLabel]);

  const copyText = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      if (copyToClipboard) {
        copyToClipboard(text);
      } else {
        navigator.clipboard?.writeText(text);
        antdMessage.success(t('common.copied', { defaultValue: '已复制' }));
      }
    },
    [copyToClipboard, t],
  );

  const generateDraft = useCallback(async () => {
    if (!modelID) {
      antdMessage.warning(t('chat.skillDraftNoModel', { defaultValue: '暂无可用模型，无法生成技能草稿' }));
      return;
    }
    if (!transcript.trim()) {
      antdMessage.warning(t('chat.skillDraftNoMessages', { defaultValue: '当前会话暂无可用于转技能的消息' }));
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRawDraft('');
    setActiveTab('skill');
    setIsGenerating(true);

    try {
      await streamModelChatCompletions(modelID, buildPrompt(transcript, sessionLabel), {
        signal: controller.signal,
        onDelta: chunk => setRawDraft(prev => prev + chunk),
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      antdMessage.error(msg || t('chat.skillDraftFailed', { defaultValue: '技能草稿生成失败' }));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsGenerating(false);
    }
  }, [modelID, sessionLabel, t, transcript]);

  const saveToWorkspace = useCallback(async () => {
    const cleanDir = skillDirName.trim();
    if (!cleanDir || cleanDir.includes('/') || cleanDir.includes('\\') || cleanDir.includes('..')) {
      antdMessage.warning(t('chat.skillDraftInvalidDir', { defaultValue: '请输入有效的技能目录名' }));
      return;
    }
    if (!draftParts.skillMd.trim() && !draftParts.readmeMd.trim()) {
      antdMessage.warning(t('chat.skillDraftNoContent', { defaultValue: '暂无可保存的技能草稿' }));
      return;
    }

    setIsSaving(true);
    try {
      const normalizedSkillMd = ensureSkillFrontmatter(draftParts.skillMd, cleanDir, skillName);
      await api.post('/v1/openclaw/files/mkdir', { path: skillWorkspacePath, dirname: 'skills' }).catch((err: any) => {
        const msg = String(err?.response?.data?.error || err?.message || '');
        if (!/exist|exists|已存在|file exists/i.test(msg)) throw err;
      });
      await api.post('/v1/openclaw/files/mkdir', { path: skillRootPath, dirname: cleanDir }).catch((err: any) => {
        const msg = String(err?.response?.data?.error || err?.message || '');
        if (!/exist|exists|已存在|file exists/i.test(msg)) throw err;
      });
      await api.post('/v1/openclaw/files/create', {
        path: skillTargetPath,
        filename: 'SKILL.md',
        content: normalizedSkillMd,
      }).catch(async (err: any) => {
        const msg = String(err?.response?.data?.error || err?.message || '');
        if (!/exist|exists|已存在|file exists/i.test(msg)) throw err;
        await api.post('/v1/openclaw/files/save', { path: joinPath(skillTargetPath, 'SKILL.md'), content: normalizedSkillMd });
      });
      await api.post('/v1/openclaw/files/create', {
        path: skillTargetPath,
        filename: 'README.md',
        content: draftParts.readmeMd || `# ${skillName}\n\n可后续补充使用说明。\n`,
      }).catch(async (err: any) => {
        const msg = String(err?.response?.data?.error || err?.message || '');
        if (!/exist|exists|已存在|file exists/i.test(msg)) throw err;
        await api.post('/v1/openclaw/files/save', {
          path: joinPath(skillTargetPath, 'README.md'),
          content: draftParts.readmeMd || `# ${skillName}\n\n可后续补充使用说明。\n`,
        });
      });

      for (const file of extraFiles) {
        const pathParts = file.path.split('/');
        let targetWritePath = skillTargetPath;
        let finalFilename = file.path;

        if (pathParts.length > 1) {
          const subDirs = pathParts.slice(0, -1);
          finalFilename = pathParts[pathParts.length - 1];

          let currentParent = skillTargetPath;
          for (const subDir of subDirs) {
            await api.post('/v1/openclaw/files/mkdir', { path: currentParent, dirname: subDir }).catch((err: any) => {
              const msg = String(err?.response?.data?.error || err?.message || '');
              if (!/exist|exists|已存在|file exists/i.test(msg)) throw err;
            });
            currentParent = joinPath(currentParent, subDir);
          }
          targetWritePath = currentParent;
        }

        const writeTargetPath = joinPath(targetWritePath, finalFilename);
        await api.post('/v1/openclaw/files/create', {
          path: targetWritePath,
          filename: finalFilename,
          content: file.content,
        }).catch(async (err: any) => {
          const msg = String(err?.response?.data?.error || err?.message || '');
          if (!/exist|exists|已存在|file exists/i.test(msg)) throw err;
          await api.post('/v1/openclaw/files/save', {
            path: writeTargetPath,
            content: file.content,
          });
        });
      }

      antdMessage.success(t('chat.skillDraftSaved', { path: skillTargetPath, defaultValue: `已保存到 ${skillTargetPath}` }));
      
      await api.post('/v1/openclaw/skills/reload').catch((reloadErr: any) => {
        console.error('Failed to trigger skills engine reload after saving:', reloadErr);
      });
      window.dispatchEvent(new CustomEvent('openclaw:skills-updated'));
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.error || err?.message || t('chat.skillDraftSaveFailed', { defaultValue: '技能保存失败' }));
    } finally {
      setIsSaving(false);
    }
  }, [draftParts.readmeMd, draftParts.skillMd, extraFiles, skillDirName, skillName, skillRootPath, skillTargetPath, skillWorkspacePath, t]);

  useEffect(() => {
    if (!open) return;
    if (!rawDraft && status === 'authenticated' && modelID && transcript.trim()) {
      void generateDraft();
    }
  }, [generateDraft, modelID, open, rawDraft, status, transcript]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const textAreaStyle = {
    minHeight: 460,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.6,
    borderRadius: 10,
    background: isDarkMode ? '#0f172a' : '#fff',
    color: isDarkMode ? '#e2e8f0' : '#0f172a',
  };

  const extraTabItems = useMemo(() => {
    return extraFiles.map((file, idx) => ({
      key: `extra-${idx}`,
      label: file.path,
      children: (
        <Input.TextArea
          value={file.content}
          readOnly
          style={textAreaStyle}
          placeholder={t('chat.skillDraftExtraPlaceholder', { defaultValue: '附属文件内容。' })}
        />
      ),
    }));
  }, [extraFiles, textAreaStyle, t]);

  const tabItems = useMemo(() => [
    {
      key: 'skill',
      label: PART_SKILL,
      children: (
        <Input.TextArea
          value={draftParts.skillMd}
          onChange={e => setRawDraft(() => {
            const readme = draftParts.readmeMd;
            const extraBlocks = extraFiles.map(f => `<FILE path="${f.path}">\n${f.content}\n</FILE>`).join('\n');
            return `<SKILL_MD>\n${e.target.value}\n</SKILL_MD>\n<README_MD>\n${readme}\n</README_MD>\n${extraBlocks}`;
          })}
          placeholder={t('chat.skillDraftGenerating', { defaultValue: '正在生成技能草稿…' })}
          style={textAreaStyle}
        />
      ),
    },
    {
      key: 'readme',
      label: PART_README,
      children: (
        <Input.TextArea
          value={draftParts.readmeMd}
          onChange={e => setRawDraft(() => {
            const skill = draftParts.skillMd;
            const extraBlocks = extraFiles.map(f => `<FILE path="${f.path}">\n${f.content}\n</FILE>`).join('\n');
            return `<SKILL_MD>\n${skill}\n</SKILL_MD>\n<README_MD>\n${e.target.value}\n</README_MD>\n${extraBlocks}`;
          })}
          placeholder={t('chat.skillDraftReadmePlaceholder', { defaultValue: 'README 草稿会显示在这里' })}
          style={textAreaStyle}
        />
      ),
    },
    ...extraTabItems,
  ], [draftParts.readmeMd, draftParts.skillMd, extraFiles, extraTabItems, textAreaStyle, t]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={640}
      placement="right"
      destroyOnClose={false}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Wand2 size={18} color="#8b5cf6" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>
              {t('chat.convertToSkill', { defaultValue: '转为技能' })}
            </div>
            <div style={{ marginTop: 2, fontSize: 12, fontWeight: 500, color: isDarkMode ? '#94a3b8' : '#64748b' }}>
              {pickInitialName(sessionLabel)}
            </div>
          </div>
        </div>
      }
      extra={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tooltip title={t('chat.saveSkillDraftToWorkspace', { defaultValue: '保存到工作区技能目录' })}>
            <Button
              size="small"
              type="primary"
              icon={isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              onClick={saveToWorkspace}
              disabled={isGenerating || isSaving || !skillDirName.trim() || !draftParts.skillMd.trim()}
            >
              {t('common.save', { defaultValue: '保存' })}
            </Button>
          </Tooltip>
          <Tooltip title={t('chat.regenerateSkillDraft', { defaultValue: '重新生成' })}>
            <Button
              size="small"
              icon={isGenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              onClick={generateDraft}
              disabled={!canGenerate && !isGenerating}
            />
          </Tooltip>
          <Tooltip title={t('chat.copyCurrentDraft', { defaultValue: '复制当前草稿' })}>
            <Button
              size="small"
              icon={<Copy size={14} />}
              onClick={() => copyText(activeTab === 'skill' ? draftParts.skillMd : draftParts.readmeMd)}
              disabled={isGenerating || !(activeTab === 'skill' ? draftParts.skillMd : draftParts.readmeMd).trim()}
            />
          </Tooltip>
          <Button size="small" type="text" icon={<X size={16} />} onClick={onClose} />
        </div>
      }
      styles={{
        body: {
          padding: 16,
          background: isDarkMode ? '#0f172a' : '#f8fafc',
        },
        header: {
          background: isDarkMode ? '#111827' : '#fff',
          borderBottomColor: isDarkMode ? '#334155' : '#e2e8f0',
        },
      }}
    >
      <div
        style={{
          marginBottom: 12,
          padding: '10px 12px',
          borderRadius: 10,
          border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
          background: isDarkMode ? '#111827' : '#fff',
          color: isDarkMode ? '#cbd5e1' : '#475569',
          fontSize: 12,
          lineHeight: 1.6,
        }}
      >
        {isGenerating
          ? t('chat.skillDraftGeneratingHint', { defaultValue: '正在从当前会话提炼可复用的技能草稿…' })
          : t('chat.skillDraftHint', {
              defaultValue: '确认内容后可保存到 OpenClaw 可扫描的 workspace/skills 目录；同名文件会被更新。',
            })}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 10,
          marginBottom: 12,
        }}
      >
        <Input
          value={skillName}
          onChange={e => {
            const next = e.target.value;
            setSkillName(next);
            setSkillDirName(slugifySkillName(next));
          }}
          placeholder={t('chat.skillDraftNamePlaceholder', { defaultValue: '技能名称' })}
          disabled={isSaving}
        />
        <Input
          value={skillDirName}
          onChange={e => setSkillDirName(e.target.value)}
          placeholder={t('chat.skillDraftDirPlaceholder', { defaultValue: '目录名，例如 daily-report' })}
          disabled={isSaving}
          addonBefore="skills/"
        />
      </div>
      {skillTargetPath && (
        <div style={{ marginBottom: 8, fontSize: 12, color: isDarkMode ? '#94a3b8' : '#64748b' }}>
          {t('chat.skillDraftSavePath', { path: skillTargetPath, defaultValue: `保存位置：${skillTargetPath}` })}
        </div>
      )}
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </Drawer>
  );
}
