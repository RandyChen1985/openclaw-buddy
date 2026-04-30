import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { message, Button, Tooltip } from 'antd';
import { RotateCcw, XCircle, Terminal as TerminalIcon, X, Maximize2, Minimize2 } from 'lucide-react';
import api from '../../api';
import storage from '../../utils/storage';
import { getWsUrl } from '../../utils/url';

interface V3TerminalPaneProps {
  t: any;
  cwd?: string;
  width?: number;
  onWidthChange?: (width: number) => void;
  onClose: () => void;
  transition?: string;
}

export const V3TerminalPane: React.FC<V3TerminalPaneProps> = ({ t, cwd, width = 450, onWidthChange, onClose, transition: customTransition }) => {
  const [terminalEl, setTerminalEl] = useState<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [sessionKey, setSessionKey] = useState(0);

  useEffect(() => {
    if (!terminalEl) return;

    // Initialize xterm.js
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 12,
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
    }, 400);

    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
        sendResize();
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(initialFit);
      if (socket) socket.close();
      term.dispose();
      xtermRef.current = null;
    };
  }, [terminalEl, sessionKey, cwd, t]);

  // Handle width changes (including CSS transitions)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({
            type: 'resize',
            cols: xtermRef.current?.cols,
            rows: xtermRef.current?.rows
          }));
        }
      }
    }, 250); // Match or slightly exceed CSS transition time
    return () => clearTimeout(timer);
  }, [width]);

  const handleRestart = () => {
    setSessionKey(prev => prev + 1);
  };

  const handleInterrupt = () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send('\x03');
    }
  };

  return (
    <div className="v3-terminal-pane" style={{
      width: width,
      height: '100%',
      background: '#0f172a',
      borderLeft: '1px solid #334155',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '-4px 0 15px rgba(0,0,0,0.2)',
      zIndex: 20,
      transition: customTransition !== undefined ? customTransition : 'width 0.2s ease-in-out'
    }}>
      <div style={{ 
        padding: '12px 16px', 
        borderBottom: '1px solid #334155', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        background: '#1e293b'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f8fafc' }}>
          <TerminalIcon size={14} className="text-indigo-400" />
          <span style={{ fontSize: 13, fontWeight: 800 }}>{t('common.terminal', { defaultValue: '运维终端' })}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Tooltip title={t('common.interrupt', { defaultValue: '中断 (Ctrl+C)' })}>
            <Button 
              size="small" 
              type="text" 
              icon={<XCircle size={14} />} 
              onClick={handleInterrupt}
              style={{ color: '#ef4444' }}
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
          <Tooltip title={width > 600 ? t('common.minimize', { defaultValue: '最小化' }) : t('common.maximize', { defaultValue: '最大化' })}>
            <Button 
              size="small" 
              type="text" 
              icon={width > 600 ? <Minimize2 size={14} /> : <Maximize2 size={14} />} 
              onClick={() => {
                const target = width > 600 ? 450 : 800;
                onWidthChange?.(target);
              }}
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
      <div 
        ref={setTerminalEl} 
        style={{ flex: 1, overflow: 'hidden', padding: 12 }}
        onClick={() => xtermRef.current?.focus()}
      />
    </div>
  );
};
