import React, { useState, useEffect } from 'react';
import { Card, Button, Tag, Input, Modal, Form, Select, message, Spin, Empty, Drawer } from 'antd';
import { useTranslation } from 'react-i18next';
import { 
  Search, Info, CheckCircle2, Sparkles, Code, PenTool, Scale, Rocket,
  UserCircle2, Copy, Video, Banknote, Users, GraduationCap, Heart
} from 'lucide-react';
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
  identity: {
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
  const [submitting, setSubmitting] = useState(false);
  const [models, setModels] = useState<any[]>([]);
  const [form] = Form.useForm();

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
    form.setFieldsValue({ expertId: expert.id });
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
        modelId: values.modelId
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
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
          {filteredExperts.map(expert => (
            <Card key={expert.id} hoverable bodyStyle={{ padding: 20, display: 'flex', flexDirection: 'column', height: '100%' }} style={{ borderRadius: 16, border: '1px solid #e2e8f0' }} onClick={() => { setSelectedExpert(expert); setIsDrawerOpen(true); }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: '#eff6ff', border: '1px solid #dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>{expert.emoji}</div>
                <Tag color="geekblue" style={{ borderRadius: 6 }}>{currentLang === 'zh' ? expert.category_zh : expert.category.toUpperCase()}</Tag>
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>{(currentLang === 'zh' && expert.name) ? expert.name : (expert.name_en || expert.name)}</h3>
              <p style={{ color: '#64748b', fontSize: 13, lineHeight: 1.6, flex: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{(currentLang === 'zh' && expert.description) ? expert.description : (expert.description_en || expert.description)}</p>
              <div style={{ display: 'flex', gap: 12, marginTop: 24, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
                <Button block onClick={(e) => { e.stopPropagation(); setSelectedExpert(expert); setIsDrawerOpen(true); }}>{t('experts.viewDetail')}</Button>
                <Button block type="primary" onClick={(e) => { e.stopPropagation(); handleUseTemplate(expert); }}>{t('experts.useTemplate')}</Button>
              </div>
            </Card>
          ))}
        </div>
      ) : <Empty style={{ margin: '60px 0' }} />}

      <Drawer title={<div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ fontSize: 24 }}>{selectedExpert?.emoji}</span><div><div style={{ fontSize: 16, fontWeight: 700 }}>{(currentLang === 'zh' && selectedExpert?.name) ? selectedExpert?.name : (selectedExpert?.name_en || selectedExpert?.name)}</div><div style={{ fontSize: 12, color: '#94a3b8' }}>{t('experts.templateType')}</div></div></div>} width={isMobile ? '100%' : 500} onClose={() => setIsDrawerOpen(false)} open={isDrawerOpen} extra={<Button type="primary" onClick={() => { setIsDrawerOpen(false); if(selectedExpert) handleUseTemplate(selectedExpert); }}>{t('experts.useTemplate')}</Button>}>
        {selectedExpert && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <section>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1e293b', margin: 0 }}><UserCircle2 size={18} color="#2563eb" /> {t('experts.soul')}</h4>
                <Button type="text" size="small" icon={<Copy size={14} />} onClick={() => handleCopySoul(selectedExpert.soul)} style={{ color: '#64748b' }}>{t('common.copy')}</Button>
              </div>
              <Card bodyStyle={{ padding: 16, background: '#f1f5f9' }} style={{ borderRadius: 12, border: 'none' }}>
                <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{selectedExpert.soul}</div>
              </Card>
            </section>
            <section>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1e293b', marginBottom: 12 }}><CheckCircle2 size={18} color="#22c55e" /> {t('experts.skills')}</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{selectedExpert.skills.map(s => <Tag key={s} color="blue" style={{ borderRadius: 6, padding: '4px 10px' }}>{s}</Tag>)}</div>
            </section>
            <section>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1e293b', marginBottom: 12 }}><Info size={18} color="#f59e0b" /> {t('experts.usageGuide')}</h4>
              <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>{t('experts.usagePlaceholder')}</p>
            </section>
          </div>
        )}
      </Drawer>

      <Modal title={t('experts.createBotTitle')} open={isModalOpen} onOk={handleCreateBot} onCancel={() => setIsModalOpen(false)} confirmLoading={submitting} centered>
        <div style={{ padding: '8px 0' }}>
          <Form form={form} layout="vertical">
            <Form.Item label={t('experts.idLabel')} name="botId" rules={[{ required: true, message: t('experts.idPlaceholder') }]}><Input placeholder={t('experts.idPlaceholder')} /></Form.Item>
            <Form.Item label={t('experts.modelLabel')} name="modelId" rules={[{ required: true, message: t('experts.modelPlaceholder') }]}><Select placeholder={t('experts.modelPlaceholder')}>{models.map(m => <Select.Option key={m.id} value={m.id}>{m.name || m.id}</Select.Option>)}</Select></Form.Item>
            <Form.Item name="expertId" hidden><Input /></Form.Item>
          </Form>
        </div>
      </Modal>
    </div>
  );
};

export default ExpertMarket;
