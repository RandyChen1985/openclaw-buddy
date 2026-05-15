import { useState, useEffect, useRef } from 'react';
import api from '../api';

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
    
    // 频率计算：过渡态仍保持 30s，避免启停期间放大状态接口压力；
    // 若已认证的 WebSocket 突然断开，由 App 立即触发一次 fetchStatus 做端口状态校准。
    const getStatusInterval = () => {
      if (isTransitioning) return 30000;
      return activeTab === 'dashboard' ? 30000 : 60000;
    };

    const interval = getStatusInterval();
    
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

  // 健康度轮询逻辑 (Health Polling - 低频)
  useEffect(() => {
    // 频率计算：Dashboard 10s，其他页面 30s，过渡态保持 Dashboard 频率
    const healthInterval = activeTab === 'dashboard' || isTransitioning ? 10000 : 30000;
    
    const timer = setInterval(fetchHealth, healthInterval);
    return () => clearInterval(timer);
  }, [activeTab, isTransitioning]);

  return { status, history, fetching, refreshCountdown, fetchData: fetchStatus };
};
