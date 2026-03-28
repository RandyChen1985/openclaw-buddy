import React, { useRef, useEffect } from 'react';
import { Spin } from 'antd';

interface LogsViewerProps {
  wsLogs: string[];
}

const LogsViewer: React.FC<LogsViewerProps> = ({ wsLogs }) => {
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [wsLogs]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: '#0d1117', borderRadius: 0, overflow: 'hidden', border: '1px solid #21262d', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#161b22', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#8b949e', fontSize: 12, fontFamily: 'monospace' }}>guardian.log</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite' }} />
          <span style={{ color: '#22c55e', fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Live</span>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, fontFamily: 'monospace', fontSize: 12, color: '#c9d1d9', lineHeight: 1.6 }}>
        {wsLogs.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#484f58', height: '100%', justifyContent: 'center' }}>
            <Spin size="small" />正在连接日志流...
          </div>
        ) : wsLogs.map((log, i) => (
          <div key={i} style={{ display: 'flex', gap: 12 }}>
            <span style={{ color: '#30363d', width: 28, textAlign: 'right', flexShrink: 0, userSelect: 'none' }}>
              {(i + 1).toString().padStart(3, '0')}
            </span>
            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{log}</span>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};

export default LogsViewer;
