import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { message, Button, Tooltip, Space, Result, Spin, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { RotateCcw, XCircle, Terminal as TerminalIcon, Info, Download, RefreshCw } from 'lucide-react';
import api from '../api';
import storage from '../utils/storage';
import { getWsUrl } from '../utils/url';

const { Paragraph, Text } = Typography;

interface TuiViewProps {
  isRunning?: boolean;
  onNavigateToDashboard?: () => void;
  isDarkMode?: boolean;
}

const TuiView: React.FC<TuiViewProps> = () => {
  const { t } = useTranslation();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [ocVersion, setOcVersion] = useState<string>('');
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleWinResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleWinResize);
    return () => window.removeEventListener('resize', handleWinResize);
  }, []);

  const fetchOcStatus = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/v1/openclaw/version');
      const data = res.data;
      setIsInstalled(data.installed);
      setOcVersion(data.version || '');
    } catch (err) {
      console.error('Failed to fetch openclaw version:', err);
      setIsInstalled(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestart = () => {
    setSessionKey(prev => prev + 1);
    message.success(t('common.restarting', { defaultValue: '正在重启终端...' }));
  };

  const handleInterrupt = () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send('\x03');
      message.info(t('common.interruptSent', { defaultValue: '已发送中断信号 (Ctrl+C)' }));
    }
  };

  useEffect(() => {
    fetchOcStatus();
  }, []);

  useEffect(() => {
    if (!isInstalled || !terminalRef.current) return;

    // Initialize xterm.js
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: isMobile ? 'bar' : 'block',
      fontSize: isMobile ? 13 : 14,
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
    
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const token = storage.getItem('guardian_token');
    let socket: WebSocket | null = null;
    
    const sendResize = () => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows
        }));
      }
    };

    const connect = async () => {
      // 优先获取短效票据 (Ticket)
      const res = await api.post('/v1/auth/ticket').catch(() => null);
      const ticket = res?.data?.ticket;

      let wsUrl = '';
      if (ticket) {
        wsUrl = getWsUrl(`/v1/ws/tui?ticket=${ticket}`);
      } else {
        // 回退到长效 Token
        wsUrl = getWsUrl(`/v1/ws/tui?token=${token}`);
      }

      if (xtermRef.current === null) return; // Component unmounted

      socket = new WebSocket(wsUrl);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;

      socket.onopen = () => {
        sendResize();
      };

      socket.onmessage = (event) => {
        term.write(new Uint8Array(event.data));
      };

      socket.onerror = (error) => {
        console.error('TUI WebSocket error:', error);
        message.error(t('common.connectionError'));
      };

      socket.onclose = () => {
        term.write(`\r\n\x1b[31m[${t('common.connectionClosed')}]\x1b[0m\r\n`);
      };

      term.onData((data) => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(data);
        }
      });

      term.onResize(() => {
        sendResize();
      });
    };

    connect();

    const initialFit = setTimeout(() => {
      fitAddon.fit();
      term.focus();
      sendResize();
    }, 200);

    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(initialFit);
      if (socket) socket.close();
      term.dispose();
      xtermRef.current = null;
    };
  }, [isInstalled, sessionKey]);

  if (isLoading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}>
        <Spin size="large" tip="正在探测系统环境..." />
      </div>
    );
  }

  if (isInstalled === false) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', padding: '40px' }}>
        <Result
          status="warning"
          title={<span style={{ color: '#f8fafc' }}>未检测到 OpenClaw 核心程序</span>}
          subTitle={
            <div style={{ color: '#94a3b8', maxWidth: '600px', margin: '0 auto' }}>
              <Paragraph>
                在线聊天功能依赖于宿主机的 <Text code style={{ color: '#38bdf8', background: '#1e293b' }}>openclaw</Text> 命令行工具。
              </Paragraph>
              <Paragraph>
                请确保您已完成以下步骤：
                <ul style={{ textAlign: 'left', marginTop: '16px' }}>
                  <li>在服务器上下载并解压 OpenClaw 核心。</li>
                  <li>将执行文件路径加入系统的环境变量（PATH）中。</li>
                  <li>或者在 Buddy 的配置文件中指定正确的执行路径。</li>
                </ul>
              </Paragraph>
            </div>
          }
          extra={[
            <Button 
                type="primary" 
                key="github" 
                icon={<Download size={16} />} 
                onClick={() => window.open('https://github.com/RandyChen1985/openclaw-buddy/releases')}
                className="flex items-center gap-2"
            >
              前往 GitHub 下载
            </Button>,
            <Button 
                key="retry" 
                icon={<RefreshCw size={16} />} 
                onClick={fetchOcStatus}
                ghost
                style={{ color: '#94a3b8', borderColor: '#475569' }}
            >
              重新探测
            </Button>
          ]}
          style={{ 
            background: 'rgba(30, 41, 59, 0.5)', 
            backdropFilter: 'blur(20px)',
            borderRadius: '16px',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}
        />
      </div>
    );
  }

  return (
    <div 
      style={{ 
        height: '100%', 
        width: '100%', 
        background: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      {/* 允许在网关停止时通过 TUI 工具进行对话（命令会自行处理连接错误） */}
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
            {!isMobile && <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '13px' }}>TUI 聊天</span>}
          </div>

          {ocVersion && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', maxWidth: isMobile ? '160px' : 'none' }}>
              <Info size={13} style={{ color: '#94a3b8' }} />
              <span style={{ color: '#cbd5e1', whiteSpace: 'nowrap' }}>
                {isMobile ? 'v' : 'OpenClaw CLI:'}
              </span>
              <span style={{ 
                color: '#38bdf8', 
                fontFamily: 'monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontWeight: 600
              }}>
                {ocVersion}
              </span>
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

          <Tooltip title={t('common.restartTerminal', { defaultValue: '重启终端' })}>
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
            e.preventDefault(); // 防止触发双击缩放或其他干扰
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

export default TuiView;
