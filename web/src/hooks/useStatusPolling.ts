import { useState, useEffect, useRef } from 'react';
import api from '../api';

export const useStatusPolling = (isTransitioning: boolean, targetStatus: string | null, onTransitionEnd: (status: string) => void) => {
  const [status, setStatus] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [refreshCountdown, setRefreshCountdown] = useState(10);
  const lastStatusRef = useRef<string | null>(null);

  const fetchData = async () => {
    try {
      const [statusRes, historyRes] = await Promise.all([
        api.get('/v1/openclaw/status'),
        api.get('/v1/stats/health'),
      ]);
      const newStatus = statusRes.data;
      const currentGatewayStatus = newStatus?.gateway?.status;

      if (isTransitioning && targetStatus && currentGatewayStatus === targetStatus) {
        onTransitionEnd(currentGatewayStatus);
      }
      lastStatusRef.current = currentGatewayStatus;

      setStatus(newStatus);
      setHistory(historyRes.data);
    } catch (err) {
      console.error('Fetch error', err);
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let timer: any;
    if (isTransitioning) {
      timer = setInterval(fetchData, 2000);
      setRefreshCountdown(0);
    } else {
      setRefreshCountdown(10);
      timer = setInterval(() => {
        setRefreshCountdown(prev => {
          if (prev <= 1) {
            fetchData();
            return 10;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTransitioning, targetStatus]);

  return { status, history, fetching, refreshCountdown, fetchData };
};
