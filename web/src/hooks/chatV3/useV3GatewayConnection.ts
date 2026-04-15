import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import storage from '../../utils/storage';
import { getWsUrl } from '../../utils/url';
import { getTicket } from '../../api';
import { APP_VERSION } from '../../version';
import * as nacl from 'tweetnacl';

export type V3WsStatus =
  | 'disconnected'
  | 'connecting'
  | 'challenging'
  | 'authorizing'
  | 'authenticated'
  | 'error';

type V3WsEvent =
  | { type: 'CONNECT_REQUEST' }
  | { type: 'WS_OPEN' }
  | { type: 'WS_CLOSE' }
  | { type: 'WS_ERROR' }
  | { type: 'CHALLENGE_RECEIVED' }
  | { type: 'AUTH_OK' }
  | { type: 'AUTH_NEEDS_PAIRING' }
  | { type: 'AUTH_FAILED' };

function wsStatusReducer(state: V3WsStatus, event: V3WsEvent): V3WsStatus {
  switch (event.type) {
    case 'CONNECT_REQUEST':
      return 'connecting';
    case 'WS_OPEN':
      return 'challenging';
    case 'CHALLENGE_RECEIVED':
      return 'challenging';
    case 'AUTH_OK':
      return 'authenticated';
    case 'AUTH_NEEDS_PAIRING':
      return 'authorizing';
    case 'AUTH_FAILED':
      return 'error';
    case 'WS_CLOSE':
      return 'disconnected';
    case 'WS_ERROR':
      return 'error';
    default:
      return state;
  }
}

export interface V3GatewayConnectionHandlers {
  /**
   * 处理后端 event 流。
   */
  onEvent?: (data: any, ws: WebSocket) => void;
  /**
   * 处理后端 res（RPC 响应）。
   */
  onResponse?: (data: any) => void;
}

export interface UseV3GatewayConnectionParams {
  keyPair: nacl.BoxKeyPair | null;
  deviceId: string;
  /**
   * 最大重连次数；达到上限后会进入 error。
   */
  maxReconnects?: number;
  /**
   * 连接上的 ws event/res 路由回调（由上层组合器实现）。
   */
  handlers?: V3GatewayConnectionHandlers;
}

export interface SendRpcResult {
  ok: boolean;
  payload?: any;
  error?: { message?: string } | any;
  id?: string;
}

/**
 * v3 网关连接层：负责 WebSocket 生命周期、RPC 请求/响应、pending 超时、以及重连调度。
 *
 * 说明：该模块只管理“连接与协议收发”，业务侧（chat/sessions/approval 等）的事件处理通过 handlers 注入。
 */
export function useV3GatewayConnection({
  keyPair,
  deviceId,
  maxReconnects = 5,
  handlers
}: UseV3GatewayConnectionParams) {
  const wsRef = useRef<WebSocket | null>(null);
  const requestIdRef = useRef(1);
  const pendingRequests = useRef<Map<string, (res: any) => void>>(new Map());
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, dispatch] = useReducer(wsStatusReducer, 'disconnected' as V3WsStatus);
  const [lastHealth, setLastHealth] = useState<{ ok: boolean; latency: number; ts: number } | null>(null);
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [pulse, setPulse] = useState(0);

  /**
   * 统一失败回调所有挂起中的 RPC 请求，避免断连后 Promise 悬挂导致 UI 卡死。
   */
  const rejectAllPendingRequests = useCallback((errorMessage: string) => {
    if (pendingRequests.current.size === 0) return;
    const resolvers = Array.from(pendingRequests.current.values());
    pendingRequests.current.clear();
    resolvers.forEach(resolve => resolve({ ok: false, error: { message: errorMessage } }));
  }, []);

  /**
   * 发送网关 RPC 请求（req/res）。当 ws 未连接时返回 ok=false。
   */
  const sendRPC = useCallback((method: string, params: any): Promise<SendRpcResult> => {
    return new Promise((resolve) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        resolve({ ok: false, error: { message: 'WebSocket not connected' } });
        return;
      }
      const id = `${method}-${requestIdRef.current++}`;
      const req = { type: 'req', id, method, params };

      const timeoutValue = method === 'sessions.delete' ? 180000 : 30000;
      const timer = setTimeout(() => {
        if (pendingRequests.current.has(id)) {
          pendingRequests.current.delete(id);
          resolve({ ok: false, error: { message: `RPC timeout (${timeoutValue / 1000}s)` } });
        }
      }, timeoutValue);

      pendingRequests.current.set(id, (res: any) => {
        clearTimeout(timer);
        resolve(res);
      });
      wsRef.current.send(JSON.stringify(req));
    });
  }, []);

  /**
   * 完成 challenge 握手并发起 connect 授权。
   */
  const handleChallenge = useCallback(async (nonce: string, ws: WebSocket) => {
    if (!keyPair || !deviceId) return;
    const nonceBytes = new TextEncoder().encode(nonce);
    const payload = new Uint8Array([...nonceBytes, ...new TextEncoder().encode(APP_VERSION)]);
    const signature = nacl.sign.detached(payload, keyPair.secretKey);

    let gatewayToken = '';
    try {
      const api = await import('../../api').then(m => m.default);
      const res = await api.get('/v1/openclaw/gateway-token');
      gatewayToken = res.data?.token || '';
    } catch (e) {
      // 保持原行为：仅记录错误并进入 error
      // eslint-disable-next-line no-console
      console.error('❌ [V3] 获取 Gateway Token 失败:', e);
      dispatch({ type: 'AUTH_FAILED' });
      return;
    }

    const role = 'operator';
    const scopes = 'operator.admin,operator.read,operator.write';
    const clientId = 'openclaw-control-ui';
    const clientMode = 'cli';
    const platform = navigator.platform.toLowerCase().includes('mac') ? 'macos' : 'windows';

    const authId = `connect-${Date.now()}`;
    const req = {
      type: 'req',
      id: authId,
      method: 'connect',
      params: {
        role,
        scopes: scopes.split(','),
        clientId,
        clientMode,
        deviceId,
        platform,
        gatewayToken,
        challenge: {
          nonce,
          publicKey: btoa(String.fromCharCode(...keyPair.publicKey)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
          signature: btoa(String.fromCharCode(...signature)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
        }
      }
    };

    pendingRequests.current.set(authId, (res: any) => {
      if (res.ok) {
        dispatch({ type: 'AUTH_OK' });
      } else {
        const errMsg = typeof res.error === 'object' ? JSON.stringify(res.error) : String(res.error);
        if (errMsg.includes('NOT_PAIRED') || errMsg.includes('NOT_AUTHORIZED')) {
          dispatch({ type: 'AUTH_NEEDS_PAIRING' });
        } else {
          // eslint-disable-next-line no-console
          console.error('❌ [V3] 握手失败:', res.error);
          dispatch({ type: 'AUTH_FAILED' });
        }
      }
    });
    ws.send(JSON.stringify(req));
  }, [keyPair, deviceId]);

  /**
   * 建立连接：创建新 ws，替换旧 ws，并挂载 onopen/onmessage/onclose/onerror。
   */
  const connect = useCallback(async () => {
    if (!keyPair || !deviceId) return;

    dispatch({ type: 'CONNECT_REQUEST' });

    const oldWs = wsRef.current;
    wsRef.current = null;
    if (oldWs) oldWs.close();

    const ticket = await getTicket();
    const token = storage.getItem('guardian_token');
    const wsUrl = ticket
      ? getWsUrl(`/v1/ws/gateway?ticket=${ticket}`)
      : getWsUrl(`/v1/ws/gateway?token=${token}`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (ws !== wsRef.current) return;
      dispatch({ type: 'WS_OPEN' });
    };

    ws.onmessage = (event) => {
      if (ws !== wsRef.current) return;
      let data: any;
      try {
        data = JSON.parse(event.data);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('⚠️ [V3] 非法 WS 消息，已忽略:', event.data);
        return;
      }

      if (data.type === 'event') {
        if (data.event === 'health') {
          const { ok, durationMs, ts } = data.payload;
          setLastHealth({ ok, latency: durationMs || 0, ts });
          setLatencyHistory(prev => [...prev.slice(-29), durationMs || 0]);
          setPulse(p => p + 1);
          return;
        }
        if (data.event === 'connect.challenge') {
          dispatch({ type: 'CHALLENGE_RECEIVED' });
          handleChallenge(data.payload.nonce, ws);
          return;
        }
        handlers?.onEvent?.(data, ws);
        return;
      }

      if (data.type === 'res') {
        const resolve = pendingRequests.current.get(data.id);
        if (resolve) {
          resolve(data);
          pendingRequests.current.delete(data.id);
        }
        handlers?.onResponse?.(data);
      }
    };

    ws.onclose = () => {
      if (ws !== wsRef.current) return;
      wsRef.current = null;
      dispatch({ type: 'WS_CLOSE' });
      rejectAllPendingRequests('WebSocket closed');
    };

    ws.onerror = () => {
      if (ws !== wsRef.current) return;
      dispatch({ type: 'WS_ERROR' });
      rejectAllPendingRequests('WebSocket error');
    };
  }, [keyPair, deviceId, handlers, handleChallenge, rejectAllPendingRequests]);

  /**
   * 重连调度：当进入 disconnected 且仍具备 keyPair 时，按退避策略尝试重连。
   */
  useEffect(() => {
    if (!keyPair) return;
    if (status !== 'disconnected') return;
    if (reconnectCountRef.current >= maxReconnects) {
      dispatch({ type: 'AUTH_FAILED' });
      return;
    }
    const delay = reconnectCountRef.current === 0 ? 0 : Math.min(2000 * reconnectCountRef.current, 10000);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectCountRef.current++;
      connect();
    }, delay);
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [status, keyPair, maxReconnects, connect]);

  useEffect(() => {
    if (status === 'authenticated') reconnectCountRef.current = 0;
  }, [status]);

  /**
   * 组件卸载时关闭连接。
   */
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return useMemo(() => {
    return {
      status,
      connect,
      sendRPC,
      wsRef,
      rejectAllPendingRequests,
      lastHealth,
      latencyHistory,
      pulse
    };
  }, [status, connect, sendRPC, rejectAllPendingRequests, lastHealth, latencyHistory, pulse]);
}

