import React, { useMemo, useState } from 'react';
import { Button, Select } from 'antd';
import { Activity, Bot, Cpu, Image, Plus, Quote, RefreshCw, Terminal as TerminalIcon, Zap } from 'lucide-react';
import type { InputAreaHandle } from '../../components/Chat/V3InputArea';
import V3InputArea from '../../components/Chat/V3InputArea';
import { V3SoulEditorDrawer } from './V3SoulEditorDrawer';
import { V3SkillsDrawer } from './V3SkillsDrawer';
import Tooltip from '../../components/common/AppTooltip';

export interface V3ComposerBarProps {
  t: any;
  isMobile: boolean;
  /** App 全局暗色：头像圈与输入条外沿 */
  isDarkMode?: boolean;
  status: 'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error';
  isTyping: boolean;
  /** 新建会话创建中等：锁输入，但不视为「生成中」（不显示停止按钮） */
  sessionComposeBlocked?: boolean;
  sessionKey: string | null;
  isLoadingHistory: boolean;
  onRefreshSession: () => void;
  loadingBots: boolean;

  selectedBot: string;
  /** 嵌入模式下 bot 由 URL 固定，不允许在页面中切换 */
  lockBotSelection?: boolean;
  /**
   * 请求“以某个 bot 创建新会话”（会弹确认框，由上层决定是否执行）。
   * 说明：v3 在已有 sessionKey 的页面里，切换 bot 视为创建新会话，而不是切换当前会话。
   */
  onRequestNewSessionWithBot: (bot: string) => void;
  /** 当前会话对应的 botId（用于隐藏每个 bot 右侧的“新会话”按钮） */
  currentSessionBotId?: string | null;
  botsModels: any;

  sessionModel: string;
  onSessionModelChange: (newModel: string) => void;

  inputAreaRef: React.RefObject<InputAreaHandle>;
  quotedMsg: string | null;
  onClearQuote: () => void;
  onSend: (text: string, files?: any[]) => void;
  onStop: () => void;
  onOpenTerminal?: () => void;
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
  isDarkMode = false,
  status,
  isTyping,
  sessionComposeBlocked = false,
  sessionKey,
  isLoadingHistory,
  onRefreshSession,
  loadingBots,
  selectedBot,
  lockBotSelection = false,
  onRequestNewSessionWithBot,
  currentSessionBotId = null,
  botsModels,
  sessionModel,
  onSessionModelChange,
  inputAreaRef,
  quotedMsg,
  onClearQuote,
  onSend,
  onStop,
  onOpenTerminal
}: V3ComposerBarProps) {
  const [isComposing, setIsComposing] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const BotAvatar = ({ provider, size = 34 }: { provider: string; size?: number }) => {
    const p = (provider || '').toLowerCase();
    const wrapStyle = {
      width: size,
      height: size,
      borderRadius: '50%',
      background: isDarkMode ? '#1e293b' : '#fff',
      border: isDarkMode ? '1px solid #334155' : '1px solid #e2e8f0',
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
    background: 'var(--v3-surface, #fff)',
    borderRadius: 20,
    boxShadow: isFocused
      ? (isDarkMode
        ? '0 20px 40px -10px var(--v3-input-focus-glow, rgba(99, 102, 241, 0.22)), 0 0 0 4px var(--v3-input-focus-ring, rgba(165, 180, 252, 0.28))'
        : '0 20px 40px -10px var(--v3-input-focus-glow, rgba(99, 102, 241, 0.25)), 0 0 0 4px var(--v3-input-focus-ring, rgba(99, 102, 241, 0.3))')
      : (isDarkMode
        ? '0 10px 28px -6px rgba(0, 0, 0, 0.45), 0 0 0 2px var(--v3-input-idle-ring, rgba(99, 102, 241, 0.14))'
        : '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 0 0 2px var(--v3-input-idle-ring, rgba(99, 102, 241, 0.1))'),
    border: 'none',
    flexDirection: 'column' as const,
    overflow: 'visible',
    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
    width: '100%',
    boxSizing: 'border-box' as const,
    transform: isFocused ? 'translateY(-4px)' : 'none'
  }), [isFocused, isDarkMode]);

  const selectBarStyle = useMemo(() => ({
    display: 'flex' as const,
    alignItems: 'center' as const,
    background: isDarkMode ? '#0f172a' : '#f8fafc',
    borderRadius: 10,
    border: isDarkMode ? '1px solid #334155' : 'none',
    padding: '2px 4px',
    height: 38,
    flex: 1,
    maxWidth: isMobile ? 'none' : 510,
    minWidth: 0,
    boxShadow: 'none' as const
  }), [isDarkMode, isMobile]);

  const currentModelInfo = useMemo(() => {
    const models = botsModels?.data?.models || [];
    const findModel = (id: string) => {
      if (!id) return null;
      // 1. 尝试精确匹配
      let m = models.find((m: any) => m.id === id);
      if (m) return m;
      // 2. 尝试模糊匹配（处理带不带 provider 前缀的情况，例如 yovole/gemma vs gemma）
      const baseId = id.includes('/') ? id.split('/').pop() : id;
      return models.find((m: any) => {
        const mBaseId = m.id.includes('/') ? m.id.split('/').pop() : m.id;
        return mBaseId === baseId;
      });
    };

    if (!sessionModel) {
      const botId = selectedBot.replace('openclaw:', '');
      const bot = botsModels?.data?.bots?.find((b: any) => b.id === botId);
      if (bot) return findModel(bot.model);
      return null;
    }
    return findModel(sessionModel);
  }, [sessionModel, selectedBot, botsModels]);

  const supportsImage = useMemo(() => {
    // 优先从匹配到的模型详情里看
    if (currentModelInfo) {
      return !!(currentModelInfo.capabilities?.includes('image') || 
                currentModelInfo.input?.includes('image') || 
                currentModelInfo.input_modalities?.includes('image'));
    }
    
    // 兜底策略：如果没匹配到模型详情（例如 ID 漂移），则直接看机器人（Bot）自身的定义
    const botId = selectedBot.replace('openclaw:', '');
    const bot = botsModels?.data?.bots?.find((b: any) => b.id === botId);
    if (bot) {
      if (bot.capabilities?.includes('image') || bot.input?.includes('image')) return true;
    }

    return false;
  }, [currentModelInfo, selectedBot, botsModels]);

  return (
    <div style={containerStyle} className="input-container-v3">
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', padding: isMobile ? '6px 12px 0' : '12px 16px 0', gap: 8, boxSizing: 'border-box' }}>
        <div style={selectBarStyle}>
          <Select
            placeholder={t('chat.selectBotTip')}
            style={{ flex: 1, minWidth: 0, fontSize: isMobile ? 11 : 13 }} // 改为 flex: 1
            value={selectedBot}
            onChange={onRequestNewSessionWithBot}
            loading={loadingBots}
            disabled={lockBotSelection || isTyping || sessionComposeBlocked}
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
                  <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2', minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontWeight: 600, color: isDarkMode ? '#e2e8f0' : '#1e293b', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {bot.name || bot.id}
                      </span>
                      {(bot.capabilities?.includes('image') || bot.input?.includes('image')) && <Image size={11} color="#0ea5e9" style={{ flexShrink: 0 }} />}
                    </div>
                    <span style={{ fontSize: 9, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {bot.model || '---'} {t('chat.defaultSuffix', { defaultValue: '(默认)' })}
                    </span>
                  </div>

                  {!lockBotSelection && bot.id !== currentSessionBotId && (
                    <Tooltip title={t('chat.newSession', { defaultValue: '新会话' })}>
                      <Button
                        size="small"
                        type="text"
                        icon={<Plus size={14} />}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onRequestNewSessionWithBot(`openclaw:${bot.id}`);
                        }}
                        style={{
                          height: 24,
                          width: 24,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 8,
                          color: isDarkMode ? '#94a3b8' : '#64748b'
                        }}
                      />
                    </Tooltip>
                  )}
                </div>
              </Select.Option>
            ))}
          </Select>
          <div style={{ width: 1, height: 16, background: isDarkMode ? '#475569' : '#bfdbfe', margin: '0 4px' }} />
          <Select
            placeholder={t('chat.sessionModelPlaceholder', { defaultValue: '自由切换会话模型' })}
            style={{ flex: 1.2, minWidth: 0, fontSize: isMobile ? 11 : 13 }} // 改为 flex: 1.2 并保持 minWidth: 0
            value={sessionModel}
            onChange={onSessionModelChange}
            loading={loadingBots}
            disabled={isTyping || sessionComposeBlocked}
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
                    <Select.Option key={m.id} value={m.id} label={m.name || m.id}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <Cpu size={14} style={{ color: '#6366f1', flexShrink: 0 }} />
                          <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || m.id}</span>
                        </div>
                        {(m.capabilities?.includes('image') || m.input?.includes('image') || m.input_modalities?.includes('image')) && (
                          <Tooltip title="Supports Image (Vision)">
                            <Image size={12} color="#0ea5e9" style={{ flexShrink: 0 }} />
                          </Tooltip>
                        )}
                      </div>
                    </Select.Option>
                  ))}
                </Select.OptGroup>
              ));
            })()}
          </Select>
        </div>

        {!isMobile && (
          <V3SoulEditorDrawer
            t={t}
            isMobile={!!isMobile}
            isDarkMode={isDarkMode}
            selectedBot={selectedBot}
            botsModels={botsModels}
            status={status}
          />
        )}

        {!isMobile && (
          <V3SkillsDrawer
            t={t}
            isMobile={!!isMobile}
            isDarkMode={isDarkMode}
            selectedBot={selectedBot}
            botsModels={botsModels}
            status={status}
            inputAreaRef={inputAreaRef}
          />
        )}

        {!isMobile && (
          <Tooltip
            title={
              isTyping
                ? t('chat.refreshWaitReply', { defaultValue: '请等待当前回复结束后刷新' })
                : (status === 'authenticated' && sessionKey)
                  ? t('chat.refreshSession', { defaultValue: '刷新' })
                  : t('chat.refreshSessionNoSession', { defaultValue: '暂无可刷新的会话' })
            }
          >
            <span style={{ display: 'inline-flex', marginLeft: 2 }}>
              <Button
                type="text"
                size="small"
                icon={<RefreshCw size={16} className={isLoadingHistory ? 'animate-spin' : ''} />}
                onClick={onRefreshSession}
                disabled={status !== 'authenticated' || !sessionKey || isTyping || isLoadingHistory}
                aria-label={t('chat.refreshSession', { defaultValue: '刷新' })}
                style={{
                  height: 38,
                  width: 38,
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: isDarkMode ? '#1e293b' : '#f5f3ff',
                  border: isDarkMode ? '1px solid #334155' : 'none',
                  padding: 0,
                  boxShadow: isDarkMode ? 'none' : '0 2px 4px rgba(124, 58, 237, 0.06)',
                  color: (status !== 'authenticated' || !sessionKey || isTyping || isLoadingHistory)
                    ? (isDarkMode ? '#475569' : '#cbd5e1')
                    : (isDarkMode ? '#c4b5fd' : '#64748b'),
                  opacity: (status !== 'authenticated' || !sessionKey || isTyping || isLoadingHistory) ? 0.55 : 1
                }}
              />
            </span>
          </Tooltip>
        )}

        {!isMobile && (
          <Tooltip title={t('common.terminal', { defaultValue: '运维终端' })}>
            <span style={{ display: 'inline-flex', marginLeft: 6 }}>
              <Button
                type="text"
                size="small"
                icon={<TerminalIcon size={16} />}
                onClick={onOpenTerminal}
                disabled={status !== 'authenticated' || !sessionKey}
                style={{
                  height: 38,
                  width: 38,
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: isDarkMode ? '#0f172a' : '#f0f9ff',
                  border: isDarkMode ? '1px solid #334155' : 'none',
                  padding: 0,
                  boxShadow: isDarkMode ? 'none' : '0 2px 4px rgba(14, 165, 233, 0.06)',
                  color: (status !== 'authenticated' || !sessionKey)
                    ? (isDarkMode ? '#475569' : '#cbd5e1')
                    : (isDarkMode ? '#38bdf8' : '#0ea5e9'),
                  opacity: (status !== 'authenticated' || !sessionKey) ? 0.55 : 1
                }}
              />
            </span>
          </Tooltip>
        )}
      </div>

      {quotedMsg && (
        <div style={{ padding: isMobile ? '6px 12px 0' : '8px 16px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, boxSizing: 'border-box', width: '100%', overflow: 'hidden' }}>
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            fontSize: 12,
            color: isDarkMode ? '#94a3b8' : '#64748b',
            background: isDarkMode ? '#0f172a' : '#f1f5f9',
            border: isDarkMode ? '1px solid #334155' : 'none',
            padding: '4px 8px',
            borderRadius: 6,
            minWidth: 0,
            flex: 1,
            overflow: 'hidden'
          }}>
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
        isDarkMode={isDarkMode}
        isTyping={isTyping}
        sessionComposeBlocked={sessionComposeBlocked}
        onSend={onSend}
        onStop={onStop}
        t={t}
        isComposing={isComposing}
        setIsComposing={setIsComposing}
        isFocused={isFocused}
        setIsFocused={setIsFocused}
        selectedBot={selectedBot}
        supportsImage={supportsImage}
        botsModels={botsModels}
      />
    </div>
  );
}
