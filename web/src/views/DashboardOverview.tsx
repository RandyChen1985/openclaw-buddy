import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Tag, Progress, Button, Timeline, Badge, Spin, Empty, message, notification, Tabs, Radio, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { Server, Activity, Play, Square, RefreshCw, Trophy, Zap, Monitor } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import dayjs from 'dayjs';
import api from '../api';
import { APP_VERSION } from '../version';
import { hasNewVersion } from '../utils/version';

interface DashboardOverviewProps {
  status: any;
  history: any[];
  wsLogs: string[];
  isRunning: boolean;
  onControl: (action: string) => void;
  onNavigate?: (key: string) => void;
  systemEvents?: any[];
  topBots?: any[];
  ocInstalled: boolean | null;
  activeTasks?: any[];
  isTransitioning?: boolean; // 新增：正在执行过渡动作
  loading?: boolean;
  onRefreshVersion?: (refresh?: boolean) => Promise<any>;
  onUpgrade?: (version: string) => void;
  onRestart?: () => void;
}

interface SystemInfo {
  hostname: string;
  os: string;
  arch: string;
  cpus: number;
}

interface OcStatus {
  installed: boolean;
  version: string;
  path: string;
}

const DashboardOverview: React.FC<DashboardOverviewProps> = ({ 
  status, history, isRunning, onControl, onNavigate,
  systemEvents = [], topBots = [], ocInstalled, activeTasks = [], isTransitioning = false, loading = false,
  onRefreshVersion, onUpgrade, onRestart
}) => {
  const { t } = useTranslation();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  const [verLoading, setVerLoading] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [ocStatus, setOcStatus] = useState<OcStatus | null>(null);
  const [usageData, setUsageData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('tokens');
  const [usageLoading, setUsageLoading] = useState(false);
  const [selectedDays, setSelectedDays] = useState(30);

  // 综合判断是否处于处理中：1. 异步任务在跑 2. 前端正在等待请求响应
  const isGatewayProcessing = isTransitioning || activeTasks.some(t => t.module === 'gateway' && t.status === 'Running');
  
  // 环境检测中锁定：1. OpenClaw 安装状态未知 2. 系统基本信息尚未对账完成
  const isEnvChecking = ocInstalled === null || !systemInfo;

  const fetchData = async () => {
    try {
      const [sysRes, ocRes] = await Promise.all([
        api.get('/v1/system/info'),
        api.get('/v1/openclaw/version')
      ]);
      if (sysRes.data) setSystemInfo(sysRes.data);
      if (ocRes.data) setOcStatus(ocRes.data);
    } catch (err) {
      console.error('Failed to fetch dashboard system info:', err);
    }
  };

  const fetchUsageData = async (days: number = selectedDays, force: boolean = false) => {
    setUsageLoading(true);
    try {
      const res = await api.get(`/v1/gateway/usage-cost?days=${days}${force ? '&force=true' : ''}`);
      if (res.data) setUsageData(res.data);
    } catch (err) {
      console.error('Failed to fetch usage data:', err);
    } finally {
      setUsageLoading(false);
    }
  };

  const handleManualRefreshVersion = async () => {
    if (!onRefreshVersion || verLoading) return;
    setVerLoading(true);
    try {
      const data = await onRefreshVersion(true);
      if (data) {
        // 只有远程版本 > 本地版本时才提示更新
        if (hasNewVersion(APP_VERSION, data.latest)) {
          notification.info({
            message: '发现新版本',
            description: (
              <div>
                已发布新版本 v{data.latest}，建议立即更新以获得最佳体验。
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Button 
                    type="primary" 
                    size="small" 
                    onClick={() => {
                      onUpgrade?.(data.latest);
                      notification.destroy();
                    }}
                    style={{ background: '#2563eb', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600 }}
                  >
                    🚀 立即一键升级
                  </Button>
                  <a 
                    href={`https://github.com/RandyChen1985/openclaw-buddy/releases/tag/${data.latest}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ color: '#64748b', fontSize: 12 }}
                  >
                    查看发布说明
                  </a>
                </div>
              </div>
            ),
            placement: 'topRight',
            duration: 15
          });
        } else {
          message.success('当前已是最新版本');
        }
      }
    } catch (err) {
      message.error('版本检查失败');
    } finally {
      setVerLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetchUsageData();
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);

    // 检测是否需要滚动到快捷操作
    if (window.location.hash === '#actions') {
      setTimeout(() => {
        document.getElementById('dashboard-quick-actions')?.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    }

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const formatLargeNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toFixed(0);
  };

  const getWaterlines = (data: any[], dataKey: string) => {
    const values = (data || [])
      .map((d) => Number(d?.[dataKey]))
      .filter((v) => Number.isFinite(v));
    const max = values.length ? Math.max(...values) : 0;
    if (!Number.isFinite(max) || max <= 0) return [];
    // 25% / 50% / 75% 水位线，便于肉眼估算区间
    return [0.25, 0.5, 0.75].map((p) => max * p);
  };

  const renderChart = (
    data: any[],
    dataKey: string,
    color: string,
    label: string,
    unit: string,
    isDailyUsage: boolean = false,
    showWaterlines: boolean = false
  ) => (
    <div style={{ height: 120 }}>
      {!isDailyUsage && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label} {t('dashboard.historyTrend')}</span>
          <span style={{ fontSize: 10, color: '#94a3b8' }}>24H</span>
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`color${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.15} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis 
            dataKey={isDailyUsage ? "date" : "timestamp"} 
            hide={!isDailyUsage}
            fontSize={9}
            tickFormatter={(v) => isDailyUsage ? dayjs(v).format('MM-DD') : v}
          />
          <YAxis hide domain={['auto', 'auto']} />
          {showWaterlines && getWaterlines(data, dataKey).map((y, idx) => (
            <ReferenceLine
              key={`${dataKey}-wl-${idx}`}
              y={y}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              strokeWidth={1}
              ifOverflow="extendDomain"
              label={{
                value: `${formatLargeNumber(y)}${unit ? ' ' + unit : ''}`,
                position: 'insideTopRight',
                fill: '#94a3b8',
                fontSize: 10,
              }}
            />
          ))}
          <ChartTooltip
            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 11 }}
            labelFormatter={(v) => isDailyUsage ? dayjs(v).format('YYYY-MM-DD') : dayjs(v).format('HH:mm:ss')}
            formatter={(v: any) => [isDailyUsage ? formatLargeNumber(v) + ' ' + unit : v.toFixed(1) + ' ' + unit, label]}
          />
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#color${dataKey})`} dot={isDailyUsage} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
      {/* 顶部环境概览条 */}
      <div 
        id="dashboard-env-monitor-bar"
        style={{ 
          background: 'rgba(255, 255, 255, 0.45)', 
          backdropFilter: 'blur(10px)',
          borderRadius: 12, 
          padding: isMobile ? '16px' : '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isMobile ? 'flex-start' : 'center',
          minHeight: 64,
          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
          border: '1px solid #e2e8f0',
          position: 'relative',
          zIndex: 10
        }}
      >
        {isEnvChecking ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <RefreshCw size={18} style={{ color: '#3b82f6', animation: 'spin 1.5s linear infinite' }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: '#3b82f6', letterSpacing: '0.05em' }}>
              OpenClaw 环境检测中...
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', flexDirection: isMobile ? 'column' : 'row', width: '100%', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', gap: isMobile ? '16px' : '32px', flexDirection: isMobile ? 'column' : 'row', width: isMobile ? '100%' : 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ background: '#f0f9ff', padding: '8px', borderRadius: '10px' }}><Monitor size={18} style={{ color: '#0ea5e9' }} /></div>
                <div>
                  <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>HOST</div>
                  <div style={{ fontSize: 14, color: '#1e293b', fontWeight: 600 }}>{systemInfo?.hostname || '---'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ background: '#f5f3ff', padding: '8px', borderRadius: '10px' }}><Server size={18} style={{ color: '#8b5cf6' }} /></div>
                <div>
                  <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>OS</div>
                  <div style={{ fontSize: 14, color: '#1e293b', fontWeight: 600 }}>{systemInfo ? `${systemInfo.os} (${systemInfo.arch})` : '---'}</div>
                </div>
              </div>
              {!isMobile && <div style={{ width: 1, height: 24, background: '#e2e8f0' }} />}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ background: ocStatus?.installed ? '#f0fdf4' : '#fef2f2', padding: '8px', borderRadius: '10px' }}><Zap size={18} style={{ color: ocStatus?.installed ? '#22c55e' : '#ef4444' }} /></div>
                <div>
                  <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>OpenClaw CLI</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {ocStatus?.installed ? <Badge status="processing" color="#22c55e" text={<span style={{ fontSize: 14, color: '#1e293b', fontWeight: 700 }}>{ocStatus.version}</span>} /> : <span style={{ fontSize: 14, color: '#ef4444', fontWeight: 700 }}>未安装</span>}
                  </div>
                </div>
              </div>
              {!isMobile && <div style={{ width: 1, height: 24, background: '#e2e8f0' }} />}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ background: '#ecfdf5', padding: '8px', borderRadius: '10px' }}><Activity size={18} style={{ color: '#059669' }} /></div>
                <div>
                  <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>OpenClaw Buddy</div>
                  <div style={{ fontSize: 14, color: '#1e293b', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Tooltip title="GitHub 源码">
                      <div 
                        style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', opacity: 0.6 }}
                        onClick={(e: React.MouseEvent) => {
                          e.preventDefault();
                          window.open('https://github.com/RandyChen1985/openclaw-buddy', '_blank');
                        }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.28 1.15-.28 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                          <path d="M9 18c-4.51 2-5-2-7-2" />
                        </svg>
                      </div>
                    </Tooltip>
                    v{APP_VERSION}
                    <Button 
                      type="text" 
                      size="small" 
                      onClick={handleManualRefreshVersion}
                      disabled={verLoading}
                      icon={<RefreshCw size={10} className={verLoading ? 'animate-spin' : ''} style={{ color: '#94a3b8' }} />} 
                      style={{ padding: 0, height: 'auto', minWidth: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    />
                    {/* 升级就绪后的重启提醒按钮 */}
                    {/* 升级就绪后的重启提醒按钮：仅在目标版本 > 当前版本时显示 */}
                    {activeTasks.some(t => 
                      t.module === 'system' && 
                      t.action === 'upgrade' && 
                      t.status === 'Completed' &&
                      (() => {
                        const curr = APP_VERSION.split('.').map(Number);
                        const targetVersion = (t.target || '').toString().replace('v', '');
                        const target = targetVersion.split('.').map(Number);
                        for (let i = 0; i < Math.max(curr.length, target.length); i++) {
                          const c = curr[i] || 0;
                          const tVal = target[i] || 0;
                          if (tVal > c) return true; // 目标大于当前，需重启
                          if (tVal < c) return false;
                        }
                        return false;
                      })()
                    ) && (
                      <Tag 
                        icon={<RefreshCw size={10} className={isRestarting ? "animate-spin" : ""} />} 
                        color={isRestarting ? "default" : "error"} 
                        onClick={() => {
                          if (isRestarting) return;
                          setIsRestarting(true);
                          onRestart?.();
                        }}
                        style={{ 
                          cursor: isRestarting ? 'not-allowed' : 'pointer', 
                          borderRadius: 10, 
                          margin: 0, 
                          fontSize: 10, 
                          fontWeight: 700,
                          opacity: isRestarting ? 0.7 : 1
                        }}
                      >
                        {isRestarting ? "正在重启..." : "重启生效"}
                      </Tag>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <Row gutter={[20, 20]}>
        <Col xs={24} lg={10}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
            <Card styles={{ body: { padding: 24 } }} style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13, fontWeight: 500 }}>
                  <Activity size={15} color={isRunning ? '#22c55e' : '#ef4444'} />
                  {t('dashboard.coreStatus')}
                </div>
                <Tag color={isRunning ? 'success' : 'error'} style={{ borderRadius: 20, border: 'none', margin: 0, fontWeight: 600, padding: '0 10px' }}>
                  {isRunning ? t('dashboard.running') : t('dashboard.stopped')}
                </Tag>
              </div>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('dashboard.runtime')}</div>
                <div style={{ fontSize: isMobile ? 18 : 24, fontWeight: 800, color: '#1e293b', fontFamily: 'monospace' }}>
                  {status?.gateway?.runtime || '---'}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {status?.metrics && (
                  <>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                        <span style={{ color: '#64748b' }}>{t('dashboard.cpuLoad')}</span>
                        <span style={{ fontWeight: 700 }}>{status?.metrics?.cpu_usage?.toFixed(1)}%</span>
                      </div>
                      <Progress percent={status?.metrics?.cpu_usage} showInfo={false} strokeColor="#3b82f6" strokeWidth={6} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                        <span style={{ color: '#64748b' }}>{t('dashboard.memLoad')}</span>
                        <span style={{ fontWeight: 700 }}>{status?.metrics?.memory_usage?.toFixed(1)}%</span>
                      </div>
                      <Progress percent={status?.metrics?.memory_usage} showInfo={false} strokeColor="#8b5cf6" strokeWidth={6} />
                    </div>
                  </>
                )}
              </div>
            </Card>

            <Card 
              styles={{ body: { padding: '20px 24px' } }} 
              style={{ borderRadius: 12, border: '1px solid #e2e8f0', flex: 1 }}
              title={<span style={{ fontSize: 13, fontWeight: 600 }}><Trophy size={14} color="#f59e0b" /> {t('dashboard.topBots')}</span>}
            >
              {loading ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b' }}>
                  <Spin size="small" />
                  <div style={{ marginTop: 12, fontSize: 12 }}>{t('dashboard.analyzing')}</div>
                </div>
              ) : topBots.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {topBots.map((bot, index) => (
                    <div key={bot.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: '#f8fafc', borderRadius: 10, border: '1px solid #f1f5f9' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 6, background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#64748b' }}>{index + 1}</div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{bot.name || bot.id}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>ID: {bot.id}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b' }}>{bot.sessions || 0}</div>
                        <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase' }}>{t('dashboard.activeSessions')}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dashboard.noActiveBots')} />
              )}
            </Card>
          </div>
        </Col>

        <Col xs={24} lg={14}>
          <Card 
            title={<span style={{ fontSize: 13, fontWeight: 600 }}><Activity size={15} color="#3b82f6" /> {t('dashboard.diagnosticLab')}</span>}
            styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 52 }, body: { padding: '24px' } }}
            style={{ height: '100%', borderRadius: 12, border: '1px solid #e2e8f0' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <Row gutter={24}>
                <Col span={12}>
                  {renderChart(history, 'cpu_usage', '#3b82f6', t('dashboard.cpu'), '%')}
                </Col>
                <Col span={12}>
                  {renderChart(history, 'memory_usage', '#8b5cf6', t('dashboard.memory'), '%')}
                </Col>
              </Row>
              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 20 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {t('dashboard.usageTrend')} ({selectedDays}D)
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Radio.Group 
                        size="small" 
                        value={selectedDays} 
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedDays(val);
                          fetchUsageData(val);
                        }}
                        optionType="button"
                        buttonStyle="solid"
                        style={{ fontSize: 10 }}
                      >
                        <Radio.Button value={7}>{t('dashboard.days7')}</Radio.Button>
                        <Radio.Button value={14}>{t('dashboard.days14')}</Radio.Button>
                        <Radio.Button value={30}>{t('dashboard.days30')}</Radio.Button>
                      </Radio.Group>
                      <Button 
                        size="small" 
                        type="text" 
                        icon={<RefreshCw size={12} className={usageLoading ? 'animate-spin' : ''} />} 
                        onClick={() => fetchUsageData(selectedDays, true)}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}
                      />
                    </div>
                  </div>
                  <Tabs 
                    size="small"
                    activeKey={activeTab} 
                    onChange={setActiveTab}
                    className="compact-tabs usage-tabs"
                    items={[
                      { key: 'tokens', label: t('dashboard.tokens') },
                      { key: 'costs', label: t('dashboard.costs') },
                      { key: 'cache', label: t('dashboard.cache') },
                    ]}
                    style={{ marginBottom: 0 }}
                  />
                </div>
                {usageLoading ? (
                  <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin size="small" /></div>
                ) : usageData?.daily ? (
                  <>
                    {activeTab === 'tokens' && renderChart(usageData.daily, 'totalTokens', '#f59e0b', t('dashboard.tokens'), '', true, true)}
                    {activeTab === 'costs' && renderChart(usageData.daily, 'totalCost', '#ef4444', t('dashboard.costs'), 'Credits', true, true)}
                    {activeTab === 'cache' && renderChart(usageData.daily, 'cacheRead', '#3b82f6', t('dashboard.cache'), '', true, true)}
                  </>
                ) : (
                  <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 11 }}>
                    {t('dashboard.noActiveBots')}
                  </div>
                )}
              </div>
            </div>

            {/* 巡检事件轨迹 */}
            <div style={{ marginTop: 24, borderTop: '1px solid #f1f5f9', paddingTop: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20 }}>
                <Zap size={15} color="#64748b" /> {t('dashboard.timeline')}
              </div>
              <div style={{ 
                height: 260, 
                overflowY: 'auto', 
                padding: '16px', 
                background: '#f8fafc', 
                borderRadius: 12,
                border: '1px solid #f1f5f9'
              }}>
                <Timeline
                  items={systemEvents.map(ev => ({
                    color: ev.event_type === 'HEAL' ? '#f43f5e' : ev.event_type === 'UPDATE' ? '#3b82f6' : ev.event_type === 'CONTROL' ? '#10b981' : '#64748b',
                    children: ev.message,
                  }))}
                  style={{ paddingTop: 8 }}
                />
                {systemEvents.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#475569', fontSize: 12, padding: '40px 0' }}>
                    {t('dashboard.noEvents')}
                  </div>
                )}
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      {/* 快捷操作 */}
      <Card
        id="dashboard-quick-actions"
        style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
        title={<span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>{t('dashboard.quickActions')}</span>}
        styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 52 }, body: { padding: '16px 24px' } }}
      >
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(160px, 1fr))', 
          gap: 12,
          width: '100%'
        }}>
          <Button
            type="primary"
            size="large"
            icon={<Play size={14} />}
            onClick={() => onControl('start')}
            disabled={isRunning || ocInstalled === false || isGatewayProcessing || isEnvChecking}
            loading={(isGatewayProcessing && !isRunning) || (isEnvChecking && ocInstalled === null)}
            style={{ 
              borderRadius: 10, 
              width: '100%',
              background: (isRunning || isGatewayProcessing || isEnvChecking) ? '#cbd5e1' : '#22c55e', 
              borderColor: (isRunning || isGatewayProcessing || isEnvChecking) ? '#cbd5e1' : '#22c55e' 
            }}
          >
            {t('dashboard.startGateway')}
          </Button>
          <Button
            danger
            type="primary"
            size="large"
            icon={<Square size={14} />}
            onClick={() => onControl('stop')}
            disabled={!isRunning || ocInstalled === false || isGatewayProcessing || isEnvChecking}
            loading={isGatewayProcessing && isRunning}
            style={{ borderRadius: 10, width: '100%' }}
          >
            {t('dashboard.stopGateway')}
          </Button>
          <Button
            size="large"
            icon={<RefreshCw size={14} />}
            onClick={() => onControl('restart')}
            disabled={!isRunning || ocInstalled === false || isGatewayProcessing || isEnvChecking}
            loading={isGatewayProcessing}
            style={{ borderRadius: 10, border: '1.5px solid #e2e8f0', width: '100%' }}
          >
            {t('dashboard.asyncRestart')}
          </Button>
          <Button
            size="large"
            icon={<Zap size={14} />}
            onClick={() => onNavigate?.('components')}
            disabled={isEnvChecking}
            style={{ 
              borderRadius: 10, 
              width: '100%',
              background: isEnvChecking ? '#f8fafc' : '#f8fafc', 
              border: '1.5px solid #e2e8f0', 
              opacity: isEnvChecking ? 0.6 : 1 
            }}
          >
            {t('dashboard.wechatChannel')}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default DashboardOverview;
