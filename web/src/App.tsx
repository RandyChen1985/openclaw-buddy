import { useState, useEffect } from 'react';
import { 
  Layout, Card, Button, Input, Form, 
  Typography, Space, Badge, Tabs, 
  Statistic, Row, Col, List, Tag, message, 
  ConfigProvider
} from 'antd';
import { 
  Activity, Shield, Terminal, Settings, 
  RefreshCw, Play, Square, LogOut, CheckCircle2, 
  XCircle
} from 'lucide-react';
import axios from 'axios';
import { 
  XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, AreaChart, Area 
} from 'recharts';
import dayjs from 'dayjs';

const { Header, Content, Footer } = Layout;
const { Title, Text } = Typography;

// --- API Service ---
const API_URL = import.meta.env.VITE_API_URL || '';

const api = axios.create({
  baseURL: API_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('guardian_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// --- Components ---

const LoginPage = ({ onLoginSuccess }: { onLoginSuccess: (token: string) => void }) => {
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: { token: string }) => {
    setLoading(true);
    try {
      const res = await api.post('/login', { token: values.token });
      if (res.data.status === 'success') {
        localStorage.setItem('guardian_token', values.token);
        onLoginSuccess(values.token);
        message.success('登录成功');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || '无效的 Token');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-100 p-4">
      <Card className="w-full max-w-md shadow-lg rounded-xl">
        <div className="text-center mb-8">
          <div className="bg-blue-500 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield className="text-white w-8 h-8" />
          </div>
          <Title level={2}>Lobster Guardian</Title>
          <Text type="secondary">有孚小龙虾监控 - Web 管理面板</Text>
        </div>
        
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item 
            name="token" 
            label="管理员 Token" 
            rules={[{ required: true, message: '请输入您的 Token' }]}
          >
            <Input.Password 
              placeholder="请输入配置文件中的 GUARDIAN_TOKEN" 
              size="large"
              prefix={<Settings className="w-4 h-4 text-gray-400 mr-2" />}
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              进入面板
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

const Dashboard = () => {
  const [status, setStatus] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [wsLogs, setWsLogs] = useState<string[]>([]);
  
  // Polling for status
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statusRes, historyRes] = await Promise.all([
          api.get('/v1/openclaw/status'),
          api.get('/v1/stats/health')
        ]);
        setStatus(statusRes.data);
        setHistory(historyRes.data);
      } catch (err) {
        console.error('Fetch error', err);
      }
    };
    
    fetchData();
    const timer = setInterval(fetchData, 10000);
    return () => clearInterval(timer);
  }, []);

  // WebSocket for logs
  useEffect(() => {
    const token = localStorage.getItem('guardian_token');
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = import.meta.env.DEV ? `ws://localhost:3000/v1/ws/logs?token=${token}` : `${protocol}//${host}/v1/ws/logs?token=${token}`;
    
    const socket = new WebSocket(wsUrl);
    
    socket.onmessage = (event) => {
      setWsLogs(prev => [...prev.slice(-100), event.data]);
    };
    
    return () => socket.close();
  }, []);

  const handleControl = async (action: string) => {
    try {
      await api.post(`/v1/gateway/${action}`);
      message.loading(`正在执行 ${action}...`, 2);
    } catch (err: any) {
      message.error(`操作失败: ${err.response?.data?.error || '未知错误'}`);
    }
  };

  return (
    <Layout className="min-h-screen">
      <Header className="bg-white border-b px-4 flex items-center justify-between sticky top-0 z-50">
        <Space>
          <div className="bg-blue-500 p-1.5 rounded-lg">
            <Shield className="text-white w-5 h-5" />
          </div>
          <Title level={4} className="m-0 hidden sm:block">Lobster Guardian</Title>
        </Space>
        <Space>
          <Badge status={status?.gateway?.status === 'Running' ? 'processing' : 'error'} text={status?.gateway?.status || 'Unknown'} />
          <Button icon={<LogOut className="w-4 h-4" />} type="text" onClick={() => { localStorage.removeItem('guardian_token'); window.location.reload(); }} />
        </Space>
      </Header>
      
      <Content className="p-4 md:p-8 max-w-7xl mx-auto w-full">
        <Row gutter={[16, 16]}>
          {/* Status Cards */}
          <Col xs={24} md={8}>
            <Card className="h-full rounded-xl">
              <Statistic 
                title="网关运行时长" 
                value={status?.gateway?.runtime || '--'} 
                prefix={<Activity className="w-4 h-4 mr-2 text-blue-500" />} 
              />
              <div className="mt-4 flex items-center justify-between text-gray-500">
                <span>PID: {status?.gateway?.pid || 'N/A'}</span>
                <Tag color={status?.gateway?.status === 'Running' ? 'green' : 'red'}>{status?.gateway?.status}</Tag>
              </div>
            </Card>
          </Col>
          <Col xs={24} md={16}>
            <Card title="健康度趋势 (24H)" className="rounded-xl overflow-hidden">
              <div className="h-40 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history}>
                    <defs>
                      <linearGradient id="colorHealth" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="timestamp" hide />
                    <YAxis hide domain={[0, 100]} />
                    <Tooltip 
                      labelFormatter={(val) => dayjs(val).format('YYYY-MM-DD HH:mm')}
                      formatter={(val: any) => [val, '响应时间(ms)']}
                    />
                    <Area type="monotone" dataKey="response_time_ms" stroke="#3b82f6" fillOpacity={1} fill="url(#colorHealth)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </Col>

          {/* Controls */}
          <Col xs={24} lg={16}>
            <Card title="服务控制" className="rounded-xl mb-4">
              <Row gutter={16}>
                <Col span={8}>
                  <Button block size="large" type="primary" icon={<Play className="w-4 h-4 mr-1" />} onClick={() => handleControl('start')}>启动</Button>
                </Col>
                <Col span={8}>
                  <Button block size="large" danger icon={<Square className="w-4 h-4 mr-1" />} onClick={() => handleControl('stop')}>停止</Button>
                </Col>
                <Col span={8}>
                  <Button block size="large" icon={<RefreshCw className="w-4 h-4 mr-1" />} onClick={() => handleControl('restart')}>重启</Button>
                </Col>
              </Row>
            </Card>

            <Card className="rounded-xl overflow-hidden" bodyStyle={{ padding: 0 }}>
              <Tabs 
                defaultActiveKey="plugins"
                items={[
                  {
                    key: 'plugins',
                    label: '插件 (Plugins)',
                    children: (
                      <div className="p-4">
                        <List 
                          dataSource={status?.plugins || []}
                          renderItem={(item: any) => (
                            <List.Item extra={item.online ? <Tag color="green">ONLINE</Tag> : <Tag color="red">OFFLINE</Tag>}>
                              <Text strong>{item.name}</Text>
                            </List.Item>
                          )}
                        />
                      </div>
                    )
                  },
                  {
                    key: 'channels',
                    label: '渠道 (Channels)',
                    children: (
                      <div className="p-4">
                        <List 
                          dataSource={status?.channels || []}
                          renderItem={(item: any) => (
                            <List.Item extra={item.online ? <CheckCircle2 className="text-green-500 w-5 h-5" /> : <XCircle className="text-red-500 w-5 h-5" />}>
                              <Text strong>{item.name}</Text>
                            </List.Item>
                          )}
                        />
                      </div>
                    )
                  }
                ]}
              />
            </Card>
          </Col>

          {/* Logs */}
          <Col xs={24} lg={8}>
            <Card title="实时日志" extra={<Terminal className="w-4 h-4" />} className="rounded-xl h-full flex flex-col bg-slate-900 border-none">
              <div className="flex-1 overflow-auto h-96 font-mono text-xs text-green-400 p-2 scrollbar-hide">
                {wsLogs.length === 0 ? <Text className="text-gray-500">等待日志流...</Text> : wsLogs.map((log, i) => (
                  <div key={i} className="mb-1">{log}</div>
                ))}
              </div>
            </Card>
          </Col>
        </Row>
      </Content>
      
      <Footer className="text-center text-gray-400 py-8 bg-slate-50 border-t">
        Lobster Guardian &copy; 2026 Powered by 有孚网络
      </Footer>
    </Layout>
  );
};

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('guardian_token'));

  return (
    <ConfigProvider theme={{
      token: {
        colorPrimary: '#3b82f6',
        borderRadius: 8,
      },
    }}>
      {token ? <Dashboard /> : <LoginPage onLoginSuccess={setToken} />}
    </ConfigProvider>
  );
}
