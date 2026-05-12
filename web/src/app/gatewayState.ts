export type GatewayBadgeStatus = 'success' | 'processing' | 'error';

export type DerivedGatewayState = {
  httpGatewayStatus: string;
  httpGatewayRunning: boolean;
  isRunning: boolean;
  isConnecting: boolean;
  isAuthorizing: boolean;
  isWsRecovering: boolean;
  gatewayStateText: string;
  gatewayBadgeStatus: GatewayBadgeStatus;
  gatewayLatency?: number;
  gatewayHealthTime: string;
};

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

type StatusLike = {
  gateway?: {
    status?: unknown;
  };
};

export function deriveGatewayState(params: {
  status: unknown;
  v3Status?: string;
  gatewayWsDesired: boolean;
  lastHealth?: { latency?: number; ts?: number } | null;
  t: TranslateFn;
}): DerivedGatewayState {
  const { status, v3Status, gatewayWsDesired, lastHealth, t } = params;
  const httpGatewayStatus = String((status as StatusLike)?.gateway?.status || '').toLowerCase();
  const httpGatewayRunning = httpGatewayStatus === 'running';

  const isRunning =
    v3Status === 'authenticated' ||
    (!gatewayWsDesired && httpGatewayRunning);

  const isConnecting = ['connecting', 'handshaking', 'challenging', 'identifying'].includes((v3Status || '') as any);
  const isAuthorizing = v3Status === 'authorizing';
  const isWsRecovering = gatewayWsDesired && httpGatewayRunning && ['disconnected', 'error'].includes(v3Status || '');

  const gatewayStateText = isRunning
    ? t('dashboard.running')
    : isAuthorizing
      ? t('chat.gatewayAuthorizing', { defaultValue: '等待设备授权' })
      : isConnecting
        ? t('chat.gatewayConnecting')
        : isWsRecovering
          ? (v3Status === 'error'
            ? t('chat.gatewayConnectionError', { defaultValue: '连接异常' })
            : t('chat.gatewayReconnecting', { defaultValue: '网关重连中...' }))
          : t('dashboard.stopped');

  const gatewayBadgeStatus: GatewayBadgeStatus =
    isRunning ? 'success' : ((isConnecting || isAuthorizing || isWsRecovering) ? 'processing' : 'error');

  const gatewayLatency = v3Status === 'authenticated' && lastHealth?.latency !== undefined
    ? lastHealth.latency
    : undefined;

  const gatewayHealthTime = lastHealth?.ts
    ? new Date(lastHealth.ts < 1_000_000_000_000 ? lastHealth.ts * 1000 : lastHealth.ts).toLocaleTimeString()
    : '';

  return {
    httpGatewayStatus,
    httpGatewayRunning,
    isRunning,
    isConnecting,
    isAuthorizing,
    isWsRecovering,
    gatewayStateText,
    gatewayBadgeStatus,
    gatewayLatency,
    gatewayHealthTime,
  };
}
