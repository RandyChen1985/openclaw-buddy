import React, { useState, useEffect } from 'react';
import { RefreshCw, Search, CheckCircle2, AlertCircle, Puzzle, Trash2, HelpCircle, ExternalLink } from 'lucide-react';
import SkillFileExplorer from '../components/SkillFileExplorer';
import { Card, Table, Tag, Button, Input, message, Tooltip, Segmented, Modal, Steps, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import api from '../api';

interface Skill {
  name: string;
  description: string;
  emoji?: string;
  eligible: boolean;
  disabled: boolean;
  source: string;
  bundled: boolean;
  missing?: {
    bins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
  path?: string;
}

interface SkillManagementProps {
  isMobile?: boolean;
  onRefresh?: (force?: boolean, isSilent?: boolean) => Promise<void>;
  loading?: boolean;
  skills?: any[];
  activeTasks?: any[];
  isRunning?: boolean;
  onNavigateToDashboard?: () => void;
  isDarkMode?: boolean;
}

const SkillManagement: React.FC<SkillManagementProps> = ({ 
  isMobile, onRefresh, loading: globalLoading, skills: globalSkills, 
  activeTasks = [], isDarkMode = false
}) => {
  const { t } = useTranslation();
  const [localSkills, setLocalSkills] = useState<Skill[]>([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | number>('ready');
  const [typeFilter, setTypeFilter] = useState<string | number>('all');
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [processingNames, setProcessingNames] = useState<Set<string>>(new Set());
  const processingRef = React.useRef(new Set<string>());
  const lastActionTimeRef = React.useRef<Record<string, number>>({});

  const loading = globalLoading !== undefined ? globalLoading : localLoading;
  const skills = globalSkills !== undefined ? globalSkills : localSkills;
  const dividerSubtle = isDarkMode ? '#334155' : '#f1f5f9';
  const pageHeading = isDarkMode ? '#f1f5f9' : '#1e293b';
  const pageMuted = isDarkMode ? '#94a3b8' : '#64748b';

  // 必须导入遮罩组件
  // (我在 import 处会补上)

  // 检查是否有相同的任务正在进行中
  const hasActiveTask = (name: string, action?: string) => {
    return activeTasks.some(task => 
      task.module === 'skills' && 
      task.target === name && 
      (action ? task.action === action : true) &&
      task.status === 'Running'
    );
  };

  // 当全局 skills 变化时，清空处理中的锁
  const lastUpdateRef = React.useRef(updatedAt);
  useEffect(() => {
    // 严格锁定：只有当同步时间戳真正发生变化时，才释放锁定
    if (updatedAt && updatedAt !== lastUpdateRef.current) {
      setProcessingNames(new Set());
      processingRef.current.clear();
      lastUpdateRef.current = updatedAt;
    }
  }, [globalSkills, updatedAt]);

  const fetchSkills = async (force = false) => {
    // 如果存在父级分发的 onRefresh，优先使用 (同步阻塞)
    if (onRefresh) {
      await onRefresh(force, false);
      return;
    }
    
    setLocalLoading(true);
    try {
      if (force) {
          // 这个接口现在是同步返回的，物理阻塞直到重载完成
          await api.post('/v1/openclaw/skills/reload');
      }
      const res = await api.get(`/v1/openclaw/skills${force ? '?refresh=true' : ''}`);
      const rawData = res.data;
      
      let skillsList: Skill[] = [];
      if (rawData.data) {
          skillsList = Array.isArray(rawData.data.skills) ? rawData.data.skills : [];
          const updateTime = rawData.data.updated_at || rawData.data.updatedAt || rawData.updated_at;
          setUpdatedAt(updateTime ? dayjs(updateTime).format('YYYY-MM-DD HH:mm:ss') : '');
      } else {
          skillsList = Array.isArray(rawData.skills) ? rawData.skills : [];
      }
      
      setLocalSkills(skillsList);
      if (force) message.success(t('skills.syncSuccess'));
    } catch (err) {
      message.error(t('skills.fetchFailed'));
    } finally {
      setLocalLoading(false);
    }
  };

  useEffect(() => {
    if (!onRefresh) {
      fetchSkills();
    }
  }, []);

  const filteredSkills = skills.filter(skill => {
    const matchesSearch = skill.name.toLowerCase().includes(searchText.toLowerCase()) || 
                         skill.description.toLowerCase().includes(searchText.toLowerCase());
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'ready' && skill.eligible);
    const matchesType = typeFilter === 'all' || (typeFilter === 'builtin' && skill.bundled) || (typeFilter === 'external' && !skill.bundled);
    return matchesSearch && matchesStatus && matchesType;
  });

  const handleUninstall = (name: string, e?: React.BaseSyntheticEvent) => {
    // 1. [物理拦截] 立即停止传播
    if (e) e.stopPropagation();

    const now = Date.now();
    const lastTime = lastActionTimeRef.current[name] || 0;
    
    // 2. [同步哨兵] 秒级拦截，防止穿透，并检查全局任务
    if (processingRef.current.has(name) || now - lastTime < 1000 || hasActiveTask(name, 'uninstall')) {
      message.warning(t('common.taskAlreadyRunning'));
      return;
    }

    Modal.confirm({
      title: t('skills.uninstallConfirmTitle'),
      content: t('skills.uninstallConfirmContent', { name }),
      okText: t('skills.confirmUninstall'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true, loading: processingNames.has(name) || hasActiveTask(name, 'uninstall') },
      centered: true,
      onCancel: () => {
        // 用户取消，解锁
        processingRef.current.delete(name);
        setProcessingNames(new Set(processingRef.current));
      },
      onOk: async () => {
        // 确认瞬间再次加锁
        if (processingRef.current.has(name) || hasActiveTask(name, 'uninstall')) return;
        
        lastActionTimeRef.current[name] = Date.now();
        processingRef.current.add(name);
        setProcessingNames(new Set(processingRef.current));

        try {
          // 物理接入异步任务机制
          const res = await api.delete(`/v1/openclaw/skills/${name}`);
          const tid = res.data?.taskID ?? res.data?.taskId;
          if (tid) {
            message.info(t('chat.waitingGatewaySync'));
          } else {
            message.success(t('skills.uninstallSuccess', { name }));
            if (onRefresh) onRefresh(true);
          }
        } catch (err: any) {
          message.error(err.response?.data?.error || t('skills.uninstallFailed'));
          processingRef.current.delete(name);
          setProcessingNames(new Set(processingRef.current));
        }
      }
    });
  };

  const [explorerOpen, setExplorerOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  const columns = [
    {
      title: t('skills.skillName'),
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Skill) => (
        <div 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 10, 
            cursor: record.path ? 'pointer' : 'default',
            transition: 'all 0.2s'
          }}
          className={record.path ? 'skill-name-clickable' : ''}
          onClick={() => {
            if (record.path) {
              setSelectedSkill(record);
              setExplorerOpen(true);
            }
          }}
        >
          <span style={{ fontSize: 20 }}>{record.emoji || '🧩'}</span>
          <div>
            <div style={{ 
              fontWeight: 600, 
              color: record.path ? '#2563eb' : '#1e293b',
              textDecoration: record.path ? 'underline transparent' : 'none',
              transition: 'all 0.2s'
            }} className="skill-title-text">{text}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{record.source}</div>
          </div>
        </div>
      ),
    },
    {
      title: t('skills.status'),
      key: 'eligible',
      width: 120,
      render: (record: Skill) => (
        record.eligible ? (
          <Tag color="success" icon={<CheckCircle2 size={12} style={{ marginRight: 4 }} />} style={{ borderRadius: 6, padding: '2px 8px' }}>{t('skills.ready')}</Tag>
        ) : (
          <Tooltip title={
            record.missing ? (
              <div>
                {record.missing.bins.length > 0 && <div>{t('skills.missingBins')}: {record.missing.bins.join(', ')}</div>}
                {record.missing.env.length > 0 && <div>{t('skills.missingEnv')}: {record.missing.env.join(', ')}</div>}
                {record.missing.config.length > 0 && <div>{t('skills.missingConfig')}: {record.missing.config.join(', ')}</div>}
              </div>
            ) : t('skills.environmentNotMet')
          }>
            <Tag color="warning" icon={<AlertCircle size={12} style={{ marginRight: 4 }} />} style={{ borderRadius: 6, padding: '2px 8px', cursor: 'help' }}>{t('skills.needsConfig')}</Tag>
          </Tooltip>
        )
      ),
    },
    {
      title: t('skills.functionDesc'),
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text: string) => (
        <Tooltip title={text}>
          <span style={{ color: '#64748b', fontSize: 13 }}>{text}</span>
        </Tooltip>
      ),
    },
    {
      title: t('skills.type'),
      key: 'bundled',
      width: 100,
      render: (record: Skill) => (
        <Tag style={{ borderRadius: 4 }}>{record.bundled ? t('skills.builtin') : t('skills.external')}</Tag>
      )
    },
    {
      title: t('skills.path'),
      dataIndex: 'path',
      key: 'path',
      ellipsis: true,
      render: (text: string) => (
        <Tooltip title={text}>
          <span style={{ color: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}>{text || '-'}</span>
        </Tooltip>
      ),
    },
    {
      title: t('skills.actions'),
      key: 'action',
      width: 80,
      render: (_: any, record: Skill) => {
        const isProcessing = processingNames.has(record.name) || hasActiveTask(record.name, 'uninstall');
        return !record.bundled && (
          <Tooltip title={isProcessing ? t('common.processing') : ''}>
            <Button 
              type="text" 
              danger 
              size="small" 
              icon={<Trash2 size={14} />} 
              onClick={(e) => handleUninstall(record.name, e)}
              disabled={isProcessing}
              style={{ borderRadius: 6, cursor: isProcessing ? 'not-allowed' : 'pointer' }}
            />
          </Tooltip>
        );
      }
    }
  ];

  return (
    <div style={{ height: '100%', minHeight: 'calc(100vh - 100px)', width: '100%', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* 允许在网关停止时同步与管理 Skills */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '0' : '8px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card 
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 12 }}>
            <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: pageHeading, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Puzzle size={isMobile ? 18 : 20} color="#2563eb" /> {isMobile ? t('skills.title') : t('skills.fullTitle')}
            </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12 }}>
                {updatedAt && (
                  <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>
                    {isMobile ? updatedAt.split(' ')[1] : `${t('skills.syncedAt')}: ${updatedAt}`}
                  </span>
                )}
                <Button 
                  type="text" 
                  size="small" 
                  icon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />} 
                  onClick={() => fetchSkills(true)}
                  loading={loading}
                  style={{ color: '#64748b', display: 'flex', alignItems: 'center', padding: isMobile ? '0 4px' : '0 8px' }}
                >
                  {isMobile ? '' : t('common.refresh')}
                </Button>
                <Button 
                  type="text" 
                  size="small" 
                  icon={<HelpCircle size={16} />} 
                  onClick={() => setIsHelpModalOpen(true)}
                  style={{ color: '#60a5fa', background: isDarkMode ? 'rgba(37,99,235,0.2)' : '#eff6ff', borderRadius: 8, display: 'flex', alignItems: 'center', border: isDarkMode ? '1px solid #334155' : undefined }}
                />
              </div>
          </div>
        }
        bodyStyle={{ padding: 0 }} 
        style={{ borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.02)', border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`, background: isDarkMode ? '#1e293b' : '#fff', overflow: 'hidden' }}
        >
        <div style={{ padding: isMobile ? '10px 16px' : '12px 24px', borderBottom: `1px solid ${isDarkMode ? '#334155' : '#f1f5f9'}`, color: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 12 }}>          {t('skills.description')}
        </div>
        <div style={{ 
            padding: isMobile ? '12px 16px' : '16px 24px', 
            borderBottom: `1px solid ${dividerSubtle}`, 
            display: 'flex', 
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'flex-start' : 'center', 
            gap: 12 
        }} className={isDarkMode ? 'skill-mgmt-toolbar' : undefined}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: isMobile ? '100%' : 'auto', flex: 1 }}>
            <Input 
              prefix={<Search size={16} color="#94a3b8" />} 
              placeholder={t('skills.search')} 
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={{ flex: 1, borderRadius: 8, background: isDarkMode ? '#0f172a' : undefined, borderColor: isDarkMode ? '#334155' : undefined, color: isDarkMode ? '#f1f5f9' : undefined }}
              allowClear
            />
            {!isMobile && (
                <div style={{ 
                    fontSize: 12, color: isDarkMode ? '#93c5fd' : '#2563eb', background: isDarkMode ? 'rgba(37,99,235,0.15)' : '#eff6ff', 
                    padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap', border: isDarkMode ? '1px solid #334155' : undefined
                }}>
                    {t('skills.count', { count: filteredSkills.length })}
                </div>
            )}
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'space-between' : 'flex-end', flexWrap: 'wrap' }}>
            <Segmented
              className={isDarkMode ? 'skill-mgmt-seg' : undefined}
              options={[
                { label: t('skills.all'), value: 'all' },
                { label: t('skills.builtin'), value: 'builtin' },
                { label: t('skills.external'), value: 'external' }
              ]}
              value={typeFilter}
              onChange={(value) => setTypeFilter(value)}
              style={{ background: isDarkMode ? '#0f172a' : '#f1f5f9', borderRadius: 8, padding: 2, border: isDarkMode ? '1px solid #334155' : undefined }}
            />
            <Segmented
              className={isDarkMode ? 'skill-mgmt-seg' : undefined}
              options={[
                { label: t('skills.ready'), value: 'ready' },
                { label: t('skills.all'), value: 'all' }
              ]}
              value={statusFilter}
              onChange={(value) => setStatusFilter(value)}
              style={{ background: isDarkMode ? '#0f172a' : '#f1f5f9', borderRadius: 8, padding: 2, border: isDarkMode ? '1px solid #334155' : undefined }}
            />
            {isMobile && (
                <div style={{ 
                    fontSize: 11, color: isDarkMode ? '#93c5fd' : '#2563eb', background: isDarkMode ? 'rgba(37,99,235,0.15)' : '#eff6ff', 
                    padding: '2px 8px', borderRadius: 20, border: isDarkMode ? '1px solid #334155' : undefined
                }}>
                    {t('skills.count', { count: filteredSkills.length })}
                </div>
            )}
          </div>
        </div>
        
        {isMobile ? (
          <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '0 4px' }}>
            {filteredSkills.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>{t('skills.noSkills')}</div>
            ) : (
                filteredSkills.map(skill => (
                    <div key={skill.name} style={{ 
                        padding: 16, borderBottom: `1px solid ${dividerSubtle}`, 
                        display: 'flex', flexDirection: 'column', gap: 8 
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                <span style={{ fontSize: 20 }}>{skill.emoji || '🧩'}</span>
                                <span style={{ fontWeight: 600, color: pageHeading }}>{skill.name}</span>
                            </div>
                            {!skill.bundled && (
                                <Tooltip title={processingNames.has(skill.name) || hasActiveTask(skill.name, 'uninstall') ? t('common.processing') : ''}>
                                    <Button 
                                        type="text" 
                                        danger 
                                        size="small" 
                                        icon={<Trash2 size={16} />} 
                                        onClick={(e) => handleUninstall(skill.name, e)}
                                        disabled={processingNames.has(skill.name) || hasActiveTask(skill.name, 'uninstall')}
                                        style={{ padding: 0, height: 24, cursor: (processingNames.has(skill.name) || hasActiveTask(skill.name, 'uninstall')) ? 'not-allowed' : 'pointer' }}
                                    />
                                </Tooltip>
                            )}
                            {skill.eligible ? (
                                <Tag color="success" style={{ margin: 0, borderRadius: 4 }}>{t('skills.ready')}</Tag>
                            ) : (
                                <Tag color="warning" style={{ margin: 0, borderRadius: 4 }}>{t('skills.needsConfig')}</Tag>
                            ) }
                        </div>
                        <div style={{ fontSize: 13, color: pageMuted, lineHeight: 1.5 }}>{skill.description}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{t('skills.source')}: {skill.source}</div>
                        {skill.path && <div style={{ fontSize: 10, color: '#cbd5e1', fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 4 }}>{skill.path}</div>}
                    </div>
                ))
            )}
          </div>
        ) : (
            <Table 
                columns={columns} 
                dataSource={filteredSkills} 
                rowKey="name"
                loading={loading}
                pagination={{ pageSize: 12, hideOnSinglePage: true }}
                locale={{ emptyText: t('skills.noSkills') }}
                style={{ padding: '8px' }}
            />
        )}
      </Card>
      
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ padding: 8, background: isDarkMode ? 'rgba(79, 70, 229, 0.22)' : '#eff6ff', borderRadius: 10, color: isDarkMode ? '#a5b4fc' : '#2563eb', border: isDarkMode ? '1px solid #334155' : undefined }}><HelpCircle size={20} /></div>
            <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: isDarkMode ? '#f1f5f9' : undefined }}>{t('skills.help.title')}</div>
                <div style={{ fontSize: 12, color: isDarkMode ? '#94a3b8' : '#64748b', fontWeight: 400 }}>{t('skills.help.subtitle')}</div>
            </div>
          </div>
        }
        open={isHelpModalOpen}
        onCancel={() => setIsHelpModalOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setIsHelpModalOpen(false)} style={{ borderRadius: 8 }}>{t('common.confirm')}</Button>
        ]}
        width={580}
        bodyStyle={{ padding: '24px 24px 10px', background: isDarkMode ? '#0f172a' : undefined }}
        styles={isDarkMode ? { content: { background: '#0f172a' }, header: { background: '#1e293b', borderBottom: '1px solid #334155' } } : undefined}
        style={{ borderRadius: 20, overflow: 'hidden' }}
        maskStyle={{ backdropFilter: 'blur(10px)', background: isDarkMode ? 'rgba(15, 23, 42, 0.72)' : 'rgba(255,255,255,0.4)' }}
      >
        <div style={{ marginBottom: 24, padding: 16, background: isDarkMode ? '#1e293b' : '#f8fafc', borderRadius: 12, border: isDarkMode ? '1px solid #334155' : '1px solid #f1f5f9' }}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                {t('skills.help.description')}
            </Typography.Text>
        </div>
        
        <Steps
          direction="vertical"
          size="small"
          current={-1}
          items={[
            {
              title: <span style={{ fontWeight: 700 }}>{t('skills.help.step1')}</span>,
              description: (
                <Button 
                    type="link" 
                    href="https://skills.sh/" 
                    target="_blank" 
                    icon={<ExternalLink size={14} />}
                    style={{ padding: 0, height: 'auto', fontSize: 12 }}
                >
                    立即前往 skills.sh
                </Button>
              )
            },
            {
              title: <span style={{ fontWeight: 600 }}>{t('skills.help.step2')}</span>
            },
            {
              title: <span style={{ fontWeight: 600 }}>{t('skills.help.step3')}</span>,
              description: <Typography.Text code>openclaw skill install [skill-id]</Typography.Text>
            },
            {
              title: <span style={{ fontWeight: 600 }}>{t('skills.help.step4')}</span>
            },
            {
              title: <span style={{ fontWeight: 600 }}>{t('skills.help.step5')}</span>
            }
          ]}
        />
      </Modal>
      </div>

      {selectedSkill && (
        <SkillFileExplorer
          open={explorerOpen}
          onClose={() => setExplorerOpen(false)}
          rootPath={selectedSkill.path || ''}
          skillName={selectedSkill.name}
          t={t}
          isMobile={!!isMobile}
          isDarkMode={isDarkMode}
        />
      )}

      <style>{`
        .skill-name-clickable:hover .skill-title-text {
          color: #1d4ed8 !important;
          text-decoration: underline !important;
        }
        .hover-bg-slate:hover {
          background: #f1f5f9;
        }
        ${isDarkMode ? `
        .skill-mgmt-toolbar .ant-input-affix-wrapper {
          background: #0f172a !important;
          border-color: #334155 !important;
        }
        .skill-mgmt-toolbar .ant-input-affix-wrapper input { color: #f1f5f9 !important; }
        .skill-mgmt-toolbar .ant-input-affix-wrapper .ant-input-clear-icon { color: #94a3b8 !important; }
        .skill-mgmt-seg.ant-segmented .ant-segmented-thumb {
          background: #2563eb !important;
          box-shadow: none !important;
        }
        .skill-mgmt-seg.ant-segmented .ant-segmented-item-selected {
          background: #2563eb !important;
          color: #f8fafc !important;
          box-shadow: none !important;
        }
        .hover-bg-slate:hover { background: #334155 !important; }
        ` : ''}
      `}</style>
    </div>
  );
};

export default SkillManagement;
