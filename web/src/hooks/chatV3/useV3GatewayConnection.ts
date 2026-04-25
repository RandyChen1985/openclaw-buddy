import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import storage from '../../utils/storage';
import { getWsUrl } from '../../utils/url';
import api, { getTicket } from '../../api';
import { APP_VERSION } from '../../version';
import * as nacl from 'tweetnacl';

/** `openclaw.json` 里 `gateway.auth.token` 极少变；短时缓存减少握手阶段重复 HTTP */
const GATEWAY_TOKEN_CACHE_MS = 120_000;

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
  /**
   * 捕获原始日志。
   */
  onLog?: (log: { direction: 'in' | 'out'; timestamp: number; data: any }) => void;
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
  const connectInFlightRef = useRef(false);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gatewayTokenCacheRef = useRef<{ token: string; at: number } | null>(null);
  const gatewayTokenFetchRef = useRef<Promise<string> | null>(null);

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
   * 获取 Buddy 转发的 `gateway.auth.token`（与 challenge 后行为一致），带内存缓存与并发去重。
   * `connect()` 开头会 fire-and-forget 预取，与 getTicket / 建连并行，缩短 HANDSHAKING 窗口。
   */
  const ensureGatewayToken = useCallback(async (): Promise<string> => {
    const now = Date.now();
    const hit = gatewayTokenCacheRef.current;
    if (hit?.token && now - hit.at < GATEWAY_TOKEN_CACHE_MS) {
      return hit.token;
    }
    if (gatewayTokenFetchRef.current) {
      return gatewayTokenFetchRef.current;
    }
    const p = (async () => {
      const res = await api.get('/v1/openclaw/gateway-token');
      const token = res.data?.token || '';
      if (token) {
        gatewayTokenCacheRef.current = { token, at: Date.now() };
      }
      return token;
    })();
    gatewayTokenFetchRef.current = p;
    try {
      return await p;
    } finally {
      gatewayTokenFetchRef.current = null;
    }
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

      const timeoutMap: Record<string, number> = {
        'sessions.delete': 180000,
        'chat.send': 120000,
        'chat.history': 60000,
        'chat.abort': 15000,
      };
      const timeoutValue = timeoutMap[method] || 30000;
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
      
      const raw = JSON.stringify(req);
      handlers?.onLog?.({ direction: 'out', timestamp: Date.now(), data: req });
      wsRef.current.send(raw);
    });
  }, [handlers]);

  /**
   * 完成 challenge 握手并发起 connect 授权。
   */
  const handleChallenge = useCallback(async (nonce: string, ws: WebSocket) => {
    if (!keyPair || !deviceId) return;

    let gatewayToken = '';
    try {
      gatewayToken = await ensureGatewayToken();
    } catch (e) {
      // 保持原行为：仅记录错误并进入 error
      // eslint-disable-next-line no-console
      console.error('❌ [V3] 获取 Gateway Token 失败:', e);
      dispatch({ type: 'AUTH_FAILED' });
      return;
    }
    if (!gatewayToken) {
      // eslint-disable-next-line no-console
      console.error('❌ [V3] Gateway Token 为空（请检查 openclaw.json gateway.auth.token）');
      dispatch({ type: 'AUTH_FAILED' });
      return;
    }

    const signedAt = Date.now();
    const role = 'operator';
    const scopes = 'operator.admin,operator.read,operator.write';
    const clientId = 'openclaw-control-ui';
    const clientMode = 'cli';
    const platform = navigator.platform.toLowerCase().includes('mac') ? 'macos' : 'windows';

    const authId = `connect-${Date.now()}`;

    // 与既有网关协议对齐：签名握手串（服务端会校验字段完整性，如 minProtocol/maxProtocol）
    const handshakeStr = `v3|${deviceId}|${clientId}|${clientMode}|${role}|${scopes}|${signedAt}|${gatewayToken}|${nonce}|${platform}|`;
    const signatureBytes = nacl.sign.detached(new TextEncoder().encode(handshakeStr), keyPair.secretKey);

    const req = {
      type: 'req',
      id: authId,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        role,
        scopes: scopes.split(','),
        auth: { token: gatewayToken },
        client: { id: clientId, mode: clientMode, platform, version: APP_VERSION },
        device: {
          id: deviceId,
          publicKey: btoa(String.fromCharCode(...keyPair.publicKey)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
          signature: btoa(String.fromCharCode(...signatureBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
          signedAt,
          nonce
        }
      }
    };

    // 握手兜底超时：避免 connect-res 丢失导致状态悬挂
    if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
    connectTimeoutRef.current = setTimeout(() => {
      if (!pendingRequests.current.has(authId)) return;
      pendingRequests.current.delete(authId);
      // 进入 error 并关闭当前 ws，交由重连调度处理
      dispatch({ type: 'AUTH_FAILED' });
      try { ws.close(); } catch {}
    }, 30000);

    pendingRequests.current.set(authId, (res: any) => {
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
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
  }, [keyPair, deviceId, ensureGatewayToken]);

  /**
   * 建立连接：创建新 ws，替换旧 ws，并挂载 onopen/onmessage/onclose/onerror。
   */
  const connect = useCallback(async () => {
    if (!keyPair || !deviceId) return;
    // 防抖：避免多次点击导致 close/new ws 抖动
    if (connectInFlightRef.current) return;
    connectInFlightRef.current = true;

    dispatch({ type: 'CONNECT_REQUEST' });
    
    // 💡 性能优化：并行预取 Ticket 和 Gateway Token，缩短等待链路
    const tokenPromise = ensureGatewayToken().catch(() => '');
    const ticketPromise = getTicket().catch(() => null);

    const oldWs = wsRef.current;
    wsRef.current = null;
    if (oldWs) oldWs.close();

    const [ticket] = await Promise.all([ticketPromise, tokenPromise]);
    const token = storage.getItem('guardian_token');
    const wsUrl = ticket
      ? getWsUrl(`/v1/ws/gateway?ticket=${ticket}`)
      : getWsUrl(`/v1/ws/gateway?token=${token}`);

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('❌ [V3] WebSocket 构造失败:', e);
      connectInFlightRef.current = false;
      dispatch({ type: 'WS_ERROR' });
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (ws !== wsRef.current) return;
      connectInFlightRef.current = false;
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
          const { ok, durationMs, ts } = data.payload || {};
          setLastHealth({ ok, latency: durationMs || 0, ts });
          setLatencyHistory(prev => [...prev.slice(-29), durationMs || 0]);
          setPulse(p => p + 1);
          // 依然触发 onEvent，让上层 Context 捕获完整数据
          handlers?.onEvent?.(data, ws);
          return;
        }
        if (data.event === 'connect.challenge') {
          dispatch({ type: 'CHALLENGE_RECEIVED' });
          handleChallenge(data.payload.nonce, ws);
          return;
        }
        handlers?.onLog?.({ direction: 'in', timestamp: Date.now(), data });
        handlers?.onEvent?.(data, ws);
        return;
      }

      if (data.type === 'res') {
        handlers?.onLog?.({ direction: 'in', timestamp: Date.now(), data });
        const resolve = pendingRequests.current.get(data.id);
        if (resolve) {
          resolve(data);
          pendingRequests.current.delete(data.id);
        }
        handlers?.onResponse?.(data);
      }
    };

    ws.onclose = (ev) => {
      if (ws !== wsRef.current) return;
      wsRef.current = null;
      connectInFlightRef.current = false;
      // 4001 = gateway auth rotated; reset reconnect counter for immediate retry
      if (ev.code === 4001) {
        reconnectCountRef.current = 0;
        gatewayTokenCacheRef.current = null;
        // eslint-disable-next-line no-console
        console.warn('⚠️ [V3] 网关认证已轮换 (4001)，立即重连');
      }
      dispatch({ type: 'WS_CLOSE' });
      rejectAllPendingRequests('WebSocket closed');
    };

    ws.onerror = () => {
      if (ws !== wsRef.current) return;
      connectInFlightRef.current = false;
      // 浏览器中 onerror 总会紧跟 onclose；这里只 reject 挂起请求，
      // 不再 dispatch WS_ERROR，由后续 onclose -> WS_CLOSE 统一触发重连，
      // 避免 error+close 连续触发导致重连计数被双倍消耗。
      rejectAllPendingRequests('WebSocket error');
    };
  }, [keyPair, deviceId, ensureGatewayToken, handlers, handleChallenge, rejectAllPendingRequests]);

  /**
   * 重连调度：当进入 disconnected 且仍具备 keyPair 时，按退避策略尝试重连。
   * 只监听 disconnected（onerror 不再直接触发 error 状态，而是由 onclose 统一收归为 disconnected）。
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
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
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

