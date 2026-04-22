import React, { useMemo, useState } from 'react';
import { Badge, Button, Dropdown, Input, Modal, Radio, Select, Switch, Tooltip } from 'antd';
import { LayoutPanelLeft, Palette, RefreshCw, Save, Settings, Shield, Wand2, Wifi } from 'lucide-react';
import type { V3ThemeMode, V3ThemePresetId, V3ThemeTokens } from '../../hooks/chatV3/useV3Theme';

export interface V3ChatHeaderProps {
  t: any;
  isMobile: boolean;

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
    showSider,
    onToggleSider,
    status,
    lastHealth,
    latencyHistory,
    pulse,
    onReconnect,
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
    v3Theme
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
        <div style={{ width: 120, fontSize: 12, color: '#64748b', fontWeight: 600 }}>{label}</div>
        <input
          type="color"
          value={isHex ? value : '#4f46e5'}
          onChange={(e) => {
            const next = e.target.value;
            v3Theme.setCustomTokens(prev => ({ ...prev, [token]: next }));
          }}
          style={{ width: 34, height: 28, padding: 0, border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff' }}
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
  const settingsPanelStyle: React.CSSProperties = {
    width: isMobile ? 'calc(100vw - 20px)' : 360,
    maxWidth: isMobile ? 'calc(100vw - 20px)' : 'min(360px, calc(100vw - 16px))',
    maxHeight: isMobile ? 'min(88dvh, 720px)' : 'min(78vh, 680px)',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    padding: isMobile ? 10 : 12,
    boxSizing: 'border-box',
    background: '#fff',
    borderRadius: 12,
    border: '1px solid #e2e8f0',
    boxShadow: '0 12px 30px rgba(0,0,0,0.12)'
  };

  const settingsOverlay = (
    <div style={settingsPanelStyle} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: '#0f172a' }}>
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
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>
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

        <div style={{ height: 1, background: '#f1f5f9' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>
            {t('chat.showThinking', { defaultValue: '显示思考或工具调用' })}
          </div>
          <Switch size="small" checked={showThinking} onChange={(val) => setShowThinking(val)} />
        </div>

        {!isMobile && (
          <>
            <div style={{ height: 1, background: '#f1f5f9' }} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>
                  {t('chat.showDebug', { defaultValue: '显示推送日志' })}
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                  {t('chat.showDebugHint', { defaultValue: '仅 debug 调试用，开启可能占用 CPU' })}
                </div>
              </div>
              <Switch size="small" checked={showDebug} onChange={(val) => setShowDebug(val)} />
            </div>
          </>
        )}

        <div style={{ height: 1, background: '#f1f5f9' }} />

        <div>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700, marginBottom: 4 }}>
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
                className="v3-settings-reasoning-btn"
                onClick={() => {
                  onSendReasoningCommand?.(`/reasoning ${mode}`);
                  setSettingsOpen(false);
                }}
              >
                <code style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#334155' }}>/reasoning {mode}</code>
                <div
                  style={{
                    fontSize: 11,
                    color: '#64748b',
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

        <div style={{ height: 1, background: '#f1f5f9' }} />

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
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>
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
          <div
            style={{
              marginTop: 10,
              padding: '10px 12px',
              background: '#f8fafc',
              borderRadius: 10,
              border: '1px solid #f1f5f9'
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: '#475569',
                lineHeight: 1.45,
                marginBottom: 6,
                overflowWrap: 'break-word',
                wordBreak: 'break-word'
              }}
            >
              {t('chat.thinkingLevelHelpTitle')}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.55, overflowWrap: 'break-word', wordBreak: 'break-word' }}>
              {t('chat.thinkingLevelHelpBody')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ padding: isMobile ? '6px 10px' : '10px 16px', background: '#fff', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10, gap: 8, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 10, minWidth: 0, flex: 1 }}>
        <Button
          type="text"
          icon={<LayoutPanelLeft size={18} />}
          onClick={onToggleSider}
          style={{ marginLeft: -6, color: showSider ? 'var(--v3-primary, #4f46e5)' : 'var(--v3-text-muted, #64748b)', flexShrink: 0 }}
        />

        {status !== 'authenticated' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <Badge status={status === 'error' ? 'error' : 'processing'} />
            <span style={{ fontSize: 11, color: status === 'error' ? '#ef4444' : '#94a3b8', fontWeight: 500 }}>
              {status === 'error' ? t('chat.gatewayConnectFailed') : t('chat.gatewayConnecting')}
            </span>
          </div>
        )}

        {status === 'authenticated' && sessionKey && sessionMeta ? (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              {!isMobile && (
                <Tooltip title={t('chat.clickToCopy', { defaultValue: '点击复制会话 ID' })}>
                  <span
                    style={{
                      fontSize: 10,
                      color: '#94a3b8',
                      fontFamily: 'monospace',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: 120,
                      lineHeight: '12px'
                    }}
                    className="v3-session-id-header"
                    onClick={() => onCopy(sessionKey)}
                  >
                    {sessionKey}
                  </span>
                </Tooltip>
              )}

              {!isMobile && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'var(--v3-source-chip-bg, rgba(79, 70, 229, 0.10))',
                  padding: '1px 6px',
                  borderRadius: 4,
                  border: '1px solid var(--v3-source-chip-border, rgba(79, 70, 229, 0.22))'
                }}>
                  <span style={{ color: 'var(--v3-source-chip-text, var(--v3-primary, #4f46e5))', display: 'flex', alignItems: 'center' }}>
                    {sessionMeta.isMain ? <Shield size={10} fill={'var(--v3-source-chip-text, var(--v3-primary, #4f46e5))' as any} /> : React.cloneElement(sessionMeta.sourceMeta.icon as React.ReactElement, { size: 10 })}
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--v3-source-chip-text, var(--v3-primary, #4f46e5))', whiteSpace: 'nowrap' }}>
                    {sessionMeta.sourceMeta.label}
                  </span>
                </div>
              )}

              {!isMobile && sessionMeta.bot && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>
                  <span>{sessionMeta.bot.identityEmoji || '🤖'}</span>
                  <span style={{ fontWeight: 600 }}>
                    {(() => {
                      const botId = sessionMeta.botId || sessionMeta.bot.id;
                      const botName = sessionMeta.bot.identityName || sessionMeta.bot.name;
                      const botText = botName ? `${botId}（${botName}）` : botId;
                      const userText =
                        (sessionMeta.source || '').toLowerCase() === 'openai-user' && sessionMeta.openAIUser
                          ? ` · ${sessionMeta.openAIUser}`
                          : '';
                      return `${botText}${userText}`;
                    })()}
                  </span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {isEditingLabel ? (
                <Input
                  size="small"
                  autoFocus
                  value={editingLabelText}
                  onChange={e => setEditingLabelText(e.target.value)}
                  onBlur={() => { onUpdateLabel(editingLabelText); setIsEditingLabel(false); }}
                  onPressEnter={() => { onUpdateLabel(editingLabelText); setIsEditingLabel(false); }}
                  disabled={isUpdatingLabel}
                  style={{ height: 20, fontSize: 12, width: isMobile ? 120 : 200 }}
                />
              ) : (
                <>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: isMobile ? 150 : 300 }}>
                    {isMobile && sessionMeta.bot ? `${sessionMeta.bot.identityEmoji || '🤖'} ` : ''}
                    {sessionMeta.isMain ? t('chat.mainSession', { defaultValue: '主会话' }) : (sessionLabel || t('chat.noLabel', { defaultValue: '未命名会话' }))}
                  </span>
                  {!sessionMeta.isMain && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      {/* 禁用态明确的 not-allowed 光标与变灰效果（无需额外 tooltip，避免与 toast 重复） */}
                      <span
                        style={{
                          display: 'inline-flex',
                          cursor: isSummarizing ? 'not-allowed' : 'pointer',
                          opacity: isSummarizing ? 0.55 : 1
                        }}
                      >
                        <Button
                          size="small"
                          type="text"
                          icon={isSummarizing ? <RefreshCw size={10} className="animate-spin" /> : <Wand2 size={10} />}
                          onClick={onAutoSummarize}
                          // 手动触发应可点击；即便本地消息为空也可由上层兜底拉历史。
                          disabled={isSummarizing}
                          style={{
                            padding: 0,
                            height: 16,
                            width: 16,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: isSummarizing ? '#94a3b8' : '#6366f1'
                          }}
                        />
                      </span>
                      <Button
                        size="small"
                        type="text"
                        icon={isUpdatingLabel ? <RefreshCw size={10} className="animate-spin" /> : <Save size={10} />}
                        onClick={() => {
                          setEditingLabelText(sessionLabel || '');
                          setIsEditingLabel(true);
                        }}
                        style={{ padding: 0, height: 16, width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          !isMobile && status === 'authenticated' && null
        )}

        {status === 'authenticated' && !sessionKey && !isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 8, flexShrink: 0, marginLeft: 4 }}>
            <div style={{ height: 12, width: 1, background: '#f1f5f9', marginRight: 2 }} />
            <span style={{ fontSize: 11, color: lastHealth?.ok === false ? '#f59e0b' : '#10b981', fontWeight: 600, marginRight: 2 }}>
              {lastHealth?.ok === false ? t('chat.gatewayFluctuating') : t('chat.connected')}
            </span>
            <div
              key={pulse}
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: lastHealth?.ok === false ? '#f59e0b' : (lastHealth?.ok ? '#10b981' : '#94a3b8'),
                animation: lastHealth?.ok ? 'v3-heartbeat 0.8s ease-out' : 'none',
                flexShrink: 0
              }}
            />
            {!isMobile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', width: 35 }}>
                  {lastHealth ? `${lastHealth.latency}ms` : '---'}
                </span>
                <svg width="30" height="12" style={{ opacity: 0.6 }}>
                  <polyline
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="1"
                    points={latencyHistory.map((l: any, i: any) => `${(i / 29) * 30},${12 - (Math.min(l, 200) / 200) * 12}`).join(' ')}
                  />
                </svg>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 2 : 6, flexShrink: 0 }}>
        {status === 'authenticated' && sessionKey && !isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', background: '#f8fafc', borderRadius: 8, height: 24, marginLeft: 4 }}>
            <span style={{ fontSize: 10, color: lastHealth?.ok === false ? '#f59e0b' : '#10b981', fontWeight: 600 }}>
              {lastHealth?.ok === false ? t('chat.gatewayFluctuating') : t('chat.connected')}
            </span>
            <div
              key={pulse}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: lastHealth?.ok === false ? '#f59e0b' : (lastHealth?.ok ? '#10b981' : '#94a3b8'),
                animation: lastHealth?.ok ? 'v3-heartbeat 0.8s ease-out' : 'none',
                flexShrink: 0
              }}
            />
            <span style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'monospace', minWidth: 30 }}>
              {lastHealth ? `${lastHealth.latency}ms` : '---'}
            </span>
          </div>
        )}

        <Button size="small" type="text" icon={<Wifi size={14} />} onClick={onReconnect} title={t('common.restart')} />

        <Dropdown
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          trigger={['click']}
          dropdownRender={() => settingsOverlay}
          placement={isMobile ? 'bottom' : 'bottomRight'}
          getPopupContainer={() => document.body}
          destroyPopupOnHide
        >
          <Button size="small" type="text" icon={<Settings size={14} />} title={t('chat.settings', { defaultValue: '设置' })} />
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
        styles={{ body: { paddingTop: 12, maxHeight: isMobile ? 'calc(100dvh - 120px)' : undefined, overflowY: isMobile ? 'auto' : undefined } }}
      >
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ minWidth: isMobile ? 0 : 320, flex: 1, width: isMobile ? '100%' : undefined, maxWidth: '100%' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>
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
                <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>
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
                          <span style={{ fontSize: 11, color: '#64748b' }}>{p.description}</span>
                        </div>
                      </div>
                    </Select.Option>
                  ))}
                </Select>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a' }}>
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
            <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>
              {t('chat.themePreview', { defaultValue: '预览' })}
            </div>
            <div style={{
              borderRadius: 14,
              border: '1px solid #e2e8f0',
              background: '#fff',
              padding: 12
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: '#0f172a' }}>V3</div>
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
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  color: '#0f172a',
                  borderRadius: 14,
                  padding: '10px 12px',
                  maxWidth: 240
                }}>
                  <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                    {t('chat.themeAssistant', { defaultValue: '助手消息' })}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
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
            <div style={{ marginTop: 10, fontSize: 11, color: '#64748b' }}>
              {t('chat.themeHint', { defaultValue: '提示：自定义模式会用你设置的 tokens 覆盖预设。' })}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

