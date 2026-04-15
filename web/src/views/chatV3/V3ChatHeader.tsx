import React, { useMemo } from 'react';
import { Badge, Button, Input, Select, Switch, Tooltip } from 'antd';
import { LayoutPanelLeft, RefreshCw, Save, Shield, Wand2 } from 'lucide-react';

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
  messagesCount: number;
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

  // source meta helper
  parseSessionKey: (key: string) => { botId: string; source: string };
  getSourceMeta: (source: string) => { icon: any; color: string; label: string };

  // bots for showing identity chip
  botsModels: any;
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
    messagesCount,
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
    parseSessionKey,
    getSourceMeta,
    botsModels
  } = props;

  const sessionMeta = useMemo(() => {
    if (!sessionKey) return null;
    const { botId, source } = parseSessionKey(sessionKey);
    const sourceMeta = getSourceMeta(source);
    const isMain = sessionKey === 'agent:main:main';
    const bot = botsModels?.data?.bots?.find((b: any) => b.id === botId);
    return { botId, sourceMeta, isMain, bot };
  }, [botsModels, getSourceMeta, parseSessionKey, sessionKey]);

  return (
    <div style={{ padding: isMobile ? '6px 10px' : '10px 16px', background: '#fff', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10, gap: 8, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 10, minWidth: 0, flex: 1 }}>
        <Button
          type="text"
          icon={<LayoutPanelLeft size={18} />}
          onClick={onToggleSider}
          style={{ marginLeft: -6, color: showSider ? '#4f46e5' : '#64748b', flexShrink: 0 }}
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
                  background: `${sessionMeta.sourceMeta.color}15`,
                  padding: '1px 6px',
                  borderRadius: 4,
                  border: `1px solid ${sessionMeta.sourceMeta.color}33`
                }}>
                  <span style={{ color: sessionMeta.sourceMeta.color, display: 'flex', alignItems: 'center' }}>
                    {sessionMeta.isMain ? <Shield size={10} fill={sessionMeta.sourceMeta.color} /> : React.cloneElement(sessionMeta.sourceMeta.icon as React.ReactElement, { size: 10 })}
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: sessionMeta.sourceMeta.color, whiteSpace: 'nowrap' }}>
                    {sessionMeta.sourceMeta.label}
                  </span>
                </div>
              )}

              {!isMobile && sessionMeta.bot && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>
                  <span>{sessionMeta.bot.identityEmoji || '🤖'}</span>
                  <span style={{ fontWeight: 600 }}>{sessionMeta.bot.identityName || sessionMeta.bot.id}</span>
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
                      <Tooltip title={t('chat.autoSummarize', { defaultValue: 'AI 自动总结标题' })}>
                        <Button
                          size="small"
                          type="text"
                          icon={isSummarizing ? <RefreshCw size={10} className="animate-spin" /> : <Wand2 size={10} />}
                          onClick={onAutoSummarize}
                          disabled={isSummarizing || messagesCount === 0}
                          style={{ padding: 0, height: 16, width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1' }}
                        />
                      </Tooltip>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginRight: 4 }}>
          <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{t('chat.showThinking', { defaultValue: '思考过程' })}</span>
          <Switch
            size="small"
            checked={showThinking}
            onChange={(val) => setShowThinking(val)}
          />
        </div>

        {!isMobile && (
          <>
            <div style={{ width: 1, height: 12, background: '#f1f5f9', marginRight: 2 }} />
            <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>{t('chat.thinkingLevel', { defaultValue: '思考等级' })}:</span>
            <Select size="small" value={thinkingLevel} onChange={onThinkingLevelChange} style={{ width: 100 }} dropdownStyle={{ borderRadius: 8 }}>
              <Select.Option value="off">Off</Select.Option>
              <Select.Option value="minimal">Minimal</Select.Option>
              <Select.Option value="low">Low</Select.Option>
              <Select.Option value="medium">Medium</Select.Option>
              <Select.Option value="high">High</Select.Option>
              <Select.Option value="xhigh">XHigh</Select.Option>
            </Select>
          </>
        )}

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

        <Button size="small" type="text" icon={<RefreshCw size={13} />} onClick={onReconnect} title={t('common.restart')} />
      </div>
    </div>
  );
}

