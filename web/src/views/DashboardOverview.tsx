import React, { useState, useEffect, useRef } from 'react';
import { Row, Col, Card, Tag, Progress, Button, Skeleton, Spin, Timeline } from 'antd';
import { Server, Activity, Play, Square, RefreshCw, Smartphone, Terminal, History, Trophy, AlertTriangle, Zap, Download } from 'lucide-react';
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
}

const DashboardOverview: React.FC<DashboardOverviewProps> = ({ 
  status, history, wsLogs, isRunning, onControl, onNavigate,
  systemEvents = [], topBots = []
}) => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const renderChart = (data: any[], dataKey: string, color: string, label: string, unit: string) => (
    <div style={{ height: 120 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label} 历史趋势</span>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Row gutter={[20, 20]}>
        {/* 左侧：核心状态与负载 */}
        <Col xs={24} lg={10}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
            <Card styles={{ body: { padding: 24 } }} style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13, fontWeight: 500 }}>
                  <Server size={15} color={isRunning ? '#22c55e' : '#ef4444'} />
                  网关核心状态
                </div>
                <Tag color={isRunning ? 'success' : 'error'} style={{ borderRadius: 20, border: 'none', margin: 0, fontWeight: 600, padding: '0 10px' }}>
                  {isRunning ? '运行中' : '已停止'}
                </Tag>
              </div>
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>运行时长</div>
                  <div style={{ fontSize: 10, color: '#10b981', fontWeight: 600, fontFamily: 'monospace' }}>{status?.version}</div>
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
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                    <span style={{ color: '#64748b', fontWeight: 500 }}>CPU 当前负载</span>
                    <span style={{ color: '#1e293b', fontWeight: 700 }}>{status?.metrics?.cpu_usage?.toFixed(1)}%</span>
                  </div>
                  <Progress percent={status?.metrics?.cpu_usage} showInfo={false} strokeColor="#3b82f6" trailColor="#eff6ff" strokeWidth={6} />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                    <span style={{ color: '#64748b', fontWeight: 500 }}>内存 当前负载</span>
                    <span style={{ color: '#1e293b', fontWeight: 700 }}>{status?.metrics?.memory_usage?.toFixed(1)}%</span>
                  </div>
                  <Progress percent={status?.metrics?.memory_usage} showInfo={false} strokeColor="#8b5cf6" trailColor="#f5f3ff" strokeWidth={6} />
                </div>
              </div>
            </Card>

            {/* 机器人活跃榜 (Bot Top) */}
            <Card 
              styles={{ body: { padding: '20px 24px' } }} 
              style={{ borderRadius: 12, border: '1px solid #e2e8f0', flex: 1 }}
              title={<span style={{ fontSize: 13, fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}><Trophy size={14} color="#f59e0b" /> 机器人资源活跃榜 (Top Bots)</span>}
            >
              {topBots.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>
                  暂无活跃会话数据
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
                          {bot.sessions} 活跃会话
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
            title={<span style={{ fontSize: 13, fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}><Activity size={15} color="#3b82f6" /> 资源诊断实验室 (Diagnostic Laboratory)</span>}
            styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 52 }, body: { padding: '24px' } }}
            style={{ height: '100%', borderRadius: 12, border: '1px solid #e2e8f0' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <Row gutter={24}>
                <Col span={12}>
                  {renderChart(history, 'cpu_usage', '#3b82f6', 'CPU', '%')}
                </Col>
                <Col span={12}>
                  {renderChart(history, 'memory_usage', '#8b5cf6', '内存', '%')}
                </Col>
              </Row>
              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 20 }}>
                {renderChart(history, 'response_time_ms', '#10b981', '网关延迟 (TTFT)', 'ms')}
              </div>
            </div>

            {/* 巡检事件轨迹 (Timeline) */}
            <div style={{ marginTop: 24, borderTop: '1px solid #f1f5f9', paddingTop: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20 }}>
                <History size={15} color="#64748b" /> 巡检历史轨迹 (Inspection Timeline)
              </div>
              <div style={{ height: 260, overflowY: 'auto', paddingRight: 10 }}>
                <Timeline
                  items={systemEvents.map(ev => ({
                    color: ev.event_type === 'HEAL' ? 'red' : ev.event_type === 'UPDATE' ? 'blue' : ev.event_type === 'CONTROL' ? 'green' : 'gray',
                    children: (
                      <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingRight: 4 }}>
                        <span style={{ fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                          {ev.event_type === 'HEAL' && <AlertTriangle size={12} />}
                          {ev.event_type === 'UPDATE' && <Download size={12} />}
                          {ev.event_type === 'CONTROL' && <Zap size={12} />}
                          {ev.message}
                        </span>
                        <span style={{ color: '#94a3b8', fontSize: 11, flexShrink: 0, fontFamily: 'monospace' }}>
                          {dayjs(ev.timestamp).format('HH:mm:ss')}
                        </span>
                      </div>
                    ),
                  }))}
                  style={{ paddingTop: 8 }}
                />
                {systemEvents.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, padding: '20px 0' }}>
                    暂无巡检记录
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
        title={<span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>快捷指令与自愈控制</span>}
        styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 52 }, body: { padding: '16px 24px' } }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, width: '100%' }}>
          <Button
            type="primary"
            size="large"
            icon={<Play size={14} />}
            onClick={() => onControl('start')}
            disabled={isRunning}
            style={{ 
              fontWeight: 600, flex: isMobile ? '1 1 calc(50% - 6px)' : 'none', minWidth: 140, borderRadius: 10,
              background: isRunning ? '#cbd5e1' : '#22c55e', borderColor: isRunning ? '#cbd5e1' : '#22c55e'
            }}
          >
            启动网关
          </Button>
          <Button
            danger
            type="primary"
            size="large"
            icon={<Square size={14} />}
            onClick={() => onControl('stop')}
            disabled={!isRunning}
            style={{ fontWeight: 600, flex: isMobile ? '1 1 calc(50% - 6px)' : 'none', minWidth: 140, borderRadius: 10 }}
          >
            停止网关
          </Button>
          <Button
            size="large"
            icon={<RefreshCw size={14} />}
            onClick={() => onControl('restart')}
            style={{ fontWeight: 600, flex: isMobile ? '1 1 100%' : 'none', minWidth: 140, borderRadius: 10, border: '1.5px solid #e2e8f0' }}
          >
            异步重启
          </Button>
          <div style={{ flex: 1 }} />
          <Button
            size="large"
            icon={<Smartphone size={14} />}
            onClick={() => onNavigate?.('components')}
            style={{ fontWeight: 600, flex: isMobile ? '1 1 100%' : 'none', minWidth: 140, borderRadius: 10, background: '#f8fafc', border: '1.5px solid #e2e8f0' }}
          >
            微信渠道管理
          </Button>
        </div>
      </Card>

      {/* 实时监控日志 */}
      <Card
        title={<span style={{ fontSize: 13, fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}><Terminal size={15} color="#64748b" /> 实时巡检日志 (Local Monitor)</span>}
        styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 52 }, body: { padding: 0, overflow: 'hidden' } }}
        style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
      >
        <div style={{ height: 300, background: '#0d1117', padding: '16px 20px', fontFamily: '"JetBrains Mono", "Fira Code", monospace', fontSize: 12, color: '#c9d1d9', overflowY: 'auto', lineHeight: 1.8 }}>
          {wsLogs.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#484f58', height: '100%', justifyContent: 'center' }}>
              <Spin size="small" /> 正在监听本地巡检流...
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
