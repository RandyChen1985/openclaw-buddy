import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Button, message, QRCode, Spin, Result, Select, Divider } from 'antd';
import { useTranslation } from 'react-i18next';
import { Save, RefreshCw, Smartphone, Bot, HelpCircle } from 'lucide-react';
import api from '../api';

interface ChannelField {
  key: string;
  label: string;
  placeholder: string;
  type: string;
  required: boolean;
  helpUrl?: string;
}

interface ChannelMetadata {
  id: string;
  name: string;
  description: string;
  setupType: 'qr' | 'form';
  fields?: ChannelField[];
}

interface ChannelSetupModalProps {
  visible: boolean;
  channel: ChannelMetadata | null;
  onClose: () => void;
  onSuccess: () => void;
}

const ChannelSetupModal: React.FC<ChannelSetupModalProps> = ({ visible, channel, onClose, onSuccess }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [bots, setBots] = useState<any[]>([]);
  const [loadingBots, setLoadingBots] = useState(false);

  useEffect(() => {
    if (visible) {
      fetchBots();
      if (channel?.setupType === 'qr') {
        fetchQRCode();
      }
    }
    if (!visible) {
      setQrUrl(null);
      form.resetFields();
    }
  }, [visible, channel]);

  const fetchBots = async () => {
    setLoadingBots(true);
    try {
      const response = await api.get('/v1/openclaw/bots-models');
      // 注意：后端接口返回的是 { data: { bots: [...], models: [...] }, updated_at: "..." }
      // api 拦截器会解开外层的 data，所以 response.data 已经是 { data: { bots: ... }, ... }
      const botsList = response.data?.data?.bots || response.data?.bots || [];
      setBots(botsList);
      // 默认选中 main
      if (botsList.some((b: any) => b.id === 'main')) {
        form.setFieldsValue({ agentId: 'main' });
      } else if (botsList.length > 0) {
        form.setFieldsValue({ agentId: botsList[0].id });
      }
    } catch (err: any) {
      console.error('Failed to fetch bots');
    } finally {
      setLoadingBots(false);
    }
  };

  const fetchQRCode = async () => {
    if (!channel) return;
    setQrLoading(true);
    try {
      const response = await api.get(`/v1/channels/qrcode/${channel.id}`);
      if (response.data?.qrcode_url || response.data?.data?.qrcode_url) {
        setQrUrl(response.data.qrcode_url || response.data.data.qrcode_url);
      }
    } catch (err: any) {
      message.error(t('channels.qrError') || '获取二维码失败');
    } finally {
      setQrLoading(false);
    }
  };

  const handleFinish = async (values: any) => {
    if (!channel) return;
    const { agentId, ...secrets } = values;
    setLoading(true);
    try {
      await api.post('/v1/channels/setup', {
        channelId: channel.id,
        agentId,
        secrets
      });
      message.success(t('common.saveSuccess'));
      onSuccess();
      onClose();
    } catch (err: any) {
      const detail = err?.response?.data?.message || err?.response?.data?.error || err?.message;
      message.error(detail || t('common.saveFailed') || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  if (!channel) return null;

  return (
    <Modal
      title={`${t('channels.setup')} - ${channel.name}`}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={channel.setupType === 'qr' ? 450 : 550}
      centered
      destroyOnClose
    >
      <div style={{ padding: '12px 0' }}>
        <p style={{ color: '#64748b', fontSize: 13, marginBottom: 20 }}>{channel.description}</p>

        <Form form={form} layout="vertical" onFinish={handleFinish} requiredMark="optional">
          <Form.Item 
            label={<span style={{ fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: 6 }}><Bot size={14} /> {t('channels.targetBot') || '目标机器人 (Target Agent)'}</span>}
            name="agentId"
            rules={[{ required: true }]}
            tooltip={t('channels.targetBotTip') || '指定该渠道的消息由哪个机器人响应'}
          >
            <Select 
              loading={loadingBots}
              style={{ borderRadius: 8, height: 40 }}
              options={bots.map(b => ({ label: `${b.emoji} ${b.name} (${b.id})`, value: b.id }))}
            />
          </Form.Item>
          
          <Divider dashed />

          {channel.setupType === 'qr' ? (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              {qrLoading ? (
                <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
                  <Spin size="large" />
                  <span style={{ color: '#94a3b8', fontSize: 12 }}>{t('channels.qrLoading') || '正在生成授权二维码...'}</span>
                </div>
              ) : qrUrl ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
                  <div style={{ padding: 12, background: '#fff', borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid #f1f5f9' }}>
                    <QRCode value={qrUrl} size={220} bordered={false} />
                  </div>
                  <div style={{ color: '#16a34a', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Smartphone size={16} /> {t('channels.scanToLogin') || '请使用对应 App 扫码授权'}
                  </div>
                  <Button icon={<RefreshCw size={14} />} onClick={fetchQRCode}>{t('common.refresh')}</Button>
                </div>
              ) : (
                <Result
                  status="warning"
                  title={t('channels.qrFailed') || '未能获取到二维码'}
                  extra={<Button onClick={fetchQRCode}>{t('common.retry')}</Button>}
                />
              )}
              
              {channel.fields && channel.fields.length > 0 && (
                <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px dashed #e2e8f0' }}>
                  <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>{t('channels.orManual') || '或者手动配置凭证'}</p>
                  {channel.fields.map(field => (
                    <Form.Item key={field.key} label={field.label} name={field.key} rules={[{ required: field.required }]}>
                      {field.type === 'password' ? <Input.Password placeholder={field.placeholder} /> : <Input placeholder={field.placeholder} />}
                    </Form.Item>
                  ))}
                  <Form.Item style={{ marginBottom: 0 }}>
                    <Button type="primary" htmlType="submit" loading={loading} block icon={<Save size={16} />}>
                      {t('common.save')}
                    </Button>
                  </Form.Item>
                </div>
              )}
            </div>
          ) : (
            <>
              {channel.fields?.map(field => (
                <Form.Item 
                  key={field.key} 
                  label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 500, color: '#334155' }}>{field.label}</span>
                      {field.helpUrl && (
                        <a 
                          href={field.helpUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          style={{ display: 'flex', color: '#94a3b8', transition: 'color 0.2s' }}
                          onMouseEnter={(e) => e.currentTarget.style.color = '#3b82f6'}
                          onMouseLeave={(e) => e.currentTarget.style.color = '#94a3b8'}
                          title={t('common.help') || '如何获取？'}
                        >
                          <HelpCircle size={14} />
                        </a>
                      )}
                    </div>
                  } 
                  name={field.key} 
                  rules={[{ required: field.required, message: `${field.label} ${t('common.required')}` }]}
                >
                  {field.type === 'password' ? (
                    <Input.Password placeholder={field.placeholder} style={{ borderRadius: 8, height: 40 }} />
                  ) : (
                    <Input placeholder={field.placeholder} style={{ borderRadius: 8, height: 40 }} />
                  )}
                </Form.Item>
              ))}
              <div style={{ marginTop: 32, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <Button onClick={onClose} style={{ borderRadius: 8, height: 40, padding: '0 24px' }}>{t('common.cancel')}</Button>
                <Button type="primary" htmlType="submit" loading={loading} style={{ borderRadius: 8, height: 40, padding: '0 24px' }} icon={<Save size={16} />}>
                  {t('common.save')}
                </Button>
              </div>
            </>
          )}
        </Form>
      </div>
    </Modal>
  );
};

export default ChannelSetupModal;
