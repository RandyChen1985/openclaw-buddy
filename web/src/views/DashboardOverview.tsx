import React, { useState, useEffect, useRef } from 'react';
import { Row, Col, Card, Tag, Progress, Button, Skeleton, Spin, Timeline, Tooltip as AntTooltip, Badge } from 'antd';
import { useTranslation } from 'react-i18next';
import { Server, Activity, Play, Square, RefreshCw, Smartphone, Terminal, History, Trophy, AlertTriangle, Zap, Download, Monitor, AlertCircle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, ResponsiveContainer } from 'recharts';
import dayjs from 'dayjs';

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
  loading?: boolean;
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
  status, history, wsLogs, isRunning, onControl, onNavigate,
  systemEvents = [], topBots = [], ocInstalled, loading
}) => {
  const { t } = useTranslation();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [ocStatus, setOcStatus] = useState<OcStatus | null>(null);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('guardian_token');
      const [sysRes, ocRes] = await Promise.all([
        fetch('/v1/system/info', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/v1/openclaw/version', { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      const sysJson = await sysRes.json();
      const ocJson = await ocRes.json();
      if (sysJson.code === 200) setSystemInfo(sysJson.data);
      if (ocJson.code === 200) setOcStatus(ocJson.data);
    } catch (err) {
      console.error('Failed to fetch dashboard system info:', err);
    }
  };

  useEffect(() => {
    fetchData();
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const renderChart = (data: any[], dataKey: string, color: string, label: string, unit: string) => (
    <div style={{ height: 120 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label} {t('dashboard.historyTrend')}</span>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>24H</span>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`color${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.15} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="timestamp" hide />
          <YAxis hide domain={['auto', 'auto']} />
          <ChartTooltip
            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 11 }}
            labelFormatter={(v) => dayjs(v).format('HH:mm:ss')}
            formatter={(v: any) => [v.toFixed(1) + ' ' + unit, label]}
          />
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#color${dataKey})`} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
      {/* 顶部环境概览条 - 独立渲染层 (亮色版) */}
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
        {ocInstalled === null || !systemInfo ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <RefreshCw size={18} style={{ color: '#3b82f6', animation: 'spin 1.5s linear infinite' }} />
            <span 
              className="animate-pulse-slow"
              style={{ 
                fontSize: 14, 
                fontWeight: 600, 
                color: '#3b82f6', 
                letterSpacing: '0.05em'
              }}
            >
              OpenClaw 环境检测中...
            </span>
          </div>
        ) : (
          <div style={{ 
            display: 'flex', 
            alignItems: isMobile ? 'flex-start' : 'center', 
            justifyContent: 'space-between',
            flexDirection: isMobile ? 'column' : 'row',
            width: '100%',
            gap: 16,
            animation: 'fadeIn 0.5s ease-out'
          }}>
            <div style={{ 
              display: 'flex', 
              alignItems: isMobile ? 'flex-start' : 'center', 
              gap: isMobile ? '16px' : '32px', 
              flexDirection: isMobile ? 'column' : 'row',
              width: isMobile ? '100%' : 'auto' 
            }}>
              {/* Hostname */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ background: '#f0f9ff', padding: '8px', borderRadius: '10px' }}>
                  <Monitor size={18} style={{ color: '#0ea5e9' }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{t('dashboard.hostname', { defaultValue: '主机名' })}</div>
                  <div style={{ fontSize: 14, color: '#1e293b', fontWeight: 600 }}>{systemInfo?.hostname || '---'}</div>
                </div>
              </div>

              {/* OS */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ background: '#f5f3ff', padding: '8px', borderRadius: '10px' }}>
                  <Server size={18} style={{ color: '#8b5cf6' }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{t('dashboard.os', { defaultValue: '操作系统' })}</div>
                  <div style={{ fontSize: 14, color: '#1e293b', fontWeight: 600 }}>
                    {systemInfo ? `${systemInfo.os} (${systemInfo.arch})` : '---'}
                  </div>
                </div>
              </div>

              {!isMobile && <div style={{ width: 1, height: 24, background: '#e2e8f0' }} />}

              {/* CLI Status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ 
                  background: ocStatus?.installed ? '#f0fdf4' : '#fef2f2', 
                  padding: '8px', 
                  borderRadius: '10px' 
                }}>
                  <Zap size={18} style={{ color: ocStatus?.installed ? '#22c55e' : '#ef4444' }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>OpenClaw CLI</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {ocStatus?.installed ? (
                      <Badge status="processing" color="#22c55e" text={<span style={{ fontSize: 14, color: '#1e293b', fontWeight: 700, fontFamily: 'monospace' }}>{ocStatus.version}</span>} />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, color: '#ef4444', fontWeight: 700 }}>未安装</span>
                        <AntTooltip title="OpenClaw 核心程序未在环境变量中通过检测">
                          <AlertCircle size={14} style={{ color: '#ef4444', cursor: 'help' }} />
                        </AntTooltip>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 12, 
              width: isMobile ? '100%' : 'auto',
              justifyContent: isMobile ? 'flex-end' : 'flex-start' 
            }}>
              {!ocStatus?.installed && (
                <Button 
                  type="primary" 
                  size="small" 
                  danger 
                  icon={<Download size={14} />}
                  onClick={() => window.open('https://github.com/RandyChen1985/openclaw-buddy/releases')}
                  style={{ borderRadius: 6, fontWeight: 600 }}
                >
                  获取下载
                </Button>
              )}
              <Button 
                type="text" 
                size="small"
                icon={<RefreshCw size={14} style={{ color: '#94a3b8' }} />} 
                onClick={fetchData}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #f1f5f9' }}
              />
            </div>
          </div>
        )}
      </div>

      <Row gutter={[20, 20]}>
        {/* 左侧：核心状态与负载 */}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('dashboard.runtime')}</div>
                </div>
                <div style={{ 
                  fontSize: isMobile ? 18 : 24, 
                  fontWeight: 800, 
                  color: '#1e293b', 
                  fontFamily: 'monospace', 
                  wordBreak: 'break-all', 
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {status?.gateway?.runtime || <Skeleton.Input active size="small" style={{ height: 28, width: 160 }} />}
                </div>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {!status?.metrics ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <Skeleton active paragraph={{ rows: 1 }} />
                    <Skeleton active paragraph={{ rows: 1 }} />
                  </div>
                ) : (
                  <>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                        <span style={{ color: '#64748b', fontWeight: 500 }}>{t('dashboard.cpuLoad')}</span>
                        <span style={{ color: '#1e293b', fontWeight: 700 }}>{status?.metrics?.cpu_usage?.toFixed(1)}%</span>
                      </div>
                      <Progress percent={status?.metrics?.cpu_usage} showInfo={false} strokeColor="#3b82f6" trailColor="#eff6ff" strokeWidth={6} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                        <span style={{ color: '#64748b', fontWeight: 500 }}>{t('dashboard.memLoad')}</span>
                        <span style={{ color: '#1e293b', fontWeight: 700 }}>{status?.metrics?.memory_usage?.toFixed(1)}%</span>
                      </div>
                      <Progress percent={status?.metrics?.memory_usage} showInfo={false} strokeColor="#8b5cf6" trailColor="#f5f3ff" strokeWidth={6} />
                    </div>
                  </>
                )}
              </div>
            </Card>

            {/* 机器人活跃榜 (Bot Top) */}
            <Card 
              styles={{ body: { padding: '20px 24px' } }} 
              style={{ borderRadius: 12, border: '1px solid #e2e8f0', flex: 1, minHeight: 180 }}
              title={<span style={{ fontSize: 13, fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}><Trophy size={14} color="#f59e0b" /> {t('dashboard.topBots')}</span>}
            >
              {loading ? (
                <div style={{ textAlign: 'center', padding: '32px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <Spin size="small" />
                  <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>{t('dashboard.analyzing')}</div>
                  <div style={{ fontSize: 10, color: '#cbd5e1' }}>{t('dashboard.syncing')}</div>
                </div>
              ) : topBots.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>
                  {t('dashboard.noActiveBots')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {topBots.map((bot, idx) => (
                    <div key={bot.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16 }}>{bot.emoji}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{bot.name}</span>
                        </div>
                        <Tag color="blue" bordered={false} style={{ margin: 0, fontSize: 10, borderRadius: 4 }}>
                          {bot.sessions} {t('dashboard.activeSessions')}
                        </Tag>
                      </div>
                      <Progress 
                        percent={Math.min(100, (bot.sessions / 10) * 100)} 
                        showInfo={false} 
                        strokeColor={idx === 0 ? '#f59e0b' : idx === 1 ? '#3b82f6' : '#8b5cf6'} 
                        strokeWidth={6} 
                      />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </Col>

        {/* 右侧：资源趋势图 */}
        <Col xs={24} lg={14}>
          <Card
            title={<span style={{ fontSize: 13, fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}><Activity size={15} color="#3b82f6" /> {t('dashboard.diagnosticLab')}</span>}
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
                {renderChart(history, 'response_time_ms', '#10b981', t('dashboard.latency'), 'ms')}
              </div>
            </div>

            {/* 巡检事件轨迹 (Terminal Style Timeline) */}
            <div style={{ marginTop: 24, borderTop: '1px solid #f1f5f9', paddingTop: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20 }}>
                <History size={15} color="#64748b" /> {t('dashboard.timeline')}
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
                    children: (
                      <div style={{ 
                        fontSize: 11, 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        gap: 12, 
                        color: '#64748b',
                        fontFamily: '"JetBrains Mono", monospace'
                      }}>
                        <span style={{ color: ev.event_type === 'HEAL' ? '#e11d48' : '#334155', display: 'flex', alignItems: 'center', gap: 6, flex: 1, fontWeight: 500 }}>
                          {ev.event_type === 'HEAL' && <AlertTriangle size={11} />}
                          {ev.event_type === 'UPDATE' && <Download size={11} />}
                          {ev.event_type === 'CONTROL' && <Zap size={11} />}
                          {ev.message}
                        </span>
                        <span style={{ opacity: 0.5, flexShrink: 0 }}>
                          {dayjs(ev.timestamp).format('HH:mm:ss')}
                        </span>
                      </div>
                    ),
                  }))}
                  style={{ paddingTop: 8 }}
                />
                {systemEvents.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#475569', fontSize: 12, padding: '40px 0', fontFamily: 'monospace' }}>
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
        style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>{t('dashboard.quickActions')}</span>
            {ocInstalled === false && (
              <Tag color="error" icon={<AlertCircle size={12} />} style={{ margin: 0, borderRadius: 4 }}>
                核心组件未就绪，控制已锁死
              </Tag>
            )}
          </div>
        }
        styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 52 }, body: { padding: '16px 24px' } }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, width: '100%', opacity: (ocInstalled === false || ocInstalled === null) ? 0.6 : 1 }}>
          <Button
            type="primary"
            size="large"
            icon={<Play size={14} />}
            onClick={() => onControl('start')}
            disabled={isRunning || ocInstalled === false || ocInstalled === null}
            style={{ 
              fontWeight: 600, flex: isMobile ? '1 1 calc(50% - 6px)' : 'none', minWidth: 140, borderRadius: 10,
              background: (isRunning || ocInstalled === false || ocInstalled === null) ? '#cbd5e1' : '#22c55e', borderColor: (isRunning || ocInstalled === false || ocInstalled === null) ? '#cbd5e1' : '#22c55e'
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
            disabled={!isRunning || ocInstalled === false || ocInstalled === null}
            style={{ fontWeight: 600, flex: isMobile ? '1 1 calc(50% - 6px)' : 'none', minWidth: 140, borderRadius: 10 }}
          >
            {t('dashboard.stopGateway')}
          </Button>
          <Button
            size="large"
            icon={<RefreshCw size={14} />}
            onClick={() => onControl('restart')}
            disabled={ocInstalled === false || ocInstalled === null}
            style={{ fontWeight: 600, flex: isMobile ? '1 1 100%' : 'none', minWidth: 140, borderRadius: 10, border: '1.5px solid #e2e8f0' }}
          >
            {t('dashboard.asyncRestart')}
          </Button>
          <div style={{ flex: 1 }} />
          <Button
            size="large"
            icon={<Smartphone size={14} />}
            onClick={() => onNavigate?.('components')}
            disabled={ocInstalled === null}
            style={{ fontWeight: 600, flex: isMobile ? '1 1 100%' : 'none', minWidth: 140, borderRadius: 10, background: ocInstalled === null ? '#f1f5f9' : '#f8fafc', border: '1.5px solid #e2e8f0' }}
          >
            {t('dashboard.wechatChannel')}
          </Button>
        </div>
      </Card>

      {/* 实时监控日志 */}
      <Card
        title={<span style={{ fontSize: 13, fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}><Terminal size={15} color="#64748b" /> {t('dashboard.realtimeLogs')}</span>}
        styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 52 }, body: { padding: 0, overflow: 'hidden' } }}
        style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
      >
        <div style={{ height: 300, background: '#0d1117', padding: '16px 20px', fontFamily: '"JetBrains Mono", "Fira Code", monospace', fontSize: 12, color: '#c9d1d9', overflowY: 'auto', lineHeight: 1.8 }}>
          {wsLogs.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#484f58', height: '100%', justifyContent: 'center' }}>
              <Spin size="small" /> {t('dashboard.listeningLogs')}
            </div>
          ) : wsLogs.map((log, i) => (
            <div key={i} style={{ display: 'flex', gap: 16 }}>
              <span style={{ color: '#30363d', width: 32, textAlign: 'right', flexShrink: 0, userSelect: 'none', fontSize: 11 }}>
                {(i + 1).toString().padStart(3, '0')}
              </span>
              <span style={{ 
                whiteSpace: 'pre-wrap', 
                wordBreak: 'break-all',
                color: log.toLowerCase().includes('error') ? '#f87171' : log.toLowerCase().includes('warn') ? '#fbbf24' : '#c9d1d9'
              }}>
                {log}
              </span>
            </div>
          ))}
          <div ref={logsEndRef} style={{ height: 10 }} />
        </div>
      </Card>
    </div>
  );
};

export default DashboardOverview;
