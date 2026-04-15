import React, { useMemo, useState } from 'react';
import { Button, Select } from 'antd';
import { Activity, Bot, Cpu, Plus, Quote, RefreshCw, Zap } from 'lucide-react';
import type { InputAreaHandle } from '../../components/Chat/V3InputArea';
import V3InputArea from '../../components/Chat/V3InputArea';
import { V3SoulEditorDrawer } from './V3SoulEditorDrawer';

export interface V3ComposerBarProps {
  t: any;
  isMobile: boolean;
  status: 'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error';
  isTyping: boolean;
  loadingBots: boolean;

  selectedBot: string;
  setSelectedBot: (bot: string) => void;
  botsModels: any;

  sessionModel: string;
  onSessionModelChange: (newModel: string) => void;

  inputAreaRef: React.RefObject<InputAreaHandle>;
  quotedMsg: string | null;
  onClearQuote: () => void;
  onSend: (text: string, files?: any[]) => void;
  onStop: () => void;
}

/**
 * v3 底部输入区（Composer Bar）：
 * - 机器人/模型选择
 * - 引用消息提示条
 * - 输入框容器（聚焦态/输入法 composing）
 * - 灵魂编辑入口
 *
 * 说明：仅做 UI 拆分与状态内聚，发送/停止仍由父组件提供回调。
 */
export function V3ComposerBar({
  t,
  isMobile,
  status,
  isTyping,
  loadingBots,
  selectedBot,
  setSelectedBot,
  botsModels,
  sessionModel,
  onSessionModelChange,
  inputAreaRef,
  quotedMsg,
  onClearQuote,
  onSend,
  onStop
}: V3ComposerBarProps) {
  const [isComposing, setIsComposing] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const BotAvatar = ({ provider, size = 34 }: { provider: string; size?: number }) => {
    const p = (provider || '').toLowerCase();
    const wrapStyle = {
      width: size,
      height: size,
      borderRadius: '50%',
      background: '#fff',
      border: '1px solid #e2e8f0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
      flexShrink: 0 as const
    };
    if (p.includes('openai')) return <div style={wrapStyle}><Bot size={size * 0.55} color="#10a37f" /></div>;
    if (p.includes('anthropic')) return <div style={{ ...wrapStyle, fontSize: size * 0.45, fontWeight: 900, color: '#d97706', fontFamily: 'serif' }}>A</div>;
    if (p.includes('google') || p.includes('gemini')) return <div style={wrapStyle}><Zap size={size * 0.55} color="#4285f4" fill="#4285f4" /></div>;
    if (p.includes('deepseek')) return <div style={wrapStyle}><Activity size={size * 0.55} color="#0891b2" /></div>;
    return <div style={wrapStyle}><Bot size={size * 0.55} color="#2563eb" /></div>;
  };

  const containerStyle = useMemo(() => ({
    display: 'flex',
    background: '#fff',
    borderRadius: 20,
    boxShadow: isFocused
      ? '0 20px 40px -10px rgba(99, 102, 241, 0.25), 0 0 0 4px rgba(99, 102, 241, 0.3)'
      : '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 0 0 2px rgba(99, 102, 241, 0.1)',
    border: 'none',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
    width: '100%',
    boxSizing: 'border-box' as const,
    transform: isFocused ? 'translateY(-4px)' : 'none'
  }), [isFocused]);

  return (
    <div style={containerStyle} className="input-container-v3">
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', padding: isMobile ? '6px 12px 0' : '12px 16px 0', gap: 8, boxSizing: 'border-box' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          background: '#f8fafc',
          borderRadius: 10,
          border: 'none',
          padding: '2px 4px',
          height: 38,
          flex: isMobile ? 1 : '0 0 auto',
          width: isMobile ? 'auto' : 420,
          minWidth: 0,
          boxShadow: 'none'
        }}>
          <Select
            placeholder={t('chat.selectBotTip')}
            style={{ width: isMobile ? '45%' : 220, fontSize: isMobile ? 11 : 13 }}
            value={selectedBot}
            onChange={setSelectedBot}
            loading={loadingBots}
            disabled={isTyping}
            variant="borderless"
            dropdownStyle={{ borderRadius: 10, minWidth: 240 }}
            dropdownMatchSelectWidth={false}
            listHeight={400}
          >
            {botsModels?.data?.bots?.map((bot: any) => (
              <Select.Option key={bot.id} value={`openclaw:${bot.id}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                  <div style={{ flexShrink: 0 }}>
                    <BotAvatar provider={bot.provider || (bot.id === 'main' ? 'openai' : '')} size={20} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2', minWidth: 0 }}>
                    <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {bot.name || bot.id}
                    </span>
                    <span style={{ fontSize: 9, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {bot.model || '---'} {t('chat.defaultSuffix', { defaultValue: '(默认)' })}
                    </span>
                  </div>
                </div>
              </Select.Option>
            ))}
          </Select>
          <div style={{ width: 1, height: 16, background: '#bfdbfe', margin: '0 4px' }} />
          <Select
            placeholder={t('chat.sessionModelPlaceholder', { defaultValue: '自由切换会话模型' })}
            style={{ flex: 1, fontSize: isMobile ? 11 : 13, minWidth: 0 }}
            value={sessionModel}
            onChange={onSessionModelChange}
            loading={loadingBots}
            disabled={isTyping}
            variant="borderless"
            dropdownStyle={{ borderRadius: 10, minWidth: 200 }}
            dropdownMatchSelectWidth={false}
          >
            <Select.Option value="">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#94a3b8' }}>
                <RefreshCw size={14} />
                <span style={{ fontSize: 13 }}>{t('chat.defaultModel', { defaultValue: '使用默认模型' })}</span>
              </div>
            </Select.Option>
            {(() => {
              const groups = (botsModels?.data?.models || []).reduce((acc: Record<string, any[]>, m: any) => {
                let p = 'Others';
                if (m.id && m.id.includes('/')) p = m.id.split('/')[0];
                else if (m.provider) p = m.provider;
                if (!acc[p]) acc[p] = [];
                acc[p].push(m);
                return acc;
              }, {});
              return Object.keys(groups).sort().map(provider => (
                <Select.OptGroup label={provider.toUpperCase()} key={provider}>
                  {groups[provider].map((m: any) => (
                    <Select.Option key={m.id} value={m.id}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Cpu size={14} style={{ color: '#6366f1' }} />
                        <span style={{ fontSize: 13 }}>{m.name || m.id}</span>
                      </div>
                    </Select.Option>
                  ))}
                </Select.OptGroup>
              ));
            })()}
          </Select>
        </div>

        <V3SoulEditorDrawer
          t={t}
          isMobile={!!isMobile}
          selectedBot={selectedBot}
          botsModels={botsModels}
          status={status}
        />
      </div>

      {quotedMsg && (
        <div style={{ padding: isMobile ? '6px 12px 0' : '8px 16px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, boxSizing: 'border-box', width: '100%', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: '#64748b', background: '#f1f5f9', padding: '4px 8px', borderRadius: 6, minWidth: 0, flex: 1, overflow: 'hidden' }}>
            <Quote size={12} style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={{ overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, wordBreak: 'break-all' } as React.CSSProperties}>{quotedMsg}</span>
          </div>
          <Button type="text" size="small" icon={<Plus size={14} style={{ transform: 'rotate(45deg)' }} />} onClick={onClearQuote} style={{ flexShrink: 0 }} />
        </div>
      )}

      <V3InputArea
        ref={inputAreaRef}
        status={status}
        isMobile={!!isMobile}
        isTyping={isTyping}
        onSend={onSend}
        onStop={onStop}
        t={t}
        isComposing={isComposing}
        setIsComposing={setIsComposing}
        isFocused={isFocused}
        setIsFocused={setIsFocused}
        selectedBot={selectedBot}
      />
    </div>
  );
}

