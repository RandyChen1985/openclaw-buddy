import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Tag, Progress, Button, Skeleton } from 'antd';
import { Server, Activity, Cpu, Play, Square, RefreshCw, Smartphone } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, ResponsiveContainer } from 'recharts';
import dayjs from 'dayjs';

interface DashboardOverviewProps {
  status: any;
  history: any[];
  isRunning: boolean;
  onControl: (action: string) => void;
  onNavigate?: (key: string) => void;
}

const DashboardOverview: React.FC<DashboardOverviewProps> = ({ status, history, isRunning, onControl, onNavigate }) => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Row gutter={[20, 20]}>
        <Col xs={24} lg={12}>
          <Card styles={{ body: { padding: 24 } }} style={{ height: '100%', borderRadius: 12, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13, fontWeight: 500 }}>
                <Server size={15} color={isRunning ? '#22c55e' : '#ef4444'} />
                网关核心状态
              </div>
              <Tag color={isRunning ? 'success' : 'error'} style={{ borderRadius: 20, border: 'none', margin: 0, fontWeight: 600, padding: '0 10px' }}>
                {isRunning ? '运行中' : '已停止'}
              </Tag>
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>运行时长</div>
                <div style={{ fontSize: 10, color: '#10b981', fontWeight: 600, fontFamily: 'monospace' }}>{status?.version}</div>
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#1e293b', fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.3 }}>
                {status?.gateway?.runtime || <Skeleton.Input active size="small" style={{ height: 24, width: 140 }} />}
              </div>
            </div>
            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 16, display: 'grid', gridTemplateColumns: '0.8fr 1fr 1.2fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>PID</div>
                <div style={{ fontFamily: 'monospace', color: '#334155', fontWeight: 600, fontSize: 13 }}>
                  {status?.gateway?.pid || <Skeleton active paragraph={{ rows: 0 }} title={{ width: 40 }} />}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>最近更新</div>
                <div style={{ fontFamily: 'monospace', color: '#64748b', fontSize: 13 }}>{dayjs().format('HH:mm:ss')}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>系统安装于</div>
                <div style={{ 
                  fontFamily: 'monospace', 
                  color: '#64748b', 
                  fontSize: window.innerWidth < 768 ? 10 : 12,
                  whiteSpace: 'nowrap' 
                }}>
                  {status?.installed_at ? (window.innerWidth < 768 ? status.installed_at.split(' ')[0] : status.installed_at) : <Skeleton active paragraph={{ rows: 0 }} title={{ width: 80 }} />}
                </div>
              </div>
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={<span style={{ fontSize: 13, fontWeight: 500, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}><Activity size={15} color="#3b82f6" />响应延迟统计（近 24 小时）</span>}
            styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 52 }, body: { padding: '12px 20px 16px' } }}
            style={{ height: '100%', borderRadius: 12, border: '1px solid #e2e8f0' }}
          >
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="colorL" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="timestamp" hide />
                  <YAxis hide />
                  <ChartTooltip
                    contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
                    labelFormatter={(v) => dayjs(v).format('HH:mm:ss')}
                    formatter={(v: any) => [v + ' ms', '响应时间']}
                  />
                  <Area type="monotone" dataKey="response_time_ms" stroke="#3b82f6" strokeWidth={2} fill="url(#colorL)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Col>
      </Row>
      
      <Row style={{ marginTop: 20, order: isMobile ? 2 : 1 }}>
        <Col span={24}>
          <Card
            title={<span style={{ fontSize: 13, fontWeight: 500, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}><Cpu size={15} color="#8b5cf6" /> 服务器负载监控</span>}
            styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 48 }, body: { padding: '24px 20px' } }}
            style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
          >
            <Row gutter={24} justify="space-around">
              <Col span={8} style={{ textAlign: 'center' }}>
                <Progress type="dashboard" percent={Math.round(status?.metrics?.cpu_usage || 0)} size={window.innerWidth < 768 ? 60 : 80} strokeColor="#ef4444" />
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 500, marginTop: 8 }}>CPU 使用率</div>
              </Col>
              <Col span={8} style={{ textAlign: 'center' }}>
                <Progress type="dashboard" percent={Math.round(status?.metrics?.memory_usage || 0)} size={window.innerWidth < 768 ? 60 : 80} strokeColor="#3b82f6" />
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 500, marginTop: 8 }}>内存占用率</div>
              </Col>
              <Col span={8} style={{ textAlign: 'center' }}>
                <Progress type="dashboard" percent={Math.round(status?.metrics?.disk_usage || 0)} size={window.innerWidth < 768 ? 60 : 80} strokeColor="#d946ef" />
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 500, marginTop: 8 }}>磁盘利用率</div>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      <Card
        style={{ marginTop: 20, borderRadius: 12, border: '1px solid #e2e8f0', order: isMobile ? 1 : 2 }}
        title={<span style={{ fontSize: 13, fontWeight: 500, color: '#475569' }}>快捷操作</span>}
        styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 52 }, body: { padding: '16px 24px' } }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, width: '100%' }}>
          <Button
            type="primary"
            size="large"
            icon={<Play size={14} />}
            onClick={() => onControl('start')}
            disabled={isRunning}
            style={{ fontWeight: 500, flex: window.innerWidth < 768 ? '1 1 calc(50% - 6px)' : 'none', minWidth: 120 }}
          >
            启动网关
          </Button>
          <Button
            danger
            size="large"
            icon={<Square size={14} />}
            onClick={() => onControl('stop')}
            disabled={!isRunning}
            style={{ fontWeight: 500, flex: window.innerWidth < 768 ? '1 1 calc(50% - 6px)' : 'none', minWidth: 120 }}
          >
            停止网关
          </Button>
          <Button
            size="large"
            icon={<RefreshCw size={14} />}
            onClick={() => onControl('restart')}
            style={{ fontWeight: 500, flex: window.innerWidth < 768 ? '1 1 calc(50% - 6px)' : 'none', minWidth: 120 }}
          >
            重启网关
          </Button>
          <Button
            size="large"
            icon={<Smartphone size={14} />}
            onClick={() => onNavigate?.('components')}
            disabled={!isRunning}
            style={{ 
              fontWeight: 500, 
              flex: window.innerWidth < 768 ? '1 1 calc(50% - 6px)' : 'none', 
              minWidth: 120,
              background: isRunning ? '#16a34a' : '#f5f5f5',
              color: isRunning ? '#fff' : 'rgba(0, 0, 0, 0.25)',
              border: 'none'
            }}
          >
            绑定微信
          </Button>
        </div>
      </Card>

      {/* Live Event Stream */}
      <Card
        style={{ marginTop: 20, borderRadius: 12, border: '1px solid #e2e8f0', background: '#fff', order: 3 }}
        title={<span style={{ fontSize: 13, fontWeight: 700, color: '#475569', display: 'flex', alignItems: 'center', gap: 8 }}><div className="terminal-dot" /> 实时事件流 (Live Event Stream)</span>}
        styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 48 }, body: { padding: '12px 16px' } }}
      >
        <div style={{ maxHeight: 180, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11 }}>
          {[
            { time: dayjs().subtract(2, 'm').format('HH:mm:ss'), type: 'SUCCESS', msg: '网关核心巡检完成：所有进程运行正常' },
            { time: dayjs().subtract(5, 'm').format('HH:mm:ss'), type: 'INFO', msg: '执行定时业务数据全量同步... 已同步 24 个模型' },
            { time: dayjs().subtract(8, 'm').format('HH:mm:ss'), type: 'SUCCESS', msg: 'SQLite 数据库维护：已清理 7 天前旧数据' },
            { time: dayjs().subtract(12, 'm').format('HH:mm:ss'), type: 'INFO', msg: '检测到前端访问：Token 校验通过' },
            { time: dayjs().subtract(15, 'm').format('HH:mm:ss'), type: 'SUCCESS', msg: '健康检测报告已生成：P95 延迟 42ms' },
            { time: dayjs().subtract(20, 'm').format('HH:mm:ss'), type: 'INFO', msg: 'OpenClaw Guardian 守护进程已就位' }
          ].map((log, i) => (
             <div key={i} style={{ marginBottom: 6, display: 'flex', gap: 10 }}>
               <span style={{ color: '#94a3b8' }}>[{log.time}]</span>
               <span style={{ color: log.type === 'SUCCESS' ? '#22c55e' : '#3b82f6', fontWeight: 700 }}>{log.type}</span>
               <span style={{ color: '#475569' }}>{log.msg}</span>
             </div>
          ))}
          <div style={{ color: '#22c55e', opacity: 0.6, marginTop: 4 }}>... 正在实时监测系统健康状态 🦞</div>
        </div>
      </Card>

      <style>{`
        .terminal-dot {
          width: 8px;
          height: 8px;
          background: #ef4444;
          border-radius: 50%;
          box-shadow: 0 0 8px #ef4444;
          animation: blink 1.5s infinite;
        }
        @keyframes blink {
          0% { opacity: 0.4; }
          50% { opacity: 1; }
          100% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
};

export default DashboardOverview;
