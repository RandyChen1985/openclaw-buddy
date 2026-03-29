import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Spin, Input, Tag, Space, Button } from 'antd';
import { Search, Filter, AlertCircle, Info, AlertTriangle } from 'lucide-react';

interface LogsViewerProps {
  wsLogs: string[];
}

const LogsViewer: React.FC<LogsViewerProps> = ({ wsLogs }) => {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [searchText, setSearchText] = useState('');
  const [activeLevel, setActiveLevel] = useState<string>('all');

  useEffect(() => {
    // 仅在没有过滤或搜索时自动滚动到最底层，否则可能打断查看
    if (searchText === '' && activeLevel === 'all') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [wsLogs, searchText, activeLevel]);

  const filteredLogs = useMemo(() => {
    return wsLogs.filter(log => {
      const lowerLog = log.toLowerCase();
      
      // 级别过滤逻辑
      let matchesLevel = true;
      if (activeLevel === 'error') {
        matchesLevel = lowerLog.includes('error') || lowerLog.includes('err') || lowerLog.includes('exception');
      } else if (activeLevel === 'warn') {
        matchesLevel = lowerLog.includes('warn') || lowerLog.includes('warning');
      } else if (activeLevel === 'info') {
        matchesLevel = lowerLog.includes('info');
      }

      // 搜索过滤逻辑
      const matchesSearch = searchText === '' || lowerLog.includes(searchText.toLowerCase());

      return matchesLevel && matchesSearch;
    });
  }, [wsLogs, searchText, activeLevel]);

  const getLogColor = (log: string) => {
    const lowerLog = log.toLowerCase();
    if (lowerLog.includes('error') || lowerLog.includes('err') || lowerLog.includes('exception')) return '#f87171'; // Red
    if (lowerLog.includes('warn') || lowerLog.includes('warning')) return '#fbbf24'; // Yellow
    if (lowerLog.includes('info')) return '#60a5fa'; // Blue
    if (lowerLog.includes('success') || lowerLog.includes('healthy')) return '#34d399'; // Green
    return '#c9d1d9';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: '#0d1117', borderRadius: 0, overflow: 'hidden', border: '1px solid #30363d', height: '100%', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
      {/* 顶部工具栏 */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        padding: '12px 16px', 
        background: '#161b22', 
        borderBottom: '1px solid #30363d', 
        flexWrap: 'wrap',
        gap: 12,
        flexShrink: 0 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 200 }}>
          <span style={{ color: '#8b949e', fontSize: 13, fontWeight: 600, fontFamily: 'monospace', marginRight: 8 }}>guardian.log</span>
          <Input
            placeholder="搜索日志关键词..."
            variant="borderless"
            prefix={<Search size={14} color="#8b949e" />}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            style={{ 
              background: '#0d1117', 
              borderRadius: 6, 
              border: '1px solid #30363d', 
              color: '#c9d1d9',
              height: 32,
              flex: 1,
              maxWidth: 300
            }}
          />
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Space size={4}>
            {[
              { id: 'all', label: '全部', color: '#8b949e', icon: <Filter size={12} /> },
              { id: 'info', label: '信息', color: '#3b82f6', icon: <Info size={12} /> },
              { id: 'warn', label: '警告', color: '#f59e0b', icon: <AlertTriangle size={12} /> },
              { id: 'error', label: '错误', color: '#ef4444', icon: <AlertCircle size={12} /> }
            ].map(level => (
              <Tag.CheckableTag
                key={level.id}
                checked={activeLevel === level.id}
                onChange={() => setActiveLevel(level.id)}
                style={{ 
                  margin: 0, 
                  fontSize: 11, 
                  background: activeLevel === level.id ? `${level.color}20` : 'transparent',
                  color: activeLevel === level.id ? level.color : '#484f58',
                  border: `1px solid ${activeLevel === level.id ? level.color : '#30363d'}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '1px 8px',
                  borderRadius: 4,
                  transition: 'all 0.2s'
                }}
              >
                {level.icon}{level.label}
              </Tag.CheckableTag>
            ))}
          </Space>
          <div style={{ width: 1, height: 16, background: '#30363d', margin: '0 4px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', border: '1px solid rgba(34, 197, 94, 0.4)', boxShadow: '0 0 8px rgba(34, 197, 94, 0.6)' }} />
            <span style={{ color: '#22c55e', fontSize: 10, fontWeight: 700, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Live</span>
          </div>
        </div>
      </div>

      {/* 日志内容区 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', fontFamily: '"JetBrains Mono", "Fira Code", monospace', fontSize: 12, color: '#c9d1d9', lineHeight: 1.8 }}>
        {wsLogs.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: '#484f58', height: '100%', justifyContent: 'center' }}>
            <Spin size="small" />
            <span style={{ fontSize: 13 }}>正在建立 WebSocket 安全隧道...</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: '#484f58', height: '100%', justifyContent: 'center' }}>
            <Search size={24} />
            <span style={{ fontSize: 13 }}>未找到匹配 "{searchText}" 的日志</span>
            <Button type="link" size="small" onClick={() => { setSearchText(''); setActiveLevel('all'); }}>清除所有过滤器</Button>
          </div>
        ) : (
          filteredLogs.map((log, i) => (
            <div key={i} style={{ display: 'flex', gap: 16, borderBottom: '1px solid #161b22', padding: '2px 0' }}>
              <span style={{ color: '#30363d', width: 32, textAlign: 'right', flexShrink: 0, userSelect: 'none', fontSize: 11 }}>
                {(i + 1).toString().padStart(3, '0')}
              </span>
              <span style={{ 
                whiteSpace: 'pre-wrap', 
                wordBreak: 'break-all', 
                color: getLogColor(log),
                textShadow: getLogColor(log) !== '#c9d1d9' ? `0 0 10px ${getLogColor(log)}20` : 'none'
              }}>
                {log}
              </span>
            </div>
          ))
        )}
        <div ref={logsEndRef} style={{ height: 10 }} />
      </div>
    </div>
  );
};

export default LogsViewer;
