import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { message } from 'antd';
import api from '../../api';
import storage from '../../utils/storage';
import { getWsUrl } from '../../utils/url';

/** 新建运维终端标签页时使用 */
export function genTerminalTabId() {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export interface V3TerminalSessionHandle {
  interrupt: () => void;
  focusTerminal: () => void;
  scrollToBottom: () => void;
}

export interface V3TerminalSessionProps {
  t: (key: string, opts?: Record<string, unknown>) => string;
  cwd?: string;
  width: number;
  isActive: boolean;
  restartKey: number;
  /** 弹窗内略大字号；侧栏默认 12 */
  fontSize?: number;
  cursorStyle?: 'block' | 'bar' | 'underline';
  screenReaderMode?: boolean;
}

export const V3TerminalSession = forwardRef<V3TerminalSessionHandle, V3TerminalSessionProps>(
  function V3TerminalSession(
    { t, cwd, width: _width, isActive, restartKey, fontSize = 12, cursorStyle = 'block', screenReaderMode = false },
    ref
  ) {
    const [terminalEl, setTerminalEl] = React.useState<HTMLDivElement | null>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const socketRef = useRef<WebSocket | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        interrupt: () => {
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send('\x03');
          }
        },
        focusTerminal: () => {
          xtermRef.current?.focus();
        },
        scrollToBottom: () => {
          xtermRef.current?.scrollToBottom();
        },
      }),
      []
    );

    useEffect(() => {
      if (!terminalEl) return;

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle,
        fontSize,
        fontFamily: '"Cascadia Code", "Fira Code", monospace',
        theme: {
          background: '#0f172a',
          foreground: '#f8fafc',
          selectionBackground: 'rgba(255, 255, 255, 0.2)',
        },
        allowProposedApi: true,
        screenReaderMode,
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
          socket.send(
            JSON.stringify({
              type: 'resize',
              cols: term.cols,
              rows: term.rows,
            })
          );
        }
      };

      const connect = async () => {
        const res = await api.post('/v1/auth/ticket').catch(() => null);
        const ticket = res?.data?.ticket;

        const queryParams = new URLSearchParams();
        if (ticket) queryParams.set('ticket', ticket);
        else queryParams.set('token', token || '');
        if (cwd) queryParams.set('cwd', cwd);

        const wsUrl = getWsUrl(`/v1/ws/shell?${queryParams.toString()}`);

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

      const fitTerminal = () => {
        if (!fitAddonRef.current || !xtermRef.current) return;
        fitAddonRef.current.fit();
        sendResize();
      };

      const ro = typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            requestAnimationFrame(fitTerminal);
          })
        : null;
      ro?.observe(terminalEl);

      const handleResize = () => requestAnimationFrame(fitTerminal);
      window.addEventListener('resize', handleResize);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitTerminal();
          xtermRef.current?.focus();
        });
      });

      return () => {
        ro?.disconnect();
        window.removeEventListener('resize', handleResize);
        if (socket) socket.close();
        term.dispose();
        xtermRef.current = null;
        socketRef.current = null;
      };
    }, [terminalEl, restartKey, cwd, t, fontSize, cursorStyle, screenReaderMode]);

    useEffect(() => {
      if (!isActive) return;
      const id = requestAnimationFrame(() => {
        if (fitAddonRef.current && xtermRef.current) {
          fitAddonRef.current.fit();
          xtermRef.current.focus();
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(
              JSON.stringify({
                type: 'resize',
                cols: xtermRef.current.cols,
                rows: xtermRef.current.rows,
              })
            );
          }
        }
      });
      return () => cancelAnimationFrame(id);
    }, [isActive]);

    return (
      <div
        ref={setTerminalEl}
        style={{ height: '100%', width: '100%', minHeight: 0 }}
        onClick={() => xtermRef.current?.focus()}
      />
    );
  }
);
