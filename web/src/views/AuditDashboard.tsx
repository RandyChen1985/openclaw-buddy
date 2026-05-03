import React, { useState, useEffect, useRef } from 'react';
import { Card, DatePicker, Space, Table, Tag, Spin, Typography, Badge, Empty, Tabs, Input, Select, Modal, Radio } from 'antd';
import { ShieldAlert, Zap, Cpu, Activity, Search, Terminal, ExternalLink, MessageSquare, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import * as echarts from 'echarts';
import dayjs from 'dayjs';
import api from '../api';

const { RangePicker } = DatePicker;
const { Title, Text } = Typography;
const { Option } = Select;

interface AuditDashboardProps {
  isDarkMode?: boolean;
}

const AuditDashboard: React.FC<AuditDashboardProps> = ({ isDarkMode = false }) => {
  const { t } = useTranslation();
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
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

  const sessionCount = (() => {
    const n = Number(summary?.summary?.session_count);
    return Number.isFinite(n) ? n : 0;
  })();

  const buildRange = () => {
    const start = dateRange[0].startOf('day').toISOString();
    const end = dateRange[1].endOf('day').toISOString();
    return { start, end };
  };

  // 仅刷新顶部汇总/图表（不受日志过滤条件影响）
  const fetchSummaryAndTools = async () => {
    setLoadingSummary(true);
    const { start, end } = buildRange();
    try {
      const [sumRes, toolRes] = await Promise.all([
        api.get(`/v1/audit/dashboard/summary?start=${start}&end=${end}&granularity=${granularity}`),
        api.get(`/v1/audit/dashboard/tools?start=${start}&end=${end}`),
      ]);

      if (sumRes.data) setSummary(sumRes.data);
      if (toolRes.data) setTools(toolRes.data);
      setLastSync(dayjs().format('HH:mm:ss'));
    } catch (err) {
      console.error('Failed to fetch audit data:', err);
    } finally {
      setLoadingSummary(false);
    }
  };

  useEffect(() => {
    fetchSummaryAndTools();
    const timer = setInterval(fetchSummaryAndTools, 60000);
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
  }, [dateRange, granularity]);

  // 仅刷新底部审计日志（过滤条件只影响此处）
  const fetchAuditLogs = async () => {
    setLoadingLogs(true);
    const { start, end } = buildRange();
    try {
      const logRes = await api.get(
        `/v1/audit/logs?start=${start}&end=${end}&keyword=${logKeyword || ''}&level=${logLevel || ''}`
      );
      if (logRes.data) setAuditLogs(logRes.data);
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    fetchAuditLogs();
    const timer = setInterval(fetchAuditLogs, 60000);
    return () => clearInterval(timer);
  }, [dateRange, logKeyword, logLevel]);

  const renderTrendChart = () => {
    if (!trendChartRef.current || !summary?.trend?.length) return;
    
    // 仅销毁并重建趋势图实例，不影响其他图表
    if (charts.current.trend) charts.current.trend.dispose();
    charts.current.trend = echarts.init(trendChartRef.current);

    const xAxisData = summary.trend.map((i: any) => {
      const d = dayjs(i.time);
      return granularity === 'day' ? d.format('MM-DD') : d.format('HH:00');
    });

    const chartTheme = {
      color: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'],
      textStyle: { fontFamily: 'inherit', color: isDarkMode ? '#94a3b8' : '#64748b' }
    };

    charts.current.trend.setOption({
      ...chartTheme,
      tooltip: { 
        trigger: 'axis', 
        backgroundColor: isDarkMode ? 'rgba(30, 41, 59, 0.9)' : 'rgba(255, 255, 255, 0.9)', 
        borderColor: isDarkMode ? '#334155' : '#e2e8f0',
        textStyle: { color: isDarkMode ? '#f1f5f9' : '#334155' },
        borderRadius: 8, 
        shadowBlur: 10,
        formatter: (params: any) => {
          const item = params[0];
          const time = summary.trend[item.dataIndex]?.time;
          return `<b>${dayjs(time).format(granularity === 'day' ? 'YYYY-MM-DD' : 'MM-DD HH:00')}</b><br/>Tokens: ${item.value.toLocaleString()}`;
        }
      },
      grid: { left: '10', right: '10', top: '10', bottom: '10', containLabel: true },
      xAxis: { 
        type: 'category', 
        boundaryGap: false, 
        data: xAxisData,
        axisLine: { lineStyle: { color: isDarkMode ? '#334155' : '#e2e8f0' } },
        axisLabel: { fontSize: 10, color: isDarkMode ? '#94a3b8' : '#64748b' }
      },
      yAxis: { 
        type: 'value', 
        splitLine: { lineStyle: { type: 'dashed', color: isDarkMode ? '#334155' : '#f1f5f9' } }, 
        axisLabel: { 
          fontSize: 10, 
          color: isDarkMode ? '#94a3b8' : '#64748b',
          formatter: (val: number) => {
            if (val >= 1000) return (val / 1000).toFixed(0) + 'K';
            return val;
          }
        } 
      },
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
  };

  const renderTabCharts = () => {
    const chartTheme = {
      color: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'],
      textStyle: { fontFamily: 'inherit', color: isDarkMode ? '#94a3b8' : '#64748b' }
    };

    // 2. Model Chart
    if (activeTab === 'model' && modelChartRef.current && summary?.model_distribution?.length > 0) {
      if (charts.current.model) charts.current.model.dispose();
      charts.current.model = echarts.init(modelChartRef.current);
      charts.current.model.setOption({
        ...chartTheme,
        tooltip: { trigger: 'item', backgroundColor: isDarkMode ? '#1e293b' : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0', textStyle: { color: isDarkMode ? '#f1f5f9' : '#334155' } },
        legend: { bottom: '0', icon: 'circle', itemWidth: 6, textStyle: { fontSize: 10, color: isDarkMode ? '#94a3b8' : '#64748b' } },
        series: [{
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['50%', '40%'],
          avoidLabelOverlap: false,
          itemStyle: { borderRadius: 4, borderColor: isDarkMode ? '#1e293b' : '#fff', borderWidth: 2 },
          label: { show: false },
          data: summary.model_distribution.map((i: any) => ({ value: i.tokens, name: i.model }))
        }]
      }, true);
    }

    // 2.1 Agent Chart
    if (activeTab === 'agent' && agentChartRef.current && summary?.agent_distribution?.length > 0) {
      if (charts.current.agent) charts.current.agent.dispose();
      charts.current.agent = echarts.init(agentChartRef.current);
      charts.current.agent.setOption({
        ...chartTheme,
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: isDarkMode ? '#1e293b' : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0', textStyle: { color: isDarkMode ? '#f1f5f9' : '#334155' } },
        grid: { left: '10', right: '30', top: '10', bottom: '10', containLabel: true },
        xAxis: { 
          type: 'value', 
          splitLine: { show: false }, 
          axisLabel: { 
            fontSize: 9,
            color: isDarkMode ? '#94a3b8' : '#64748b',
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
          axisLine: { lineStyle: { color: isDarkMode ? '#334155' : '#e2e8f0' } }, 
          axisTick: { show: false },
          axisLabel: { fontSize: 9, color: isDarkMode ? '#94a3b8' : '#64748b' }
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
    if (activeTab === 'tools' && toolsChartRef.current && tools.length > 0) {
      if (charts.current.tools) charts.current.tools.dispose();
      charts.current.tools = echarts.init(toolsChartRef.current);
      charts.current.tools.setOption({
        ...chartTheme,
        tooltip: { trigger: 'axis', backgroundColor: isDarkMode ? '#1e293b' : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0', textStyle: { color: isDarkMode ? '#f1f5f9' : '#334155' } },
        grid: { left: '10', right: '30', top: '10', bottom: '0', containLabel: true },
        xAxis: { 
          type: 'value', 
          splitLine: { show: false }, 
          axisLabel: { 
            fontSize: 9,
            color: isDarkMode ? '#94a3b8' : '#64748b',
            formatter: (val: number) => {
              if (val >= 1000) return (val / 1000).toFixed(0) + 'K';
              return val;
            }
          } 
        },
        yAxis: { 
          type: 'category', 
          data: tools.map((i: any) => i.name).reverse(), 
          axisLine: { lineStyle: { color: isDarkMode ? '#334155' : '#e2e8f0' } }, 
          axisTick: { show: false },
          axisLabel: { fontSize: 9, color: isDarkMode ? '#94a3b8' : '#64748b' }
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
    const timer = setTimeout(renderTrendChart, 300);
    return () => clearTimeout(timer);
  }, [summary?.trend, granularity, loadingSummary]);

  useEffect(() => {
    const timer = setTimeout(renderTabCharts, 300);
    return () => clearTimeout(timer);
  }, [summary, tools, loadingSummary, activeTab]);

  const logColumns = [
    {
      title: t('common.time'),
      dataIndex: 'timestamp',
      key: 'timestamp',
      render: (ts: string) => (
        <Text style={{ fontSize: '11px', color: isDarkMode ? '#94a3b8' : '#64748b' }}>{dayjs(ts).format('MM-DD HH:mm:ss')}</Text>
      ),
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
          <span
            title={cmd}
            style={{
              display: 'block',
              minWidth: 0,
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '11px',
              lineHeight: 1.45,
              padding: '2px 6px',
              borderRadius: 4,
              background: isDarkMode ? '#0f172a' : '#f1f5f9',
              color: isDarkMode ? '#7dd3fc' : '#0f172a',
              border: isDarkMode ? '1px solid #334155' : '1px solid #e2e8f0',
            }}
          >
            {cmd}
          </span>
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
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
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
              <Divider type="vertical" isDarkMode={isDarkMode} />
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

      <Spin spinning={loadingSummary}>
        {/* Metric Ribbons (Compact) */}
        <div className="audit-metrics-grid" style={{ marginBottom: 16 }}>
          {([
            { title: t('audit.totalTokens'), value: summary?.summary?.total_tokens, Icon: Zap, iconColor: '#f59e0b' },
            { title: t('audit.activeAgents'), value: summary?.summary?.active_agents, Icon: Activity, iconColor: '#3b82f6' },
            { title: t('audit.sessionCount', { defaultValue: '会话数' }), value: sessionCount, Icon: MessageSquare, iconColor: '#06b6d4' },
            { title: t('audit.securityHits'), value: summary?.summary?.security_hits, Icon: ShieldAlert, iconColor: '#ef4444', isAlert: (summary?.summary?.security_hits > 0) },
            { title: t('audit.modelCoverage'), value: summary?.model_distribution?.length, Icon: Cpu, iconColor: '#8b5cf6' },
          ] as { title: string; value: any; Icon: LucideIcon; iconColor: string; isAlert?: boolean }[]).map((item, idx) => {
            const MetricIcon = item.Icon;
            const iconSize = 24;
            const iconWrap = 46;
            return (
            <Card key={idx} bodyStyle={{ padding: '10px 12px' }} style={{ borderRadius: '8px', border: `1px solid ${isDarkMode ? '#334155' : '#f1f5f9'}`, background: isDarkMode ? '#1e293b' : '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <Text type="secondary" style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 600, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: isDarkMode ? '#94a3b8' : 'inherit' }}>{item.title}</Text>
                  <div style={{ fontSize: isMobile ? '16px' : '18px', fontWeight: 700, color: item.isAlert ? '#ef4444' : (isDarkMode ? '#f1f5f9' : '#1e293b'), marginTop: 0 }}>
                    {item.value?.toLocaleString() || 0}
                  </div>
                </div>
                {!isMobile && (
                <div
                  aria-hidden
                  style={{
                    width: iconWrap,
                    height: iconWrap,
                    minWidth: iconWrap,
                    borderRadius: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    background: isDarkMode ? 'rgba(148, 163, 184, 0.1)' : '#f8fafc',
                    border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
                  }}
                >
                  <MetricIcon size={iconSize} color={item.iconColor} strokeWidth={2.25} aria-hidden />
                </div>
                )}
              </div>
            </Card>
            );
          })}
        </div>

        {/* Middle Section: Charts (Density + Integration) */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 12 }}>
          <div>
            <Card 
              size="small"
              title={<span style={{ fontSize: '11px', fontWeight: 600, color: isDarkMode ? '#94a3b8' : '#64748b' }}>{t('audit.trendTitle')}</span>}
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
              style={{ borderRadius: '8px', height: isMobile ? '260px' : '300px', border: `1px solid ${isDarkMode ? '#334155' : '#f1f5f9'}`, background: isDarkMode ? '#1e293b' : '#fff' }}
            >
              {summary?.trend && summary.trend.length > 0 ? (
                <div ref={trendChartRef} style={{ width: '100%', height: isMobile ? '200px' : '240px' }} />
              ) : (
                <Empty description={t('audit.noData')} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 20 }} />
              )}
            </Card>
          </div>
          <div>
            <Card 
              size="small"
              bodyStyle={{ padding: '0 8px 8px 8px' }}
              style={{ borderRadius: '8px', height: isMobile ? '260px' : '300px', border: `1px solid ${isDarkMode ? '#334155' : '#f1f5f9'}`, background: isDarkMode ? '#1e293b' : '#fff' }}
            >
              <Tabs activeKey={activeTab} onChange={setActiveTab} size="small" centered className={`compact-tabs ${isDarkMode ? 'dark-tabs' : ''}`}>
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
          </div>
        </div>

        {/* Bottom Section: Logs (Flat & Compact) */}
        <Card 
          size="small"
          title={<span style={{ fontSize: '11px', fontWeight: 600, color: isDarkMode ? '#94a3b8' : '#64748b' }}>{t('audit.securityLogs')}</span>}
          extra={
            <Space size="small">
              <Input 
                size="small"
                placeholder="搜索..." 
                prefix={<Search size={10} />} 
                style={{ width: isMobile ? 100 : 160, borderRadius: '4px', background: isDarkMode ? '#0f172a' : '#fff', borderColor: isDarkMode ? '#334155' : '#d9d9d9', color: isDarkMode ? '#f1f5f9' : 'inherit' }} 
                allowClear
                onChange={(e) => setLogKeyword(e.target.value)}
              />
              <Select 
                size="small"
                placeholder="级别" 
                style={{ width: 70 }} 
                allowClear
                onChange={setLogLevel}
                dropdownStyle={{ background: isDarkMode ? '#1e293b' : '#fff' }}
              >
                <Option value="high">HIGH</Option>
                <Option value="low">LOW</Option>
              </Select>
            </Space>
          }
          style={{ marginTop: '12px', borderRadius: '8px', border: `1px solid ${isDarkMode ? '#334155' : '#f1f5f9'}`, background: isDarkMode ? '#1e293b' : '#fff' }}
          bodyStyle={{ padding: '0 4px' }}
        >
          <Table 
            dataSource={auditLogs} 
            columns={logColumns} 
            pagination={{ pageSize: isMobile ? 5 : 8, size: 'small', hideOnSinglePage: true }} 
            rowKey={(_, index) => index || ''}
            size="small"
            scroll={{ x: 'max-content' }}
            loading={loadingLogs}
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
        .ant-table-thead > tr > th { 
          font-size: 10px !important; 
          background: ${isDarkMode ? '#0f172a' : '#fafafa'} !important; 
          color: ${isDarkMode ? '#94a3b8' : 'inherit'} !important; 
          border-bottom: 1px solid ${isDarkMode ? '#334155' : '#f0f0f0'} !important; 
        }
        .ant-table-cell { 
          font-size: 10px !important; 
          background: ${isDarkMode ? '#1e293b' : 'inherit'} !important;
          color: ${isDarkMode ? '#cbd5e1' : 'inherit'} !important;
          border-bottom: 1px solid ${isDarkMode ? '#334155' : '#f0f0f0'} !important; 
        }
        /* Strongly override code block backgrounds */
        .ant-table-cell code, 
        .ant-typography-code,
        [class*="ant-typography-code"] {
          background: ${isDarkMode ? '#0f172a' : '#f1f5f9'} !important;
          color: ${isDarkMode ? '#60a5fa' : 'inherit'} !important;
          border: ${isDarkMode ? '1px solid #334155' : '1px solid #e2e8f0'} !important;
        }
        .ant-table {
          background: ${isDarkMode ? '#1e293b' : 'inherit'} !important;
        }
        /* Pagination Styling */
        .ant-pagination-item, .ant-pagination-prev, .ant-pagination-next, .ant-pagination-jump-prev, .ant-pagination-jump-next {
          background: ${isDarkMode ? '#0f172a' : '#fff'} !important;
          border-color: ${isDarkMode ? '#334155' : '#d9d9d9'} !important;
        }
        .ant-pagination-item a {
          color: ${isDarkMode ? '#94a3b8' : 'inherit'} !important;
        }
        .ant-pagination-item-active {
          border-color: #2563eb !important;
        }
        .ant-pagination-item-active a {
          color: #2563eb !important;
        }
        .ant-pagination-options-quick-jumper input {
          background: ${isDarkMode ? '#0f172a' : '#fff'} !important;
          border-color: ${isDarkMode ? '#334155' : '#d9d9d9'} !important;
          color: ${isDarkMode ? '#f1f5f9' : 'inherit'} !important;
        }
        .audit-metrics-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        @media (min-width: 768px) { .audit-metrics-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (min-width: 1024px) { .audit-metrics-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
      `}} />
    </div>
  );
};

const Divider = ({ type, isDarkMode }: { type: 'vertical', isDarkMode?: boolean }) => (
  <div style={{ display: 'inline-block', width: '1px', height: '10px', background: isDarkMode ? '#334155' : '#e2e8f0', margin: '0 8px', verticalAlign: 'middle' }}>{type === 'vertical' ? '' : ''}</div>
);

export default AuditDashboard;
