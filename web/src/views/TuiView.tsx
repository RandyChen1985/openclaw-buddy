import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { message, Button, Tooltip, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { RotateCcw, XCircle } from 'lucide-react';

const TuiView: React.FC = () => {
  const { t } = useTranslation();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [sessionKey, setSessionKey] = useState(0);

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

  useEffect(() => {
    if (!terminalRef.current) return;

    // Initialize xterm.js
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Cascadia Code", "Fira Code", monospace',
      theme: {
        background: '#0f172a',
        foreground: '#f8fafc',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    term.focus();
    
    // 给 DOM 渲染留一点时间后再计算尺寸
    const initialFit = setTimeout(() => {
      fitAddon.fit();
      term.focus(); // 再次确保聚焦
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        sendResize();
      }
    }, 200);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Connection Logic
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = localStorage.getItem('guardian_token');
    
    const wsUrl = `${protocol}//${host}/v1/ws/tui?token=${token}`;
    
    const socket = new WebSocket(wsUrl);
    socket.binaryType = 'arraybuffer'; // 必须要设为二进制模式同步 PTY 流
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
      console.log('TUI WebSocket connected');
      // 连接成功后立即同步尺寸
      sendResize();
    };

    socket.onmessage = (event) => {
      // 接收二进制数据并写入终端
      term.write(new Uint8Array(event.data));
    };

    socket.onerror = (error) => {
      console.error('TUI WebSocket error:', error);
      message.error(t('common.connectionError'));
    };

    socket.onclose = () => {
      console.log('TUI WebSocket closed');
      term.write('\r\n\x1b[31m[Connection Closed]\x1b[0m\r\n');
    };

    term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    });

    // 监听终端尺寸变化 (FitAddon 触发或窗口变化)
    term.onResize(() => {
      sendResize();
    });

    // Handle resize
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
      {/* 悬浮操作按钮组 */}
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 100 }}>
        <Space>
          <Tooltip title={t('common.interrupt', { defaultValue: '强制中断 (Ctrl+C)' })}>
            <Button 
              shape="circle" 
              icon={<XCircle size={18} />} 
              onClick={handleInterrupt}
              style={{ 
                background: 'rgba(239, 68, 68, 0.2)', 
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#fca5a5',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
              }} 
              className="hover:bg-red-500/30 hover:scale-110 active:scale-95 transition-all"
            />
          </Tooltip>

          <Tooltip title={t('common.restartTerminal', { defaultValue: '重启终端' })}>
            <Button 
              shape="circle" 
              icon={<RotateCcw size={18} />} 
              onClick={handleRestart}
              style={{ 
                background: 'rgba(255, 255, 255, 0.1)', 
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#fff',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
              }} 
              className="hover:scale-110 active:scale-95 transition-all"
            />
          </Tooltip>
        </Space>
      </div>

      <div 
        ref={terminalRef} 
        tabIndex={0}
        onClick={() => {
          if (xtermRef.current) {
            xtermRef.current.focus();
            xtermRef.current.scrollToBottom();
          }
        }}
        style={{ 
          height: '100%', 
          width: '100%', 
          padding: '12px',
          cursor: 'text',
          outline: 'none'
        }} 
      />
    </div>
  );
};

export default TuiView;
