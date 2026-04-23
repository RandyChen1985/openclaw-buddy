import React from 'react';
import { Modal, Card, Button, Spin, Tag, message, Alert, Select, Input, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { Trash2, Bot, Link2 } from 'lucide-react';
import api from '../api';

export interface ChannelLite {
  id: string;
  name: string;
  icon?: string;
}

interface BindingRow {
  agentId: string;
  agentName: string;
  emoji?: string;
  routes: string;
  routeSummary?: string;
  accountId?: string;
  source?: string;
  bindings: number;
}

interface AgentPick {
  id: string;
  name?: string;
  emoji?: string;
}

interface Overview {
  channelId: string;
  credentialConfigured: boolean;
  credentialHint?: string;
  channelEnabled: boolean;
  bindings: BindingRow[];
  notices?: string[];
  candidateAgents?: AgentPick[];
}

interface ChannelAccountsModalProps {
  visible: boolean;
  channel: ChannelLite | null;
  onClose: () => void;
  onAfterChange: () => void;
}

const ChannelAccountsModal: React.FC<ChannelAccountsModalProps> = ({
  visible,
  channel,
  onClose,
  onAfterChange,
}) => {
  const { t } = useTranslation();
  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState<Overview | null>(null);
  const [unbinding, setUnbinding] = React.useState<string | null>(null);
  const [bindAgentId, setBindAgentId] = React.useState<string | undefined>(undefined);
  const [bindAgentManual, setBindAgentManual] = React.useState('');
  const [bindAccountId, setBindAccountId] = React.useState('');
  const [binding, setBinding] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!channel?.id) return;
    setLoading(true);
    try {
      const res = await api.get(`/v1/channels/${channel.id}/accounts`);
      const body = res.data?.data ?? res.data;
      setData(body as Overview);
    } catch (e: any) {
      message.error(e?.message || t('channels.accountsFetchFailed'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [channel?.id, t]);

  React.useEffect(() => {
    if (visible && channel?.id) {
      void load();
      setBindAgentId(undefined);
      setBindAgentManual('');
      setBindAccountId('');
    } else {
      setData(null);
    }
  }, [visible, channel?.id, load]);

  const handleUnbindAgent = (agentId: string, accountId?: string) => {
    if (!channel?.id) return;
    const acc = (accountId || '').trim();
    const content =
      acc.length > 0
        ? t('channels.unbindAgentConfirmWithAccount', { channel: channel.name, agent: agentId, account: acc })
        : t('channels.unbindAgentConfirm', { channel: channel.name, agent: agentId });
    Modal.confirm({
      title: t('common.confirmAction'),
      content,
      okText: t('channels.unbind'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: async () => {
        setUnbinding(`${agentId}\x1e${acc}`);
        try {
          const q = new URLSearchParams({ agentId });
          if (acc) q.set('accountId', acc);
          await api.delete(`/v1/channels/${channel.id}/setup?${q.toString()}`);
          message.success(t('channels.unbindAgentSuccess'));
          await load();
          onAfterChange();
        } catch (err: any) {
          message.error(err?.response?.data?.message || err?.message || t('common.error'));
        } finally {
          setUnbinding(null);
        }
      },
    });
  };

  const handleBind = async () => {
    if (!channel?.id) {
      return;
    }
    const resolvedAgent = (bindAgentId || bindAgentManual.trim()).trim();
    if (!resolvedAgent) {
      message.warning(t('channels.bindPickAgent'));
      return;
    }
    setBinding(true);
    try {
      await api.post(`/v1/channels/${channel.id}/bind`, {
        agentId: resolvedAgent,
        accountId: bindAccountId.trim() || undefined,
      });
      message.success(t('channels.bindRouteSuccess'));
      setBindAccountId('');
      setBindAgentId(undefined);
      setBindAgentManual('');
      await load();
      onAfterChange();
    } catch (err: any) {
      message.error(err?.response?.data?.message || err?.message || t('common.error'));
    } finally {
      setBinding(false);
    }
  };

  const agentOptions =
    data?.candidateAgents?.map((a) => ({
      value: a.id,
      label: `${a.emoji || '🤖'} ${a.name || a.id} (${a.id})`,
    })) ?? [];

  return (
    <Modal
      title={`${t('channels.manageAccounts')} — ${channel?.name || ''}`}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={640}
      centered
      destroyOnClose
    >
      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data?.notices && data.notices.length > 0 && (
            <Alert type="warning" showIcon message={t('channels.configNotices')} description={data.notices.join('\n')} />
          )}

          <div style={{ fontSize: 13, color: '#64748b', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span>{t('channels.credentialStatus')}:</span>
            {data?.credentialConfigured ? (
              <Tag color="success">{t('channels.credentialPresent')}</Tag>
            ) : (
              <Tag>{t('channels.credentialAbsent')}</Tag>
            )}
            {data?.credentialHint && (
              <span style={{ color: '#334155', fontFamily: 'monospace', fontSize: 12 }}>{data.credentialHint}</span>
            )}
            <Tag color={data?.channelEnabled ? 'processing' : 'default'}>
              {data?.channelEnabled ? t('channels.channelSwitchOn') : t('channels.channelSwitchOff')}
            </Tag>
          </div>

          <Card size="small" title={t('channels.addRouteBinding')} styles={{ header: { minHeight: 40 } }}>
            <Space direction="vertical" style={{ width: '100%' }} size={10}>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{t('channels.addRouteBindingHint')}</div>
              {agentOptions.length > 0 ? (
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder={t('channels.bindPickAgent')}
                  style={{ width: '100%' }}
                  options={agentOptions}
                  value={bindAgentId}
                  onChange={(v) => setBindAgentId(v)}
                  allowClear
                />
              ) : (
                <Input
                  placeholder={t('channels.bindAgentManualPlaceholder')}
                  value={bindAgentManual}
                  onChange={(e) => setBindAgentManual(e.target.value)}
                />
              )}
              <Input
                placeholder={t('channels.bindAccountIdPlaceholder')}
                value={bindAccountId}
                onChange={(e) => setBindAccountId(e.target.value)}
                allowClear
              />
              <Button type="primary" icon={<Link2 size={14} />} loading={binding} onClick={() => void handleBind()}>
                {t('channels.bindRouteSubmit')}
              </Button>
            </Space>
          </Card>

          <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a', marginTop: 4 }}>{t('channels.boundAgents')}</div>
          <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.55 }}>{t('channels.manageAccountsRouteHint')}</div>

          {!data?.bindings?.length ? (
            <Card size="small" styles={{ body: { padding: 24, textAlign: 'center', color: '#94a3b8' } }}>
              {t('channels.noAgentBindings')}
            </Card>
          ) : (
            data.bindings.map((b) => (
              <Card
                key={`${b.agentId}-${b.accountId || ''}-${b.source || 'root'}-${b.routes}`}
                size="small"
                styles={{ body: { padding: '12px 16px' } }}
                style={{ borderRadius: 10, border: '1px solid #e2e8f0' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 8,
                        background: '#f8fafc',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1px solid #e2e8f0',
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ fontSize: 18 }}>{b.emoji || '🤖'}</span>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, color: '#1e293b' }}>{b.agentName}</span>
                        {b.source === 'agentsList' && (
                          <Tag color="warning" style={{ margin: 0 }}>
                            {t('channels.bindingSourceAgentsList')}
                          </Tag>
                        )}
                        {b.source === 'root' && (
                          <Tag color="default" style={{ margin: 0 }}>
                            {t('channels.bindingSourceRoot')}
                          </Tag>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Bot size={12} />
                        <span style={{ fontFamily: 'monospace' }}>{b.agentId}</span>
                      </div>
                      {(b.routeSummary || b.routes) && (
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, wordBreak: 'break-word' }}>
                          {t('channels.routes')}: {b.routeSummary || b.routes}
                        </div>
                      )}
                    </div>
                  </div>
                  <Button
                    danger
                    type="text"
                    size="small"
                    icon={<Trash2 size={14} />}
                    loading={unbinding === `${b.agentId}\x1e${(b.accountId || '').trim()}`}
                    onClick={() => handleUnbindAgent(b.agentId, b.accountId)}
                  >
                    {t('channels.unbind')}
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>
      )}
    </Modal>
  );
};

export default ChannelAccountsModal;
