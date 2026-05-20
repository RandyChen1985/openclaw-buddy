import { useState, useEffect, useRef } from 'react';
import api from '../api';

/** 网关状态 / 健康度 HTTP 轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 20_000;

export const useStatusPolling = (
  isTransitioning: boolean, 
  targetStatus: string | null, 
  activeTab: string,
  onTransitionEnd: (status: string) => void
) => {
  const [status, setStatus] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [refreshCountdown, setRefreshCountdown] = useState(5);
  const lastStatusRef = useRef<string | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await api.get('/v1/openclaw/status');
      const newStatus = res.data;
      const currentGatewayStatus = newStatus?.gateway?.status;

      if (isTransitioning && targetStatus && currentGatewayStatus === targetStatus) {
        onTransitionEnd(currentGatewayStatus);
      }
      lastStatusRef.current = currentGatewayStatus;
      setStatus(newStatus);
      return newStatus;
    } catch (err) {
      console.error('Fetch status error', err);
      return null;
    } finally {
      setFetching(false);
    }
  };

  const fetchHealth = async () => {
    try {
      const res = await api.get('/v1/stats/health');
      setHistory(res.data);
    } catch (err) {
      console.error('Fetch health error', err);
    }
  };

  // 初始加载
  useEffect(() => {
    fetchStatus();
    fetchHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 状态轮询逻辑 (Status Polling)
  useEffect(() => {
    let timer: any;
    
    // 若已认证的 WebSocket 突然断开，由 App 立即触发一次 fetchStatus 做端口状态校准。
    const interval = POLL_INTERVAL_MS;
    
    if (isTransitioning) {
      timer = setInterval(fetchStatus, interval);
      setRefreshCountdown(0);
    } else {
      const seconds = interval / 1000;
      setRefreshCountdown(seconds);
      timer = setInterval(() => {
        setRefreshCountdown(prev => {
          if (prev <= 1) {
            fetchStatus();
            return seconds;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTransitioning, targetStatus, activeTab]);

  // 健康度轮询逻辑 (Health Polling)
  useEffect(() => {
    const timer = setInterval(fetchHealth, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [activeTab, isTransitioning]);

  return { status, history, fetching, refreshCountdown, fetchData: fetchStatus };
};
