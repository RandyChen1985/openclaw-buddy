import React from 'react';
import { Modal, Card, Button, Spin, Tag, message, Select, Input, Space, Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { Trash2, Link2, Key, Users } from 'lucide-react';
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

interface ChannelAccount {
  id: string;
  name: string;
  isConfigured: boolean;
}

interface Overview {
  channelId: string;
  credentialConfigured: boolean;
  credentialHint?: string;
  channelEnabled: boolean;
  credentials: ChannelAccount[];
  bindings: BindingRow[];
  notices?: string[];
  candidateAgents?: AgentPick[];
}

interface ChannelAccountsModalProps {
  visible: boolean;
  channel: ChannelLite | null;
  onClose: () => void;
  onAfterChange: () => void;
  isDarkMode?: boolean;
}

const ChannelAccountsModal: React.FC<ChannelAccountsModalProps> = ({
  visible,
  channel,
  onClose,
  onAfterChange,
  isDarkMode = false,
}) => {
  const { t } = useTranslation();

  const shell = React.useMemo(
    () => ({
      border: isDarkMode ? '#334155' : '#e2e8f0',
      hairline: isDarkMode ? '#334155' : '#f1f5f9',
      infoBg: isDarkMode ? '#0f172a' : '#f8fafc',
      infoTitle: isDarkMode ? '#e2e8f0' : '#475569',
      infoText: isDarkMode ? '#94a3b8' : '#64748b',
      emptyBg: isDarkMode ? '#0f172a' : '#f8fafc',
      emptyText: isDarkMode ? '#94a3b8' : '#94a3b8',
      keyIconBg: isDarkMode ? '#334155' : '#f1f5f9',
      heading: isDarkMode ? '#f1f5f9' : '#1e293b',
      editCardBg: isDarkMode ? 'rgba(37, 99, 235, 0.14)' : '#eff6ff',
      bindHintBg: isDarkMode ? 'rgba(22, 101, 52, 0.22)' : '#f0fdf4',
      bindHintBorder: isDarkMode ? '#166534' : '#dcfce7',
      bindHintTitle: isDarkMode ? '#86efac' : '#166534',
      bindHintBody: isDarkMode ? '#cbd5e1' : '#64748b',
      agentAvatarBg: isDarkMode ? '#0f172a' : '#f8fafc',
      cardBg: isDarkMode ? '#1e293b' : '#fff',
      modalContent: isDarkMode ? '#0f172a' : undefined,
      modalHeader: isDarkMode ? '#1e293b' : undefined,
      modalBody: isDarkMode ? '#0f172a' : undefined,
    }),
    [isDarkMode]
  );
  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState<Overview | null>(null);
  const [unbinding, setUnbinding] = React.useState<string | null>(null);
  const [bindAgentId, setBindAgentId] = React.useState<string | undefined>(undefined);
  const [bindAccountId, setBindAccountId] = React.useState<string | undefined>(undefined);
  const [binding, setBinding] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState('credentials');

  // 凭证管理相关状态
  const [editingAccount, setEditingAccount] = React.useState<string | null>(null); // 'new' or accountId
  const [newAccId, setNewAccId] = React.useState('');
  const [accSecrets, setAccSecrets] = React.useState<Record<string, string>>({});
  const [savingAcc, setSavingAcc] = React.useState(false);
  const [deletingAcc, setDeletingAcc] = React.useState<string | null>(null);

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
      setBindAccountId(undefined);
      setActiveTab('credentials');
    } else {
      setData(null);
    }
  }, [visible, channel?.id, load]);

  const handleUnbindAgent = (agentId: string, accountId?: string) => {
    if (!channel?.id) return;
    const acc = (accountId || '').trim();
    Modal.confirm({
      title: t('common.confirmAction'),
      content: acc.length > 0 
        ? `确定要解除机器人「${agentId}」与账号「${acc}」的关联吗？`
        : `确定要解除机器人「${agentId}」与此渠道的关联吗？`,
      okText: t('channels.unbind'),
      okButtonProps: { danger: true },
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

  const handleBind = async (force = false) => {
    if (!channel?.id || !bindAgentId) {
      if (!bindAgentId) message.warning("请选择接收消息的机器人");
      return;
    }
    const targetAccId = bindAccountId || 'default';

    if (!force) {
      const existing = data?.bindings?.find((b) => (b.accountId || 'default') === targetAccId);
      if (existing && existing.agentId !== bindAgentId) {
        Modal.confirm({
          title: t('common.confirmAction'),
          content: `账号 "${targetAccId}" 当前已关联至机器人 "${existing.agentName}"，确认要切换至新选中的机器人吗？`,
          onOk: () => void handleBind(true),
        });
        return;
      }
    }

    setBinding(true);
    try {
      await api.post(`/v1/channels/${channel.id}/bind`, {
        agentId: bindAgentId,
        accountId: targetAccId === 'default' ? undefined : targetAccId,
      });
      message.success(t('channels.bindRouteSuccess'));
      setBindAccountId(undefined);
      setBindAgentId(undefined);
      await load();
      onAfterChange();
    } catch (err: any) {
      message.error(err?.response?.data?.message || err?.message || t('common.error'));
    } finally {
      setBinding(false);
    }
  };

  const handleSaveAccount = async () => {
    if (!channel?.id || !editingAccount) return;
    const finalId = editingAccount === 'new' ? newAccId.trim() : editingAccount;
    if (!finalId) {
      message.warning('请输入账号 ID');
      return;
    }
    setSavingAcc(true);
    try {
      await api.post('/v1/channels/setup', {
        channelId: channel.id,
        secrets: { ...accSecrets, accountId: finalId },
      });
      message.success(t('common.saveSuccess'));
      setEditingAccount(null);
      setNewAccId('');
      setAccSecrets({});
      await load();
    } catch (err: any) {
      message.error(err?.response?.data?.message || err?.message || t('common.error'));
    } finally {
      setSavingAcc(false);
    }
  };

  const handleDeleteAccount = (accId: string) => {
    if (!channel?.id) return;
    Modal.confirm({
      title: t('common.confirmAction'),
      content: `确定要删除账号 "${accId}" 的凭证吗？`,
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setDeletingAcc(accId);
        try {
          await api.delete(`/v1/channels/${channel.id}/accounts/${accId}`);
          message.success(t('common.deleteSuccess'));
          await load();
        } catch (err: any) {
          message.error(err?.message || t('common.error'));
        } finally {
          setDeletingAcc(null);
        }
      },
    });
  };

  const agentOptions = data?.candidateAgents?.map((a) => ({
    value: a.id,
    label: `${a.emoji || '🤖'} ${a.name || a.id} (${a.id})`,
  })) ?? [];

  const accountOptions = data?.credentials?.map(c => ({
    value: c.id,
    label: `${c.name} (${c.id})`
  })) ?? [];

  const renderCredentialsTab = () => {
    const isTelegram = channel?.id === 'telegram';
    const isQQBot = channel?.id === 'qqbot';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 13, color: shell.infoText, background: shell.infoBg, padding: '10px 14px', borderRadius: 8, border: `1px solid ${shell.border}` }}>
          <div style={{ fontWeight: 600, color: shell.infoTitle, marginBottom: 4 }}>{t('channels.credentialManagement')}</div>
          {t('channels.credentialManagementHint')}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!data?.credentials?.length ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: shell.emptyText, fontSize: 12, background: shell.emptyBg, borderRadius: 10, border: `1px dashed ${shell.border}` }}>暂无已配置账号，请点击下方按钮添加</div>
          ) : (
            data.credentials.map((acc) => (
              <Card key={acc.id} size="small" styles={{ body: { padding: '8px 12px' } }} style={{ borderRadius: 10, background: shell.cardBg, borderColor: shell.border }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ background: shell.keyIconBg, width: 32, height: 32, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Key size={14} style={{ color: shell.infoText }} /></div>
                    <div>
                      <div style={{ fontWeight: 600, color: shell.heading }}>{acc.name}</div>
                      <div style={{ fontSize: 11, color: shell.emptyText }}>ID: {acc.id}</div>
                    </div>
                  </div>
                  <Space>
                    <Button type="link" size="small" onClick={() => { setEditingAccount(acc.id); setAccSecrets({}); }}>{t('common.edit')}</Button>
                    {acc.id !== 'default' && (
                      <Button type="link" danger size="small" loading={deletingAcc === acc.id} onClick={() => handleDeleteAccount(acc.id)}>{t('common.delete')}</Button>
                    )}
                  </Space>
                </div>
              </Card>
            ))
          )}
        </div>

        {!editingAccount ? (
          <Button type="dashed" block icon={<Key size={14} />} onClick={() => setEditingAccount('new')} style={{ height: 40, borderRadius: 8 }}>
            {t('channels.addCredential')}
          </Button>
        ) : (
          <Card size="small" title={editingAccount === 'new' ? t('channels.addCredential') : `${t('common.edit')} ${editingAccount}`} style={{ border: '1px solid #3b82f6', background: shell.editCardBg, borderRadius: 10 }} styles={{ header: { background: 'transparent', borderBottomColor: shell.border, color: shell.heading } }}>
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              {editingAccount === 'new' && (
                <Input placeholder={t('channels.newAccountIdPlaceholder')} value={newAccId} onChange={(e) => setNewAccId(e.target.value)} style={{ borderRadius: 6 }} />
              )}
              
              {isTelegram ? (
                <Input.Password placeholder="Bot Token (例如: 123456:ABC-DEF...)" value={accSecrets.token || ''} onChange={(e) => setAccSecrets({ ...accSecrets, token: e.target.value })} style={{ borderRadius: 6 }} />
              ) : isQQBot ? (
                <>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <Input placeholder="App ID" value={accSecrets.appId || ''} onChange={(e) => setAccSecrets({ ...accSecrets, appId: e.target.value })} style={{ borderRadius: 6 }} />
                    <Input.Password placeholder="App Secret" value={accSecrets.appSecret || ''} onChange={(e) => setAccSecrets({ ...accSecrets, appSecret: e.target.value })} style={{ borderRadius: 6 }} />
                  </div>
                  <Input.Password placeholder="Token (可选)" value={accSecrets.token || ''} onChange={(e) => setAccSecrets({ ...accSecrets, token: e.target.value })} style={{ borderRadius: 6 }} />
                </>
              ) : (
                <div style={{ display: 'flex', gap: 10 }}>
                  <Input placeholder={t('channels.appIdPlaceholder') || 'App ID'} value={accSecrets.appId || ''} onChange={(e) => setAccSecrets({ ...accSecrets, appId: e.target.value })} style={{ borderRadius: 6 }} />
                  <Input.Password placeholder={t('channels.appSecretPlaceholder') || 'App Secret'} value={accSecrets.appSecret || ''} onChange={(e) => setAccSecrets({ ...accSecrets, appSecret: e.target.value })} style={{ borderRadius: 6 }} />
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
                <Button size="small" onClick={() => setEditingAccount(null)}>{t('common.cancel')}</Button>
                <Button type="primary" size="small" loading={savingAcc} onClick={() => void handleSaveAccount()}>{t('channels.saveCredential')}</Button>
              </div>
            </Space>
          </Card>
        )}
      </div>
    );
  };

  const renderBindingsTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 13, color: shell.bindHintBody, background: shell.bindHintBg, padding: '10px 14px', borderRadius: 8, border: `1px solid ${shell.bindHintBorder}` }}>
        <div style={{ fontWeight: 600, color: shell.bindHintTitle, marginBottom: 4 }}>关联机器人 (Agent Routing)</div>
        {t('channels.bindRelationshipHint')}
      </div>

      <Card size="small" title="添加新关联" style={{ borderRadius: 10, border: `1px solid ${shell.border}`, background: shell.cardBg }} styles={{ header: { background: 'transparent', borderBottomColor: shell.border, color: shell.heading } }}>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: shell.emptyText, marginBottom: 4 }}>1. 接收消息的机器人</div>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder={agentOptions.length > 0 ? "请选择机器人..." : "暂无可用机器人"}
                style={{ width: '100%' }}
                options={agentOptions}
                value={bindAgentId}
                onChange={(v) => setBindAgentId(v)}
                disabled={agentOptions.length === 0}
                allowClear
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: shell.emptyText, marginBottom: 4 }}>2. 关联的账号凭据</div>
              <Select
                placeholder={accountOptions.length > 0 ? "请选择凭据..." : "请先配置凭据"}
                style={{ width: '100%' }}
                options={accountOptions}
                value={bindAccountId}
                onChange={(v) => setBindAccountId(v)}
                disabled={accountOptions.length === 0}
                allowClear
              />
            </div>
          </div>
          <Button type="primary" block icon={<Link2 size={14} />} loading={binding} onClick={() => void handleBind()} style={{ height: 38, borderRadius: 8 }}>
            确认关联
          </Button>
        </Space>
      </Card>

      <div style={{ fontWeight: 600, fontSize: 13, color: shell.heading, marginTop: 4 }}>当前已生效关联</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!data?.bindings?.length ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: shell.emptyText, fontSize: 12, background: shell.emptyBg, borderRadius: 10, border: `1px dashed ${shell.border}` }}>{t('channels.noAgentBindings')}</div>
        ) : (
          data.bindings.map((b) => (
            <Card key={`${b.agentId}-${b.accountId}`} size="small" style={{ borderRadius: 10, border: `1px solid ${shell.hairline}`, background: shell.cardBg }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: shell.agentAvatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${shell.border}` }}>
                    <span style={{ fontSize: 18 }}>{b.emoji || '🤖'}</span>
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 600, color: shell.heading }}>{b.agentName}</span>
                      <Tag color="cyan" style={{ fontSize: 10, margin: 0 }}>{b.accountId || 'default'}</Tag>
                    </div>
                    <div style={{ fontSize: 11, color: shell.emptyText }}>Agent ID: {b.agentId}</div>
                  </div>
                </div>
                <Button danger type="text" size="small" icon={<Trash2 size={14} />} loading={unbinding === `${b.agentId}\x1e${(b.accountId || '').trim()}`} onClick={() => handleUnbindAgent(b.agentId, b.accountId)}>
                  {t('channels.unbind')}
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );

  return (
    <Modal
      title={`${t('channels.manageAccounts')} — ${channel?.name || ''}`}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={720}
      centered
      destroyOnClose
      wrapClassName={isDarkMode ? 'channel-accounts-modal--dark' : undefined}
      styles={{
        content: { background: shell.modalContent },
        header: { background: shell.modalHeader, borderBottom: `1px solid ${shell.border}`, color: shell.heading },
        body: { padding: '0 24px 24px 24px', background: shell.modalBody },
      }}
    >
      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
      ) : (
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            { key: 'credentials', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Key size={14} /> {t('channels.credentialManagement')}</span>, children: renderCredentialsTab() },
            { key: 'bindings', label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Users size={14} /> 关联机器人</span>, children: renderBindingsTab() },
          ]}
        />
      )}
      {isDarkMode && (
        <style>{`
          .channel-accounts-modal--dark .ant-tabs-nav::before { border-bottom-color: #334155 !important; }
          .channel-accounts-modal--dark .ant-tabs-tab { color: #94a3b8 !important; }
          .channel-accounts-modal--dark .ant-tabs-tab.ant-tabs-tab-active .ant-tabs-tab-btn { color: #f1f5f9 !important; }
          .channel-accounts-modal--dark .ant-tabs-ink-bar { background: #3b82f6 !important; }
          .channel-accounts-modal--dark .ant-select .ant-select-selector {
            background: #0f172a !important;
            border-color: #334155 !important;
            color: #e2e8f0 !important;
          }
          .channel-accounts-modal--dark .ant-input,
          .channel-accounts-modal--dark .ant-input-password {
            background: #0f172a !important;
            border-color: #334155 !important;
            color: #e2e8f0 !important;
          }
          .channel-accounts-modal--dark .ant-card-head-title { color: #f1f5f9 !important; }
        `}</style>
      )}
    </Modal>
  );
};

export default ChannelAccountsModal;
