import React from 'react';
import { Input, Button, Spin, Tooltip, Avatar, Badge as AntBadge, Select } from 'antd';
import { Search, Plus, Trash2, History, RefreshCw, Copy, XCircle, AlertCircle, Shield, Zap, Monitor, MessageCircle, Send, Globe, Clock, PenLine, Sparkles, Settings, GitBranch } from 'lucide-react';

export interface V3SessionListProps {
  sessions: any[];
  sessionKey: string | null;
  typingSessionKeys?: string[];
  loadingSessions: boolean;
  sessionSearch: string;
  setSessionSearch: (val: string) => void;
  onSelectSession: (key: string) => void;
  onNewSession: () => void;
  /** 正在创建新会话时禁用按钮，避免连点产生大量空会话 */
  newSessionBusy?: boolean;
  onDeleteSession: (e: any, key: string) => void;
  onDeleteGroup: (label: string, keys: string[]) => void;
  onClearAll: () => void;
  fetchSessions: (isSilent?: boolean) => void;
  isMobile: boolean;
  setShowSider: (show: boolean) => void;
  copyToClipboard: (text: string) => void;
  botsModels?: any; // 💡 注入机器人列表，用于根据 botId 查询名称
  t: any;
  /** 与 App 全局暗色同步（侧栏表面、分组条等） */
  isDarkMode?: boolean;
}

// --- Utils & Config ---
const parseSessionKey = (key: string) => {
  if (!key || !key.startsWith('agent:')) return { botId: 'main', source: 'dashboard' as const, openAIUser: undefined as string | undefined };
  const parts = key.split(':');
  const botId = parts[1] || 'main';
  const source = parts[2] || 'dashboard';

  // openai-user: agent:{botId}:openai-user:{username}-{uuid}
  let openAIUser: string | undefined;
  if ((source || '').toLowerCase() === 'openai-user') {
    const raw = (parts[3] || '').trim();
    if (raw) openAIUser = raw.split('-')[0] || raw;
  }

  return { botId, source, openAIUser };
};

const SourceConfig: Record<string, { icon: any, color: string, labelKey: string, defaultLabel: string }> = {
  'buddy': { icon: <Sparkles size={14} />, color: '#0ea5e9', labelKey: 'chat.source.buddy', defaultLabel: 'buddy平台' },
  /** 会话 key 第三段为 main：系统内置渠道（如 agent:main:main） */
  'main': { icon: <Settings size={14} />, color: '#475569', labelKey: 'chat.source.system', defaultLabel: '系统渠道' },
  'dashboard': { icon: <Monitor size={14} />, color: 'var(--v3-primary, #6366f1)', labelKey: 'chat.source.dashboard', defaultLabel: '管理后台' },
  'weixin': { icon: <MessageCircle size={14} />, color: '#07c160', labelKey: 'chat.source.weixin', defaultLabel: '微信' },
  'feishu': { icon: <Send size={14} />, color: '#3370ff', labelKey: 'chat.source.feishu', defaultLabel: '飞书' },
  'telegram': { icon: <Send size={14} />, color: '#24A1DE', labelKey: 'chat.source.telegram', defaultLabel: 'Telegram' },
  'subagent': { icon: <GitBranch size={14} />, color: '#0d9488', labelKey: 'chat.source.subagent', defaultLabel: '子代理' },
  'cron': { icon: <Clock size={14} />, color: '#8b5cf6', labelKey: 'chat.source.cron', defaultLabel: '定时任务' },
  'openai-user': { icon: <Zap size={14} />, color: '#f59e0b', labelKey: 'chat.source.openaiUser', defaultLabel: 'OpenAI API' },
  'fallback': { icon: <Globe size={14} />, color: '#94a3b8', labelKey: 'chat.source.fallback', defaultLabel: '其他渠道' }
};

const getSourceMeta = (source: string) => {
  const s = source?.toLowerCase();
  if (SourceConfig[s]) return SourceConfig[s];
  // 兼容逻辑：api -> openai-user
  if (s === 'api') return SourceConfig['openai-user'];
  // OpenClaw 网关会话 key 第三段常见为 openclaw-weixin，与微信同源展示
  if (s === 'openclaw-weixin') return SourceConfig['weixin'];
  return SourceConfig['fallback'];
};

const SessionStatusIcon = ({ status, t }: { status: string, t: any }) => {
  if (status === 'active') {
    return (
      <Tooltip title={t('chat.statusActive', { defaultValue: '正在生成中...' })}>
        <AntBadge status="processing" size="small" style={{ marginLeft: 6, transform: 'scale(0.8)' }} />
      </Tooltip>
    );
  }
  if (status === 'failed') {
    return (
      <Tooltip title={t('chat.statusFailed', { defaultValue: '执行遇到错误' })}>
        <AlertCircle size={10} color="#ef4444" style={{ marginLeft: 6 }} />
      </Tooltip>
    );
  }
  return null;
};

const V3SessionList: React.FC<V3SessionListProps> = ({
  sessions, sessionKey, loadingSessions, sessionSearch, setSessionSearch,
  onSelectSession, onNewSession, onDeleteSession, onDeleteGroup, onClearAll, fetchSessions,
  isMobile, setShowSider, copyToClipboard, botsModels, t,
  typingSessionKeys = [],
  newSessionBusy = false,
  isDarkMode = false,
}) => {
  const shell = React.useMemo(() => isDarkMode ? {
    rootBg: '#1e293b',
    hairline: '#334155',
    groupBg: '#0f172a',
    groupHover: '#1e293b',
    chipBg: '#0f172a',
    sessionActiveBg: 'rgba(99,102,241,0.22)',
    sessionActiveBorder: 'rgba(165,180,252,0.4)',
    msgCountBg: '#334155',
    trackBg: '#334155',
    avatarRingBg: '#0f172a',
    avatarRingBorder: '#334155',
    pinnedIdleBg: '#0f172a',
    pinnedBorder: '#334155',
    pinnedBorderActive: 'rgba(165,180,252,0.35)',
    chipBorder: '#334155',
    textMuted: '#94a3b8',
  } : {
    rootBg: 'var(--v3-surface, #fff)',
    hairline: '#f1f5f9',
    groupBg: '#f8fafc',
    groupHover: '#f1f5f9',
    chipBg: '#f8fafc',
    sessionActiveBg: '#eef2ff',
    sessionActiveBorder: '#c7d2fe',
    msgCountBg: '#f1f5f9',
    trackBg: '#f1f5f9',
    avatarRingBg: '#fff',
    avatarRingBorder: '#f1f5f9',
    pinnedIdleBg: 'var(--v3-pinned-bg, #f8fafc)',
    pinnedBorder: 'var(--v3-pinned-border, #e2e8f0)',
    pinnedBorderActive: 'var(--v3-pinned-border-active, rgba(79, 70, 229, 0.28))',
    chipBorder: '#e2e8f0',
    textMuted: '#94a3b8',
  }, [isDarkMode]);

  const [activeBotId, setActiveBotId] = React.useState<string>('all');
  const [activeSource, setActiveSource] = React.useState<string>('all');

  const sourcesInSessions = React.useMemo(() => {
    const sources = new Set<string>();
    sessions.forEach((s: any) => {
      const { botId, source } = parseSessionKey(s.key);
      if (activeBotId === 'all' || botId === activeBotId) {
        if (source) sources.add(source);
      }
    });
    return Array.from(sources).map(src => {
      const meta = getSourceMeta(src);
      return {
        id: src,
        name: t(meta.labelKey, { defaultValue: meta.defaultLabel }),
        icon: meta.icon,
        color: meta.color
      };
    });
  }, [sessions, activeBotId, t]);

  React.useEffect(() => {
    if (activeSource !== 'all' && !sourcesInSessions.find(s => s.id === activeSource)) {
      setActiveSource('all');
    }
  }, [sourcesInSessions, activeSource]);

  const botsInSessions = React.useMemo(() => {
    const bots = new Set<string>();
    sessions.forEach((s: any) => {
      if (s.key !== 'agent:main:main') {
        const { botId } = parseSessionKey(s.key);
        if (botId) bots.add(botId);
      }
    });
    return Array.from(bots).map(botId => {
      const bot = botsModels?.data?.bots?.find((b: any) => b.id === botId);
      return {
        id: botId,
        name: botId === 'main' ? (bot?.name || t('chat.mainBotName', { defaultValue: '系统主机器人' })) : (bot?.name || botId)
      };
    });
  }, [sessions, botsModels, t]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: shell.rootBg as any }}>
      <style>{`
        .session-group-header { 
          display: flex; 
          align-items: center; 
          justify-content: space-between;
          padding: 8px 12px; 
          margin: 0 4px 8px;
          border-radius: 6px;
          background: ${shell.groupBg};
          transition: all 0.2s;
        }
        .session-group-header:hover {
          background: ${shell.groupHover};
        }
        @keyframes v3-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .v3-spin { animation: v3-spin 1s linear infinite; }
        .group-delete-btn {
          opacity: 0;
          transition: opacity 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #94a3b8;
          cursor: pointer;
          height: 18px;
          width: 18px;
          border-radius: 4px;
        }
        .session-group-header:hover .group-delete-btn {
          opacity: 1;
        }
        .group-delete-btn:hover {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.05);
        }
        @keyframes v3-pencil {
          0% { transform: rotate(-8deg) translateY(0); }
          50% { transform: rotate(8deg) translateY(-1px); }
          100% { transform: rotate(-8deg) translateY(0); }
        }
        .v3-pencil {
          animation: v3-pencil 0.9s ease-in-out infinite;
          margin-left: 6px;
          opacity: 0.9;
          display: inline-flex;
          align-items: center;
        }
        @keyframes v3-dot {
          0% { opacity: 0.2; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-1px); }
          80% { opacity: 0.2; transform: translateY(0); }
          100% { opacity: 0.2; transform: translateY(0); }
        }
        .v3-dots {
          display: inline-flex;
          align-items: center;
          margin-left: 3px;
          letter-spacing: 1px;
          font-weight: 900;
          font-size: 12px;
          line-height: 1;
          opacity: 0.95;
          transform: translateY(-0.5px);
        }
        .v3-dots span {
          display: inline-block;
          animation: v3-dot 1.2s infinite ease-in-out;
        }
        .v3-dots span:nth-child(1) { animation-delay: 0ms; }
        .v3-dots span:nth-child(2) { animation-delay: 160ms; }
        .v3-dots span:nth-child(3) { animation-delay: 320ms; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
      <div style={{ padding: isMobile ? '12px 12px' : '16px', borderBottom: `1px solid ${shell.hairline}`, display: 'flex', gap: isMobile ? 6 : 8, alignItems: 'center' }}>
        <Button 
            type="primary"
            size={isMobile ? 'small' : 'middle'}
            icon={<Plus size={isMobile ? 14 : 16} />} 
            style={{
              flex: 1,
              minWidth: 0,
              borderRadius: 8,
              height: isMobile ? 32 : 38,
              fontSize: isMobile ? 12 : 14,
              paddingInline: isMobile ? 8 : 12,
              background: 'var(--v3-primary, #4f46e5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            loading={newSessionBusy}
            disabled={newSessionBusy}
            onClick={() => {
              if (newSessionBusy) return;
              onNewSession();
              if (isMobile) setShowSider(false);
            }}
        >
          {t('chat.v3NewSession', { defaultValue: '开启新会话' })}
        </Button>
        <Button 
          size={isMobile ? 'small' : 'middle'}
          icon={<RefreshCw size={isMobile ? 13 : 14} className={loadingSessions ? "v3-spin" : ""} />} 
          onClick={() => fetchSessions(false)} 
          loading={loadingSessions}
          style={{ height: isMobile ? 32 : 38, width: isMobile ? 32 : 38, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}
        />
        {sessions.some(s => s.key !== 'agent:main:main') && (
          <Tooltip title={t('chat.clearAllHistory', { defaultValue: '清除全部历史' })}>
            <Button
              size={isMobile ? 'small' : 'middle'}
              icon={<Trash2 size={isMobile ? 12 : 13} />}
              onClick={onClearAll}
              style={{ height: isMobile ? 32 : 38, width: isMobile ? 32 : 38, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, color: shell.textMuted }}
            />
          </Tooltip>
        )}
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {botsInSessions.length > 0 && (
          <div style={{ 
            padding: '4px 8px 10px', 
            display: 'flex', 
            gap: 8, 
            alignItems: 'center',
            overflowX: 'auto', 
            whiteSpace: 'nowrap',
          }} className="hide-scrollbar">
            <div 
              onClick={() => setActiveBotId('all')}
              style={{
                cursor: 'pointer',
                fontWeight: activeBotId === 'all' ? 600 : 500,
                color: activeBotId === 'all' ? 'var(--v3-primary, #4f46e5)' : '#64748b',
                background: activeBotId === 'all' ? 'rgba(79, 70, 229, 0.1)' : shell.chipBg,
                border: '1px solid',
                borderColor: activeBotId === 'all' ? 'rgba(79, 70, 229, 0.2)' : shell.chipBorder,
                padding: '4px 12px',
                borderRadius: '16px',
                fontSize: 12,
                transition: 'all 0.2s ease',
                userSelect: 'none'
              }}
            >
              {t('chat.allBots', { defaultValue: '全部' })}
            </div>
            {botsInSessions.map(b => (
              <div 
                key={b.id}
                onClick={() => setActiveBotId(b.id)}
                style={{
                  cursor: 'pointer',
                  fontWeight: activeBotId === b.id ? 600 : 500,
                  color: activeBotId === b.id ? 'var(--v3-primary, #4f46e5)' : '#64748b',
                  background: activeBotId === b.id ? 'rgba(79, 70, 229, 0.1)' : shell.chipBg,
                  border: '1px solid',
                  borderColor: activeBotId === b.id ? 'rgba(79, 70, 229, 0.2)' : shell.chipBorder,
                  padding: '4px 12px',
                  borderRadius: '16px',
                  fontSize: 12,
                  transition: 'all 0.2s ease',
                  userSelect: 'none'
                }}
              >
                {b.name}
              </div>
            ))}
          </div>
        )}

        <div style={{ padding: '0 8px 12px', display: 'flex', gap: 6, alignItems: 'center' }}>
          {sourcesInSessions.length > 0 && (
            <Select
              size="small"
              value={activeSource}
              onChange={setActiveSource}
              style={{ width: 105 }}
              popupMatchSelectWidth={false}
              options={[
                { label: t('chat.allSources', { defaultValue: '全部渠道' }), value: 'all' },
                ...sourcesInSessions.map(s => ({
                  label: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      {s.icon && React.cloneElement(s.icon as React.ReactElement, { size: 12, color: s.color })}
                      <span>{s.name}</span>
                    </div>
                  ),
                  value: s.id
                }))
              ]}
            />
          )}
          <Input
            size="small"
            prefix={<Search size={12} style={{ color: '#94a3b8' }} />}
            placeholder={t('chat.searchSessions', { defaultValue: '搜索会话...' })}
            value={sessionSearch}
            onChange={e => setSessionSearch(e.target.value)}
            allowClear
            style={{ borderRadius: 8, fontSize: 12, flex: 1 }}
          />
        </div>

        {loadingSessions && sessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20 }}><Spin size="small" /></div>
        ) : sessions.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#cbd5e1' }}>
              <History size={32} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
              <div style={{ fontSize: 13 }}>{t('chat.noHistory', { defaultValue: '暂无历史会话' })}</div>
          </div>
        ) : (
          (() => {
            const filtered = sessions.filter((s: any) => !sessionSearch || (s.key || '').toLowerCase().includes(sessionSearch.toLowerCase()) || (s.label || '').toLowerCase().includes(sessionSearch.toLowerCase()));
            
            let mainSession = filtered.find((s: any) => s.key === 'agent:main:main');
            if (mainSession) {
                if (activeBotId !== 'all' && activeBotId !== 'main') mainSession = undefined;
                if (mainSession && activeSource !== 'all') {
                    const { source } = parseSessionKey(mainSession.key);
                    if (source !== activeSource) mainSession = undefined;
                }
            }
                
            let otherSessions = filtered.filter((s: any) => s.key !== 'agent:main:main');
            if (activeBotId !== 'all') {
                otherSessions = otherSessions.filter((s: any) => {
                    const { botId } = parseSessionKey(s.key);
                    return botId === activeBotId;
                });
            }
            if (activeSource !== 'all') {
                otherSessions = otherSessions.filter((s: any) => {
                    const { source } = parseSessionKey(s.key);
                    return source === activeSource;
                });
            }

            // 分组逻辑
            const groups: Record<string, any[]> = { today: [], yesterday: [], lastWeek: [], older: [] };
            const now = new Date();
            const todayStr = now.toDateString();
            const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
            const yesterdayStr = yesterday.toDateString();
            const lastWeek = new Date(now); lastWeek.setDate(now.getDate() - 7);

            otherSessions.forEach((s: any) => {
              const date = new Date(s.updatedAt || s.createdAt || Date.now());
              const dateStr = date.toDateString();
              if (dateStr === todayStr) groups.today.push(s);
              else if (dateStr === yesterdayStr) groups.yesterday.push(s);
              else if (date > lastWeek) groups.lastWeek.push(s);
              else groups.older.push(s);
            });

            const renderGroup = (label: string, items: any[]) => {
              if (items.length === 0) return null;
              return (
                <div key={label} style={{ marginBottom: 16 }}>
                  <div className="session-group-header">
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      {label === 'today' ? t('chat.today', { defaultValue: '今天' }) :
                       label === 'yesterday' ? t('chat.yesterday', { defaultValue: '昨天' }) :
                       label === 'lastWeek' ? t('chat.lastSevenDays', { defaultValue: '最近一周' }) :
                       t('chat.older', { defaultValue: '更早记录' })}
                    </span>
                    <Tooltip title={t('chat.deleteThisGroup', { defaultValue: '删除该分组会话' })}>
                      <div 
                        className="group-delete-btn" 
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteGroup(label, items.map(i => i.key));
                        }}
                      >
                        <XCircle size={13} />
                      </div>
                    </Tooltip>
                  </div>
                  {items.map((s: any) => {
                    const isActive = sessionKey === s.key;
                    const { source, openAIUser } = parseSessionKey(s.key);
                    const sourceMeta = getSourceMeta(source);
                    const sourceLabel = t(sourceMeta.labelKey, { defaultValue: sourceMeta.defaultLabel });
                    
                    return (
                      <div 
                          key={s.key}
                          onClick={() => {
                            onSelectSession(s.key);
                            if (isMobile) setShowSider(false);
                          }}
                          style={{ 
                              padding: '10px 12px', borderRadius: 10, cursor: 'pointer', marginBottom: 4, transition: 'all 0.2s',
                              background: isActive ? shell.sessionActiveBg : 'transparent',
                              border: '1px solid', borderColor: isActive ? shell.sessionActiveBorder : 'transparent',
                              display: 'flex', alignItems: 'center', gap: 12, position: 'relative'
                          }}
                          className="session-item"
                      >
                          <div style={{ position: 'relative', flexShrink: 0 }}>
            <Avatar 
                              size={32} 
                              icon={sourceMeta.icon} 
                              style={{ 
                                background: sourceMeta.color, 
                                color: '#fff', 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center',
                                boxShadow: isActive ? `0 0 0 2px ${sourceMeta.color}33` : 'none'
                              }} 
                            />
                            {/* Bot Badge */}
                            <div style={{
                              position: 'absolute',
                              bottom: -2,
                              right: -2,
                              width: 16,
                              height: 16,
                              background: shell.avatarRingBg,
                              borderRadius: '50%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 10,
                              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                              border: `1px solid ${shell.avatarRingBorder}`
                            }}>
                              {s.avatar ? <img src={s.avatar} style={{ width: '100%', height: '100%', borderRadius: '50%' }} /> : (s.emoji || '🤖')}
                            </div>
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                                <div style={{ fontSize: 13, fontVariant: 'tabular-nums', fontWeight: 700, color: isActive ? (isDarkMode ? '#f1f5f9' : 'var(--v3-primary-strong, #3730a3)') : (isDarkMode ? '#e2e8f0' : 'var(--v3-text, #1e293b)'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, display: 'flex', alignItems: 'center' }}>
                                    {s.label || t('chat.noLabel', { defaultValue: '未命名会话' })}
                                    <SessionStatusIcon status={s.status} t={t} />
                                    {typingSessionKeys.includes(s.key) && (
                                      <span className="v3-pencil">
                                        <PenLine size={12} color={isActive ? (isDarkMode ? '#a5b4fc' : 'var(--v3-primary, #4f46e5)') : '#94a3b8'} />
                                        <span className="v3-dots" style={{ color: isActive ? (isDarkMode ? '#a5b4fc' : 'var(--v3-primary, #4f46e5)') : '#94a3b8' }} aria-label={t('chat.statusActive', { defaultValue: '正在生成中...' })}>
                                          <span>.</span><span>.</span><span>.</span>
                                        </span>
                                      </span>
                                    )}
                                </div>
                                {s.messagesCount !== undefined && (
                                  <div style={{ 
                                    fontSize: 10, background: isActive ? (isDarkMode ? 'rgba(165, 180, 252, 0.18)' : 'rgba(79, 70, 229, 0.1)') : shell.msgCountBg, 
                                    color: isActive ? (isDarkMode ? '#e0e7ff' : 'var(--v3-primary, #4f46e5)') : shell.textMuted, padding: '0 6px', 
                                    borderRadius: 6, fontWeight: 600, flexShrink: 0
                                  }}>
                                    {s.messagesCount}
                                  </div>
                                )}
                              </div>
                              <div className="session-id-container" style={{ fontSize: 9, color: isActive && isDarkMode ? '#cbd5e1' : '#94a3b8', marginTop: 1, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}>
                                  <span>{new Date(s.updatedAt || s.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                  <span>•</span>
                                  <span style={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    {sourceMeta.icon && React.cloneElement(sourceMeta.icon as React.ReactElement, { size: 10, style: { opacity: 0.7 } })}
                                    {sourceLabel}{openAIUser ? `（${openAIUser}）` : ''}
                                  </span>
                                  {s.model && (
                                    <>
                                      <span>•</span>
                                      <span style={{ fontSize: 8, background: isActive ? (isDarkMode ? 'rgba(165, 180, 252, 0.12)' : 'rgba(79, 70, 229, 0.05)') : shell.chipBg, padding: '0 4px', borderRadius: 4, fontWeight: 600, color: isActive ? (isDarkMode ? '#c7d2fe' : 'var(--v3-primary, #6366f1)') : shell.textMuted }}>
                                        {s.model.split('/').pop() || s.model}
                                      </span>
                                    </>
                                  )}
                              </div>
                              {/* Token 水位线 */}
                              {s.contextTokens > 0 && (
                                <div style={{ marginTop: 6, width: '100%' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2, fontSize: 9, fontWeight: 600 }}>
                                       <span style={{ color: isActive ? (isDarkMode ? '#a5b4fc' : '#4f46e5') : '#94a3b8', transform: 'scale(0.9)', transformOrigin: 'left', fontWeight: 800 }}>
                                         {(() => {
                                           const { botId, source, openAIUser } = parseSessionKey(s.key);
                                           const bot = botsModels?.data?.bots?.find((b: any) => b.id === botId);
                                           const botName = bot?.name || botId;
                                           if (source === 'openai-user' && openAIUser) {
                                             return (
                                               <>
                                                 <span style={{ textTransform: 'uppercase' }}>{botName}</span>
                                                 <span style={{ opacity: 0.6, margin: '0 4px' }}>/</span>
                                                 <span>{openAIUser}</span>
                                               </>
                                             );
                                           }
                                           return <span style={{ textTransform: 'uppercase' }}>{botName}</span>;
                                         })()}
                                       </span>
                                       <span style={{ 
                                         color: (s.totalTokens / s.contextTokens) > 0.8 ? '#ef4444' : (isActive ? (isDarkMode ? '#a5b4fc' : '#4f46e5') : '#64748b'),
                                         opacity: 0.8
                                       }}>
                                         <span style={{ opacity: 0.6, marginRight: 4, fontWeight: 400 }}>CONTEXT</span>
                                         {Math.round((s.totalTokens / s.contextTokens) * 100)}%
                                       </span>
                                    </div>
                                  <div style={{ height: 3, width: '100%', background: isActive ? (isDarkMode ? 'rgba(165, 180, 252, 0.14)' : 'rgba(79, 70, 229, 0.1)') : shell.trackBg, borderRadius: 2, overflow: 'hidden' }}>
                                    <div style={{ 
                                      height: '100%', 
                                      width: `${Math.min(100, (s.totalTokens / s.contextTokens) * 100)}%`,
                                      background: (s.totalTokens / s.contextTokens) > 0.8 ? '#ef4444' : (isActive ? (isDarkMode ? '#818cf8' : '#4f46e5') : '#94a3b8'),
                                      transition: 'width 0.3s ease'
                                    }} />
                                  </div>
                                </div>
                              )}
                          </div>
                          <div className="session-actions" style={{ display: 'flex', gap: 4, opacity: 0, transition: '0.2s' }}>
                              <Button size="small" type="text" icon={<Copy size={12} />} onClick={(e) => { e.stopPropagation(); copyToClipboard(s.key); }} />
                              {s.key !== 'agent:main:main' && (
                                <Button size="small" type="text" icon={<Trash2 size={12} />} onClick={(e) => onDeleteSession(e, s.key)} />
                              )}
                          </div>
                      </div>
                    );
                  })}
                </div>
              );
            };

            return (
              <>
                {mainSession && (
                  <div style={{ marginBottom: 12 }}>
                    <div className="session-group-header">
                      <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--v3-primary, #6366f1)', textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Shield size={10} />
                        {t('chat.pinnedSession', { defaultValue: '置顶会话' })}
                      </span>
                    </div>
                    {(() => {
                      const isActive = sessionKey === mainSession.key;
                      return (
                        <div 
                            key={mainSession.key}
                            onClick={() => {
                              onSelectSession(mainSession.key);
                              if (isMobile) setShowSider(false);
                            }}
                            style={{ 
                                padding: '10px 12px', borderRadius: 10, cursor: 'pointer', marginBottom: 4, transition: 'all 0.2s',
                                background: isActive ? 'var(--v3-pinned-bg-active, linear-gradient(135deg, rgba(79, 70, 229, 0.08) 0%, rgba(79, 70, 229, 0.16) 100%))' : shell.pinnedIdleBg,
                                border: '1px solid', borderColor: isActive ? shell.pinnedBorderActive : shell.pinnedBorder,
                                display: 'flex', alignItems: 'center', gap: 12, position: 'relative',
                                boxShadow: isActive ? '0 4px 12px rgba(0, 0, 0, 0.04)' : 'none'
                            }}
                            className="session-item-main"
                        >
                            <div style={{ position: 'relative', flexShrink: 0 }}>
                              <Avatar 
                                size={32} 
                                icon={<Shield size={16} fill={isActive ? '#fff' : 'var(--v3-primary, #6366f1)'} />} 
                                style={{ 
                                  background: isActive ? 'var(--v3-primary, #4f46e5)' : 'rgba(79, 70, 229, 0.12)', 
                                  color: isActive ? '#fff' : 'var(--v3-primary-strong, #4338ca)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  boxShadow: isActive ? '0 0 0 2px rgba(0, 0, 0, 0.06)' : 'none'
                                }} 
                              />
                              <div style={{
                                position: 'absolute',
                                bottom: -2,
                                right: -2,
                                width: 16,
                                height: 16,
                                background: shell.avatarRingBg as any,
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 10,
                                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                border: `1px solid ${shell.avatarRingBorder}`
                              }}>
                                {mainSession.avatar ? <img src={mainSession.avatar} style={{ width: '100%', height: '100%', borderRadius: '50%' }} /> : (mainSession.emoji || '⚡')}
                              </div>
                            </div>

                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                                  <div style={{ fontSize: 13, fontWeight: 800, color: isActive ? (isDarkMode ? '#f1f5f9' : 'var(--v3-text, #0f172a)') : (isDarkMode ? '#e2e8f0' : 'var(--v3-primary-strong, #3730a3)'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, display: 'flex', alignItems: 'center' }}>
                                      {t('chat.mainSession', { defaultValue: '主会话' })}
                                      <SessionStatusIcon status={mainSession.status} t={t} />
                                  </div>
                                  {mainSession.messagesCount !== undefined && (
                                    <div style={{ 
                                      fontSize: 10, background: isDarkMode ? 'rgba(165, 180, 252, 0.18)' : 'rgba(79, 70, 229, 0.1)', 
                                      color: isDarkMode ? '#e0e7ff' : 'var(--v3-primary, #4f46e5)', padding: '0 6px', 
                                      borderRadius: 6, fontWeight: 600, flexShrink: 0
                                    }}>
                                      {mainSession.messagesCount}
                                    </div>
                                  )}
                                </div>
                                <div style={{ fontSize: 9, color: isDarkMode ? '#a5b4fc' : 'var(--v3-primary, #6366f1)', opacity: isDarkMode ? 0.9 : 0.7, marginTop: 1, fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}>
                                    <span>{new Date(mainSession.updatedAt || mainSession.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    <span>•</span>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>CORE SYSTEM</span>
                                </div>
                                {/* Token 水位线 (主会话同步补全) */}
                                {mainSession.contextTokens > 0 && (
                                    <div style={{ marginTop: 6, width: '100%' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2, fontSize: 9, fontWeight: 700 }}>
                                        <span style={{ color: isDarkMode ? '#a5b4fc' : 'var(--v3-primary, #6366f1)', opacity: 0.85, transform: 'scale(0.9)', transformOrigin: 'left', fontWeight: 900 }}>
                                          {(() => {
                                            const bot = botsModels?.data?.bots?.find((b: any) => b.id === 'main');
                                            return bot?.name || t('chat.mainBotName', { defaultValue: '系统主机器人' });
                                          })()}
                                        </span>
                                        <span style={{ 
                                            color: (mainSession.totalTokens / mainSession.contextTokens) > 0.8 ? '#ef4444' : (isDarkMode ? '#a5b4fc' : 'var(--v3-primary, #4f46e5)'),
                                            opacity: 0.85
                                        }}>
                                            <span style={{ opacity: 0.6, marginRight: 4, fontWeight: 400 }}>CONTEXT</span>
                                            {Math.round((mainSession.totalTokens / mainSession.contextTokens) * 100)}%
                                        </span>
                                    </div>
                                    <div style={{ height: 3, width: '100%', background: isDarkMode ? 'rgba(165, 180, 252, 0.14)' : 'rgba(79, 70, 229, 0.15)', borderRadius: 2, overflow: 'hidden' }}>
                                        <div style={{ 
                                            height: '100%', 
                                            width: `${Math.min(100, (mainSession.totalTokens / mainSession.contextTokens) * 100)}%`,
                                            background: (mainSession.totalTokens / mainSession.contextTokens) > 0.8 ? '#ef4444' : (isDarkMode ? '#818cf8' : 'var(--v3-primary, #6366f1)'),
                                            transition: 'width 0.3s ease'
                                        }} />
                                    </div>
                                    </div>
                                )}
                            </div>
                            <div className="session-actions" style={{ display: 'flex', gap: 4, opacity: 0, transition: '0.2s' }}>
                                <Button size="small" type="text" icon={<Copy size={12} />} onClick={(e) => { e.stopPropagation(); copyToClipboard(mainSession.key); }} />
                            </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
                {['today', 'yesterday', 'lastWeek', 'older'].map(key => renderGroup(key, groups[key]))}
              </>
            );
          })()
        )}
      </div>
    </div>
  );
};

export default React.memo(V3SessionList);
