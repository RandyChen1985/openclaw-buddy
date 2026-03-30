import React, { useState, useEffect } from 'react';
import { Card, Button, Tag, Input, Modal, Form, Select, message, Spin, Empty, Drawer, Steps, Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { 
  Search, CheckCircle2, Sparkles, Code, PenTool, Scale, Rocket,
  Copy, Video, Banknote, Users, GraduationCap, Heart,
  ShieldCheck, Brain
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import api from '../api';

interface Expert {
  id: string;
  name: string;
  name_en: string;
  description: string;
  description_en: string;
  emoji: string;
  category: string;
  category_zh: string;
  soul: string;
  identity_md?: string;
  identity?: {
    name: string;
    bio: string;
  };
  skills: string[];
}

interface ExpertMarketProps {
  isMobile?: boolean;
  onShowGlobalLoading: (msg: string, duration?: number) => void;
  onNavigate: (tab: string) => void;
}

const ExpertMarket: React.FC<ExpertMarketProps> = ({ isMobile, onShowGlobalLoading, onNavigate }) => {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language.split('-')[0]; // 处理 zh-CN 等情况

  const [experts, setExperts] = useState<Expert[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selectedExpert, setSelectedExpert] = useState<Expert | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [models, setModels] = useState<any[]>([]);
  const [form] = Form.useForm();

  // Token 估算逻辑
  const estimateTokens = (text: string) => {
    if (!text) return 0;
    const chineseChars = text.match(/[\u4e00-\u9fa5]/g)?.length || 0;
    const nonChineseChars = text.length - chineseChars;
    return Math.ceil(chineseChars + (nonChineseChars / 2.8)); // 调高权值以适配 Markdown 符号
  };

  const [soulTokens, setSoulTokens] = useState(0);
  const [idTokens, setIdTokens] = useState(0);

  // 类别配色方案
  const getCategoryColor = (category: string) => {
    const colors: Record<string, { bg: string, border: string, tag: string, iconBg: string }> = {
      technical: { bg: '#eff6ff', border: '#dbeafe', tag: 'blue', iconBg: '#fff' },
      creative: { bg: '#f5f3ff', border: '#ede9fe', tag: 'purple', iconBg: '#fff' },
      selfmedia: { bg: '#fff7ed', border: '#ffedd5', tag: 'orange', iconBg: '#fff' },
      finance: { bg: '#f0fdf4', border: '#dcfce7', tag: 'green', iconBg: '#fff' },
      management: { bg: '#eef2ff', border: '#e0e7ff', tag: 'indigo', iconBg: '#fff' },
      legal: { bg: '#f1f5f9', border: '#e2e8f0', tag: 'default', iconBg: '#fff' },
      education: { bg: '#fffbeb', border: '#fef3c7', tag: 'amber', iconBg: '#fff' },
      lifestyle: { bg: '#fff1f2', border: '#ffe4e6', tag: 'rose', iconBg: '#fff' },
      all: { bg: '#ffffff', border: '#e2e8f0', tag: 'blue', iconBg: '#f8fafc' }
    };
    return colors[category] || colors.all;
  };

  useEffect(() => {
    fetchExperts();
    fetchModels();
  }, []);

  const fetchExperts = async () => {
    setLoading(true);
    try {
      const res = await api.get('/v1/openclaw/experts');
      setExperts(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      message.error(t('experts.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  const fetchModels = async () => {
    try {
      const res = await api.get('/v1/openclaw/bots-models');
      setModels(res.data.data?.models || []);
    } catch (err) {}
  };

  const categories = [
    { label: t('experts.all'), value: 'all', icon: <Sparkles size={14} /> },
    { label: t('experts.technical'), value: 'technical', icon: <Code size={14} /> },
    { label: t('experts.creative'), value: 'creative', icon: <PenTool size={14} /> },
    { label: t('experts.selfmedia'), value: 'selfmedia', icon: <Video size={14} /> },
    { label: t('experts.finance'), value: 'finance', icon: <Banknote size={14} /> },
    { label: t('experts.management'), value: 'management', icon: <Users size={14} /> },
    { label: t('experts.legal'), value: 'legal', icon: <Scale size={14} /> },
    { label: t('experts.education'), value: 'education', icon: <GraduationCap size={14} /> },
    { label: t('experts.lifestyle'), value: 'lifestyle', icon: <Heart size={14} /> }
  ];

  const filteredExperts = experts.filter(e => {
    const name = (currentLang === 'zh' && e.name) ? e.name : (e.name_en || e.name);
    const desc = (currentLang === 'zh' && e.description) ? e.description : (e.description_en || e.description);
    const matchesSearch = name.toLowerCase().includes(searchText.toLowerCase()) || 
                         desc.toLowerCase().includes(searchText.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || e.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const handleUseTemplate = (expert: Expert) => {
    setSelectedExpert(expert);
    setIsModalOpen(true);
    setCurrentStep(0); // 重置到第一步
    form.setFieldsValue({ 
      botId: '',
      modelId: '',
      expertId: expert.id,
      soul: expert.soul,
      identity_md: expert.identity_md || `# ${expert.name}\n\n${expert.identity?.bio || ''}`
    });
    setSoulTokens(estimateTokens(expert.soul));
    setIdTokens(estimateTokens(expert.identity_md || ''));
  };

  const handleCreateBot = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      setIsModalOpen(false);
      onShowGlobalLoading(t('experts.creating'), 5000);
      await api.post('/v1/openclaw/bots/template', {
        expertId: values.expertId,
        botId: values.botId,
        modelId: values.modelId,
        soul: values.soul,
        identity_md: values.identity_md
      });
      message.success(t('experts.createSuccess', { id: values.botId }));
      onNavigate('bots-models');
    } catch (err: any) {
      onShowGlobalLoading('', 1);
      if (!err.errorFields) {
        message.error(t('bots.createFailed') + ': ' + (err.response?.data?.error || err.message));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopySoul = (text: string) => {
    navigator.clipboard.writeText(text);
    message.success(t('common.copySuccess'));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ padding: isMobile ? '0 4px' : '0 8px' }}>
        <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, color: '#1e293b', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Rocket size={isMobile ? 22 : 26} color="#2563eb" />
          {t('experts.title')}
        </h2>
        <p style={{ color: '#64748b', fontSize: 13, maxWidth: 800 }}>
          {t('experts.description')}
        </p>
      </div>

      <Card bodyStyle={{ padding: isMobile ? 12 : 16 }} style={{ borderRadius: 16, border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 16, alignItems: 'center' }}>
          <Input 
            prefix={<Search size={16} color="#94a3b8" />}
            placeholder={t('experts.searchPlaceholder')}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            style={{ borderRadius: 10, flex: isMobile ? 'none' : 1 }}
          />
          <div style={{ width: isMobile ? '100%' : 'auto', overflowX: 'auto' }}>
            <div style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
              {categories.map(cat => (
                <Tag.CheckableTag
                  key={cat.value}
                  checked={categoryFilter === cat.value}
                  onChange={() => setCategoryFilter(cat.value)}
                  style={{ 
                    padding: '4px 12px', borderRadius: 8, 
                    border: categoryFilter === cat.value ? '1px solid #2563eb' : '1px solid #e2e8f0',
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
                    background: categoryFilter === cat.value ? '#eff6ff' : '#fff',
                    color: categoryFilter === cat.value ? '#2563eb' : '#64748b',
                    fontWeight: categoryFilter === cat.value ? 700 : 400,
                    transition: 'all 0.2s ease'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'inherit' }}>
                    {cat.icon} {cat.label}
                  </span>
                </Tag.CheckableTag>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {loading ? (
        <div style={{ padding: '60px 0', textAlign: 'center' }}><Spin size="large" /></div>
      ) : filteredExperts.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {filteredExperts.map(expert => {
            const theme = getCategoryColor(expert.category);
            return (
              <Card 
                key={expert.id} 
                hoverable 
                className="expert-card-item"
                bodyStyle={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', height: '100%' }} 
                style={{ 
                  borderRadius: 18, 
                  border: `1px solid ${theme.border}`,
                  background: theme.bg,
                  overflow: 'hidden',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                }} 
                onClick={() => { setSelectedExpert(expert); setIsDrawerOpen(true); }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ 
                    width: 48, height: 48, borderRadius: 14, 
                    background: theme.iconBg, 
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26,
                    border: `1px solid ${theme.border}`
                  }}>
                    {expert.emoji}
                  </div>
                  <div style={{ 
                    borderRadius: 8, padding: '4px 8px', fontSize: 11, fontWeight: 800, 
                    background: 'rgba(255,255,255,0.7)', 
                    color: '#334155',
                    border: `1px solid ${theme.border}`,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                    textTransform: 'uppercase',
                    backdropFilter: 'blur(4px)'
                  }}>
                    {currentLang === 'zh' ? expert.category_zh : expert.category.toUpperCase()}
                  </div>
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: '#1e293b', marginBottom: 8, letterSpacing: '-0.01em' }}>
                  {(currentLang === 'zh' && expert.name) ? expert.name : (selectedExpert?.name_en || expert.name)}
                </h3>
                <p style={{ color: '#475569', fontSize: 13, lineHeight: 1.7, flex: 1, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', opacity: 0.85 }}>
                  {(currentLang === 'zh' && expert.description) ? expert.description : (expert.description_en || expert.description)}
                </p>
                <div style={{ display: 'flex', gap: 12, marginTop: 24, paddingTop: 16, borderTop: `1px dashed ${theme.border}` }}>
                  <Button 
                    block 
                    style={{ borderRadius: 10, fontWeight: 600, border: `1px solid ${theme.border}`, background: 'rgba(255,255,255,0.6)' }}
                    onClick={(e) => { e.stopPropagation(); setSelectedExpert(expert); setIsDrawerOpen(true); }}
                  >
                    {t('experts.viewDetail')}
                  </Button>
                  <Button 
                    block 
                    type="primary" 
                    style={{ borderRadius: 10, fontWeight: 600, boxShadow: '0 4px 12px rgba(37, 99, 235, 0.15)' }}
                    onClick={(e) => { e.stopPropagation(); handleUseTemplate(expert); }}
                  >
                    {t('experts.useTemplate')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : <Empty style={{ margin: '60px 0' }} />}

      <Drawer 
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))' }}>{selectedExpert?.emoji}</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>
                {(currentLang === 'zh' && selectedExpert?.name) ? selectedExpert?.name : (selectedExpert?.name_en || selectedExpert?.name)}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>{t('experts.templateType')}</div>
            </div>
          </div>
        } 
        width={isMobile ? '100%' : 520} 
        onClose={() => setIsDrawerOpen(false)} 
        open={isDrawerOpen} 
        bodyStyle={{ padding: '0 24px 24px' }}
        extra={<Button type="primary" size="large" style={{ borderRadius: 10, fontWeight: 600, padding: '0 20px' }} onClick={() => { setIsDrawerOpen(false); if(selectedExpert) handleUseTemplate(selectedExpert); }}>{t('experts.useTemplate')}</Button>}
      >
        {selectedExpert && (
          <div className="expert-detail-container" style={{ display: 'flex', flexDirection: 'column', gap: 32, paddingTop: 24 }}>
            {/* 1. 身份定义区域 */}
            <section>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1e293b', fontSize: 15, fontWeight: 700, margin: 0 }}>
                  <ShieldCheck size={20} color="#2563eb" /> 
                  身份定义 (Identity Profile)
                </h4>
                <Button type="text" size="small" icon={<Copy size={14} />} onClick={() => selectedExpert.identity_md && handleCopySoul(selectedExpert.identity_md)} style={{ color: '#94a3b8' }}>{t('common.copy')}</Button>
              </div>
              <div style={{ 
                padding: '20px', background: '#f8fafc', borderRadius: 16, border: '1px solid #f1f5f9',
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
              }}>
                <div className="markdown-content expert-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                    {selectedExpert.identity_md || `# ${selectedExpert.name}\n\n${selectedExpert.identity?.bio || ''}`}
                  </ReactMarkdown>
                </div>
              </div>
            </section>

            {/* 2. 核心之魂区域 */}
            <section>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1e293b', fontSize: 15, fontWeight: 700, margin: 0 }}>
                  <Brain size={20} color="#8b5cf6" /> 
                  思维之魂 (Core Reasoning)
                </h4>
                <Button type="text" size="small" icon={<Copy size={14} />} onClick={() => handleCopySoul(selectedExpert.soul)} style={{ color: '#94a3b8' }}>{t('common.copy')}</Button>
              </div>
              <div style={{ 
                padding: '20px', background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)', borderRadius: 16, border: '1px solid #ddd6fe',
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
              }}>
                <div className="markdown-content expert-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                    {selectedExpert.soul}
                  </ReactMarkdown>
                </div>
              </div>
            </section>

            {/* 3. 技能视图建议 */}
            <section>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1e293b', marginBottom: 16, fontSize: 15, fontWeight: 700 }}>
                <CheckCircle2 size={20} color="#22c55e" /> {t('experts.skills')}
              </h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {selectedExpert.skills.map(s => (
                  <Tag key={s} color="blue" style={{ borderRadius: 8, padding: '6px 12px', fontSize: 13, border: 'none', background: '#eff6ff', color: '#2563eb', fontWeight: 600 }}>{s}</Tag>
                ))}
              </div>
            </section>

            {/* 样式定义 */}
            <style dangerouslySetInnerHTML={{ __html: `
              .expert-md h1 { font-size: 1.4em; margin-bottom: 16px; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
              .expert-md h2 { font-size: 1.2em; margin-top: 20px; margin-bottom: 12px; color: #334155; display: flex; align-items: center; gap: 8px; }
              .expert-md h3 { font-size: 1.1em; margin-top: 16px; margin-bottom: 8px; color: #475569; }
              .expert-md p { font-size: 13px; line-height: 1.8; color: #475569; margin-bottom: 12px; }
              .expert-md ul, .expert-md ol { padding-left: 18px; margin-bottom: 16px; }
              .expert-md li { font-size: 13px; color: #475569; margin-bottom: 6px; line-height: 1.6; }
              .expert-md blockquote { border-left: 4px solid #cbd5e1; padding-left: 12px; color: #64748b; font-style: italic; margin: 12px 0; }
              .expert-md code { background: #f1f5f9; padding: 2px 6px; borderRadius: 4px; font-family: monospace; font-size: 12px; color: #2563eb; }
              .expert-md strong { color: #1e293b; font-weight: 700; }
            ` }} />
          </div>
        )}
      </Drawer>

      <Modal 
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ padding: 8, background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)' }}>
              <Sparkles size={18} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>{t('experts.createBotTitle')}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{selectedExpert?.name} · {t('experts.templateType')}</div>
            </div>
          </div>
        } 
        open={isModalOpen} 
        onCancel={() => setIsModalOpen(false)} 
        footer={null}
        width={currentStep === 1 ? (isMobile ? '100%' : 1100) : 600}
        centered 
        bodyStyle={{ padding: '24px' }}
      >
        <Steps 
          current={currentStep} 
          size="small" 
          style={{ marginBottom: 32 }}
          items={[
            { title: '基础配置' },
            { title: '大脑重塑' },
            { title: '启动克隆' }
          ]}
        />

        <Form form={form} layout="vertical">
          {/* Step 0: 基础配置 */}
          {currentStep === 0 && (
            <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ background: '#f8fafc', padding: 24, borderRadius: 20, border: '1px solid #f1f5f9' }}>
                <Form.Item 
                  label={<span style={{ fontWeight: 700, color: '#334155' }}>{t('experts.idLabel')}</span>} 
                  name="botId" 
                  rules={[{ required: true, message: t('experts.idPlaceholder') }]}
                  extra="此 ID 将作为机器人文件系统的工作目录标识"
                >
                  <Input 
                    placeholder={t('experts.idPlaceholder')} 
                    style={{ height: 44, borderRadius: 12, fontSize: 14 }} 
                    prefix={<Rocket size={16} color="#94a3b8" style={{ marginRight: 8 }} />} 
                  />
                </Form.Item>
                
                <Form.Item 
                  label={<span style={{ fontWeight: 700, color: '#334155' }}>{t('experts.modelLabel')}</span>} 
                  name="modelId" 
                  rules={[{ required: true, message: t('experts.modelPlaceholder') }]}
                >
                  <Select 
                    placeholder={t('experts.modelPlaceholder')}
                    style={{ width: '100%' }}
                    size="large"
                    dropdownStyle={{ borderRadius: 16, padding: 8 }}
                    showSearch
                    optionFilterProp="label"
                  >
                    {Object.entries(
                      (models || []).reduce((acc: any, m: any) => {
                        const p = m.id.includes('/') ? m.id.split('/')[0] : (m.provider || 'Others');
                        if (!acc[p]) acc[p] = [];
                        acc[p].push(m);
                        return acc;
                      }, {})
                    ).map(([provider, providerModels]: [string, any]) => (
                      <Select.OptGroup key={provider} label={provider.toUpperCase()}>
                        {providerModels.map((m: any) => (
                          <Select.Option key={m.id} value={m.id} label={m.name || m.id}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontWeight: 500 }}>{m.name || m.id}</span>
                              <Tag color="blue" style={{ fontSize: 10, margin: 0, borderRadius: 4, height: 20, display: 'flex', alignItems: 'center' }}>{m.id}</Tag>
                            </div>
                          </Select.Option>
                        ))}
                      </Select.OptGroup>
                    ))}
                  </Select>
                </Form.Item>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <Button 
                  type="primary" 
                  size="large" 
                  onClick={async () => {
                    await form.validateFields(['botId', 'modelId']);
                    setCurrentStep(1);
                  }}
                  style={{ borderRadius: 12, fontWeight: 600, padding: '0 32px' }}
                >
                  下一步：重塑大脑
                </Button>
              </div>
            </div>
          )}

          {/* Step 1: 编辑器与分屏预览 */}
          {currentStep === 1 && (
            <div className="animate-in">
              <div style={{ display: 'flex', gap: 24, height: 650, flexDirection: isMobile ? 'column' : 'row' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <Tabs 
                    defaultActiveKey="identity" 
                    type="card"
                    items={[
                      {
                        key: 'identity',
                        label: (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <ShieldCheck size={16} />
                            <span>{t('experts.identityLabel')}</span>
                            <span style={{ fontSize: 10, background: '#f1f5f9', padding: '1px 6px', borderRadius: 6, color: '#64748b', fontWeight: 400 }}>
                              ~{idTokens} Tokens
                            </span>
                          </div>
                        ),
                        children: (
                          <Form.Item name="identity_md" style={{ marginBottom: 0 }}>
                            <Input.TextArea 
                              onChange={(e) => setIdTokens(estimateTokens(e.target.value))}
                              style={{ height: 520, borderRadius: '0 0 12px 12px', fontFamily: 'monospace', fontSize: 13, background: '#f8fafc', border: '1px solid #e2e8f0', borderTop: 'none', resize: 'none', padding: '16px' }} 
                            />
                          </Form.Item>
                        )
                      },
                      {
                        key: 'soul',
                        label: (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Brain size={16} />
                            <span>{t('experts.soulLabel')}</span>
                            <span style={{ fontSize: 10, background: '#f1f5f9', padding: '1px 6px', borderRadius: 6, color: '#64748b', fontWeight: 400 }}>
                              ~{soulTokens} Tokens
                            </span>
                          </div>
                        ),
                        children: (
                          <Form.Item name="soul" style={{ marginBottom: 0 }}>
                            <Input.TextArea 
                              onChange={(e) => setSoulTokens(estimateTokens(e.target.value))}
                              style={{ height: 520, borderRadius: '0 0 12px 12px', fontFamily: 'monospace', fontSize: 13, background: '#f8fafc', border: '1px solid #e2e8f0', borderTop: 'none', resize: 'none', padding: '16px' }} 
                            />
                          </Form.Item>
                        )
                      }
                    ]}
                    style={{ height: '100%' }}
                  />
                </div>

                {!isMobile && (
                  <div style={{ flex: 1, border: '1px solid #f1f5f9', borderRadius: 16, background: '#fff', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Code size={14} color="#64748b" />
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>实时渲染预览</span>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
                      <div className="expert-md">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                          {`${form.getFieldValue('identity_md')}\n\n---\n\n${form.getFieldValue('soul')}`}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Button onClick={() => setCurrentStep(0)} style={{ borderRadius: 10 }}>上一步</Button>
                  <div style={{ padding: '4px 12px', background: '#f8fafc', borderRadius: 20, border: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: (idTokens + soulTokens) > 3000 ? '#f59e0b' : '#22c55e' }} />
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      预计初始消耗：<strong style={{ color: (idTokens + soulTokens) > 3000 ? '#f59e0b' : '#1e293b' }}>{idTokens + soulTokens}</strong> Tokens
                    </span>
                  </div>
                </div>
                <Button type="primary" onClick={() => setCurrentStep(2)} style={{ borderRadius: 10, padding: '0 24px' }}>确认配置</Button>
              </div>
            </div>
          )}

          {/* Step 2: 最终确认 */}
          {currentStep === 2 && (
            <div className="animate-in" style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ width: 80, height: 80, background: '#f0fdf4', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                <CheckCircle2 size={40} color="#22c55e" />
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 800, color: '#1e293b', marginBottom: 8 }}>准备绪！</h3>
              <p style={{ color: '#64748b', marginBottom: 32 }}>系统已准备好将专家“{selectedExpert?.name}”克隆到您的工作区。</p>
              
              <div style={{ background: '#f8fafc', padding: 20, borderRadius: 16, textAlign: 'left', marginBottom: 32 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ color: '#94a3b8' }}>机器人 ID:</span>
                  <span style={{ fontWeight: 700, color: '#1e293b' }}>{form.getFieldValue('botId')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>核心模型:</span>
                  <Tag color="geekblue" style={{ borderRadius: 4, margin: 0 }}>{form.getFieldValue('modelId')}</Tag>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <Button size="large" onClick={() => setCurrentStep(1)} style={{ borderRadius: 12 }}>最后调整</Button>
                <Button type="primary" size="large" loading={submitting} onClick={handleCreateBot} style={{ borderRadius: 12, padding: '0 40px', fontWeight: 700, background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', border: 'none' }}>
                  启动克隆
                </Button>
              </div>
            </div>
          )}

          <Form.Item name="expertId" hidden><Input /></Form.Item>
        </Form>
        <style dangerouslySetInnerHTML={{ __html: `
          .animate-in { animation: fadeIn 0.4s ease-out; }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
          
          .expert-card-item:hover {
            transform: translateY(-8px);
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.08), 0 10px 10px -5px rgba(0, 0, 0, 0.04) !important;
          }
        ` }} />
      </Modal>
    </div>
  );
};

export default ExpertMarket;
