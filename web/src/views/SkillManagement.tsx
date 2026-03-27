import React, { useState, useEffect } from 'react';
import { Card, Table, Tag, Button, Input, message, Tooltip, Segmented, Modal } from 'antd';
import { RefreshCw, Search, CheckCircle2, AlertCircle, Puzzle, Trash2 } from 'lucide-react';
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
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | number>('ready');

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
      if (force) message.success('技能清单已强制同步并更新');
    } catch (err) {
      message.error('获取技能列表失败');
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
      title: '确认要卸载该技能吗？',
      content: `这将会执行 openclaw skills uninstall ${name} 并移除相关插件，操作不可逆。`,
      okText: '确认卸载',
      cancelText: '取消',
      okButtonProps: { danger: true },
      centered: true,
      onOk: async () => {
        try {
          setLoading(true);
          await api.delete(`/v1/openclaw/skills/${name}`);
          message.loading('正在重载系统技能引擎...', 1.5);
          await api.post('/v1/openclaw/skills/reload');
          message.success(`技能 ${name} 已成功移除`);
          fetchSkills();
        } catch (err: any) {
          message.error(err.response?.data?.error || '卸载失败');
          setLoading(false);
        }
      }
    });
  };

  const columns = [
    {
      title: '技能名称',
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
      title: '状态',
      key: 'eligible',
      width: 120,
      render: (record: Skill) => (
        record.eligible ? (
          <Tag color="success" icon={<CheckCircle2 size={12} style={{ marginRight: 4 }} />} style={{ borderRadius: 6, padding: '2px 8px' }}>已就绪</Tag>
        ) : (
          <Tooltip title={
            record.missing ? (
              <div>
                {record.missing.bins.length > 0 && <div>缺失二进制: {record.missing.bins.join(', ')}</div>}
                {record.missing.env.length > 0 && <div>缺失变量: {record.missing.env.join(', ')}</div>}
                {record.missing.config.length > 0 && <div>缺失配置: {record.missing.config.join(', ')}</div>}
              </div>
            ) : '环境不满足'
          }>
            <Tag color="warning" icon={<AlertCircle size={12} style={{ marginRight: 4 }} />} style={{ borderRadius: 6, padding: '2px 8px', cursor: 'help' }}>需配置</Tag>
          </Tooltip>
        )
      ),
    },
    {
      title: '功能描述',
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
      title: '类型',
      key: 'bundled',
      width: 100,
      render: (record: Skill) => (
        <Tag style={{ borderRadius: 4 }}>{record.bundled ? '内置' : '外部'}</Tag>
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: any, record: Skill) => (
        !record.bundled && (
          <Tooltip title="卸载插件">
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
              <Puzzle size={isMobile ? 18 : 20} color="#2563eb" /> {isMobile ? '技能管理' : '技能扩展管理'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12 }}>
              {updatedAt && (
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>
                  {isMobile ? updatedAt.split(' ')[1] : `同步于: ${updatedAt}`}
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
                {isMobile ? '' : '刷新'}
              </Button>
            </div>
          </div>
        }
        bodyStyle={{ padding: 0 }} 
        style={{ borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.02)', border: '1px solid #e2e8f0', overflow: 'hidden' }}
      >
        <div style={{ padding: isMobile ? '10px 16px' : '12px 24px', borderBottom: '1px solid #f1f5f9', color: '#64748b', fontSize: 12 }}>
          查看与管理 OpenClaw 插件扩展。
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
              placeholder="搜索..." 
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
                    共 {filteredSkills.length} 项
                </div>
            )}
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'space-between' : 'flex-end' }}>
            <Segmented
              options={[
                { label: '已就绪', value: 'ready' },
                { label: '全部', value: 'all' }
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
                    共 {filteredSkills.length} 项
                </div>
            )}
          </div>
        </div>
        
        {isMobile ? (
          <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '0 4px' }}>
            {filteredSkills.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>未发现相关技能</div>
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
                                <Tag color="success" style={{ margin: 0, borderRadius: 4 }}>就绪</Tag>
                            ) : (
                                <Tag color="warning" style={{ margin: 0, borderRadius: 4 }}>配置</Tag>
                            ) }
                        </div>
                        <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>{skill.description}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>来源: {skill.source}</div>
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
                locale={{ emptyText: '未发现相关技能' }}
                style={{ padding: '8px' }}
            />
        )}
      </Card>
      
    </div>
  );
};

export default SkillManagement;
