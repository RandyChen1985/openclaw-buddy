import { useState, useEffect } from 'react';

export const useWebSocketLogs = (token: string | null, source: string = 'buddy') => {
  const [wsLogs, setWsLogs] = useState<string[]>([]);

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
      setWsLogs((prev) => [...prev.slice(-200), event.data]);
    };

    socket.onerror = (error) => {
      console.error('WebSocket Error:', error);
    };

    return () => {
      socket.close();
    };
  }, [token, source]);

  return { wsLogs, setWsLogs };
};
