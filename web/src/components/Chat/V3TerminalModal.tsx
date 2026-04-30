import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { message, Button, Tooltip, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { RotateCcw, XCircle, Terminal as TerminalIcon, Maximize2, Minimize2 } from 'lucide-react';
import api from '../../api';
import storage from '../../utils/storage';
import { getWsUrl } from '../../utils/url';

interface V3TerminalModalProps {
  open: boolean;
  onClose: () => void;
  cwd?: string;
  title?: string;
}

export const V3TerminalModal: React.FC<V3TerminalModalProps> = ({ open, onClose, cwd, title }) => {
  const { t } = useTranslation();
  const [terminalEl, setTerminalEl] = useState<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [isMobile] = useState(window.innerWidth < 768);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!open || !terminalEl) return;

    // Initialize xterm.js
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: isMobile ? 12 : 13,
      fontFamily: '"Cascadia Code", "Fira Code", monospace',
      theme: {
        background: '#0f172a',
        foreground: '#f8fafc',
        selectionBackground: 'rgba(255, 255, 255, 0.2)',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalEl);
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
      const queryParams = new URLSearchParams();
      if (ticket) queryParams.set('ticket', ticket);
      else queryParams.set('token', token || '');
      if (cwd) queryParams.set('cwd', cwd);

      wsUrl = getWsUrl(`/v1/ws/shell?${queryParams.toString()}`);

      if (xtermRef.current === null) return;

      socket = new WebSocket(wsUrl);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;

      socket.onopen = () => {
        sendResize();
        // 如果有 cwd，显示一条提示
        if (cwd) {
          term.write(`\x1b[1;34m[Buddy] 自动切换到工作目录: ${cwd}\x1b[0m\r\n`);
        }
      };

      socket.onmessage = (event) => {
        term.write(new Uint8Array(event.data));
      };

      socket.onerror = (error) => {
        console.error('Terminal WebSocket error:', error);
        message.error(t('common.connectionError'));
      };

      socket.onclose = () => {
        term.write(`\r\n\x1b[31m[${t('common.sessionClosed')}]\x1b[0m\r\n`);
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
      if (fitAddonRef.current && xtermRef.current) {
        fitAddonRef.current.fit();
        xtermRef.current.focus();
        sendResize();
      }
    }, 400); // 增加延迟以确保 Modal 动画完成

    const handleResize = () => {
      fitAddon.fit();
      sendResize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(initialFit);
      if (socket) socket.close();
      term.dispose();
      xtermRef.current = null;
    };
  }, [open, terminalEl, sessionKey, cwd, isMobile, t]);

  const handleRestart = () => {
    setSessionKey(prev => prev + 1);
  };

  const handleInterrupt = () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send('\x03');
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={isFullscreen ? '100vw' : 1000}
      centered
      destroyOnClose
      styles={{
        body: { padding: 0, height: isFullscreen ? 'calc(100vh - 40px)' : '600px', background: '#0f172a', overflow: 'hidden', borderRadius: isFullscreen ? 0 : '0 0 12px 12px' },
        content: { padding: 0, background: '#0f172a', borderRadius: isFullscreen ? 0 : 12, overflow: 'hidden' },
        header: { padding: '12px 16px', background: '#1e293b', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: 0, borderRadius: isFullscreen ? 0 : '12px 12px 0 0' }
      }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: 'calc(100% - 32px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f8fafc' }}>
            <TerminalIcon size={16} className="text-indigo-400" />
            <span style={{ fontSize: 14, fontWeight: 700 }}>{title || t('common.terminal', { defaultValue: '运维终端' })}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
             <Tooltip title={t('common.interrupt', { defaultValue: '中断 (Ctrl+C)' })}>
                <Button 
                  size="small" 
                  type="text" 
                  icon={<XCircle size={14} />} 
                  onClick={handleInterrupt}
                  style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)' }}
                />
             </Tooltip>
             <Tooltip title={t('common.restart', { defaultValue: '重启' })}>
                <Button 
                  size="small" 
                  type="text" 
                  icon={<RotateCcw size={14} />} 
                  onClick={handleRestart}
                  style={{ color: '#94a3b8' }}
                />
             </Tooltip>
             <Tooltip title={isFullscreen ? t('common.exitFullscreen') : t('common.fullscreen')}>
                <Button 
                  size="small" 
                  type="text" 
                  icon={isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />} 
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  style={{ color: '#94a3b8' }}
                />
             </Tooltip>
          </div>
        </div>
      }
      closeIcon={<span style={{ color: '#94a3b8' }}>×</span>}
      style={isFullscreen ? { top: 0, maxWidth: '100vw', margin: 0, padding: 0 } : {}}
    >
      <div 
        ref={setTerminalEl} 
        style={{ height: '100%', width: '100%', padding: 12 }}
        onClick={() => xtermRef.current?.focus()}
      />
    </Modal>
  );
};
