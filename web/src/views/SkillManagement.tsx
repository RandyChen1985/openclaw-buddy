import React, { useState, useEffect } from 'react';
import { RefreshCw, Search, CheckCircle2, AlertCircle, Puzzle, Trash2, HelpCircle, ExternalLink } from 'lucide-react';
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
}

interface SkillManagementProps {
  isMobile?: boolean;
}

const SkillManagement: React.FC<SkillManagementProps> = ({ isMobile }) => {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | number>('ready');
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  const fetchSkills = async (force = false) => {
    setLoading(true);
    try {
      if (force) {
          await api.post('/v1/openclaw/skills/reload');
      }
      const res = await api.get(`/v1/openclaw/skills${force ? '?refresh=true' : ''}`);
      const rawData = res.data;
      
      let skillsList: Skill[] = [];
      if (rawData.data) {
          skillsList = Array.isArray(rawData.data.skills) ? rawData.data.skills : [];
          // 统一格式化时间
          setUpdatedAt(rawData.updated_at ? dayjs(rawData.updated_at).format('YYYY-MM-DD HH:mm:ss') : '');
      } else {
          skillsList = Array.isArray(rawData.skills) ? rawData.skills : [];
      }
      
      setSkills(skillsList);
      if (force) message.success(t('skills.syncSuccess'));
    } catch (err) {
      message.error(t('skills.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSkills();
  }, []);

  const filteredSkills = skills.filter(skill => {
    const matchesSearch = skill.name.toLowerCase().includes(searchText.toLowerCase()) || 
                         skill.description.toLowerCase().includes(searchText.toLowerCase());
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'ready' && skill.eligible);
    return matchesSearch && matchesStatus;
  });

  const handleUninstall = (name: string) => {
    Modal.confirm({
      title: t('skills.uninstallConfirmTitle'),
      content: t('skills.uninstallConfirmContent', { name }),
      okText: t('skills.confirmUninstall'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      centered: true,
      onOk: async () => {
        try {
          setLoading(true);
          await api.delete(`/v1/openclaw/skills/${name}`);
          message.loading(t('skills.reloadingEngine'), 1.5);
          await api.post('/v1/openclaw/skills/reload');
          message.success(t('skills.uninstallSuccess', { name }));
          fetchSkills();
        } catch (err: any) {
          message.error(err.response?.data?.error || t('skills.uninstallFailed'));
          setLoading(false);
        }
      }
    });
  };

  const columns = [
    {
      title: t('skills.skillName'),
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Skill) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>{record.emoji || '🧩'}</span>
          <div>
            <div style={{ fontWeight: 600, color: '#1e293b' }}>{text}</div>
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
      title: t('skills.actions'),
      key: 'action',
      width: 80,
      render: (_: any, record: Skill) => (
        !record.bundled && (
          <Tooltip title={t('skills.uninstall')}>
            <Button 
              type="text" 
              danger 
              size="small" 
              icon={<Trash2 size={14} />} 
              onClick={() => handleUninstall(record.name)}
              style={{ borderRadius: 6 }}
            />
          </Tooltip>
        )
      )
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card 
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 12 }}>
            <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
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
                  style={{ color: '#2563eb', background: '#eff6ff', borderRadius: 8, display: 'flex', alignItems: 'center' }}
                />
              </div>
          </div>
        }
        bodyStyle={{ padding: 0 }} 
        style={{ borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.02)', border: '1px solid #e2e8f0', overflow: 'hidden' }}
      >
        <div style={{ padding: isMobile ? '10px 16px' : '12px 24px', borderBottom: '1px solid #f1f5f9', color: '#64748b', fontSize: 12 }}>
          {t('skills.description')}
        </div>
        <div style={{ 
            padding: isMobile ? '12px 16px' : '16px 24px', 
            borderBottom: '1px solid #f1f5f9', 
            display: 'flex', 
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'flex-start' : 'center', 
            gap: 12 
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: isMobile ? '100%' : 'auto', flex: 1 }}>
            <Input 
              prefix={<Search size={16} color="#94a3b8" />} 
              placeholder={t('skills.search')} 
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={{ flex: 1, borderRadius: 8 }}
              allowClear
            />
            {!isMobile && (
                <div style={{ 
                    fontSize: 12, color: '#2563eb', background: '#eff6ff', 
                    padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap'
                }}>
                    {t('skills.count', { count: filteredSkills.length })}
                </div>
            )}
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'space-between' : 'flex-end' }}>
            <Segmented
              options={[
                { label: t('skills.ready'), value: 'ready' },
                { label: t('skills.all'), value: 'all' }
              ]}
              value={statusFilter}
              onChange={(value) => setStatusFilter(value)}
              style={{ background: '#f1f5f9', borderRadius: 8, padding: 2 }}
            />
            {isMobile && (
                <div style={{ 
                    fontSize: 11, color: '#2563eb', background: '#eff6ff', 
                    padding: '2px 8px', borderRadius: 20
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
                        padding: 16, borderBottom: '1px solid #f1f5f9', 
                        display: 'flex', flexDirection: 'column', gap: 8 
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                <span style={{ fontSize: 20 }}>{skill.emoji || '🧩'}</span>
                                <span style={{ fontWeight: 600, color: '#1e293b' }}>{skill.name}</span>
                            </div>
                            {!skill.bundled && (
                                <Button 
                                    type="text" 
                                    danger 
                                    size="small" 
                                    icon={<Trash2 size={16} />} 
                                    onClick={() => handleUninstall(skill.name)}
                                    style={{ padding: 0, height: 24 }}
                                />
                            )}
                            {skill.eligible ? (
                                <Tag color="success" style={{ margin: 0, borderRadius: 4 }}>{t('skills.ready')}</Tag>
                            ) : (
                                <Tag color="warning" style={{ margin: 0, borderRadius: 4 }}>{t('skills.needsConfig')}</Tag>
                            ) }
                        </div>
                        <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>{skill.description}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{t('skills.source')}: {skill.source}</div>
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
            <div style={{ padding: 8, background: '#eff6ff', borderRadius: 10, color: '#2563eb' }}><HelpCircle size={20} /></div>
            <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{t('skills.help.title')}</div>
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 400 }}>{t('skills.help.subtitle')}</div>
            </div>
          </div>
        }
        open={isHelpModalOpen}
        onCancel={() => setIsHelpModalOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setIsHelpModalOpen(false)} style={{ borderRadius: 8 }}>{t('common.confirm')}</Button>
        ]}
        width={580}
        bodyStyle={{ padding: '24px 24px 10px' }}
        style={{ borderRadius: 20, overflow: 'hidden' }}
        maskStyle={{ backdropFilter: 'blur(10px)', background: 'rgba(255,255,255,0.4)' }}
      >
        <div style={{ marginBottom: 24, padding: 16, background: '#f8fafc', borderRadius: 12, border: '1px solid #f1f5f9' }}>
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
  );
};

export default SkillManagement;
