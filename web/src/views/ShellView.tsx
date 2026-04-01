import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { message, Button, Tooltip, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { RotateCcw, XCircle, Server, Monitor, Cpu, Terminal as TerminalIcon } from 'lucide-react';
import api from '../api';
import { getWsUrl } from '../utils/url';

interface ServerInfo {
  hostname: string;
  os: string;
  arch: string;
  cpus: number;
}

const ShellView: React.FC = () => {
  const { t } = useTranslation();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleWinResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleWinResize);
    return () => window.removeEventListener('resize', handleWinResize);
  }, []);

  const fetchServerInfo = async () => {
    try {
      const res = await api.get('/v1/system/info');
      setServerInfo(res.data);
    } catch (err) {
      console.error('Failed to fetch server info:', err);
    }
  };

  const handleRestart = () => {
    setSessionKey(prev => prev + 1);
    message.success(t('common.restarting', { defaultValue: '正在重启终端...' }));
  };

  const handleInterrupt = () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      // 发送 Ctrl+C (\x03) 指令
      socketRef.current.send('\x03');
      message.info(t('common.interruptSent', { defaultValue: '已发送中断信号 (Ctrl+C)' }));
    }
  };

  // 映射操作系统友好名称和颜色
  const getOSDisplay = (os: string) => {
    const lowerOS = os.toLowerCase();
    if (lowerOS === 'darwin') return { name: 'macOS', color: '#cbd5e1', icon: <Monitor size={14} /> };
    if (lowerOS === 'windows') return { name: 'Windows', color: '#60a5fa', icon: <Monitor size={14} /> };
    if (lowerOS === 'linux') return { name: 'Linux', color: '#fbbf24', icon: <Monitor size={14} /> };
    return { name: os, color: '#94a3b8', icon: <Monitor size={14} /> };
  };

  useEffect(() => {
    fetchServerInfo();
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Initialize xterm.js
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: isMobile ? 'bar' : 'block',
      fontSize: isMobile ? 12 : 14,
      fontFamily: '"Cascadia Code", "Fira Code", monospace',
      theme: {
        background: '#0f172a',
        foreground: '#f8fafc',
        selectionBackground: 'rgba(255, 255, 255, 0.2)',
      },
      allowProposedApi: true,
      screenReaderMode: isMobile
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    term.focus();
    
    // 给 DOM 渲染留一点时间后再计算尺寸
    const initialFit = setTimeout(() => {
      fitAddon.fit();
      term.focus();
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        sendResize();
      }
    }, 200);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const token = localStorage.getItem('guardian_token');
    const wsUrl = getWsUrl(`/v1/ws/shell?token=${token}`);
    
    const socket = new WebSocket(wsUrl);
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;

    const sendResize = () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows
        }));
      }
    };

    socket.onopen = () => {
      sendResize();
    };

    socket.onmessage = (event) => {
      term.write(new Uint8Array(event.data));
    };

    socket.onerror = (error) => {
      console.error('Shell WebSocket error:', error);
      message.error(t('common.connectionError'));
    };

    socket.onclose = () => {
      term.write('\r\n\x1b[31m[Session Closed]\x1b[0m\r\n');
    };

    term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    });

    term.onResize(() => {
      sendResize();
    });

    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(initialFit);
      socket.close();
      term.dispose();
      xtermRef.current = null;
    };
  }, [t, sessionKey]);

  const osInfo = serverInfo ? getOSDisplay(serverInfo.os) : null;

  return (
    <div 
      style={{ 
        height: '100%', 
        width: '100%', 
        background: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* 顶部信息栏与控制栏 */}
      <div 
        style={{ 
          height: '48px', 
          minHeight: '48px',
          background: 'rgba(30, 41, 59, 0.8)', 
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          zIndex: 100
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8' }}>
            <TerminalIcon size={16} style={{ color: '#312e81' }} />
            {!isMobile && <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '13px' }}>运维终端</span>}
          </div>

          {serverInfo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '16px', fontSize: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8', maxWidth: isMobile ? '80px' : 'none' }}>
                <Server size={14} />
                <span style={{ 
                  color: '#cbd5e1', 
                  overflow: 'hidden', 
                  textOverflow: 'ellipsis', 
                  whiteSpace: 'nowrap' 
                }}>
                  {serverInfo.hostname.split('.')[0]}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
                {osInfo?.icon}
                {!isMobile && <span style={{ color: osInfo?.color }}>{osInfo?.name} ({serverInfo.arch})</span>}
              </div>
              {!isMobile && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
                  <Cpu size={14} />
                  <span>{serverInfo.cpus} Cores</span>
                </div>
              )}
            </div>
          )}
        </div>

        <Space size={isMobile ? 8 : 12}>
          <Tooltip title={t('common.interrupt', { defaultValue: '强制中断 (Ctrl+C)' })}>
            <Button 
              size={isMobile ? "middle" : "small"}
              icon={<XCircle size={14} />} 
              onClick={handleInterrupt}
              style={{ 
                background: 'rgba(239, 68, 68, 0.15)', 
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#fca5a5',
                width: isMobile ? '38px' : 'auto',
                height: isMobile ? '38px' : 'auto',
                padding: isMobile ? 0 : '4px 15px',
                borderRadius: isMobile ? '50%' : '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }} 
              className="hover:bg-red-500/20 transition-all border-none"
            >
              {!isMobile && "中断"}
            </Button>
          </Tooltip>

          <Tooltip title={t('common.restartTerminal', { defaultValue: '重启维护终端' })}>
            <Button 
              size={isMobile ? "middle" : "small"}
              icon={<RotateCcw size={14} />} 
              onClick={handleRestart}
              style={{ 
                background: 'rgba(255, 255, 255, 0.05)', 
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#e2e8f0',
                width: isMobile ? '38px' : 'auto',
                height: isMobile ? '38px' : 'auto',
                padding: isMobile ? 0 : '4px 15px',
                borderRadius: isMobile ? '50%' : '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }} 
              className="hover:bg-white/10 transition-all"
            >
              {!isMobile && "重启"}
            </Button>
          </Tooltip>
        </Space>
      </div>

      <div 
        ref={terminalRef} 
        onContextMenu={(e) => isMobile && e.preventDefault()}
        onClick={() => {
          if (xtermRef.current) {
            xtermRef.current.focus();
            if (isMobile) {
              setTimeout(() => xtermRef.current?.focus(), 100);
            }
            xtermRef.current.scrollToBottom();
          }
        }}
        onTouchEnd={(e) => {
          if (xtermRef.current) {
            e.preventDefault();
            xtermRef.current.focus();
            setTimeout(() => xtermRef.current?.focus(), 100);
            xtermRef.current.scrollToBottom();
          }
        }}
        style={{ 
          flex: 1,
          width: '100%', 
          padding: '12px',
          cursor: 'text',
          outline: 'none',
          WebkitOverflowScrolling: 'touch'
        }} 
      />
    </div>
  );
};

export default ShellView;
