import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { message } from 'antd';
import { Sparkles } from 'lucide-react';
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
  /** 选中文本后填入 V3 聊天输入框 */
  onSendSelectionToChat?: (text: string) => void;
  /** 弹窗内略大字号；侧栏默认 12 */
  fontSize?: number;
  cursorStyle?: 'block' | 'bar' | 'underline';
  screenReaderMode?: boolean;
}

interface SelectionSendHint {
  text: string;
  x: number;
  y: number;
}

const MIN_SELECTION_LEN = 2;

export const V3TerminalSession = forwardRef<V3TerminalSessionHandle, V3TerminalSessionProps>(
  function V3TerminalSession(
    {
      t,
      cwd,
      width: _width,
      isActive,
      restartKey,
      onSendSelectionToChat,
      fontSize = 12,
      cursorStyle = 'block',
      screenReaderMode = false,
    },
    ref
  ) {
    const [terminalEl, setTerminalEl] = React.useState<HTMLDivElement | null>(null);
    const [sendHint, setSendHint] = useState<SelectionSendHint | null>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const socketRef = useRef<WebSocket | null>(null);
    const sendHintRef = useRef<SelectionSendHint | null>(null);
    sendHintRef.current = sendHint;

    const handleSendToChat = useCallback(() => {
      const hint = sendHintRef.current;
      if (!hint || !onSendSelectionToChat) return;
      onSendSelectionToChat(hint.text);
      xtermRef.current?.clearSelection();
      setSendHint(null);
    }, [onSendSelectionToChat]);

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
        sendCommand: (cmd: string) => {
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send('\x03');
            setTimeout(() => {
              socketRef.current?.send(cmd + '\n');
              xtermRef.current?.focus();
            }, 120);
          } else {
            message.warning(t('common.terminalNotConnected', { defaultValue: '终端未连接，请重新连接' }));
          }
        }
      }),
      [t]
    );

    useEffect(() => {
      if (!terminalEl) return;

      let active = true;

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
        if (!active) return;
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
          if (!active) {
            socket?.close();
            return;
          }
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

      const onMouseUp = onSendSelectionToChat
        ? (ev: MouseEvent) => {
            requestAnimationFrame(() => {
              if (!xtermRef.current?.hasSelection()) return;
              const raw = xtermRef.current.getSelection() ?? '';
              const trimmed = raw.trim();
              if (trimmed.length < MIN_SELECTION_LEN) return;

              if (navigator.clipboard) {
                void navigator.clipboard.writeText(raw).catch(() => {});
              }

              const rect = terminalEl.getBoundingClientRect();
              const btnW = 132;
              const btnH = 32;
              let x = ev.clientX - rect.left - btnW / 2;
              let y = ev.clientY - rect.top - btnH - 8;
              x = Math.max(8, Math.min(x, rect.width - btnW - 8));
              y = Math.max(8, Math.min(y, rect.height - btnH - 8));
              setSendHint({ text: raw, x, y });
            });
          }
        : null;

      if (onMouseUp) {
        term.onSelectionChange(() => {
          if (!term.hasSelection()) {
            setSendHint(null);
          }
        });
        terminalEl.addEventListener('mouseup', onMouseUp);
      }

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
        active = false;
        ro?.disconnect();
        window.removeEventListener('resize', handleResize);
        if (onMouseUp) terminalEl.removeEventListener('mouseup', onMouseUp);
        if (socket) socket.close();
        term.dispose();
        xtermRef.current = null;
        socketRef.current = null;
        setSendHint(null);
      };
    }, [terminalEl, restartKey, cwd, t, fontSize, cursorStyle, screenReaderMode, onSendSelectionToChat]);


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

    useEffect(() => {
      if (isActive) {
        (window as any).__ClawTerminal__ = {
          sendCommand: (cmd: string) => {
            const trySend = () => {
              if (socketRef.current?.readyState === WebSocket.OPEN) {
                socketRef.current.send('\x03');
                setTimeout(() => {
                  socketRef.current?.send(cmd + '\n');
                  xtermRef.current?.focus();
                }, 120);
                return true;
              }
              return false;
            };

            // 1. 如果已处于 OPEN 状态，直接运行命令
            if (trySend()) return;

            // 2. 如果处于 CONNECTING（连接中）状态，启动高频智能轮询排队机制，自适应等待 5 秒
            const socket = socketRef.current;
            if (socket && socket.readyState === WebSocket.CONNECTING) {
              message.info(t('chat.terminalInitializing', { defaultValue: '终端正在连接中，请稍候...' }));
              let attempts = 0;
              const interval = setInterval(() => {
                attempts++;
                if (trySend()) {
                  clearInterval(interval);
                } else if (attempts >= 25) { // 5秒超时上限
                  clearInterval(interval);
                  message.warning(t('common.terminalNotConnected', { defaultValue: '终端已断开，请先启动终端' }));
                }
              }, 200);
              return;
            }

            // 3. 确实为关闭状态，直接警告
            message.warning(t('common.terminalNotConnected', { defaultValue: '终端已断开，请先启动终端' }));
          }
        };
      }
      return () => {
        if (isActive) {
          // 只做清理标识
        }
      };
    }, [isActive, restartKey, t]);

    return (
      <div className="v3-terminal-session-wrap" style={{ position: 'relative', height: '100%', width: '100%', minHeight: 0 }}>
        <div
          ref={setTerminalEl}
          style={{ height: '100%', width: '100%', minHeight: 0 }}
          onClick={() => xtermRef.current?.focus()}
        />
        {sendHint && onSendSelectionToChat && (
          <button
            type="button"
            className="v3-terminal-selection-send"
            style={{ left: sendHint.x, top: sendHint.y }}
            onMouseDown={e => e.preventDefault()}
            onClick={handleSendToChat}
          >
            <Sparkles size={14} />
            <span>{t('chat.terminalSendToAi', { defaultValue: '发送到 AI 分析' })}</span>
          </button>
        )}
      </div>
    );
  }
);
