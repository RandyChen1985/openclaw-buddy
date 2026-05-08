import React, { useMemo, useState } from 'react';
import { Badge, Button, Dropdown, Input, Modal, Radio, Select, Switch } from 'antd';
import { PanelLeft, Palette, RefreshCw, Save, Settings, Shield, Wand2, Maximize2, Minimize2, Folder, Loader2 } from 'lucide-react';
import Tooltip from '../../components/common/AppTooltip';

import type { V3ThemeMode, V3ThemePresetId, V3ThemeTokens } from '../../hooks/chatV3/useV3Theme';

export interface V3ChatHeaderProps {
  t: any;
  isMobile: boolean;
  /** App 全局暗色：顶栏与设置/主题弹层表面 */
  isDarkMode?: boolean;

  // left
  showSider: boolean;
  onToggleSider: () => void;

  // connection
  status: 'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error';
  lastHealth: { ok: boolean; latency: number; ts: number } | null;
  latencyHistory: number[];
  pulse: number;
  onReconnect: () => void;

  // session
  sessionKey: string | null;
  sessionLabel: string | null;
  isSummarizing: boolean;
  isUpdatingLabel: boolean;
  onAutoSummarize: () => void;
  onUpdateLabel: (newLabel: string) => void;
  onCopy: (text: string) => void;

  // label editing UI state managed by parent
  isEditingLabel: boolean;
  editingLabelText: string;
  setEditingLabelText: (val: string) => void;
  setIsEditingLabel: (val: boolean) => void;

  // thinking
  showThinking: boolean;
  setShowThinking: (val: boolean) => void;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  onThinkingLevelChange: (val: any) => void;

  // debug logging
  showDebug: boolean;
  setShowDebug: (val: boolean) => void;

  showTerminal: boolean;
  setShowTerminal: (val: boolean) => void;

  showExplorer: boolean;
  setShowExplorer: (val: boolean) => void;

  /** 发送 `/reasoning …` 等用户消息（需在已连接且非生成中时由父组件校验） */
  onSendReasoningCommand?: (text: string) => void;

  // source meta helper
  parseSessionKey: (key: string) => { botId: string; source: string; openAIUser?: string };
  getSourceMeta: (source: string) => { icon: any; color: string; label: string };

  // bots for showing identity chip
  botsModels: any;

  /**
   * v3 主题控制（仅作用于 V3 聊天）。
   */
  v3Theme: {
    mode: V3ThemeMode;
    presetId: V3ThemePresetId;
    customTokens: V3ThemeTokens;
    presets: { id: V3ThemePresetId; name: string; description: string; swatches: { primary: string; surface: string; userBubble: string } }[];
    setMode: (mode: V3ThemeMode) => void;
    setPresetId: (id: V3ThemePresetId) => void;
    setCustomTokens: (updater: (prev: V3ThemeTokens) => V3ThemeTokens) => void;
    resetCustomTokens: () => void;
  };
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenWorkspace?: () => void;
}

/**
 * v3 顶部 Header：会话信息 + 连接状态 + 思考开关/等级 + 重连。
 *
 * 说明：该组件只负责渲染与触发回调；业务状态仍由父组件/Hook 管理。
 */
export function V3ChatHeader(props: V3ChatHeaderProps) {
  const {
    t,
    isMobile,
    isDarkMode = false,
    showSider,
    onToggleSider,
    status,
    lastHealth,
    sessionKey,
    sessionLabel,
    isSummarizing,
    isUpdatingLabel,
    onAutoSummarize,
    onUpdateLabel,
    onCopy,
    isEditingLabel,
    editingLabelText,
    setEditingLabelText,
    setIsEditingLabel,
    showThinking,
    setShowThinking,
    thinkingLevel,
    onThinkingLevelChange,
    showDebug,
    setShowDebug,
    onSendReasoningCommand,
    parseSessionKey,
    getSourceMeta,
    botsModels,
    v3Theme,
    isFullscreen,
    onToggleFullscreen,
    onOpenWorkspace,
    showTerminal,
    setShowTerminal,
    showExplorer,
    setShowExplorer
  } = props;

  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /**
   * 校验/规范化颜色字符串（允许 `#rgb/#rrggbb` 或 `rgba(...)` 等 CSS 颜色）。
   */
  const normalizeColor = (val: string) => (val || '').trim();

  /**
   * 渲染一个“自定义调色盘”的字段：颜色选择器 + 文本输入。
   * 说明：为了兼容 antd 版本差异，这里使用原生 `input[type=color]`。
   */
  const renderColorField = (label: string, token: keyof V3ThemeTokens, placeholder?: string) => {
    const value = (v3Theme.customTokens[token] || '') as string;
    const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
    return (
      <div key={token} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 120, fontSize: 12, color: isDarkMode ? '#94a3b8' : '#64748b', fontWeight: 600 }}>{label}</div>
        <input
          type="color"
          value={isHex ? value : '#4f46e5'}
          onChange={(e) => {
            const next = e.target.value;
            v3Theme.setCustomTokens(prev => ({ ...prev, [token]: next }));
          }}
          style={{ width: 34, height: 28, padding: 0, border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`, borderRadius: 6, background: isDarkMode ? '#1e293b' : '#fff' }}
        />
        <Input
          size="small"
          value={value}
          placeholder={placeholder || '#RRGGBB / rgba(...)'}
          onChange={(e) => {
            const next = normalizeColor(e.target.value);
            v3Theme.setCustomTokens(prev => ({ ...prev, [token]: next }));
          }}
          style={{ width: 220, borderRadius: 8 }}
        />
        <div style={{ flex: 1 }} />
      </div>
    );
  };

  const sessionMeta = useMemo(() => {
    if (!sessionKey) return null;
    const { botId, source, openAIUser } = parseSessionKey(sessionKey);
    const sourceMeta = getSourceMeta(source);
    const isMain = sessionKey === 'agent:main:main';
    const bot = botsModels?.data?.bots?.find((b: any) => b.id === botId);
    return { botId, sourceMeta, isMain, bot, source, openAIUser };
  }, [botsModels, getSourceMeta, parseSessionKey, sessionKey]);

  /**
   * 顶部“设置”菜单内容：
   * - 主题设置入口（打开主题弹窗）
   * - 思考过程开关
   * - 思考等级选择
   */
  const reasoningModes = ['on', 'off'] as const;

  /** 设置浮层：移动端挂 body + 可滚动，避免被 chat 区域 overflow 裁剪或贴边溢出 */
  const settingsPanelStyle: React.CSSProperties = useMemo(() => ({
    width: isMobile ? 'calc(100vw - 20px)' : 360,
    maxWidth: isMobile ? 'calc(100vw - 20px)' : 'min(360px, calc(100vw - 16px))',
    maxHeight: isMobile ? 'min(88dvh, 720px)' : 'min(78vh, 680px)',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    padding: isMobile ? 10 : 12,
    boxSizing: 'border-box',
    background: isDarkMode ? '#1e293b' : '#fff',
    borderRadius: 12,
    border: isDarkMode ? '1px solid #334155' : '1px solid #e2e8f0',
    boxShadow: isDarkMode ? '0 12px 30px rgba(0,0,0,0.45)' : '0 12px 30px rgba(0,0,0,0.12)'
  }), [isMobile, isDarkMode]);

  const settingsDivider = isDarkMode ? '#334155' : '#f1f5f9';
  const settingsLabel = isDarkMode ? '#94a3b8' : '#64748b';

  const settingsOverlay = (
    <div style={settingsPanelStyle} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: isDarkMode ? '#f1f5f9' : '#0f172a' }}>
          {t('chat.settings', { defaultValue: '设置' })}
        </div>
        <Button size="small" type="text" onClick={() => setSettingsOpen(false)} style={{ color: '#94a3b8' }}>
          {t('common.close', { defaultValue: '关闭' })}
        </Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'stretch' : 'center',
            justifyContent: 'space-between',
            gap: isMobile ? 8 : 8
          }}
        >
          <div style={{ fontSize: 12, color: settingsLabel, fontWeight: 700 }}>
            {t('chat.theme', { defaultValue: '主题' })}
          </div>
          <Button
            className="v3-settings-theme-btn"
            size="small"
            icon={<Palette size={14} />}
            onClick={() => {
              setThemeModalOpen(true);
              setSettingsOpen(false);
            }}
            style={isMobile ? { width: '100%', height: 40 } : undefined}
          >
            {t('chat.themeSettings', { defaultValue: '主题设置' })}
          </Button>
        </div>

        <div style={{ height: 1, background: settingsDivider }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 12, color: settingsLabel, fontWeight: 700 }}>
            {t('chat.showThinking', { defaultValue: '显示思考或工具调用' })}
          </div>
          <Switch size="small" checked={showThinking} onChange={(val) => setShowThinking(val)} />
        </div>

        <div style={{ height: 1, background: settingsDivider }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, color: settingsLabel, fontWeight: 700 }}>
              {t('chat.showDebug', { defaultValue: '显示推送日志' })}
            </div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
              {t('chat.showDebugHint', { defaultValue: '仅 debug 调试用，开启可能占用 CPU' })}
            </div>
          </div>
          <Switch size="small" checked={showDebug} onChange={(val) => { setShowDebug(val); setSettingsOpen(false); }} />
        </div>

        {!isMobile && (
          <>
            <div style={{ height: 1, background: settingsDivider }} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 12, color: settingsLabel, fontWeight: 700 }}>
                {t('common.showTerminal', { defaultValue: '显示终端' })}
              </div>
              <Switch
                size="small"
                checked={showTerminal}
                onChange={(val) => {
                  setShowTerminal(val);
                  setSettingsOpen(false);
                }}
              />
            </div>

            <div style={{ height: 1, background: settingsDivider }} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 12, color: settingsLabel, fontWeight: 700 }}>
                {t('common.showFolder', { defaultValue: '显示文件夹' })}
              </div>
              <Switch
                size="small"
                checked={showExplorer}
                onChange={(val) => {
                  setShowExplorer(val);
                  setSettingsOpen(false);
                }}
              />
            </div>
          </>
        )}

        <div style={{ height: 1, background: settingsDivider }} />

        <div>
          <div style={{ fontSize: 12, color: settingsLabel, fontWeight: 700, marginBottom: 4 }}>
            {t('chat.reasoningMode', { defaultValue: '思考模式' })}
          </div>
          <div
            style={{
              fontSize: 11,
              color: '#94a3b8',
              lineHeight: 1.45,
              marginBottom: 8,
              overflowWrap: 'break-word',
              wordBreak: 'break-word'
            }}
          >
            {t('chat.reasoningModeHint')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {reasoningModes.map((mode) => (
              <button
                key={mode}
                type="button"
                className={`v3-settings-reasoning-btn${isDarkMode ? ' v3-settings-reasoning-btn--dark' : ''}`}
                onClick={() => {
                  onSendReasoningCommand?.(`/reasoning ${mode}`);
                  setSettingsOpen(false);
                }}
              >
                <code style={{ display: 'block', fontSize: 12, fontWeight: 800, color: isDarkMode ? '#e2e8f0' : '#334155' }}>/reasoning {mode}</code>
                <div
                  style={{
                    fontSize: 11,
                    color: isDarkMode ? '#cbd5e1' : settingsLabel,
                    lineHeight: 1.45,
                    marginTop: 6,
                    overflowWrap: 'break-word',
                    wordBreak: 'break-word'
                  }}
                >
                  {t(`chat.reasoningDesc.${mode}`, {
                    defaultValue:
                      mode === 'on'
                        ? 'On: deep reasoning; thinking stays collapsed.'
                        : mode === 'off'
                          ? 'Off: faster replies.'
                          : 'Stream: live thinking output.'
                  })}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ height: 1, background: settingsDivider }} />

        <div>
          <div
            style={{
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: isMobile ? 'stretch' : 'center',
              justifyContent: 'space-between',
              gap: 8
            }}
          >
            <div style={{ fontSize: 12, color: settingsLabel, fontWeight: 700 }}>
              {t('chat.thinkingLevel', { defaultValue: '思考等级' })}
            </div>
            <Select
              size="small"
              value={thinkingLevel}
              onChange={onThinkingLevelChange}
              style={{ width: isMobile ? '100%' : 140 }}
              dropdownStyle={{ borderRadius: 10 }}
              getPopupContainer={() => document.body}
            >
              <Select.Option value="off">Off</Select.Option>
              <Select.Option value="minimal">Minimal</Select.Option>
              <Select.Option value="low">Low</Select.Option>
              <Select.Option value="medium">Medium</Select.Option>
              <Select.Option value="high">High</Select.Option>
              <Select.Option value="xhigh">XHigh</Select.Option>
            </Select>
        </div>
      </div>
    </div>
  </div>
);

  return (
    <div style={{ padding: isMobile ? '6px 10px' : '10px 16px', background: isDarkMode ? '#1e293b' : '#fff', borderBottom: isDarkMode ? '1px solid #334155' : '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10, gap: 8, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 10, minWidth: 0, flex: 1 }}>
        <Button
          type="text"
          icon={<PanelLeft size={18} />}
          onClick={onToggleSider}
          style={{ 
            marginLeft: -6, 
            color: showSider ? 'var(--v3-primary, #4f46e5)' : 'var(--v3-text-muted, #64748b)', 
            flexShrink: 0,
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '8px'
          }}
          className="v3-sidebar-toggle-btn"
        />

        {status !== 'authenticated' && (
          <div style={{ 
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            animation: 'v3-fade-in 0.5s ease',
            // 仅「未连接」弱化；连接各阶段保持不透明，避免 connecting→challenging 时opacity跳变闪烁
            opacity: status === 'disconnected' ? 0.7 : 1
          }}>
            <Badge 
              status={status === 'error' ? 'error' : (status === 'disconnected' ? 'default' : 'processing')} 
              style={{ filter: status === 'disconnected' ? 'grayscale(1)' : 'none' }}
            />
            {(status !== 'error' && status !== 'disconnected') && (
              <Loader2 size={12} className="animate-spin" style={{ color: '#94a3b8', flexShrink: 0 }} aria-hidden />
            )}
            <span style={{ fontSize: 11, color: status === 'error' ? '#ef4444' : '#94a3b8', fontWeight: 500 }}>
              {status === 'error' 
                ? t('chat.gatewayConnectFailed') 
                : status === 'disconnected' 
                  ? t('chat.gatewayDisconnected', { defaultValue: '网关未连接' })
                  : t('chat.gatewayConnecting')}
            </span>
          </div>
        )}

        {status === 'authenticated' && sessionKey && sessionMeta ? (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', minWidth: 0 }}>
              {isEditingLabel ? (
                <Input
                  size="small"
                  autoFocus
                  value={editingLabelText}
                  onChange={e => setEditingLabelText(e.target.value)}
                  onBlur={() => { onUpdateLabel(editingLabelText); setIsEditingLabel(false); }}
                  onPressEnter={() => { onUpdateLabel(editingLabelText); setIsEditingLabel(false); }}
                  disabled={isUpdatingLabel}
                  style={{
                    height: 22,
                    fontSize: 13,
                    width: isMobile ? 120 : 220,
                    borderRadius: 6,
                    ...(isDarkMode ? { background: '#0f172a', borderColor: '#334155', color: '#e2e8f0' } : {})
                  }}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ 
                    fontSize: isMobile ? 13 : 14, 
                    fontWeight: 800, 
                    color: isDarkMode ? '#f1f5f9' : '#0f172a', 
                    whiteSpace: 'nowrap', 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis', 
                    maxWidth: isMobile ? 140 : 400,
                    letterSpacing: '-0.01em'
                  }}>
                    {isMobile && sessionMeta.bot ? `${sessionMeta.bot.identityEmoji || '🤖'} ` : ''}
                    {sessionMeta.isMain ? t('chat.mainSession', { defaultValue: '主会话' }) : (sessionLabel || t('chat.noLabel', { defaultValue: '未命名会话' }))}
                  </span>
                  
                  {!sessionMeta.isMain && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                      <Tooltip title={t('chat.autoSummarize', { defaultValue: '自动总结标题' })}>
                        <Button
                          size="small"
                          type="text"
                          icon={isSummarizing ? <RefreshCw size={11} className="animate-spin" /> : <Wand2 size={11} />}
                          onClick={onAutoSummarize}
                          disabled={isSummarizing}
                          style={{ padding: 0, height: 18, width: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isSummarizing ? (isDarkMode ? '#64748b' : '#94a3b8') : (isDarkMode ? '#a5b4fc' : '#6366f1') }}
                        />
                      </Tooltip>
                      <Tooltip title={t('common.edit', { defaultValue: '编辑名称' })}>
                        <Button
                          size="small"
                          type="text"
                          icon={isUpdatingLabel ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
                          onClick={() => {
                            setEditingLabelText(sessionLabel || '');
                            setIsEditingLabel(true);
                          }}
                          style={{ padding: 0, height: 18, width: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isDarkMode ? '#cbd5e1' : '#94a3b8' }}
                        />
                      </Tooltip>
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, marginLeft: 4 }}>
                    {!isMobile && (
                      <div 
                        className="v3-header-tag-source"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          background: isDarkMode ? 'rgba(129, 140, 248, 0.14)' : 'rgba(79, 70, 229, 0.08)',
                          padding: '1px 8px',
                          borderRadius: 999,
                          border: isDarkMode ? '1px solid rgba(165, 180, 252, 0.28)' : '1px solid rgba(79, 70, 229, 0.12)',
                          transition: 'all 0.2s ease',
                          cursor: 'default'
                        }}
                      >
                        <span style={{ color: isDarkMode ? '#c7d2fe' : '#4f46e5', display: 'flex', alignItems: 'center', opacity: 0.9 }}>
                          {sessionMeta.isMain ? <Shield size={10} fill={isDarkMode ? '#c7d2fe' : '#4f46e5'} /> : React.cloneElement(sessionMeta.sourceMeta.icon as React.ReactElement, { size: 10 })}
                        </span>
                        <span style={{ fontSize: 9, fontWeight: 800, color: isDarkMode ? '#c7d2fe' : '#4f46e5', whiteSpace: 'nowrap', letterSpacing: '0.02em' }}>
                          {sessionMeta.sourceMeta.label}
                        </span>
                      </div>
                    )}

                    {!isMobile && sessionMeta.bot && (
                      <div 
                        className="v3-header-tag-bot"
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: 4, 
                          fontSize: 9, 
                          color: isDarkMode ? '#cbd5e1' : '#475569', 
                          background: isDarkMode ? '#1e293b' : '#f1f5f9', 
                          padding: '1px 8px', 
                          borderRadius: 999,
                          border: isDarkMode ? '1px solid #334155' : '1px solid #e2e8f0',
                          transition: 'all 0.2s ease',
                          cursor: 'default'
                        }}>
                        <span style={{ opacity: 0.9 }}>{sessionMeta.bot.identityEmoji || '🤖'}</span>
                        <span style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}>
                          {(() => {
                            const botId = sessionMeta.botId || sessionMeta.bot.id;
                            const botName = sessionMeta.bot.identityName || sessionMeta.bot.name;
                            return botName ? (
                              <>
                                <span style={{ opacity: 0.6 }}>{botId}</span>
                                <span style={{ opacity: 0.4, fontWeight: 400 }}>·</span>
                                <span>{botName}</span>
                              </>
                            ) : botId;
                          })()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 1 }}>
              {!isMobile && (
                <Tooltip title={t('chat.clickToCopy', { defaultValue: '点击复制会话 ID' })}>
                  <span
                    style={{
                      fontSize: 9,
                      color: isDarkMode ? '#e2e8f0' : '#94a3b8',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      lineHeight: '12px',
                      opacity: isDarkMode ? 1 : 0.8
                    }}
                    className="v3-session-id-header"
                    onClick={() => onCopy(sessionKey)}
                  >
                    {sessionKey}
                  </span>
                </Tooltip>
              )}
              {/* OpenAI User Metadata if present */}
              {!isMobile && (sessionMeta.source || '').toLowerCase() === 'openai-user' && sessionMeta.openAIUser && (
                <div style={{ fontSize: 9, color: isDarkMode ? '#cbd5e1' : '#94a3b8', display: 'flex', alignItems: 'center', gap: 3 }}>
                   <span style={{ opacity: 0.5 }}>•</span>
                   <span>{sessionMeta.openAIUser}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          !isMobile && status === 'authenticated' && null
        )}


      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 2 : 6, flexShrink: 0 }}>
        {/* WebSocket Health Indicator (Only in Fullscreen) */}
        {isFullscreen && status === 'authenticated' && lastHealth && (
          <Tooltip title={`${t('chat.v3Status', { defaultValue: 'WebSocket V3' })} | Latency: ${lastHealth.latency}ms | TS: ${new Date(lastHealth.ts).toLocaleTimeString()}`}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 10px',
              background: 'rgba(34, 197, 94, 0.10)',
              borderRadius: 8,
              border: '1px solid rgba(34, 197, 94, 0.20)',
              cursor: 'default',
              marginRight: 2
            }}>
              <div 
                className="v3-heartbeat"
                style={{ 
                  width: 7, 
                  height: 7, 
                  borderRadius: '50%', 
                  background: '#22c55e',
                  boxShadow: '0 0 6px rgba(34, 197, 94, 0.5)',
                  animation: 'v3-heartbeat 2s infinite'
                }} 
              />
              <span style={{ 
                fontSize: 10, 
                fontWeight: 900, 
                color: '#16a34a',
                fontFamily: 'ui-monospace, monospace',
                letterSpacing: '0.02em'
              }}>
                {lastHealth.latency}ms
              </span>
            </div>
          </Tooltip>
        )}

        <Button 
          size="small" 
          type="text" 
          icon={isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />} 
          title={isFullscreen ? t('common.exitFullscreen', { defaultValue: '退出全屏' }) : t('common.fullscreen', { defaultValue: '全屏' })}
          onClick={onToggleFullscreen}
          style={isDarkMode ? { color: '#cbd5e1' } : undefined}
        />

        <Button 
          size="small" 
          type="text" 
          icon={<Folder size={14} />} 
          title={t('bots.workspace', { defaultValue: '工作区' })}
          onClick={onOpenWorkspace}
          disabled={!sessionMeta?.bot?.workspace}
          style={{ 
            color: !sessionMeta?.bot?.workspace
              ? (isDarkMode ? '#475569' : '#cbd5e1')
              : (isDarkMode ? '#a5b4fc' : 'var(--v3-primary, #4f46e5)'),
            opacity: !sessionMeta?.bot?.workspace ? 0.5 : 1
          }}
        />

        <Dropdown
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          trigger={['click']}
          dropdownRender={() => settingsOverlay}
          placement={isMobile ? 'bottom' : 'bottomRight'}
          getPopupContainer={() => document.body}
          destroyPopupOnHide
        >
          <Button size="small" type="text" icon={<Settings size={14} />} title={t('chat.settings', { defaultValue: '设置' })} style={isDarkMode ? { color: '#cbd5e1' } : undefined} />
        </Dropdown>
      </div>

      <Modal
        title={t('chat.themeSettings', { defaultValue: '主题设置（仅 V3 聊天）' })}
        open={themeModalOpen}
        onCancel={() => setThemeModalOpen(false)}
        maskClosable={false}
        keyboard={false}
        footer={null}
        width={isMobile ? 'calc(100vw - 16px)' : 720}
        centered={!isMobile}
        style={isMobile ? { top: 12, paddingBottom: 0 } : undefined}
        styles={{
          body: {
            paddingTop: 12,
            maxHeight: isMobile ? 'calc(100dvh - 120px)' : undefined,
            overflowY: isMobile ? 'auto' : undefined,
            ...(isDarkMode ? { background: '#1e293b' } : {})
          },
          ...(isDarkMode
            ? {
                content: { background: '#1e293b' },
                header: { background: '#1e293b', borderBottom: '1px solid #334155', color: '#f1f5f9' }
              }
            : {})
        }}
      >
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ minWidth: isMobile ? 0 : 320, flex: 1, width: isMobile ? '100%' : undefined, maxWidth: '100%' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: isDarkMode ? '#f1f5f9' : '#0f172a', marginBottom: 8 }}>
              {t('chat.themeMode', { defaultValue: '主题模式' })}
            </div>
            <Radio.Group
              value={v3Theme.mode}
              onChange={(e) => v3Theme.setMode(e.target.value)}
              style={{ marginBottom: 12 }}
            >
              <Radio.Button value="preset">{t('chat.themePreset', { defaultValue: '预设主题' })}</Radio.Button>
              <Radio.Button value="custom">{t('chat.themeCustom', { defaultValue: '自定义' })}</Radio.Button>
            </Radio.Group>

            {v3Theme.mode === 'preset' ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 800, color: isDarkMode ? '#f1f5f9' : '#0f172a', marginBottom: 8 }}>
                  {t('chat.themePresetSelect', { defaultValue: '选择预设' })}
                </div>
                <Select
                  value={v3Theme.presetId}
                  onChange={(val) => v3Theme.setPresetId(val)}
                  style={{ width: '100%' }}
                  dropdownStyle={{ borderRadius: 10 }}
                  getPopupContainer={(trigger) => trigger.parentElement || document.body}
                >
                  {v3Theme.presets.map(p => (
                    <Select.Option key={p.id} value={p.id}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <span style={{ width: 10, height: 10, borderRadius: 3, background: p.swatches.primary, border: '1px solid rgba(0,0,0,0.08)' }} />
                          <span style={{ width: 10, height: 10, borderRadius: 3, background: p.swatches.userBubble, border: '1px solid rgba(0,0,0,0.08)' }} />
                          <span style={{ width: 10, height: 10, borderRadius: 3, background: p.swatches.surface, border: '1px solid rgba(0,0,0,0.08)' }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
                          <span style={{ fontWeight: 800 }}>{p.name}</span>
                          <span style={{ fontSize: 11, color: isDarkMode ? '#94a3b8' : '#64748b' }}>{p.description}</span>
                        </div>
                      </div>
                    </Select.Option>
                  ))}
                </Select>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: isDarkMode ? '#f1f5f9' : '#0f172a' }}>
                    {t('chat.themeCustomPalette', { defaultValue: '自定义调色盘' })}
                  </div>
                  <Button size="small" onClick={() => v3Theme.resetCustomTokens()}>
                    {t('chat.themeReset', { defaultValue: '重置' })}
                  </Button>
                </div>
                {renderColorField(t('chat.themePrimary', { defaultValue: '主色' }), '--v3-primary', '#4f46e5')}
                {renderColorField(t('chat.themeUserBubble', { defaultValue: '用户气泡' }), '--v3-user-bubble', '#4b5bdc')}
                {renderColorField(t('chat.themeLink', { defaultValue: '链接色' }), '--v3-link', '#2563eb')}
                {renderColorField(t('chat.themeSurface', { defaultValue: '卡片底色' }), '--v3-surface', '#ffffff')}
                {renderColorField(t('chat.themeMuted', { defaultValue: '次级文字' }), '--v3-text-muted', '#64748b')}
                {renderColorField(t('chat.themeBorder', { defaultValue: '边框' }), '--v3-border', '#e2e8f0')}
              </>
            )}
          </div>

          <div style={{ minWidth: isMobile ? 0 : 280, flex: isMobile ? '1 1 100%' : '0 0 300px', width: isMobile ? '100%' : undefined, maxWidth: '100%' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: isDarkMode ? '#f1f5f9' : '#0f172a', marginBottom: 8 }}>
              {t('chat.themePreview', { defaultValue: '预览' })}
            </div>
            <div style={{
              borderRadius: 14,
              border: isDarkMode ? '1px solid #334155' : '1px solid #e2e8f0',
              background: isDarkMode ? '#0f172a' : '#fff',
              padding: 12
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: isDarkMode ? '#f1f5f9' : '#0f172a' }}>V3</div>
                <div style={{
                  height: 24,
                  padding: '0 10px',
                  borderRadius: 10,
                  background: 'var(--v3-primary)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: 11,
                  fontWeight: 800
                }}>
                  {t('chat.themeButton', { defaultValue: '按钮' })}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexDirection: 'column' }}>
                <div style={{
                  alignSelf: 'flex-start',
                  background: isDarkMode ? '#1e293b' : '#f8fafc',
                  border: isDarkMode ? '1px solid #334155' : '1px solid #e2e8f0',
                  color: isDarkMode ? '#f1f5f9' : '#0f172a',
                  borderRadius: 14,
                  padding: '10px 12px',
                  maxWidth: 240
                }}>
                  <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                    {t('chat.themeAssistant', { defaultValue: '助手消息' })}
                  </div>
                  <div style={{ fontSize: 12, color: isDarkMode ? '#94a3b8' : '#64748b' }}>
                    {t('chat.themeQuotePreview', { defaultValue: '引用/链接/代码在这里会更清晰。' })}
                  </div>
                </div>
                <div style={{
                  alignSelf: 'flex-end',
                  background: 'var(--v3-user-bubble)',
                  color: 'var(--v3-user-text, rgba(255,255,255,0.95))',
                  borderRadius: 14,
                  padding: '10px 12px',
                  maxWidth: 240,
                  boxShadow: '0 6px 18px rgba(0,0,0,0.06)'
                }}>
                  <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                    {t('chat.themeUser', { defaultValue: '用户消息' })}
                  </div>
                  <div style={{
                    borderLeft: '4px solid var(--v3-user-border, rgba(255,255,255,0.22))',
                    background: 'var(--v3-user-surface, rgba(255,255,255,0.12))',
                    padding: '6px 8px',
                    borderRadius: 10,
                    fontSize: 12
                  }}>
                    &gt; {t('chat.themeQuote', { defaultValue: '这是引用内容' })}
                  </div>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: isDarkMode ? '#94a3b8' : '#64748b' }}>
              {t('chat.themeHint', { defaultValue: '提示：自定义模式会用你设置的 tokens 覆盖预设。' })}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
