import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Button, Tooltip, Empty, Tag, Input, Radio } from 'antd';
import { X, Trash2, ArrowUpRight, ArrowDownLeft, Terminal, Copy, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface V3DebugPaneProps {
  t: any;
  logs: any[];
  onClear: () => void;
  onClose: () => void;
}

const LogItem = ({ log }: { log: any }) => {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(log.timestamp);
  const timeStr = date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
  
  const isOut = log.direction === 'out';
  let method = log.data?.method || log.data?.event || '';
  
  // 💡 如果是响应包 (type: "res") 且没有 method 字段，尝试从 id 中解析出原始方法名
  if (!method && log.data?.type === 'res' && log.data?.id) {
    const idParts = log.data.id.split('-');
    if (idParts.length > 0) {
      // 提取前缀，例如 "sessions.messages.unsubscribe"
      method = idParts[0];
    }
  }

  if (!method) method = 'unknown';

  const copyToClipboard = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(JSON.stringify(log.data, null, 2));
  };

  return (
    <div style={{ 
      borderBottom: '1px solid rgba(255,255,255,0.06)', 
      padding: '8px 10px',
      fontSize: 11,
      background: expanded ? 'rgba(255,255,255,0.03)' : 'transparent'
    }}>
      <div 
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ color: '#94a3b8', fontFamily: 'monospace', width: 95, flexShrink: 0, fontSize: 10 }}>{timeStr}</span>
        <span style={{ 
          color: isOut ? '#38bdf8' : '#4ade80', 
          display: 'inline-flex', 
          alignItems: 'center',
          gap: 2,
          fontWeight: 600,
          width: 40,
          flexShrink: 0,
          fontSize: 10
        }}>
          {isOut ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
          {isOut ? 'OUT' : 'IN'}
        </span>
        <span style={{ 
          color: '#e2e8f0', 
          fontWeight: 700, 
          fontFamily: 'monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1
        }}>
          {method}
        </span>
        {expanded ? <ChevronDown size={14} color="#64748b" /> : <ChevronRight size={14} color="#64748b" />}
      </div>
      
      {expanded && (
        <div style={{ marginTop: 8, position: 'relative' }}>
          <Button 
            size="small" 
            type="text" 
            icon={<Copy size={12} />} 
            onClick={copyToClipboard}
            style={{ position: 'absolute', right: 4, top: 4, zIndex: 1, color: '#94a3b8' }}
          />
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
            <SyntaxHighlighter
              language="json"
              style={vscDarkPlus}
              customStyle={{ 
                margin: 0, 
                padding: '12px', 
                fontSize: 10, 
                background: '#0f172a',
                maxHeight: 300,
                overflowY: 'auto'
              }}
            >
              {JSON.stringify(log.data, null, 2)}
            </SyntaxHighlighter>
          </div>
        </div>
      )}
    </div>
  );
};

export const V3DebugPane: React.FC<V3DebugPaneProps> = ({ t, logs, onClear, onClose }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [searchText, setSearchText] = useState('');
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all');

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // 方向过滤
      if (direction !== 'all' && log.direction !== direction) return false;
      
      // 关键字过滤
      if (searchText) {
        const method = (log.data?.method || log.data?.event || '').toLowerCase();
        const content = JSON.stringify(log.data).toLowerCase();
        return method.includes(searchText.toLowerCase()) || content.includes(searchText.toLowerCase());
      }
      
      return true;
    });
  }, [logs, searchText, direction]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLogs.length]);

  return (
    <div className="v3-debug-pane" style={{
      width: 380,
      height: '100%',
      background: '#1e293b',
      borderLeft: '1px solid #334155',
      display: 'flex',
      flexDirection: 'column',
      color: '#f1f5f9',
      boxShadow: '-4px 0 15px rgba(0,0,0,0.2)',
      zIndex: 20
    }}>
      <div style={{ 
        padding: '12px 16px', 
        borderBottom: '1px solid #334155', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        background: '#0f1727'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Terminal size={14} color="#38bdf8" />
          <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.02em' }}>
            {t('chat.debugLogs', { defaultValue: 'WS 推送日志' })}
          </span>
          <Tag color="blue" style={{ fontSize: 9, borderRadius: 10, border: 'none', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8' }}>
            {filteredLogs.length}
          </Tag>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Tooltip title={t('common.clear', { defaultValue: '清空' })}>
            <Button 
              size="small" 
              type="text" 
              icon={<Trash2 size={14} />} 
              onClick={onClear} 
              style={{ color: '#94a3b8' }}
            />
          </Tooltip>
          <Button 
            size="small" 
            type="text" 
            icon={<X size={16} />} 
            onClick={onClose} 
            style={{ color: '#94a3b8' }}
          />
        </div>
      </div>

      <div style={{ padding: '8px 12px', background: '#0f1727', borderBottom: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Input 
          size="small"
          placeholder={t('logs.searchPlaceholder', { defaultValue: '搜索日志关键词...' })}
          prefix={<Search size={12} color="#64748b" />}
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          allowClear
          variant="filled"
          style={{ background: '#1e293b', border: '1px solid #334155', color: '#fff' }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
           <Radio.Group 
             size="small" 
             value={direction} 
             onChange={e => setDirection(e.target.value)}
             buttonStyle="solid"
           >
             <Radio.Button value="all" style={{ fontSize: 10, background: direction === 'all' ? '#38bdf8' : '#1e293b', borderColor: '#334155', color: direction === 'all' ? '#fff' : '#94a3b8' }}>{t('common.all', { defaultValue: '全部' })}</Radio.Button>
             <Radio.Button value="out" style={{ fontSize: 10, background: direction === 'out' ? '#38bdf8' : '#1e293b', borderColor: '#334155', color: direction === 'out' ? '#fff' : '#94a3b8' }}>OUT(发送)</Radio.Button>
             <Radio.Button value="in" style={{ fontSize: 10, background: direction === 'in' ? '#38bdf8' : '#1e293b', borderColor: '#334155', color: direction === 'in' ? '#fff' : '#94a3b8' }}>IN(接收)</Radio.Button>
           </Radio.Group>
        </div>
      </div>
      
      <div 
        ref={scrollRef}
        style={{ 
          flex: 1, 
          overflowY: 'auto', 
          background: '#0f172a',
          scrollBehavior: 'smooth'
        }}
        className="v3-debug-scroll-area"
      >
        {filteredLogs.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ color: '#64748b', fontSize: 12 }}>{t('chat.noLogs', { defaultValue: '暂无推送日志' })}</span>} />
          </div>
        ) : (
          filteredLogs.map((log, i) => (
            <LogItem key={log.timestamp + '-' + i} log={log} />
          ))
        )}
      </div>

      <div style={{ 
        padding: '8px 12px', 
        fontSize: 10, 
        color: '#64748b', 
        borderTop: '1px solid #334155',
        background: '#0f1727',
        textAlign: 'center'
      }}>
        {t('chat.debugLogsHint', { defaultValue: '提示：仅保留最新 100 条业务日志' })}
      </div>
    </div>
  );
};
