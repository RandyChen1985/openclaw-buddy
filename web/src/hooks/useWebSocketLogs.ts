import { useState, useEffect, useRef } from 'react';

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

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = import.meta.env.DEV
      ? `ws://localhost:3000/v1/ws/logs?token=${token}&source=${source}`
      : `${protocol}//${host}/v1/ws/logs?token=${token}&source=${source}`;

    const socket = new WebSocket(wsUrl);

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

    return () => {
      socket.close();
    };
  }, [token, source]); // 移除 onTaskUpdate 依赖

  return { wsLogs, setWsLogs };
};
