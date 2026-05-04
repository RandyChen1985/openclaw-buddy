import { useMemo, useState } from 'react';
import { Drawer, Input, Spin, Tabs, Button, message } from 'antd';
import { Brain, Eye, PenLine, Save, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import TokenBadge from '../../components/TokenBadge';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeSanitize from 'rehype-sanitize';

export interface V3SoulEditorDrawerProps {
  t: any;
  isMobile: boolean;
  isDarkMode?: boolean;
  selectedBot: string;
  botsModels: any;
  status: 'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error';
}

/**
 * v3 灵魂编辑器抽离组件：负责 Drawer 打开/关闭、加载/保存 soul 文件、编辑/预览切换。
 *
 * 说明：
 * - 保持原有 API 调用与交互体验不变（仅从 ChatV3.tsx 抽出）
 * - 组件内部管理自身状态，外部只需提供 selectedBot/status 等上下文
 */
export function V3SoulEditorDrawer({ t, isMobile, isDarkMode = false, selectedBot, botsModels, status }: V3SoulEditorDrawerProps) {
  const [open, setOpen] = useState(false);
  const [soulContent, setSoulContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

  const botId = useMemo(() => (selectedBot || '').replace('openclaw:', ''), [selectedBot]);
  const bot = useMemo(() => botsModels?.data?.bots?.find((b: any) => b.id === botId), [botId, botsModels]);

  const shell = useMemo(
    () =>
      isDarkMode
        ? {
            triggerBg: 'rgba(124, 58, 237, 0.18)',
            headerBorder: '#334155',
            title: '#f1f5f9',
            subtitle: '#94a3b8',
            iconWrapBg: 'rgba(250, 204, 21, 0.12)',
            iconWrapBorder: 'rgba(250, 204, 21, 0.35)',
            bodyBg: '#0f172a',
            tabBarBg: '#1e293b',
            tabBarBorder: '#334155',
            sectionMuted: '#0f172a',
            sectionLabel: '#94a3b8',
            editorBg: '#0f172a',
            previewShell: '#0f172a',
            previewHeader: '#1e293b',
            previewCard: '#1e293b',
            previewCardShadow: '0 2px 12px rgba(0,0,0,0.35)',
            previewText: '#cbd5e1',
            footerBg: '#1e293b',
            footerBorder: '#334155',
            emptyHint: '#94a3b8',
            loadBg: '#0f172a'
          }
        : {
            triggerBg: '#f5f3ff',
            headerBorder: '#f1f5f9',
            title: '#1e293b',
            subtitle: '#94a3b8',
            iconWrapBg: '#fffbeb',
            iconWrapBorder: '#fef3c7',
            bodyBg: '#fff',
            tabBarBg: '#fff',
            tabBarBorder: '#f1f5f9',
            sectionMuted: '#f8fafc',
            sectionLabel: '#64748b',
            editorBg: '#fff',
            previewShell: '#fafafa',
            previewHeader: '#f1f5f9',
            previewCard: '#fff',
            previewCardShadow: '0 2px 8px rgba(0,0,0,0.02)',
            previewText: '#334155',
            footerBg: '#fff',
            footerBorder: '#f1f5f9',
            emptyHint: '#94a3b8',
            loadBg: '#f8fafc'
          },
    [isDarkMode]
  );

  /**
   * 打开并加载 Soul 内容。
   */
  const handleOpen = async () => {
    if (!selectedBot) return;
    try {
      setIsLoading(true);
      setActiveTab('edit');
      setOpen(true);
      const api = await import('../../api').then(m => m.default);
      const res = await api.get(
        `/v1/openclaw/bots/file?id=${botId}&type=soul${bot?.workspace ? `&workspace=${encodeURIComponent(bot.workspace)}` : ''}`
      );
      setSoulContent(res.data.content || '');
    } catch {
      message.error(t('common.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 保存 Soul 内容并关闭 Drawer。
   */
  const handleSave = async () => {
    if (!selectedBot) return;
    try {
      setIsSaving(true);
      const api = await import('../../api').then(m => m.default);
      await api.post('/v1/openclaw/bots/file', { id: botId, type: 'soul', content: soulContent, workspace: bot?.workspace });
      message.success(t('bots.saveSuccess'));
      setOpen(false);
    } catch {
      message.error(t('bots.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Button
        type="text"
        size="small"
        icon={<Brain size={18} color="#8b5cf6" />}
        onClick={handleOpen}
        disabled={!selectedBot || status !== 'authenticated'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: shell.triggerBg,
          border: 'none',
          borderRadius: 10,
          height: 38,
          width: 38,
          padding: 0,
          boxShadow: '0 2px 4px rgba(124, 58, 237, 0.06)'
        }}
      />

      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  background: shell.iconWrapBg,
                  padding: 6,
                  borderRadius: 10,
                  border: `1px solid ${shell.iconWrapBorder}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Brain size={18} color="#7c3aed" />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: shell.title }}>
                  {t('bots.editSoul', { defaultValue: '编辑专家灵魂' })}
                </div>
                <div style={{ fontSize: 11, color: shell.subtitle, fontWeight: 500 }}>{botId}</div>
              </div>
            </div>
          </div>
        }
        placement="right"
        onClose={() => setOpen(false)}
        open={open}
        width={isMobile ? '100%' : 600}
        extra={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button icon={<X size={16} />} onClick={() => setOpen(false)} />
            <Button
              type="primary"
              icon={<Save size={16} />}
              loading={isSaving}
              onClick={handleSave}
              style={{ background: '#2563eb', borderRadius: 8, height: 32 }}
            >
              {t('common.save', { defaultValue: '保存并应用' })}
            </Button>
          </div>
        }
        styles={{
          header: { borderBottom: `1px solid ${shell.headerBorder}`, padding: '16px 24px', background: shell.tabBarBg },
          body: {
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flex: 1,
            minHeight: 0,
            background: shell.bodyBg
          }
        }}
        closable={false}
      >
        {isLoading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: shell.loadBg }}>
            <Spin size="large" />
            <div style={{ color: shell.subtitle, fontSize: 13, fontFamily: 'monospace' }}>
              {t('chat.soulEditorRecovering', { defaultValue: '正在加载专家灵魂...' })}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <Tabs
              activeKey={activeTab}
              onChange={(k) => setActiveTab(k as any)}
              centered
              className="v3-soul-tabs"
              style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              tabBarStyle={{ marginBottom: 0, padding: '0 16px', borderBottom: `1px solid ${shell.tabBarBorder}`, background: shell.tabBarBg }}
              items={[
                {
                  key: 'edit',
                  label: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                      <PenLine size={16} />
                      <span>{t('common.edit', { defaultValue: '编辑内容' })}</span>
                    </div>
                  ),
                  children: (
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                      <div style={{ padding: '8px 16px', background: shell.sectionMuted, fontSize: 11, fontWeight: 700, color: shell.sectionLabel, textTransform: 'uppercase', letterSpacing: 1, flexShrink: 0 }}>
                        {t('chat.soulEditorSourceTitle', { defaultValue: '灵魂内容 (Markdown)' })}
                      </div>
                      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                        <TokenBadge text={soulContent} />
                        <Input.TextArea
                          value={soulContent}
                          onChange={e => setSoulContent(e.target.value)}
                          placeholder={t('chat.soulEditorPlaceholder', { defaultValue: '请输入专家灵魂（提示词）...' })}
                          style={{
                            flex: 1,
                            minHeight: 0,
                            border: 'none',
                            borderRadius: 0,
                            resize: 'none',
                            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                            fontSize: 13,
                            padding: 20,
                            background: shell.editorBg,
                            lineHeight: 1.6,
                            overflowY: 'auto'
                          }}
                        />
                      </div>
                    </div>
                  )
                },
                {
                  key: 'preview',
                  label: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                      <Eye size={16} />
                      <span>{t('common.preview', { defaultValue: '实时预览' })}</span>
                    </div>
                  ),
                  children: (
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', background: shell.previewShell }}>
                      <div style={{ padding: '8px 16px', background: shell.previewHeader, fontSize: 11, fontWeight: 700, color: shell.sectionLabel, textTransform: 'uppercase', letterSpacing: 1, flexShrink: 0 }}>
                        {t('chat.soulEditorLivePreviewTitle', { defaultValue: '实时预览' })}
                      </div>
                      <div style={{ flex: 1, minHeight: 0, padding: 20, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
                        <div style={{ maxWidth: 800, margin: '0 auto', background: shell.previewCard, padding: 24, borderRadius: 12, boxShadow: shell.previewCardShadow, border: isDarkMode ? '1px solid #334155' : undefined }}>
                          {soulContent.trim() ? (
                            <div
                              className={`markdown-body-v3 v3-soul-preview-md${isDarkMode ? ' v3-soul-preview-md--dark' : ''}`}
                              style={{ fontSize: 14, color: shell.previewText }}
                            >
                              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeSanitize]}>
                                {soulContent}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            <div style={{ color: shell.emptyHint, fontSize: 14 }}>{t('common.noContent')}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                }
              ]}
            />
            <div style={{ padding: '12px 20px', background: shell.footerBg, borderTop: `1px solid ${shell.footerBorder}`, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fbbf24', animation: 'v3-heartbeat 1.5s infinite' }} />
              <div style={{ fontSize: 11, color: shell.subtitle, fontWeight: 500 }}>
                {t('chat.soulEditorFooterHint', { defaultValue: '修改后点击保存，网关将立即应用最新的专家人格设置。' })}
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}

