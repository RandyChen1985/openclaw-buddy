import React, { useEffect, useRef } from 'react';
import { Modal, Button, Empty } from 'antd';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { RefreshCw } from 'lucide-react';
import 'xterm/css/xterm.css';
import storage from '../../utils/storage';
import { getWsUrl } from '../../utils/url';

interface TerminalModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  initialCommand?: string;
}

const TerminalModal: React.FC<TerminalModalProps> = ({ open, onClose, title = '终端安装器', initialCommand }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  // Initialize terminal and socket
  const initTerminal = () => {
    if (!terminalRef.current) return;

    // Clean up existing if any
    if (socketRef.current) socketRef.current.close();
    if (xtermRef.current) xtermRef.current.dispose();

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
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
    term.open(terminalRef.current);
    term.focus();
    
    // Multi-stage fit to handle modal transitions
    setTimeout(() => fitAddon.fit(), 100);
    setTimeout(() => fitAddon.fit(), 500);

    xtermRef.current = term;

    term.write('\x1b[1;34m[Buddy] 正在建立端到端加密隧道...\x1b[0m\r\n');

    const token = storage.getItem('guardian_token');
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
      term.write('\x1b[1;32m[Buddy] 隧道已建立，环境准备就绪。\x1b[0m\r\n\r\n');
      sendResize();
      
      if (initialCommand) {
        // Longer delay to ensure the shell process greeted us with a prompt
        setTimeout(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(new TextEncoder().encode(initialCommand + '\r'));
          }
        }, 1200);
      }
    };

    socket.onmessage = (event) => {
      term.write(new Uint8Array(event.data));
    };

    socket.onerror = () => {
      term.write('\r\n\x1b[1;31m[Buddy Error] 无法连接到终端服务，请检查网络或登录状态。\x1b[0m\r\n');
    };

    socket.onclose = () => {
      term.write('\r\n\x1b[1;31m[Session Closed]\x1b[0m\r\n');
    };

    term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    });

    term.onResize(() => sendResize());

    // Window resize handler
    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  };

  useEffect(() => {
    // If closed, cleanup
    if (!open) {
      if (socketRef.current) socketRef.current.close();
      if (xtermRef.current) xtermRef.current.dispose();
      return;
    }
  }, [open]);

  const handleRetry = () => {
    setTimeout(initTerminal, 100);
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 32 }}>
          <span style={{ fontWeight: 700 }}>{title}</span>
          <Button 
            type="text" 
            size="small" 
            icon={<RefreshCw size={14} />} 
            onClick={handleRetry}
            style={{ color: '#64748b' }}
          >
            重启连接
          </Button>
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={900}
      styles={{ body: { padding: 0, height: 500, background: '#0f172a' } }}
      destroyOnClose
      centered
      afterOpenChange={(isOpen) => {
        if (isOpen) {
          // Give it a small tick to ensure DOM is fully injected
          setTimeout(initTerminal, 50);
        }
      }}
    >
      <div 
        ref={terminalRef} 
        style={{ 
          height: '100%', 
          width: '100%', 
          padding: '12px',
          background: '#0f172a'
        }} 
      >
        {!open && <Empty description="正在准备环境..." />}
      </div>
    </Modal>
  );
};

export default TerminalModal;
