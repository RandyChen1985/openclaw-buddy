import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldCheck, ShieldOff, Zap, Plus, Trash2, 
  Settings2, RefreshCw, FileCode, HelpCircle, Info,
  Pencil, X, ShieldAlert
} from 'lucide-react';
import { 
  Card, Button, Tag, Table, Input, Select, 
  Typography, message, Popconfirm, Empty, Modal,
  Alert, Space
} from 'antd';
import { useTranslation } from 'react-i18next';
import api from '../api';
import type { Task } from '../hooks/useTaskCenter';
import TokenBadge from '../components/TokenBadge';
import Tooltip from '../components/common/AppTooltip';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

interface SecurityManagerProps {
  isMobile?: boolean;
  isRunning?: boolean;
  onNavigateToDashboard?: () => void;
  bots: any[];
  activeTasks: Task[];
  isDarkMode?: boolean;
}

const SecurityManager: React.FC<SecurityManagerProps> = ({
  isMobile, bots, activeTasks, isDarkMode = false
}) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [newPattern, setNewPattern] = useState('');
  const [jsonModalVisible, setJsonModalVisible] = useState(false);
  const [jsonContent, setJsonContent] = useState('');
  const [versionTooLow, setVersionTooLow] = useState(false);
  
  // 正在执行异步任务的状态
  const [isOperating, setIsOperating] = useState(false);
  // 是否处于编辑模式
  const [isEditing, setIsEditing] = useState(false);

  // 帮助弹窗状态
  const [helpModal, setHelpModal] = useState<{ visible: boolean, title: string, content: string }>({
    visible: false, title: '', content: ''
  });

  const [philosophyVisible, setPhilosophyVisible] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');
  
  const fetchData = async (refresh = false) => {
    setLoading(true);
    setVersionTooLow(false);
    try {
      const res = await api.get(`/v1/openclaw/security/status${refresh ? '?refresh=true' : ''}`);
      // 适配缓存后的嵌套结构: { data: { policy, snapshot, versionTooLow }, updated_at }
      const rawData = res.data;
      const resultData = rawData.data || rawData;
      const updateTime = rawData.updated_at;

      if (resultData?.versionTooLow) {
        setVersionTooLow(true);
        setData(null);
      } else {
        setData(resultData);
        setUpdatedAt(updateTime || '');
        if (resultData?.snapshot?.file) {
            setJsonContent(JSON.stringify(resultData.snapshot.file, null, 2));
        }
      }
    } catch (err: any) {
      console.error('Security status fetch error:', err);
      message.error(t('security.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const triggerTask = async (action: string, params: any) => {
    setIsOperating(true);
    try {
      const res = await api.post('/v1/openclaw/security/task', {
        action,
        ...params
      });
      const taskId = res.data?.taskID || res.data?.taskId;
      if (taskId) {
        message.info(t('security.updateStarted'));
      } else {
        message.success(t('common.success'));
        fetchData();
        setIsOperating(false);
        setIsEditing(false);
      }
    } catch (err: any) {
      message.error(err.message || t('common.error'));
      setIsOperating(false);
    }
  };

  const handleApplyPreset = (preset: string) => {
    triggerTask('apply-preset', { target: preset });
  };

  const handleUpdatePolicy = (ask: string, security: string) => {
    triggerTask('set-policy', { ask, security });
  };

  const handleAddPattern = () => {
    if (!selectedAgent || !newPattern.trim()) return;
    triggerTask('add-allowlist', { target: selectedAgent, pattern: newPattern.trim() });
    setNewPattern('');
  };

  const handleRemovePattern = (agent: string, pattern: string) => {
    triggerTask('remove-allowlist', { target: agent, pattern });
  };

  const handleSaveJson = () => {
    try {
      const content = JSON.parse(jsonContent);
      triggerTask('set-approvals', { content: JSON.stringify(content) });
      setJsonModalVisible(false);
    } catch (e) {
      message.error('Invalid JSON format');
    }
  };

  const getEffectiveScope = () => {
    if (!data?.policy?.effectivePolicy?.scopes) return null;
    return data.policy.effectivePolicy.scopes.find((s: any) => s.scopeLabel === 'tools.exec');
  };

  const effectiveScope = getEffectiveScope();

  const processedTasksRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const newlyFinishedTasks = activeTasks.filter(task => 
      task.module === 'security' && 
      (task.status === 'Completed' || task.status === 'Failed') &&
      !processedTasksRef.current.has(task.id)
    );

    if (newlyFinishedTasks.length > 0) {
        newlyFinishedTasks.forEach(t => processedTasksRef.current.add(t.id));
        fetchData();
        setIsOperating(false);
        setIsEditing(false);
    }
  }, [activeTasks]);

  const allowlistData = (selectedAgent && data?.snapshot?.file?.agents?.[selectedAgent]?.allowlist) || [];
  const safeAllowlistData = Array.isArray(allowlistData) ? allowlistData : [];

  const isAllowlistMode = effectiveScope?.security.effective === 'allowlist';

  // 状态显示逻辑
  const getAskTag = (val: string) => {
    const tagStyle: React.CSSProperties = isMobile 
      ? { fontSize: 13, padding: '2px 10px', borderRadius: 6, fontWeight: 'bold' } 
      : { fontSize: 16, padding: '6px 16px', borderRadius: 8, fontWeight: 'bold' };
      
    switch(val) {
      case 'always': return <Tag color="orange" style={tagStyle}>{t('security.askOn')}</Tag>;
      case 'on-miss': return <Tag color="blue" style={tagStyle}>{t('security.askOnMiss')}</Tag>;
      case 'off': return <Tag color="green" style={tagStyle}>{t('security.askOff')}</Tag>;
      default: return <Tag style={{fontSize: isMobile ? 13 : 16}}>{val}</Tag>;
    }
  };

  const getSecurityTag = (val: string) => {
    const tagStyle: React.CSSProperties = isMobile 
      ? { fontSize: 13, padding: '2px 10px', borderRadius: 6, fontWeight: 'bold' } 
      : { fontSize: 16, padding: '6px 16px', borderRadius: 8, fontWeight: 'bold' };

    switch(val) {
      case 'full': return <Tag color="blue" style={tagStyle}>{t('security.securityFull')}</Tag>;
      case 'allowlist': return <Tag color="cyan" style={tagStyle}>{t('security.securityAllowlist')}</Tag>;
      case 'deny': return <Tag color="red" style={tagStyle}>{t('security.securityDeny')}</Tag>;
      default: return <Tag style={{fontSize: isMobile ? 13 : 16}}>{val}</Tag>;
    }
  };

  const showHelp = (type: 'ask' | 'security' | 'allowlist' | 'advanced') => {
    setHelpModal({
      visible: true,
      title: t(`security.${type}HelpTitle`),
      content: t(`security.${type}HelpContent`)
    });
  };

  // 两行式 Option 渲染组件
  const CustomOption = ({ emoji, label, desc }: { emoji: string, label: string, desc: string }) => (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      padding: isMobile ? '2px 0' : '4px 0',
      lineHeight: 1.4
    }}>
      <Text strong style={{ fontSize: isMobile ? 13 : 14 }}>{emoji} {label}</Text>
      <Text type="secondary" style={{ fontSize: isMobile ? 10 : 11, opacity: 0.8 }}>{desc}</Text>
    </div>
  );

  return (
    <div style={{ 
      padding: isMobile ? '0 16px' : '0 24px', 
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: isMobile ? 16 : 24,
      position: 'relative'
    }}>
      {/* 允许在网关停止时配置安全审核策略 */}
      <div style={{ marginBottom: isMobile ? 8 : 16 }}>
        <Title level={isMobile ? 3 : 2} style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, flexWrap: 'wrap', color: isDarkMode ? '#f1f5f9' : 'inherit' }}>
          <ShieldCheck size={isMobile ? 22 : 28} color="#2563eb" />
          {t('security.title')}
          <Button 
            type="link" 
            icon={<Info size={14} />} 
            onClick={() => setPhilosophyVisible(true)}
            style={{ padding: 0, marginLeft: isMobile ? 4 : 8, fontSize: isMobile ? 12 : 14 }}
          >
            {t('security.learnMore')}
          </Button>
          <Button 
            size="small" 
            type="text" 
            icon={<RefreshCw size={12} />} 
            onClick={() => fetchData(true)} 
            loading={loading}
            style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', marginLeft: 4, height: 'auto', padding: '0 4px' }}
          >
            <span style={{ fontSize: 11, fontWeight: 400 }}>{t('common.refresh')}</span>
          </Button>
          {updatedAt && (
            <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400, marginLeft: 8 }}>
              {t('common.syncedAt', { defaultValue: '同步于' })}: {new Date(updatedAt).toLocaleTimeString()}
            </span>
          )}
        </Title>
        <Text type="secondary" style={{ fontSize: isMobile ? 12 : 14, opacity: 0.8 }}>{t('security.description')}</Text>
      </div>

      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', 
        gap: 24,
        flex: 1
      }}>
        <Card 
          title={<div style={{ display: 'flex', alignItems: 'center', gap: 8, color: isDarkMode ? '#f1f5f9' : 'inherit' }}><Zap size={18} /> {t('security.policyCardTitle')}</div>}
          extra={
            <Space>
              {effectiveScope && (
                !isEditing ? (
                  <Button size="small" icon={<Pencil size={14} />} onClick={() => setIsEditing(true)} disabled={loading || isOperating}>
                    {isMobile ? t('common.edit') : `${t('common.edit')}配置`}
                  </Button>
                ) : (
                  <Button size="small" icon={<X size={14} />} onClick={() => setIsEditing(false)} danger>
                    {isMobile ? "退出" : "退出编辑"}
                  </Button>
                )
              )}
              {!isMobile && effectiveScope && <Tag color="blue" style={{ marginLeft: 8 }}>{t('security.effectivePolicy')}</Tag>}
            </Space>
          }
          loading={loading}
          style={{ background: isDarkMode ? '#1e293b' : '#fff', border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`, borderRadius: 16 }}
          styles={{ body: { height: '100%', display: 'flex', flexDirection: 'column', padding: isMobile ? '16px' : '32px' } }}
        >
          {effectiveScope ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%' }}>
              {/* ... existing scope UI ... */}
              <div style={{ 
                display: 'flex', 
                flexDirection: 'row',
                justifyContent: 'space-around', 
                background: isDarkMode ? '#0f172a' : '#f8fafc', 
                padding: isMobile ? '16px 8px' : '32px 24px', 
                borderRadius: 16, 
                border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
                gap: isMobile ? 8 : 0
              }}>
                <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
                  <Space style={{ marginBottom: isMobile ? 4 : 8 }}>
                    <Text type="secondary" style={{ fontSize: isMobile ? 11 : 12, color: isDarkMode ? '#94a3b8' : 'inherit' }}>{t('security.askLabel')}</Text>
                    <Tooltip title={isMobile ? "" : t('security.clickForHelp')}>
                      <HelpCircle size={isMobile ? 12 : 14} style={{ cursor: 'pointer', color: '#94a3b8' }} onClick={() => showHelp('ask')} />
                    </Tooltip>
                  </Space>
                  <div style={{ marginTop: 4, display: 'flex', justifyContent: 'center', width: '100%' }}>
                    {!isEditing ? getAskTag(effectiveScope.ask.effective) : (
                      <Select 
                        value={effectiveScope.ask.effective} 
                        onChange={(val) => handleUpdatePolicy(val, effectiveScope.security.effective)}
                        disabled={isOperating}
                        loading={isOperating}
                        dropdownMatchSelectWidth={false}
                        listHeight={300}
                        style={{ width: '100%', minWidth: isMobile ? 'auto' : 180, height: 'auto' }}
                      >
                        <Option value="always">
                          <CustomOption emoji="🛡️" label={t('security.askOn')} desc={t('security.askAlwaysDesc')} />
                        </Option>
                        <Option value="on-miss">
                          <CustomOption emoji="⚖️" label={t('security.askOnMiss')} desc={t('security.askOnMissDesc')} />
                        </Option>
                        <Option value="off">
                          <CustomOption emoji="🚀" label={t('security.askOff')} desc={t('security.askOffDesc')} />
                        </Option>
                      </Select>
                    )}
                  </div>
                </div>
                <div style={{ 
                  height: isMobile ? 32 : 64, 
                  width: 1, 
                  background: isDarkMode ? '#334155' : '#e2e8f0', 
                  margin: isMobile ? '0 8px' : '0 24px',
                  alignSelf: 'center',
                  flexShrink: 0
                }} />
                <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
                  <Space style={{ marginBottom: isMobile ? 4 : 12 }}>
                    <Text type="secondary" style={{ fontSize: isMobile ? 11 : 12, color: isDarkMode ? '#94a3b8' : 'inherit' }}>{t('security.securityLabel')}</Text>
                    <Tooltip title={isMobile ? "" : t('security.clickForHelp')}>
                      <HelpCircle size={isMobile ? 12 : 14} style={{ cursor: 'pointer', color: '#94a3b8' }} onClick={() => showHelp('security')} />
                    </Tooltip>
                  </Space>
                  <div style={{ marginTop: 4, display: 'flex', justifyContent: 'center', width: '100%' }}>
                    {!isEditing ? getSecurityTag(effectiveScope.security.effective) : (
                      <Select 
                        value={effectiveScope.security.effective} 
                        onChange={(val) => handleUpdatePolicy(effectiveScope.ask.effective, val)}
                        disabled={isOperating}
                        loading={isOperating}
                        dropdownMatchSelectWidth={false}
                        listHeight={300}
                        style={{ width: '100%', minWidth: isMobile ? 'auto' : 180, height: 'auto' }}
                      >
                        <Option value="full">
                          <CustomOption emoji="🔒" label={t('security.securityFull')} desc={t('security.securityFullDesc')} />
                        </Option>
                        <Option value="allowlist">
                          <CustomOption emoji="📜" label={t('security.securityAllowlist')} desc={t('security.securityAllowlistDesc')} />
                        </Option>
                        <Option value="deny">
                          <CustomOption emoji="🚫" label={t('security.securityDeny')} desc={t('security.securityDenyDesc')} />
                        </Option>
                      </Select>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ flex: 1 }}>
                <Text strong style={{ display: 'block', marginBottom: 16, fontSize: 15, color: isDarkMode ? '#f1f5f9' : 'inherit' }}>{t('security.presetTitle')}</Text>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <Button 
                    block type="primary" loading={isOperating} disabled={isOperating}
                    onClick={() => handleApplyPreset('yolo')}
                    style={{ 
                      height: 'auto', padding: isMobile ? '12px 16px' : '20px 40px', textAlign: 'left',
                      background: isOperating ? '#94a3b8' : '#22c55e', border: 'none', borderRadius: 12,
                      boxShadow: isOperating ? 'none' : '0 4px 12px rgba(34, 197, 94, 0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 16
                    }}
                  >
                    <Rocket size={24} color="#fff" style={{ opacity: 0.9, flexShrink: 0 }} />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <Text style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>YOLO</Text>
                      <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>{t('security.presetYoloDesc')}</Text>
                    </div>
                  </Button>
                  
                  <Button 
                    block loading={isOperating} disabled={isOperating} onClick={() => handleApplyPreset('cautious')}
                    style={{ 
                      height: 'auto', padding: isMobile ? '12px 16px' : '20px 40px', textAlign: 'left',
                      background: isOperating ? '#94a3b8' : '#f59e0b', border: 'none', borderRadius: 12,
                      boxShadow: isOperating ? 'none' : '0 4px 12px rgba(245, 158, 11, 0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 16
                    }}
                  >
                    <ShieldAlert size={24} color="#fff" style={{ opacity: 0.9, flexShrink: 0 }} />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <Text style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>Cautious</Text>
                      <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>{t('security.presetCautiousDesc')}</Text>
                    </div>
                  </Button>
                  
                  <Button 
                    block danger type="primary" loading={isOperating} disabled={isOperating} 
                    onClick={() => handleApplyPreset('deny-all')}
                    style={{ 
                      height: 'auto', padding: isMobile ? '12px 16px' : '20px 40px', textAlign: 'left',
                      background: isOperating ? '#94a3b8' : '#ef4444', border: 'none', borderRadius: 12,
                      boxShadow: isOperating ? 'none' : '0 4px 12px rgba(239, 68, 68, 0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 16
                    }}
                  >
                    <ShieldOff size={24} color="#fff" style={{ opacity: 0.9, flexShrink: 0 }} />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <Text style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>Deny All</Text>
                      <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>{t('security.presetDenyAllDesc')}</Text>
                    </div>
                  </Button>
                </div>
              </div>
            </div>
          ) : versionTooLow ? (
            <div style={{ 
              height: '100%', 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: 16,
              padding: '40px 20px',
              background: isDarkMode ? '#0f172a' : 'rgba(240, 242, 245, 0.5)',
              borderRadius: 12,
              border: `1px dashed ${isDarkMode ? '#334155' : '#d9d9d9'}`
            }}>
               <ShieldAlert size={48} color="#ef4444" style={{ opacity: 0.8 }} />
               <Text strong style={{ fontSize: 18, color: isDarkMode ? '#f1f5f9' : 'inherit' }}>当前版本过低 (Version Upgrade Required)</Text>
               <div style={{ textAlign: 'center', maxWidth: 400 }}>
                 <Text type="secondary" style={{ fontSize: 14, color: isDarkMode ? '#94a3b8' : 'inherit' }}>
                   当前 OpenClaw 核心版本暂不支持执行策略（Exec Policy）管理。为了保障您的操作安全并启用此功能，请在终端执行以下命令进行升级：
                 </Text>
                 <div style={{ 
                   background: isDarkMode ? '#0f172a' : '#1e293b', 
                   color: '#f8fafc', 
                   padding: '12px 20px', 
                   borderRadius: 8, 
                   marginTop: 16,
                   fontFamily: 'monospace',
                   fontSize: 14,
                   position: 'relative',
                   textAlign: 'left',
                   border: isDarkMode ? '1px solid #334155' : 'none'
                 }}>
                   <span style={{ color: '#94a3b8' }}>$</span> openclaw upgrade
                 </div>
               </div>
            </div>
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        </Card>

        <Card 
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: isDarkMode ? '#f1f5f9' : 'inherit' }}>
              <Settings2 size={18} /> 
              {t('security.allowlistTitle')}
              <Tooltip title={isMobile ? "" : t('security.clickForHelp')}>
                <HelpCircle size={14} style={{ cursor: 'pointer', color: '#94a3b8', marginLeft: 4 }} onClick={() => showHelp('allowlist')} />
              </Tooltip>
            </div>
          }
          loading={loading}
          style={{ background: isDarkMode ? '#1e293b' : '#fff', border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`, borderRadius: 16 }}
          styles={{ body: { height: '100%', display: 'flex', flexDirection: 'column', padding: isMobile ? '16px' : '32px' } }}
        >
          <div style={{ marginBottom: 16 }}>
            <Tooltip title={(isMobile || !isAllowlistMode) ? "" : t('security.allowlistDisabledTip', { defaultValue: '当前安全模式下不使用白名单，编辑已禁用' })}>
              <Select 
                showSearch style={{ width: '100%' }} size="large" disabled={!isAllowlistMode || isOperating}
                placeholder={t('security.agentSelectorPlaceholder')} optionFilterProp="children"
                onChange={(v) => setSelectedAgent(v)} value={selectedAgent}
              >
                <Option value="*">* (All Agents)</Option>
                {bots.map(bot => (
                  <Option key={bot.id} value={bot.id}>
                    {bot.emoji} {bot.name} <Text type="secondary" style={{ fontSize: 12 }}>({bot.id})</Text>
                  </Option>
                ))}
              </Select>
            </Tooltip>
          </div>

          {selectedAgent ? (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, opacity: isAllowlistMode ? 1 : 0.6 }}>
              {!isAllowlistMode && (
                <Alert 
                  message={t('security.allowlistDisabledTitle', { defaultValue: '白名单编辑已禁用' })}
                  description={t('security.allowlistDisabledDesc', { defaultValue: 'OpenClaw 当前运行在非白名单模式下。若要自定义指令权限，请先将执行策略切换至 Cautious 或手动设置为 Allowlist。' })}
                  type="info" showIcon style={{ marginBottom: 16 }}
                />
              )}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <Tooltip title={(isMobile || !isAllowlistMode) ? "" : t('security.allowlistAddDisabledTip', { defaultValue: '请先开启白名单模式以添加规则' })}>
                  <div style={{ flex: 1, display: 'flex', gap: 8 }}>
                    <Input 
                      size="large" disabled={!isAllowlistMode || isOperating} placeholder={t('security.patternPlaceholder')} 
                      value={newPattern} onChange={e => setNewPattern(e.target.value)} onPressEnter={handleAddPattern}
                    />
                    <Button 
                      type="primary" size="large" loading={isOperating} disabled={!isAllowlistMode || isOperating} 
                      icon={<Plus size={18} />} onClick={handleAddPattern} 
                    />
                  </div>
                </Tooltip>
              </div>

              <Table 
                dataSource={safeAllowlistData.map((p: any, i: number) => ({ key: i, pattern: typeof p === 'string' ? p : (p?.pattern || '') }))}
                columns={[
                  { title: 'Pattern', dataIndex: 'pattern', key: 'pattern', render: (text) => <code style={{ background: isDarkMode ? '#0f172a' : '#f1f5f9', color: isDarkMode ? '#e2e8f0' : undefined, border: isDarkMode ? '1px solid #334155' : undefined, padding: '2px 6px', borderRadius: 4 }}>{text}</code> },
                  { 
                    title: t('common.action'), key: 'action', width: 80, align: 'center',
                    render: (_, record: { key: number, pattern: string }) => (
                      <Popconfirm 
                        title={t('common.confirm')} disabled={!isAllowlistMode || isOperating}
                        onConfirm={() => handleRemovePattern(selectedAgent, record.pattern)}
                      >
                        <Button type="text" danger icon={<Trash2 size={16} />} disabled={!isAllowlistMode || isOperating} />
                      </Popconfirm>
                    )
                  }
                ]}
                size="middle" pagination={{ pageSize: 8 }} locale={{ emptyText: t('security.noPatterns') }} style={{ flex: 1 }}
              />
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Empty description={t('security.agentSelectorPlaceholder')} />
            </div>
          )}
        </Card>
      </div>

      <Card 
        size="small"
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileCode size={16} /> 
            {t('security.advancedTitle')}
            <Tooltip title={t('security.clickForHelp')}>
              <HelpCircle size={14} style={{ cursor: 'pointer', color: '#94a3b8', marginLeft: 4 }} onClick={() => showHelp('advanced')} />
            </Tooltip>
          </div>
        }
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>{t('security.editApprovals')}</Text>
          {data?.snapshot && (
            <Button size="small" icon={<FileCode size={14} />} disabled={isOperating} onClick={() => setJsonModalVisible(true)}>
              {t('common.edit')} JSON
            </Button>
          )}
        </div>
      </Card>

      <Modal
        title={helpModal.title}
        open={helpModal.visible}
        onOk={() => setHelpModal(prev => ({ ...prev, visible: false }))}
        onCancel={() => setHelpModal(prev => ({ ...prev, visible: false }))}
        footer={[<Button key="ok" type="primary" onClick={() => setHelpModal(prev => ({ ...prev, visible: false }))}>{t('common.gotIt', { defaultValue: '知道了' })}</Button>]}
      >
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', fontSize: 14 }}>
          {helpModal.content}
        </div>
      </Modal>

      <Modal
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ShieldCheck size={20} color="#2563eb" /> {t('security.philosophyTitle')}</div>}
        open={philosophyVisible}
        onOk={() => setPhilosophyVisible(false)}
        onCancel={() => setPhilosophyVisible(false)}
        width={600}
        footer={[<Button key="ok" type="primary" onClick={() => setPhilosophyVisible(false)}>{t('common.gotIt', { defaultValue: '知道了' })}</Button>]}
      >
        <div style={{ padding: '8px 0' }}>
          <Paragraph style={{ fontSize: 15, lineHeight: '1.8' }}>
            <div dangerouslySetInnerHTML={{ __html: t('security.philosophyContent').replace(/\n/g, '<br/>') }} />
          </Paragraph>
        </div>
      </Modal>

      <Modal
        title={`${t('security.advancedTitle')} - JSON`}
        open={jsonModalVisible}
        onOk={handleSaveJson}
        onCancel={() => setJsonModalVisible(false)}
        width={800}
        okText={t('common.save')}
      >
        <Paragraph type="warning">
          <Alert message={t('security.saveConfirm')} type="warning" showIcon />
        </Paragraph>
        <div style={{ position: 'relative' }}>
          <TokenBadge text={jsonContent} />
          <Input.TextArea 
            value={jsonContent}
            onChange={e => setJsonContent(e.target.value)}
            rows={20}
            style={{ fontFamily: 'monospace', fontSize: 13 }}
          />
        </div>
      </Modal>
    </div>
  );
};

const Rocket = ({ size, color, style }: { size: number, color?: string, style?: React.CSSProperties }) => (
  <svg 
    width={size} height={size} viewBox="0 0 24 24" fill="none" 
    stroke={color || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" 
    style={style}
  >
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
    <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
    <path d="M9 12H4s.55-3.03 2-5c1.62-2.2 5-3 5-3"/>
    <path d="M12 15v5s3.03-.55 5-2c2.2-1.62 3-5 3-5"/>
  </svg>
);

export default SecurityManager;
