import { useState, useEffect, useRef } from 'react';
import { getWsUrl } from '../utils/url';
import { getTicket } from '../api';

export const useWebSocketLogs = (token: string | null, source: string = 'buddy', onTaskUpdate?: (task: any) => void) => {
  const [wsLogs, setWsLogs] = useState<string[]>([]);
  const onTaskUpdateRef = useRef(onTaskUpdate);

  // 始终保持 ref 是最新的，但不触发 useEffect 重连
  useEffect(() => {
    onTaskUpdateRef.current = onTaskUpdate;
  }, [onTaskUpdate]);

  useEffect(() => {
    if (!token) return;

    // 切换源时清空旧日志
    setWsLogs([]);

    let socket: WebSocket | null = null;
    let isClosed = false;

    const connect = async () => {
      // 优先获取短效票据 (Ticket)
      const ticket = await getTicket();
      let wsUrl = '';
      
      if (ticket) {
        wsUrl = getWsUrl(`/v1/ws/logs?ticket=${ticket}&source=${source}`);
      } else {
        // 回退到长效 Token (兼容旧版本或异常情况)
        wsUrl = getWsUrl(`/v1/ws/logs?token=${token}&source=${source}`);
      }

      if (isClosed) return;

      socket = new WebSocket(wsUrl);

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'TASK_UPDATE' && onTaskUpdateRef.current) {
            onTaskUpdateRef.current(msg.data);
            return;
          }
        } catch (e) {
          // 非 JSON 消息
        }
        setWsLogs((prev) => [...prev.slice(-200), event.data]);
      };

      socket.onerror = (error) => {
        console.error('WebSocket Error:', error);
      };
    };

    connect();

    return () => {
      isClosed = true;
      if (socket) {
        socket.close();
      }
    };
  }, [token, source]); // 移除 onTaskUpdate 依赖

  return { wsLogs, setWsLogs };
};
