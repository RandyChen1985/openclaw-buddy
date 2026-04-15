import { useMemo, useState } from 'react';
import { Drawer, Input, Spin, Tabs, Button, message } from 'antd';
import { Eye, PenLine, Save, Sparkles, X } from 'lucide-react';

export interface V3SoulEditorDrawerProps {
  t: any;
  isMobile: boolean;
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
export function V3SoulEditorDrawer({ t, isMobile, selectedBot, botsModels, status }: V3SoulEditorDrawerProps) {
  const [open, setOpen] = useState(false);
  const [soulContent, setSoulContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

  const botId = useMemo(() => (selectedBot || '').replace('openclaw:', ''), [selectedBot]);
  const bot = useMemo(() => botsModels?.data?.bots?.find((b: any) => b.id === botId), [botId, botsModels]);

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
        icon={<Sparkles size={18} color="#eab308" />}
        onClick={handleOpen}
        disabled={!selectedBot || status !== 'authenticated'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fffbeb',
          border: 'none',
          borderRadius: 10,
          height: 38,
          width: 38,
          padding: 0,
          boxShadow: '0 2px 4px rgba(234, 179, 8, 0.05)'
        }}
      />

      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  background: '#fffbeb',
                  padding: 6,
                  borderRadius: 10,
                  border: '1px solid #fef3c7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Sparkles size={18} color="#d97706" />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>
                  {t('bots.editSoul', { defaultValue: '编辑专家灵魂' })}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{botId}</div>
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
          header: { borderBottom: '1px solid #f1f5f9', padding: '16px 24px' },
          body: { padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
        }}
        closable={false}
      >
        {isLoading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: '#f8fafc' }}>
            <Spin size="large" />
            <div style={{ color: '#94a3b8', fontSize: 13, fontFamily: 'monospace' }}>
              {t('chat.soulEditorRecovering', { defaultValue: '正在加载专家灵魂...' })}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Tabs
              activeKey={activeTab}
              onChange={(k) => setActiveTab(k as any)}
              centered
              className="v3-soul-tabs"
              style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
              tabBarStyle={{ marginBottom: 0, padding: '0 16px', borderBottom: '1px solid #f1f5f9', background: '#fff' }}
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
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 'calc(100vh - 250px)' }}>
                      <div style={{ padding: '8px 16px', background: '#f8fafc', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>
                        {t('chat.soulEditorSourceTitle', { defaultValue: '灵魂内容 (Markdown)' })}
                      </div>
                      <Input.TextArea
                        value={soulContent}
                        onChange={e => setSoulContent(e.target.value)}
                        placeholder={t('chat.soulEditorPlaceholder', { defaultValue: '请输入专家灵魂（提示词）...' })}
                        style={{
                          flex: 1,
                          border: 'none',
                          borderRadius: 0,
                          resize: 'none',
                          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                          fontSize: 13,
                          padding: 20,
                          background: '#fff',
                          lineHeight: 1.6,
                          minHeight: 400
                        }}
                      />
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
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 'calc(100vh - 250px)', background: '#fafafa' }}>
                      <div style={{ padding: '8px 16px', background: '#f1f5f9', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>
                        {t('chat.soulEditorLivePreviewTitle', { defaultValue: '实时预览' })}
                      </div>
                      <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
                        <div style={{ maxWidth: 800, margin: '0 auto', background: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.02)', minHeight: '100%' }}>
                          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" }}>
                            {soulContent || t('common.noContent')}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )
                }
              ]}
            />
            <div style={{ padding: '12px 20px', background: '#fff', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fbbf24', animation: 'v3-heartbeat 1.5s infinite' }} />
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
                {t('chat.soulEditorFooterHint', { defaultValue: '修改后点击保存，网关将立即应用最新的专家人格设置。' })}
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}

