import { useState, useEffect } from 'react';

export const useWebSocketLogs = (token: string | null) => {
  const [wsLogs, setWsLogs] = useState<string[]>([]);

  useEffect(() => {
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = import.meta.env.DEV
      ? `ws://localhost:3000/v1/ws/logs?token=${token}`
      : `${protocol}//${host}/v1/ws/logs?token=${token}`;

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
  }, [token]);

  return { wsLogs, setWsLogs };
};
