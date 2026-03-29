import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { Card, Breadcrumb, message } from 'antd';
import { useTranslation } from 'react-i18next';

const TuiView: React.FC = () => {
  const { t } = useTranslation();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

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
    
    // 给 DOM 渲染留一点时间后再计算尺寸
    const initialFit = setTimeout(() => {
      fitAddon.fit();
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
    };
  }, [t]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Breadcrumb items={[
          { title: t('common.console') },
          { title: t('common.tuiChat') }
        ]} />
      </div>

      <Card 
        styles={{ body: { padding: 0, height: 'calc(100vh - 120px)', background: '#0f172a' } }}
        style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #1e293b' }}
      >
        <div ref={terminalRef} style={{ height: '100%', width: '100%', padding: '12px' }} />
      </Card>
    </div>
  );
};

export default TuiView;
