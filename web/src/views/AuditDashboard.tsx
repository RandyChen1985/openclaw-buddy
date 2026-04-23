import React, { useState, useEffect, useRef } from 'react';
import { Row, Col, Card, DatePicker, Space, Table, Tag, Spin, Typography, Badge, Empty, Tabs, Input, Select, Modal, Radio } from 'antd';
import { ShieldAlert, Zap, Cpu, Activity, Search, Terminal, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import * as echarts from 'echarts';
import dayjs from 'dayjs';
import api from '../api';

const { RangePicker } = DatePicker;
const { Title, Text } = Typography;
const { Option } = Select;

const AuditDashboard: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(6, 'day'),
    dayjs()
  ]);
  
  const [logKeyword, setLogKeyword] = useState('');
  const [logLevel, setLogLevel] = useState<string | undefined>(undefined);
  const [summary, setSummary] = useState<any>(null);
  const [tools, setTools] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [lastSync, setLastSync] = useState<string>('');
  const [granularity, setGranularity] = useState<'day' | 'hour'>('day');
  
  // Reactive mobile check
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);

  // Detail Modal State
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedLog, setSelectedLog] = useState<any>(null);

  const trendChartRef = useRef<HTMLDivElement>(null);
  const modelChartRef = useRef<HTMLDivElement>(null);
  const agentChartRef = useRef<HTMLDivElement>(null);
  const toolsChartRef = useRef<HTMLDivElement>(null);
  const charts = useRef<{ [key: string]: echarts.ECharts | null }>({});

  const [activeTab, setActiveTab] = useState('model');

  const fetchData = async () => {
    setLoading(true);
    const start = dateRange[0].startOf('day').toISOString();
    const end = dateRange[1].endOf('day').toISOString();

    try {
      const [sumRes, toolRes, logRes] = await Promise.all([
        api.get(`/v1/audit/dashboard/summary?start=${start}&end=${end}&granularity=${granularity}`),
        api.get(`/v1/audit/dashboard/tools?start=${start}&end=${end}`),
        api.get(`/v1/audit/logs?start=${start}&end=${end}&keyword=${logKeyword || ''}&level=${logLevel || ''}`)
      ]);

      if (sumRes.data) setSummary(sumRes.data);
      if (toolRes.data) setTools(toolRes.data);
      if (logRes.data) setAuditLogs(logRes.data);
      setLastSync(dayjs().format('HH:mm:ss'));
    } catch (err) {
      console.error('Failed to fetch audit data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 60000);
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1024);
      Object.values(charts.current).forEach(chart => chart?.resize());
    };
    window.addEventListener('resize', handleResize);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', handleResize);
      Object.values(charts.current).forEach(chart => chart?.dispose());
    };
  }, [dateRange, logKeyword, logLevel, granularity]);

  const renderCharts = () => {
    if (!summary || loading) return;

    const chartTheme = {
      color: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'],
      textStyle: { fontFamily: 'inherit' }
    };

    // 1. Trend Chart
    if (trendChartRef.current && summary.trend?.length > 0) {
      if (!charts.current.trend) charts.current.trend = echarts.init(trendChartRef.current);
      charts.current.trend.setOption({
        ...chartTheme,
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: 8, shadowBlur: 10 },
        grid: { left: '10', right: '10', top: '10', bottom: '10', containLabel: true },
        xAxis: { 
          type: 'category', 
          boundaryGap: false, 
          data: summary.trend.map((i: any) => granularity === 'day' ? dayjs(i.time).format('MM-DD') : dayjs(i.time + ':00').format('HH:00')),
          axisLine: { lineStyle: { color: '#e2e8f0' } },
          axisLabel: { fontSize: 10, color: '#64748b' }
        },
        yAxis: { type: 'value', splitLine: { lineStyle: { type: 'dashed', color: '#f1f5f9' } }, axisLabel: { fontSize: 10, color: '#64748b' } },
        series: [{
          name: 'Tokens',
          data: summary.trend.map((i: any) => i.tokens),
          type: 'line',
          smooth: 0.4,
          symbol: 'circle',
          symbolSize: 4,
          lineStyle: { width: 2, color: '#4f46e5' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(79, 70, 229, 0.1)' },
              { offset: 1, color: 'rgba(79, 70, 229, 0)' }
            ])
          },
          itemStyle: { color: '#4f46e5' }
        }]
      }, true);
    }

    // 2. Model Chart
    if (modelChartRef.current && summary.model_distribution?.length > 0) {
      if (!charts.current.model) charts.current.model = echarts.init(modelChartRef.current);
      charts.current.model.setOption({
        ...chartTheme,
        tooltip: { trigger: 'item' },
        legend: { bottom: '0', icon: 'circle', itemWidth: 6, textStyle: { fontSize: 10, color: '#64748b' } },
        series: [{
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['50%', '40%'],
          avoidLabelOverlap: false,
          itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
          label: { show: false },
          data: summary.model_distribution.map((i: any) => ({ value: i.tokens, name: i.model }))
        }]
      }, true);
    }

    // 2.1 Agent Chart
    if (agentChartRef.current && summary.agent_distribution?.length > 0) {
      if (!charts.current.agent) charts.current.agent = echarts.init(agentChartRef.current);
      charts.current.agent.setOption({
        ...chartTheme,
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: '10', right: '30', top: '10', bottom: '10', containLabel: true },
        xAxis: { 
          type: 'value', 
          splitLine: { show: false }, 
          axisLabel: { 
            fontSize: 9,
            formatter: (val: number) => {
              if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
              if (val >= 1000) return (val / 1000).toFixed(0) + 'K';
              return val;
            }
          } 
        },
        yAxis: { 
          type: 'category', 
          data: summary.agent_distribution.map((i: any) => i.agent).reverse(), 
          axisLine: { lineStyle: { color: '#e2e8f0' } }, 
          axisTick: { show: false },
          axisLabel: { fontSize: 9, color: '#64748b' }
        },
        series: [{
          name: 'Tokens',
          data: summary.agent_distribution.map((i: any) => i.tokens).reverse(),
          type: 'bar',
          barWidth: '50%',
          itemStyle: { 
            borderRadius: [0, 2, 2, 0],
            color: '#4f46e5'
          }
        }]
      }, true);
    }

    // 3. Tools Chart
    if (toolsChartRef.current && tools.length > 0) {
      if (!charts.current.tools) charts.current.tools = echarts.init(toolsChartRef.current);
      charts.current.tools.setOption({
        ...chartTheme,
        tooltip: { trigger: 'axis' },
        grid: { left: '10', right: '30', top: '10', bottom: '0', containLabel: true },
        xAxis: { 
          type: 'value', 
          splitLine: { show: false }, 
          axisLabel: { 
            fontSize: 9,
            formatter: (val: number) => {
              if (val >= 1000) return (val / 1000).toFixed(0) + 'K';
              return val;
            }
          } 
        },
        yAxis: { 
          type: 'category', 
          data: tools.map((i: any) => i.name).reverse(), 
          axisLine: { lineStyle: { color: '#e2e8f0' } }, 
          axisTick: { show: false },
          axisLabel: { fontSize: 9, color: '#64748b' }
        },
        series: [{
          data: tools.map((i: any) => i.count).reverse(),
          type: 'bar',
          barWidth: '60%',
          itemStyle: { 
            borderRadius: [0, 2, 2, 0],
            color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [
              { offset: 0, color: '#10b981' },
              { offset: 1, color: '#34d399' }
            ])
          }
        }]
      }, true);
    }
  };

  useEffect(() => {
    const timer = setTimeout(renderCharts, 300);
    return () => clearTimeout(timer);
  }, [summary, tools, loading, activeTab]);

  const logColumns = [
    {
      title: t('common.time'),
      dataIndex: 'timestamp',
      key: 'timestamp',
      render: (ts: string) => <Text style={{ fontSize: '11px', color: '#64748b' }}>{dayjs(ts).format('MM-DD HH:mm:ss')}</Text>,
      width: 120,
    },
    {
      title: 'Agent',
      dataIndex: 'agent_id',
      key: 'agent_id',
      render: (id: string) => <Tag color="blue" style={{ fontSize: '10px', borderRadius: '4px' }}>{id}</Tag>,
      width: 100,
    },
    {
      title: t('common.command'),
      dataIndex: 'command',
      key: 'command',
      render: (cmd: string, record: any) => (
        <div 
          onClick={() => { setSelectedLog(record); setDetailVisible(true); }}
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
        >
          <Text code style={{ fontSize: '11px', background: '#f1f5f9', whiteSpace: 'nowrap', padding: '1px 4px', flex: 1 }} ellipsis>{cmd}</Text>
          <ExternalLink size={10} style={{ marginLeft: 4, color: '#94a3b8' }} />
        </div>
      ),
    },
    {
      title: t('audit.riskLevel'),
      dataIndex: 'risk_level',
      key: 'risk_level',
      render: (level: string) => (
        <Badge status={level === 'high' ? 'error' : 'success'} text={<span style={{ fontSize: '11px', fontWeight: 500, color: level === 'high' ? '#ef4444' : '#10b981' }}>{level.toUpperCase()}</span>} />
      ),
      width: 90,
    }
  ];

  return (
    <div style={{ padding: isMobile ? '12px' : '16px', background: '#f8fafc', minHeight: '100vh' }}>
      {/* Responsive Header */}
      <div style={{ 
        display: 'flex', 
        flexDirection: isMobile ? 'column' : 'row', 
        justifyContent: 'space-between', 
        alignItems: isMobile ? 'flex-start' : 'center', 
        marginBottom: '16px',
        gap: '12px'
      }}>
        <Space align="center" size="middle">
          <div style={{ background: '#4f46e5', padding: '6px', borderRadius: '6px', flexShrink: 0 }}>
            <ShieldAlert size={isMobile ? 16 : 18} color="white" />
          </div>
          <div style={{ minWidth: 0 }}>
            <Title level={4} style={{ margin: 0, fontSize: isMobile ? '16px' : '18px', whiteSpace: 'nowrap' }}>{t('audit.title')}</Title>
            <Space size="small" style={{ fontSize: '10px', color: '#64748b' }} wrap>
              <span>{t('audit.lastUpdated')}: {lastSync}</span>
              <Divider type="vertical" />
              <span>{t('audit.retentionTip')}</span>
            </Space>
          </div>
        </Space>
        
        <div style={{ width: isMobile ? '100%' : 'auto' }}>
          <RangePicker 
            size="small"
            style={{ borderRadius: '6px', width: '100%' }}
            value={dateRange} 
            onChange={(dates) => dates && setDateRange([dates[0]!, dates[1]!])} 
          />
        </div>
      </div>

      <Spin spinning={loading}>
        {/* Metric Ribbons (Compact) */}
        <Row gutter={[12, 12]} style={{ marginBottom: '16px' }}>
          {[
            { title: t('audit.totalTokens'), value: summary?.summary?.total_tokens, icon: <Zap size={14} color="#f59e0b" /> },
            { title: t('audit.activeAgents'), value: summary?.summary?.active_agents, icon: <Activity size={14} color="#3b82f6" /> },
            { title: t('audit.securityHits'), value: summary?.summary?.security_hits, icon: <ShieldAlert size={14} color="#ef4444" />, isAlert: (summary?.summary?.security_hits > 0) },
            { title: t('audit.modelCoverage'), value: summary?.model_distribution?.length, icon: <Cpu size={14} color="#8b5cf6" /> },
          ].map((item, idx) => (
            <Col xs={12} lg={6} key={idx}>
              <Card bodyStyle={{ padding: '10px 12px' }} style={{ borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ minWidth: 0 }}>
                    <Text type="secondary" style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 600, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</Text>
                    <div style={{ fontSize: isMobile ? '16px' : '18px', fontWeight: 700, color: item.isAlert ? '#ef4444' : '#1e293b', marginTop: 0 }}>
                      {item.value?.toLocaleString() || 0}
                    </div>
                  </div>
                  {!isMobile && <div style={{ opacity: 0.6, flexShrink: 0 }}>{item.icon}</div>}
                </div>
              </Card>
            </Col>
          ))}
        </Row>

        {/* Middle Section: Charts (Density + Integration) */}
        <Row gutter={[12, 12]}>
          <Col xs={24} lg={16}>
            <Card 
              size="small"
              title={<span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b' }}>{t('audit.trendTitle')}</span>}
              extra={
                <Radio.Group 
                  size="small" 
                  value={granularity} 
                  onChange={(e) => setGranularity(e.target.value)}
                  style={{ transform: 'scale(0.8)', transformOrigin: 'right center' }}
                >
                  <Radio.Button value="day">天</Radio.Button>
                  <Radio.Button value="hour">小时</Radio.Button>
                </Radio.Group>
              }
              bodyStyle={{ padding: '8px' }}
              style={{ borderRadius: '8px', height: isMobile ? '260px' : '300px', border: '1px solid #f1f5f9' }}
            >
              {summary?.trend && summary.trend.length > 0 ? (
                <div ref={trendChartRef} style={{ width: '100%', height: isMobile ? '200px' : '240px' }} />
              ) : (
                <Empty description={t('audit.noData')} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 20 }} />
              )}
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card 
              size="small"
              bodyStyle={{ padding: '0 8px 8px 8px' }}
              style={{ borderRadius: '8px', height: isMobile ? '260px' : '300px', border: '1px solid #f1f5f9' }}
            >
              <Tabs activeKey={activeTab} onChange={setActiveTab} size="small" centered className="compact-tabs">
                <Tabs.TabPane tab={<span style={{ fontSize: '10px' }}>{t('audit.modelDistTitle')}</span>} key="model">
                  {summary?.model_distribution && summary.model_distribution.length > 0 ? (
                    <div ref={modelChartRef} style={{ width: '100%', height: isMobile ? '180px' : '220px' }} />
                  ) : (
                    <Empty description={t('audit.noData')} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 20 }} />
                  )}
                </Tabs.TabPane>
                <Tabs.TabPane tab={<span style={{ fontSize: '10px' }}>虾兵蟹将 (Agents)</span>} key="agent">
                  {summary?.agent_distribution && summary.agent_distribution.length > 0 ? (
                    <div ref={agentChartRef} style={{ width: '100%', height: isMobile ? '180px' : '220px' }} />
                  ) : (
                    <Empty description={t('audit.noData')} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 20 }} />
                  )}
                </Tabs.TabPane>
                <Tabs.TabPane tab={<span style={{ fontSize: '10px' }}>工具与技能</span>} key="tools">
                  {tools && tools.length > 0 ? (
                    <div ref={toolsChartRef} style={{ width: '100%', height: isMobile ? '180px' : '220px' }} />
                  ) : (
                    <Empty description={t('audit.noData')} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 20 }} />
                  )}
                </Tabs.TabPane>
              </Tabs>
            </Card>
          </Col>
        </Row>

        {/* Bottom Section: Logs (Flat & Compact) */}
        <Card 
          size="small"
          title={<span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b' }}>{t('audit.securityLogs')}</span>}
          extra={
            <Space size="small">
              <Input 
                size="small"
                placeholder="搜索..." 
                prefix={<Search size={10} />} 
                style={{ width: isMobile ? 100 : 160, borderRadius: '4px' }} 
                allowClear
                onChange={(e) => setLogKeyword(e.target.value)}
              />
              <Select 
                size="small"
                placeholder="级别" 
                style={{ width: 70 }} 
                allowClear
                onChange={setLogLevel}
              >
                <Option value="high">HIGH</Option>
                <Option value="low">LOW</Option>
              </Select>
            </Space>
          }
          style={{ marginTop: '12px', borderRadius: '8px', border: '1px solid #f1f5f9' }}
          bodyStyle={{ padding: '0 4px' }}
        >
          <Table 
            dataSource={auditLogs} 
            columns={logColumns} 
            pagination={{ pageSize: isMobile ? 5 : 8, size: 'small', hideOnSinglePage: true }} 
            rowKey={(_, index) => index || ''}
            size="small"
            scroll={{ x: 'max-content' }}
          />
        </Card>
      </Spin>

      {/* Detail Modal */}
      <Modal
        title={<Space><Terminal size={16} />{t('common.command')}</Space>}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={600}
        centered
      >
        {selectedLog && (
          <div style={{ fontSize: '11px' }}>
            <Space style={{ marginBottom: 12 }} size="middle" wrap>
              <Text type="secondary">{dayjs(selectedLog.timestamp).format('YYYY-MM-DD HH:mm:ss')}</Text>
              <Tag color="blue">{selectedLog.agent_id}</Tag>
              <Badge status={selectedLog.risk_level === 'high' ? 'error' : 'success'} text={selectedLog.risk_level.toUpperCase()} />
            </Space>
            <div style={{ background: '#1e293b', padding: '10px', borderRadius: '6px', color: '#e2e8f0', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '11px' }}>
              {selectedLog.command}
            </div>
          </div>
        )}
      </Modal>

      <style dangerouslySetInnerHTML={{ __html: `
        .compact-tabs .ant-tabs-nav { margin-bottom: 4px !important; }
        .compact-tabs .ant-tabs-tab { padding: 4px 0 !important; }
        .ant-table-thead > tr > th { font-size: 10px !important; background: #fafafa !important; }
        .ant-table-cell { font-size: 10px !important; }
      `}} />
    </div>
  );
};

const Divider = ({ type }: { type: 'vertical' }) => (
  <div style={{ display: 'inline-block', width: '1px', height: '10px', background: '#e2e8f0', margin: '0 8px', verticalAlign: 'middle' }}>{type === 'vertical' ? '' : ''}</div>
);

export default AuditDashboard;
