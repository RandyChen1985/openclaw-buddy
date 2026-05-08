import { useState, useEffect, useRef } from 'react';
import { getWsUrl } from '../utils/url';
import { getTicket } from '../api';

/** 与后端默认 history_lines 对齐；前端滚动缓冲略大以便承接历史 + 实时 */
const WS_LOG_MAX_LINES = 2000;
/** Buddy 源请求末尾历史行数（query history_lines，后端上限 5000） */
const BUDDY_HISTORY_LINES = 800;

export type WsLogConnectionState = 'idle' | 'connecting' | 'open' | 'error';

export const useWebSocketLogs = (
  token: string | null,
  source: string = 'buddy',
  onTaskUpdate?: (task: any) => void,
  /** 为 false 时不建立连接（任务状态仍由轮询兜底） */
  enabled: boolean = true
) => {
  const [wsLogs, setWsLogs] = useState<string[]>([]);
  const [wsConnectionState, setWsConnectionState] = useState<WsLogConnectionState>('idle');
  const onTaskUpdateRef = useRef(onTaskUpdate);

  // 始终保持 ref 是最新的，但不触发 useEffect 重连
  useEffect(() => {
    onTaskUpdateRef.current = onTaskUpdate;
  }, [onTaskUpdate]);

  useEffect(() => {
    if (!enabled || !token) {
      setWsConnectionState('idle');
      return;
    }

    // 切换源时清空旧日志
    setWsLogs([]);
    setWsConnectionState('connecting');

    let socket: WebSocket | null = null;
    let isClosed = false;

    const connect = async () => {
      // 优先获取短效票据 (Ticket)
      const ticket = await getTicket();
      let wsUrl = '';
      
      const historyQ = source === 'buddy' ? `&history_lines=${BUDDY_HISTORY_LINES}` : '';
      if (ticket) {
        wsUrl = getWsUrl(`/v1/ws/logs?ticket=${encodeURIComponent(ticket)}&source=${source}${historyQ}`);
      } else {
        // 回退到长效 Token (兼容旧版本或异常情况)
        wsUrl = getWsUrl(`/v1/ws/logs?token=${encodeURIComponent(token)}&source=${source}${historyQ}`);
      }

      if (isClosed) return;

      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        if (!isClosed) setWsConnectionState('open');
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'TASK_UPDATE' && onTaskUpdateRef.current) {
            onTaskUpdateRef.current(msg.data);
            return;
          }
          if (msg.type === 'LOG_HISTORY' && Array.isArray(msg.lines)) {
            const lines = msg.lines.map((x: unknown) => String(x));
            setWsLogs(lines.slice(-WS_LOG_MAX_LINES));
            return;
          }
        } catch (e) {
          // 非 JSON 消息
        }
        setWsLogs((prev) => [...prev.slice(-WS_LOG_MAX_LINES), event.data]);
      };

      socket.onerror = (error) => {
        console.error('WebSocket Error:', error);
        if (!isClosed) setWsConnectionState('error');
      };

      socket.onclose = () => {
        if (!isClosed) setWsConnectionState('error');
      };
    };

    connect();

    return () => {
      isClosed = true;
      if (socket) {
        socket.close();
      }
    };
  }, [token, source, enabled]); // 移除 onTaskUpdate 依赖

  return { wsLogs, setWsLogs, wsConnectionState };
};
