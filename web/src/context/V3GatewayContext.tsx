import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as nacl from 'tweetnacl';
import { sha256 } from 'js-sha256';
import storage from '../utils/storage';
import { useV3GatewayConnection } from '../hooks/chatV3/useV3GatewayConnection';
import type { V3WsStatus, SendRpcResult, V3GatewayConnectionHandlers } from '../hooks/chatV3/useV3GatewayConnection';

interface V3GatewayContextType {
  status: V3WsStatus;
  connect: () => Promise<void>;
  sendRPC: (method: string, params: any) => Promise<SendRpcResult>;
  /** 暂停网关 WS（不重连）；恢复时自动 connect */
  setConnectionPaused: (paused: boolean) => void;
  lastHealth: { ok: boolean; latency: number; ts: number } | null;
  latencyHistory: number[];
  pulse: number;
  deviceId: string;
  keyPair: nacl.BoxKeyPair | null;
  healthData: any | null;
  registerHandlers: (id: string, handlers: V3GatewayConnectionHandlers) => void;
  unregisterHandlers: (id: string) => void;
}

const V3GatewayContext = createContext<V3GatewayContextType | null>(null);

export const useV3Gateway = () => {
  const context = useContext(V3GatewayContext);
  if (!context) {
    throw new Error('useV3Gateway must be used within a V3GatewayProvider');
  }
  return context;
};

const hexToUint8Array = (hex: string): Uint8Array => {
  const matched = hex.match(/.{1,2}/g);
  return new Uint8Array(matched ? matched.map(byte => parseInt(byte, 16)) : []);
};

export const V3GatewayProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [keyPair, setKeyPair] = useState<nacl.BoxKeyPair | null>(null);
  const [deviceId, setDeviceId] = useState<string>('');
  const [healthData, setHealthData] = useState<any | null>(null);
  
  // 维护多路监听器，允许页面级 Hook 注入业务逻辑
  const handlersMapRef = useRef<Map<string, V3GatewayConnectionHandlers>>(new Map());

  const registerHandlers = useCallback((id: string, handlers: V3GatewayConnectionHandlers) => {
    handlersMapRef.current.set(id, handlers);
  }, []);

  const unregisterHandlers = useCallback((id: string) => {
    handlersMapRef.current.delete(id);
  }, []);

  // 路由分发器：将网关事件分发给所有注册的监听器
  const globalHandlers = useMemo<V3GatewayConnectionHandlers>(() => ({
    onEvent: (data, ws) => {
      if (data.event === 'health') {
        setHealthData(data.payload);
      }
      handlersMapRef.current.forEach(h => h.onEvent?.(data, ws));
    },
    onResponse: (data) => {
      handlersMapRef.current.forEach(h => h.onResponse?.(data));
    },
    onLog: (log) => {
      handlersMapRef.current.forEach(h => h.onLog?.(log));
    }
  }), []);

  const {
    status,
    connect,
    sendRPC,
    setConnectionPaused,
    lastHealth,
    latencyHistory,
    pulse
  } = useV3GatewayConnection({
    keyPair,
    deviceId,
    handlers: globalHandlers
  });

  // 初始化 Keys
  useEffect(() => {
    const initKeys = async () => {
      let seedHex = storage.getItem('openclaw_v3_seed');
      let seed: Uint8Array;
      if (!seedHex) {
        seed = nacl.randomBytes(32);
        storage.setItem('openclaw_v3_seed', Array.from(seed).map(b => b.toString(16).padStart(2, '0')).join(''));
      } else {
        seed = hexToUint8Array(seedHex);
      }
      const kp = nacl.sign.keyPair.fromSeed(seed);
      setKeyPair(kp as any);
      
      let hashArray: number[];
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', kp.publicKey.buffer as ArrayBuffer);
        hashArray = Array.from(new Uint8Array(hashBuffer));
      } else {
        hashArray = Array.from(hexToUint8Array(sha256(kp.publicKey)));
      }
      setDeviceId(hashArray.map(b => b.toString(16).padStart(2, '0')).join(''));
    };
    initKeys();
  }, []);

  const value = useMemo(() => ({
    status,
    connect,
    sendRPC,
    setConnectionPaused,
    lastHealth,
    latencyHistory,
    pulse,
    deviceId,
    keyPair,
    healthData,
    registerHandlers,
    unregisterHandlers
  }), [status, connect, sendRPC, setConnectionPaused, lastHealth, latencyHistory, pulse, deviceId, keyPair, healthData, registerHandlers, unregisterHandlers]);

  return (
    <V3GatewayContext.Provider value={value}>
      {children}
    </V3GatewayContext.Provider>
  );
};
