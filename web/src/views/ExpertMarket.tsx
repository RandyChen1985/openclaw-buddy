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
import TokenBadge from '../components/TokenBadge';

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
  onNavigate: (tab: string) => void;
  isRunning?: boolean;
  onNavigateToDashboard?: () => void;
  isDarkMode?: boolean;
}

const ExpertMarket: React.FC<ExpertMarketProps> = ({ isMobile, onNavigate, isDarkMode = false }) => {
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
    const lightColors: Record<string, { bg: string, border: string, tag: string, iconBg: string }> = {
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

    const darkColors: Record<string, { bg: string, border: string, tag: string, iconBg: string }> = {
      technical: { bg: '#1e293b', border: '#334155', tag: 'blue', iconBg: '#0f172a' },
      creative: { bg: '#1e293b', border: '#334155', tag: 'purple', iconBg: '#0f172a' },
      selfmedia: { bg: '#1e293b', border: '#334155', tag: 'orange', iconBg: '#0f172a' },
      finance: { bg: '#1e293b', border: '#334155', tag: 'green', iconBg: '#0f172a' },
      management: { bg: '#1e293b', border: '#334155', tag: 'indigo', iconBg: '#0f172a' },
      legal: { bg: '#1e293b', border: '#334155', tag: 'default', iconBg: '#0f172a' },
      education: { bg: '#1e293b', border: '#334155', tag: 'amber', iconBg: '#0f172a' },
      lifestyle: { bg: '#1e293b', border: '#334155', tag: 'rose', iconBg: '#0f172a' },
      all: { bg: '#1e293b', border: '#334155', tag: 'blue', iconBg: '#0f172a' }
    };

    return isDarkMode ? (darkColors[category] || darkColors.all) : (lightColors[category] || lightColors.all);
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
      setModels(res.data.data?.models || res.data?.models || []);
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

  const borderDefault = isDarkMode ? '#334155' : '#e2e8f0';
  const pageHeading = isDarkMode ? '#f1f5f9' : '#1e293b';
  const pageMuted = isDarkMode ? '#94a3b8' : '#64748b';
  const bodyText = isDarkMode ? '#cbd5e1' : '#475569';

  const wizard = {
    editorBg: isDarkMode ? '#0f172a' : '#f8fafc',
    tokenChipBg: isDarkMode ? '#334155' : '#f1f5f9',
    previewPanelBg: isDarkMode ? '#1e293b' : '#fff',
    previewHeaderBg: isDarkMode ? '#0f172a' : '#f8fafc',
    estimateBarBg: isDarkMode ? '#0f172a' : '#f8fafc',
    estimateBarBorder: isDarkMode ? '#334155' : '#f1f5f9',
    step2SummaryBg: isDarkMode ? '#0f172a' : '#f8fafc',
    step2IconBg: isDarkMode ? 'rgba(34,197,94,0.15)' : '#f0fdf4',
    step0PanelBg: isDarkMode ? '#0f172a' : '#f8fafc',
    step0PanelBorder: isDarkMode ? '#334155' : '#f1f5f9',
    formLabel: isDarkMode ? '#cbd5e1' : '#334155',
    valueStrong: isDarkMode ? '#f1f5f9' : '#1e293b',
    drawerIdentityBg: isDarkMode ? '#0f172a' : '#f8fafc',
    drawerIdentityBorder: isDarkMode ? '#334155' : '#f1f5f9',
    drawerSoulBg: isDarkMode ? 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)' : 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
    drawerSoulBorder: isDarkMode ? '#4338ca' : '#ddd6fe',
    skillTagBg: isDarkMode ? 'rgba(37,99,235,0.22)' : '#eff6ff',
    skillTagColor: isDarkMode ? '#93c5fd' : '#2563eb'
  };

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
      await form.validateFields(); // 基础校验
      const values = form.getFieldsValue(true); // 强力提取所有步骤的数据
      setSubmitting(true);
      const res = await api.post('/v1/openclaw/bots/template', {
        expertId: values.expertId || selectedExpert?.id, // 增加显式兜底
        botId: values.botId,
        modelId: values.modelId,
        soul: values.soul,
        identity_md: values.identity_md
      });
      setIsModalOpen(false);
      
      const taskID = res.data?.taskID || res.data?.data?.taskID;
      if (taskID) {
        message.loading(t('common.processing') + '...', 3);
      } else {
        message.success(t('experts.createSuccess', { id: values.botId }));
      }
      
      onNavigate('bots-models');
    } catch (err: any) {
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
    <div style={{ height: '100%', minHeight: 'calc(100vh - 100px)', width: '100%', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* 允许在网关停止时浏览并导入专家模型 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '0 4px' : '0 8px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ padding: isMobile ? '0 4px' : '0 8px' }}>
        <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, color: pageHeading, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Rocket size={isMobile ? 22 : 26} color="#2563eb" />
          {t('experts.title')}
        </h2>
        <p style={{ color: pageMuted, fontSize: 13, maxWidth: 800, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          {t('experts.description')}
          <a 
            href="https://github.com/jnMetaCode/agency-agents-zh" 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
            onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
            onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
          >
            点击更多智能体专家团队
            <Rocket size={12} />
          </a>
        </p>
      </div>

      <Card bodyStyle={{ padding: isMobile ? 12 : 16 }} style={{ borderRadius: 16, border: `1px solid ${borderDefault}`, background: isDarkMode ? '#1e293b' : '#fff' }} className={isDarkMode ? 'expert-market-filter' : undefined}>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 16, alignItems: 'center' }}>
          <Input 
            prefix={<Search size={16} color="#94a3b8" />}
            placeholder={t('experts.searchPlaceholder')}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            style={{ borderRadius: 10, flex: isMobile ? 'none' : 1, background: isDarkMode ? '#0f172a' : undefined, borderColor: isDarkMode ? '#334155' : undefined, color: isDarkMode ? '#f1f5f9' : undefined }}
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
                    border: categoryFilter === cat.value ? '1px solid #2563eb' : `1px solid ${borderDefault}`,
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
                    background: categoryFilter === cat.value
                      ? (isDarkMode ? 'rgba(37, 99, 235, 0.25)' : '#eff6ff')
                      : (isDarkMode ? '#0f172a' : '#fff'),
                    color: categoryFilter === cat.value ? (isDarkMode ? '#93c5fd' : '#2563eb') : pageMuted,
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
      {isDarkMode && (
        <style>{`
          .expert-market-filter .ant-input-affix-wrapper {
            background: #0f172a !important;
            border-color: #334155 !important;
          }
          .expert-market-filter .ant-input-affix-wrapper input { color: #f1f5f9 !important; }
        `}</style>
      )}

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
                    background: isDarkMode ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.7)', 
                    color: isDarkMode ? '#cbd5e1' : '#334155',
                    border: `1px solid ${theme.border}`,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                    textTransform: 'uppercase',
                    backdropFilter: 'blur(4px)'
                  }}>
                    {currentLang === 'zh' ? expert.category_zh : expert.category.toUpperCase()}
                  </div>
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: pageHeading, marginBottom: 8, letterSpacing: '-0.01em' }}>
                  {(currentLang === 'zh' && expert.name) ? expert.name : (expert.name_en || expert.name)}
                </h3>
                <p style={{ color: bodyText, fontSize: 13, lineHeight: 1.7, flex: 1, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', opacity: 0.85 }}>
                  {(currentLang === 'zh' && expert.description) ? expert.description : (expert.description_en || expert.description)}
                </p>
                <div style={{ display: 'flex', gap: 12, marginTop: 24, paddingTop: 16, borderTop: `1px dashed ${theme.border}` }}>
                  <Button 
                    block 
                    style={{ borderRadius: 10, fontWeight: 600, border: `1px solid ${theme.border}`, background: isDarkMode ? 'rgba(15,23,42,0.65)' : 'rgba(255,255,255,0.6)', color: isDarkMode ? '#e2e8f0' : undefined }}
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
              <div style={{ fontSize: 16, fontWeight: 800, color: pageHeading }}>
                {(currentLang === 'zh' && selectedExpert?.name) ? selectedExpert?.name : (selectedExpert?.name_en || selectedExpert?.name)}
              </div>
              <div style={{ fontSize: 12, color: pageMuted, fontWeight: 500 }}>{t('experts.templateType')}</div>
            </div>
          </div>
        } 
        width={isMobile ? '100%' : 520} 
        onClose={() => setIsDrawerOpen(false)} 
        open={isDrawerOpen} 
        bodyStyle={{ padding: '0 24px 24px', background: isDarkMode ? '#0f172a' : undefined }}
        extra={<Button type="primary" size="large" style={{ borderRadius: 10, fontWeight: 600, padding: '0 20px' }} onClick={() => { setIsDrawerOpen(false); if(selectedExpert) handleUseTemplate(selectedExpert); }}>{t('experts.useTemplate')}</Button>}
      >
        {selectedExpert && (
          <div className="expert-detail-container" style={{ display: 'flex', flexDirection: 'column', gap: 32, paddingTop: 24 }}>
            {/* 1. 身份定义区域 */}
            <section>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, color: isDarkMode ? '#f1f5f9' : '#1e293b', fontSize: 15, fontWeight: 700, margin: 0 }}>
                  <ShieldCheck size={20} color="#2563eb" /> 
                  {t('experts.identityLabel')}
                </h4>
                <Button type="text" size="small" icon={<Copy size={14} />} onClick={() => selectedExpert.identity_md && handleCopySoul(selectedExpert.identity_md)} style={{ color: '#94a3b8' }}>{t('common.copy')}</Button>
              </div>
              <div style={{ 
                padding: '20px', background: wizard.drawerIdentityBg, borderRadius: 16, border: `1px solid ${wizard.drawerIdentityBorder}`,
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
                <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, color: pageHeading, fontSize: 15, fontWeight: 700, margin: 0 }}>
                  <Brain size={20} color="#8b5cf6" /> 
                  {t('experts.soulLabel')}
                </h4>
                <Button type="text" size="small" icon={<Copy size={14} />} onClick={() => handleCopySoul(selectedExpert.soul)} style={{ color: '#94a3b8' }}>{t('common.copy')}</Button>
              </div>
              <div style={{ 
                padding: '20px', background: wizard.drawerSoulBg, borderRadius: 16, border: `1px solid ${wizard.drawerSoulBorder}`,
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
              <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, color: pageHeading, marginBottom: 16, fontSize: 15, fontWeight: 700 }}>
                <CheckCircle2 size={20} color="#22c55e" /> {t('experts.skills')}
              </h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {selectedExpert.skills.map(s => (
                  <Tag key={s} color="blue" style={{ borderRadius: 8, padding: '6px 12px', fontSize: 13, border: 'none', background: wizard.skillTagBg, color: wizard.skillTagColor, fontWeight: 600 }}>{s}</Tag>
                ))}
              </div>
            </section>

            {/* 样式定义 */}
            <style dangerouslySetInnerHTML={{ __html: isDarkMode ? `
              .expert-md h1 { font-size: 1.4em; margin-bottom: 16px; color: #f1f5f9; border-bottom: 2px solid #334155; padding-bottom: 8px; }
              .expert-md h2 { font-size: 1.2em; margin-top: 20px; margin-bottom: 12px; color: #e2e8f0; display: flex; align-items: center; gap: 8px; }
              .expert-md h3 { font-size: 1.1em; margin-top: 16px; margin-bottom: 8px; color: #cbd5e1; }
              .expert-md p { font-size: 13px; line-height: 1.8; color: #cbd5e1; margin-bottom: 12px; }
              .expert-md ul, .expert-md ol { padding-left: 18px; margin-bottom: 16px; }
              .expert-md li { font-size: 13px; color: #cbd5e1; margin-bottom: 6px; line-height: 1.6; }
              .expert-md blockquote { border-left: 4px solid #475569; padding-left: 12px; color: #94a3b8; font-style: italic; margin: 12px 0; }
              .expert-md code { background: #334155; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 12px; color: #93c5fd; }
              .expert-md strong { color: #f1f5f9; font-weight: 700; }
            ` : `
              .expert-md h1 { font-size: 1.4em; margin-bottom: 16px; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
              .expert-md h2 { font-size: 1.2em; margin-top: 20px; margin-bottom: 12px; color: #334155; display: flex; align-items: center; gap: 8px; }
              .expert-md h3 { font-size: 1.1em; margin-top: 16px; margin-bottom: 8px; color: #475569; }
              .expert-md p { font-size: 13px; line-height: 1.8; color: #475569; margin-bottom: 12px; }
              .expert-md ul, .expert-md ol { padding-left: 18px; margin-bottom: 16px; }
              .expert-md li { font-size: 13px; color: #475569; margin-bottom: 6px; line-height: 1.6; }
              .expert-md blockquote { border-left: 4px solid #cbd5e1; padding-left: 12px; color: #64748b; font-style: italic; margin: 12px 0; }
              .expert-md code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 12px; color: #2563eb; }
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
              <div style={{ fontSize: 16, fontWeight: 800, color: pageHeading }}>{t('experts.createBotTitle')}</div>
              <div style={{ fontSize: 11, color: pageMuted, fontWeight: 500 }}>{t('experts.cloneFrom', { name: (currentLang === 'zh' && selectedExpert?.name) ? selectedExpert?.name : (selectedExpert?.name_en || selectedExpert?.name) })} · {t('experts.templateType')}</div>
            </div>
          </div>
        } 
        open={isModalOpen} 
        onCancel={() => setIsModalOpen(false)} 
        footer={null}
        width={currentStep === 1 ? (isMobile ? '100%' : 1100) : 600}
        centered 
        bodyStyle={{ padding: '24px', background: isDarkMode ? '#0f172a' : undefined }}
      >
        <Steps 
          current={currentStep} 
          size="small" 
          style={{ marginBottom: 32 }}
          items={[
            { title: t('experts.stepBasic') },
            { title: t('experts.stepSoul') },
            { title: t('experts.stepClone') }
          ]}
        />

        <Form form={form} layout="vertical">
          {/* Step 0: 基础配置 */}
          {currentStep === 0 && (
            <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ background: wizard.step0PanelBg, padding: 24, borderRadius: 20, border: `1px solid ${wizard.step0PanelBorder}` }}>
                <Form.Item 
                  label={<span style={{ fontWeight: 700, color: wizard.formLabel }}>{t('experts.idLabel')}</span>} 
                  name="botId" 
                  rules={[{ required: true, message: t('experts.idPlaceholder') }]}
                  extra={t('experts.idTip')}
                >
                  <Input 
                    placeholder={t('experts.idPlaceholder')} 
                    style={{ height: 44, borderRadius: 12, fontSize: 14 }} 
                    prefix={<Rocket size={16} color="#94a3b8" style={{ marginRight: 8 }} />} 
                  />
                </Form.Item>
                
                <Form.Item 
                  label={<span style={{ fontWeight: 700, color: wizard.formLabel }}>{t('experts.modelLabel')}</span>} 
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
                  {t('experts.nextStep')}
                </Button>
              </div>
            </div>
          )}

          {/* Step 1: 编辑器与分屏预览 */}
          {currentStep === 1 && (
            <div className="animate-in">
              <div style={{ display: 'flex', gap: 24, height: 520, flexDirection: isMobile ? 'column' : 'row' }}>
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
                            <span style={{ fontSize: 10, background: wizard.tokenChipBg, padding: '1px 6px', borderRadius: 6, color: pageMuted, fontWeight: 400 }}>
                              ~{idTokens} Tokens
                            </span>
                          </div>
                        ),
                        children: (
                          <div style={{ position: 'relative', height: 380 }}>
                            <TokenBadge text={form.getFieldValue('identity_md') || ''} />
                            <Form.Item name="identity_md" noStyle>
                              <Input.TextArea 
                                onChange={(e) => setIdTokens(estimateTokens(e.target.value))}
                                style={{ 
                                  height: '100%', borderRadius: '0 0 12px 12px', 
                                  fontFamily: 'monospace', fontSize: 13, 
                                  background: wizard.editorBg, border: `1px solid ${borderDefault}`, 
                                  borderTop: 'none', resize: 'none', padding: '16px 20px',
                                  lineHeight: 1.7, overflowY: 'auto',
                                  color: isDarkMode ? '#e2e8f0' : undefined
                                }} 
                              />
                            </Form.Item>
                          </div>
                        )
                      },
                      {
                        key: 'soul',
                        label: (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Brain size={16} />
                            <span>{t('experts.soulLabel')}</span>
                            <span style={{ fontSize: 10, background: wizard.tokenChipBg, padding: '1px 6px', borderRadius: 6, color: pageMuted, fontWeight: 400 }}>
                              ~{soulTokens} Tokens
                            </span>
                          </div>
                        ),
                        children: (
                          <div style={{ position: 'relative', height: 380 }}>
                            <TokenBadge text={form.getFieldValue('soul') || ''} />
                            <Form.Item name="soul" noStyle>
                              <Input.TextArea 
                                onChange={(e) => setSoulTokens(estimateTokens(e.target.value))}
                                style={{ 
                                  height: '100%', borderRadius: '0 0 12px 12px', 
                                  fontFamily: 'monospace', fontSize: 13, 
                                  background: wizard.editorBg, border: `1px solid ${borderDefault}`, 
                                  borderTop: 'none', resize: 'none', padding: '16px 20px',
                                  lineHeight: 1.7, overflowY: 'auto',
                                  color: isDarkMode ? '#e2e8f0' : undefined
                                }} 
                              />
                            </Form.Item>
                          </div>
                        )
                      }
                    ]}
                    style={{ height: '100%' }}
                  />
                </div>

                {!isMobile && (
                  <div style={{ flex: 1, border: `1px solid ${borderDefault}`, borderRadius: 16, background: wizard.previewPanelBg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ padding: '12px 16px', background: wizard.previewHeaderBg, borderBottom: `1px solid ${borderDefault}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Code size={14} color={pageMuted} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: pageMuted }}>{t('experts.realtimePreview')}</span>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
                      <div className={isDarkMode ? 'expert-md expert-md-wizard-preview' : 'expert-md'}>
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
                  <Button onClick={() => setCurrentStep(0)} style={{ borderRadius: 10 }}>{t('experts.prevStep')}</Button>
                  <div style={{ padding: '4px 12px', background: wizard.estimateBarBg, borderRadius: 20, border: `1px solid ${wizard.estimateBarBorder}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: (idTokens + soulTokens) > 3000 ? '#f59e0b' : '#22c55e' }} />
                    <span style={{ fontSize: 12, color: pageMuted }}>
                      {t('experts.estimateTokens')}: <strong style={{ color: (idTokens + soulTokens) > 3000 ? '#f59e0b' : wizard.valueStrong }}>{idTokens + soulTokens}</strong> Tokens
                    </span>
                  </div>
                </div>
                <Button type="primary" onClick={() => setCurrentStep(2)} style={{ borderRadius: 10, padding: '0 24px' }}>{t('experts.confirmConfig')}</Button>
              </div>
            </div>
          )}

          {/* Step 2: 最终确认 */}
          {currentStep === 2 && (
            <div className="animate-in" style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ width: 80, height: 80, background: wizard.step2IconBg, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                <CheckCircle2 size={40} color="#22c55e" />
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 800, color: pageHeading, marginBottom: 8 }}>{t('experts.ready')}</h3>
              <p style={{ color: pageMuted, marginBottom: 32 }}>{t('experts.readyDesc', { name: (currentLang === 'zh' && selectedExpert?.name) ? selectedExpert?.name : (selectedExpert?.name_en || selectedExpert?.name) })}</p>
              
              <div style={{ background: wizard.step2SummaryBg, padding: 20, borderRadius: 16, textAlign: 'left', marginBottom: 32, border: isDarkMode ? `1px solid ${borderDefault}` : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ color: pageMuted }}>{t('experts.idLabel')}:</span>
                  <span style={{ fontWeight: 700, color: wizard.valueStrong }}>{form.getFieldValue('botId')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: pageMuted }}>{t('experts.modelLabel')}:</span>
                  <Tag color="geekblue" style={{ borderRadius: 4, margin: 0 }}>{form.getFieldValue('modelId')}</Tag>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <Button size="large" onClick={() => setCurrentStep(1)} style={{ borderRadius: 12 }}>{t('experts.lastAdjust')}</Button>
                <Button type="primary" size="large" loading={submitting} onClick={handleCreateBot} style={{ borderRadius: 12, padding: '0 40px', fontWeight: 700, background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', border: 'none' }}>
                  {t('experts.stepClone')}
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
          ${isDarkMode ? `
          .expert-md-wizard-preview h1 { font-size: 1.4em; margin-bottom: 12px; color: #f1f5f9; border-bottom: 2px solid #334155; padding-bottom: 8px; }
          .expert-md-wizard-preview h2 { font-size: 1.2em; margin-top: 16px; margin-bottom: 10px; color: #e2e8f0; }
          .expert-md-wizard-preview h3 { font-size: 1.05em; margin-top: 12px; color: #cbd5e1; }
          .expert-md-wizard-preview p, .expert-md-wizard-preview li { color: #cbd5e1; line-height: 1.75; }
          .expert-md-wizard-preview code { background: #334155; color: #93c5fd; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
          .expert-md-wizard-preview blockquote { border-left: 4px solid #475569; color: #94a3b8; padding-left: 12px; }
          .expert-md-wizard-preview hr { border-color: #334155; }
          ` : ''}
        ` }} />
      </Modal>
      </div>
    </div>
  );
};

export default ExpertMarket;
