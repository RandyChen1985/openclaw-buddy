import React from 'react';
import { Input, Button, Spin, Tooltip, Avatar } from 'antd';
import { Search, Plus, Trash2, History, RefreshCw, Copy, Bot, XCircle } from 'lucide-react';

interface V3SessionListProps {
  sessions: any[];
  sessionKey: string | null;
  loadingSessions: boolean;
  sessionSearch: string;
  setSessionSearch: (val: string) => void;
  onSelectSession: (key: string) => void;
  onNewSession: () => void;
  onDeleteSession: (e: any, key: string) => void;
  onDeleteGroup: (label: string, keys: string[]) => void;
  onClearAll: () => void;
  fetchSessions: (isSilent?: boolean) => void;
  isMobile: boolean;
  setShowSider: (show: boolean) => void;
  copyToClipboard: (text: string) => void;
  t: any;
}

const V3SessionList: React.FC<V3SessionListProps> = ({
  sessions, sessionKey, loadingSessions, sessionSearch, setSessionSearch,
  onSelectSession, onNewSession, onDeleteSession, onDeleteGroup, onClearAll, fetchSessions,
  copyToClipboard, t
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      <style>{`
        .session-group-header { 
          display: flex; 
          align-items: center; 
          justify-content: space-between;
          padding: 8px 12px; 
          margin: 0 4px 8px;
          border-radius: 6px;
          background: #f8fafc;
          transition: all 0.2s;
        }
        .session-group-header:hover {
          background: #f1f5f9;
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
      `}</style>
      <div style={{ padding: '16px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button 
            type="primary" 
            icon={<Plus size={16} />} 
            style={{ flex: 1, borderRadius: 8, height: 38, background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => {
              onNewSession();
            }}
        >
          {t('chat.v3NewSession', { defaultValue: '开启新会话' })}
        </Button>
        <Button 
          icon={<RefreshCw size={14} className={loadingSessions ? "v3-spin" : ""} />} 
          onClick={() => fetchSessions(false)} 
          loading={loadingSessions}
          style={{ height: 38, width: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}
        />
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        <div style={{ padding: '4px 8px 8px', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Input
            size="small"
            prefix={<Search size={12} style={{ color: '#94a3b8' }} />}
            placeholder={t('chat.searchSessions', { defaultValue: '搜索会话...' })}
            value={sessionSearch}
            onChange={e => setSessionSearch(e.target.value)}
            allowClear
            style={{ borderRadius: 8, fontSize: 12, flex: 1 }}
          />
          <Tooltip title={t('chat.clearAllHistory', { defaultValue: '清除全部历史' })}>
              <Button 
                  size="small" 
                  type="text" 
                  icon={<Trash2 size={13} />} 
                  onClick={onClearAll}
                  style={{ color: '#94a3b8', background: '#f8fafc', borderRadius: 8 }}
              />
          </Tooltip>
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
            
            // 分组逻辑
            const groups: Record<string, any[]> = { today: [], yesterday: [], lastWeek: [], older: [] };
            const now = new Date();
            const todayStr = now.toDateString();
            const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
            const yesterdayStr = yesterday.toDateString();
            const lastWeek = new Date(now); lastWeek.setDate(now.getDate() - 7);

            filtered.forEach((s: any) => {
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
                    return (
                      <div 
                          key={s.key}
                          onClick={() => {
                            onSelectSession(s.key);
                          }}
                          style={{ 
                              padding: '10px 12px', borderRadius: 10, cursor: 'pointer', marginBottom: 4, transition: 'all 0.2s',
                              background: isActive ? '#eef2ff' : 'transparent',
                              border: '1px solid', borderColor: isActive ? '#c7d2fe' : 'transparent',
                              display: 'flex', alignItems: 'center', gap: 10, position: 'relative'
                          }}
                          className="session-item"
                      >
                          <Avatar size={32} src={s.avatar} icon={<Bot size={16} />} style={{ background: isActive ? '#4f46e5' : '#f1f5f9', color: isActive ? '#fff' : '#64748b', flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: isActive ? '#3730a3' : '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                    {s.label || t('chat.noLabel', { defaultValue: '未命名会话' })}
                                </div>
                                {s.messagesCount !== undefined && (
                                  <div style={{ 
                                    fontSize: 10, background: isActive ? 'rgba(79, 70, 229, 0.1)' : '#f1f5f9', 
                                    color: isActive ? '#4f46e5' : '#94a3b8', padding: '0 6px', 
                                    borderRadius: 6, fontWeight: 600, flexShrink: 0
                                  }}>
                                    {s.messagesCount}
                                  </div>
                                )}
                              </div>
                              <div className="session-id-container" style={{ fontSize: 9, color: '#94a3b8', marginTop: 1, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}>
                                  <span>{new Date(s.updatedAt || s.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                  <span>•</span>
                                  <span style={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                    {s.key.includes(':') ? s.key.substring(s.key.indexOf(':') + 1) : s.key}
                                  </span>
                                  {s.model && (
                                    <>
                                      <span>•</span>
                                      <span style={{ fontSize: 8, background: isActive ? 'rgba(79, 70, 229, 0.05)' : '#f8fafc', padding: '0 4px', borderRadius: 4, fontWeight: 600, color: isActive ? '#6366f1' : '#94a3b8' }}>
                                        {s.model.split('/').pop() || s.model}
                                      </span>
                                    </>
                                  )}
                              </div>
                              {/* Token 水位线 */}
                              {s.contextTokens > 0 && (
                                <div style={{ marginTop: 6, width: '100%' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2, fontSize: 9, fontWeight: 600 }}>
                                     <span style={{ color: '#94a3b8', transform: 'scale(0.9)', transformOrigin: 'left' }}>CONTEXT</span>
                                     <span style={{ 
                                       color: (s.totalTokens / s.contextTokens) > 0.8 ? '#ef4444' : (isActive ? '#4f46e5' : '#64748b'),
                                       opacity: 0.8
                                     }}>
                                       {Math.round((s.totalTokens / s.contextTokens) * 100)}%
                                     </span>
                                  </div>
                                  <div style={{ height: 3, width: '100%', background: isActive ? 'rgba(79, 70, 229, 0.1)' : '#f1f5f9', borderRadius: 2, overflow: 'hidden' }}>
                                    <div style={{ 
                                      height: '100%', 
                                      width: `${Math.min(100, (s.totalTokens / s.contextTokens) * 100)}%`,
                                      background: (s.totalTokens / s.contextTokens) > 0.8 ? '#ef4444' : (isActive ? '#4f46e5' : '#94a3b8'),
                                      transition: 'width 0.3s ease'
                                    }} />
                                  </div>
                                </div>
                              )}
                          </div>
                          <div className="session-actions" style={{ display: 'flex', gap: 4, opacity: 0, transition: '0.2s' }}>
                              <Button size="small" type="text" icon={<Copy size={12} />} onClick={(e) => { e.stopPropagation(); copyToClipboard(s.key); }} />
                              <Button size="small" type="text" icon={<Trash2 size={12} />} onClick={(e) => onDeleteSession(e, s.key)} />
                          </div>
                      </div>
                    );
                  })}
                </div>
              );
            };

            return ['today', 'yesterday', 'lastWeek', 'older'].map(key => renderGroup(key, groups[key]));
          })()
        )}
      </div>
    </div>
  );
};

export default React.memo(V3SessionList);
