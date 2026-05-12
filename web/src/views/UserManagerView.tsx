import React, { useEffect, useMemo, useState } from 'react';
import {
  Card, Table, Button, Input, Tag, Space, Modal, Form, Select,
  Switch, message, Typography, Empty, Dropdown, Checkbox, Pagination, Divider, Tabs, Row, Col, Spin,
} from 'antd';
import { Plus, RefreshCw, KeyRound, KeySquare, Pencil, Search, ShieldCheck, MoreHorizontal, Trash2, Bot, Cpu, Image as ImageIcon, Copy, Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { getBaseURL } from '../utils/url';
import dayjs from 'dayjs';
import Tooltip from '../components/common/AppTooltip';

const { Title, Text } = Typography;

interface UserItem {
  id: number;
  username: string;
  real_name: string;
  remark: string;
  status: number;
  created_at: string;
  updated_at: string;
  role_keys: string[];
  has_api_token?: boolean;
}

function buildUserTokenLoginUrl(token: string) {
  const base = getBaseURL();
  const originRoot = `${window.location.origin}${base || ''}`.replace(/\/+$/, '');
  return `${originRoot}/?token=${encodeURIComponent(token)}`;
}

interface RoleItem {
  id: number;
  key: string;
  name: string;
  remark: string;
  is_builtin: boolean;
}

interface PermissionItem {
  id: number;
  key: string;
  type: string;
  name: string;
  menu_key: string;
  remark: string;
}

interface BotItem {
  id: string;
  name?: string;
  model?: string;
  provider?: string;
  capabilities?: string[];
  input?: string[];
}

interface UserManagerViewProps {
  isDarkMode?: boolean;
  /** 当前主体是否拥有 menu:system:user:manage 权限；通常调用页面只在有权限时才挂载本组件 */
  canManage?: boolean;
  isMobile?: boolean;
}

const UserManagerView: React.FC<UserManagerViewProps> = ({ isDarkMode = false, canManage = true, isMobile = false }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [users, setUsers] = useState<UserItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);

  const [userPermOpen, setUserPermOpen] = useState(false);
  const [permTarget, setPermTarget] = useState<UserItem | null>(null);
  const [userPermTab, setUserPermTab] = useState<'menu' | 'bots'>('menu');
  const [selectedPermKeys, setSelectedPermKeys] = useState<string[]>([]);
  const [selectedBotIDs, setSelectedBotIDs] = useState<string[]>([]);
  const [botsLoading, setBotsLoading] = useState(false);
  const [bots, setBots] = useState<BotItem[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserItem | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserItem | null>(null);

  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenTarget, setTokenTarget] = useState<UserItem | null>(null);
  const [tokenInfo, setTokenInfo] = useState<{ configured: boolean; token: string } | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);

  const [form] = Form.useForm();
  const [resetForm] = Form.useForm();
  const horizontalFormLayout = {
    labelCol: { flex: '96px' },
    wrapperCol: { flex: 1 },
    labelAlign: 'left' as const,
  };

  const fetchUsers = async (kw?: string) => {
    setLoading(true);
    try {
      const res = await api.get('/v1/system/users', { params: kw ? { keyword: kw } : {} });
      const items = (res.data as any)?.items || [];
      setUsers(items);
    } catch (err: any) {
      if (err?.response?.status === 403) {
        message.error(t('users.noPermission'));
      } else {
        message.error(err?.response?.data?.message || err?.message || t('common.error'));
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    try {
      const res = await api.get('/v1/system/roles');
      setRoles((res.data as any)?.items || []);
    } catch {
      // ignore role load failure—界面降级为只展示已有 role_keys
    }
  };

  const fetchPermissions = async () => {
    try {
      const res = await api.get('/v1/system/permissions', { params: { type: 'menu' } });
      setPermissions((res.data as any)?.items || []);
    } catch {
      setPermissions([]);
    }
  };

  useEffect(() => {
    if (!canManage) return;
    fetchUsers();
    fetchRoles();
    fetchPermissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const roleOptions = useMemo(
    () => roles.map(r => ({ value: r.key, label: `${r.name} (${r.key})` })),
    [roles]
  );

  const openUserPerm = async (row: UserItem) => {
    setPermTarget(row);
    setSelectedPermKeys([]);
    setSelectedBotIDs([]);
    setUserPermTab('menu');
    setUserPermOpen(true);
    setBotsLoading(true);
    try {
      const [permRes, botsRes, userBotsRes] = await Promise.all([
        api.get(`/v1/system/users/${row.id}/permissions`),
        api.get('/v1/openclaw/bots-models'),
        api.get(`/v1/system/users/${row.id}/bots`),
      ]);
      const keys = (permRes.data as any)?.permission_keys || [];
      setSelectedPermKeys(Array.isArray(keys) ? keys : []);

      const botsList = (botsRes.data as any)?.data?.bots || (botsRes.data as any)?.bots || [];
      setBots(Array.isArray(botsList) ? botsList : []);

      const botIDs = (userBotsRes.data as any)?.bot_ids || [];
      setSelectedBotIDs(Array.isArray(botIDs) ? botIDs : []);
    } catch {
      setSelectedPermKeys([]);
      setBots([]);
      setSelectedBotIDs([]);
    } finally {
      setBotsLoading(false);
    }
  };

  const saveUserPerm = async () => {
    if (!permTarget) return;
    try {
      setSubmitting(true);
      await Promise.all([
        api.put(`/v1/system/users/${permTarget.id}/permissions`, { permission_keys: selectedPermKeys }),
        api.put(`/v1/system/users/${permTarget.id}/bots`, { bot_ids: selectedBotIDs }),
      ]);
      message.success(t('common.saveSuccess'));
      setUserPermOpen(false);
    } catch (err: any) {
      message.error(err?.response?.data?.message || err?.message || t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const permByMenuKey = useMemo(() => {
    const m = new Map<string, PermissionItem>();
    for (const p of permissions) {
      if (p.menu_key) m.set(p.menu_key, p);
    }
    return m;
  }, [permissions]);

  const [mobilePage, setMobilePage] = useState(1);
  const mobilePageSize = 8;
  const mobileTotalPages = Math.max(1, Math.ceil(users.length / mobilePageSize));
  const mobileUsers = useMemo(() => {
    const start = (mobilePage - 1) * mobilePageSize;
    return users.slice(start, start + mobilePageSize);
  }, [users, mobilePage]);

  const permGroups = useMemo(() => ([
    {
      title: t('common.monitor'),
      items: [
        { menuKey: 'dashboard', label: t('common.dashboard') },
        { menuKey: 'audit', label: t('audit.title') },
        { menuKey: 'logs', label: t('common.logs') },
        { menuKey: 'tools', label: t('common.tools') },
        { menuKey: 'shell', label: t('common.shell') },
        { menuKey: 'security', label: t('security.title') },
        { menuKey: 'cron', label: t('common.cron') },
      ],
    },
    {
      title: t('common.assets'),
      items: [
        { menuKey: 'chat', label: t('common.chat') },
        { menuKey: 'tui', label: t('common.tuiChat') },
        { menuKey: 'bots-models', label: t('common.bots') },
        { menuKey: 'skills', label: t('common.skills') },
        { menuKey: 'plugins', label: t('plugins.title') },
        { menuKey: 'experts', label: t('common.expertMarket') },
      ],
    },
    {
      title: t('common.binding'),
      items: [
        { menuKey: 'components', label: t('common.channels') },
        { menuKey: 'devices', label: t('common.devices') },
      ],
    },
    {
      title: t('common.systemAdmin'),
      items: [
        { menuKey: 'system.users', label: t('common.userManagement') },
      ],
    },
    {
      title: t('common.external'),
      items: [
        { menuKey: 'lobster-panel', label: t('common.lobsterPanel') },
      ],
    },
  ]), [t]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 1, role_keys: ['user'] });
    setModalOpen(true);
  };

  const openEdit = (row: UserItem) => {
    setEditing(row);
    form.setFieldsValue({
      username: row.username,
      real_name: row.real_name,
      remark: row.remark,
      status: row.status,
      role_keys: row.role_keys?.length ? row.role_keys : ['user'],
    });
    setModalOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (editing) {
        await api.put(`/v1/system/users/${editing.id}`, {
          real_name: values.real_name || '',
          remark: values.remark || '',
          status: values.status,
          role_keys: values.role_keys || [],
        });
        message.success(t('users.updateSuccess'));
      } else {
        await api.post('/v1/system/users', {
          username: values.username,
          real_name: values.real_name || '',
          remark: values.remark || '',
          password: values.password,
          role_keys: values.role_keys || [],
        });
        message.success(t('users.createSuccess'));
      }
      setModalOpen(false);
      fetchUsers(keyword);
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || err?.message || t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const openReset = (row: UserItem) => {
    setResetTarget(row);
    resetForm.resetFields();
    setResetOpen(true);
  };

  const submitReset = async () => {
    try {
      const values = await resetForm.validateFields();
      if (!resetTarget) return;
      setSubmitting(true);
      await api.post(`/v1/system/users/${resetTarget.id}/reset-password`, { password: values.password });
      message.success(t('users.passwordReset'));
      setResetOpen(false);
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || err?.message || t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const removeUser = async (row: UserItem) => {
    try {
      await api.delete(`/v1/system/users/${row.id}`);
      message.success(t('users.deleteSuccess'));
      fetchUsers(keyword);
    } catch (err: any) {
      message.error(err?.response?.data?.message || err?.message || t('common.error'));
    }
  };

  const openApiTokenModal = async (row: UserItem) => {
    setTokenTarget(row);
    setTokenModalOpen(true);
    setTokenInfo(null);
    setTokenLoading(true);
    try {
      const res = await api.get(`/v1/system/users/${row.id}/api-token`);
      setTokenInfo({
        configured: !!res.data?.configured,
        token: typeof res.data?.token === 'string' ? res.data.token : '',
      });
    } catch (err: any) {
      message.error(err?.response?.data?.message || err?.message || t('common.error'));
      setTokenModalOpen(false);
    } finally {
      setTokenLoading(false);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(t('users.apiTokenCopySuccess'));
    } catch {
      message.error(t('common.error'));
    }
  };

  const generateApiToken = async () => {
    if (!tokenTarget) return;
    try {
      setTokenLoading(true);
      const res = await api.post(`/v1/system/users/${tokenTarget.id}/api-token/generate`);
      const tok = res.data?.token as string;
      setTokenInfo({ configured: true, token: tok || '' });
      message.success(t('users.apiTokenGenerated'));
      fetchUsers(keyword);
    } catch (err: any) {
      message.error(err?.response?.data?.message || err?.message || t('common.error'));
    } finally {
      setTokenLoading(false);
    }
  };

  const resetApiToken = async () => {
    if (!tokenTarget) return;
    try {
      setTokenLoading(true);
      const res = await api.post(`/v1/system/users/${tokenTarget.id}/api-token/reset`);
      const tok = res.data?.token as string;
      setTokenInfo({ configured: true, token: tok || '' });
      message.success(t('users.apiTokenResetDone'));
      fetchUsers(keyword);
    } catch (err: any) {
      message.error(err?.response?.data?.message || err?.message || t('common.error'));
    } finally {
      setTokenLoading(false);
    }
  };

  const renderRoles = (keys: string[]) => {
    if (!keys || keys.length === 0) return <Tag>—</Tag>;
    return (
      <Space size={4} wrap>
        {keys.map(k => {
          const matched = roles.find(r => r.key === k);
          const color = k === 'admin' ? 'geekblue' : 'default';
          return <Tag color={color} key={k}>{matched?.name || k}</Tag>;
        })}
      </Space>
    );
  };

  if (!canManage) {
    return (
      <Card>
        <Empty description={t('users.noPermission')} />
      </Card>
    );
  }

  return (
    <div style={{ padding: 0 }}>
      <Card
        bodyStyle={{ padding: 0 }}
        style={{ background: isDarkMode ? '#1e293b' : '#fff' }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: `1px solid ${isDarkMode ? '#334155' : '#f1f5f9'}`,
          flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <Title level={4} style={{ margin: 0, color: isDarkMode ? '#f1f5f9' : '#1e293b' }}>
              <ShieldCheck size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
              {t('users.title')}
            </Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('users.search')}
            </Text>
          </div>
          {isMobile ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
              <Input
                allowClear
                prefix={<Search size={14} />}
                placeholder={t('users.search')}
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                onPressEnter={() => fetchUsers(keyword)}
                style={{ flex: 1, minWidth: 0 }}
              />
              <Button size="middle" onClick={() => fetchUsers(keyword)} icon={<RefreshCw size={14} />}>
                {t('common.refresh')}
              </Button>
              <Button size="middle" type="primary" icon={<Plus size={14} />} onClick={openCreate}>
                {t('users.createUser')}
              </Button>
            </div>
          ) : (
            <Space wrap>
              <Input
                allowClear
                prefix={<Search size={14} />}
                placeholder={t('users.search')}
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                onPressEnter={() => fetchUsers(keyword)}
                style={{ width: 240 }}
              />
              <Button onClick={() => fetchUsers(keyword)} icon={<RefreshCw size={14} />}>
                {t('common.refresh')}
              </Button>
              <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>
                {t('users.createUser')}
              </Button>
              {/* 权限现在直接挂在用户上：入口放到每行操作区 */}
            </Space>
          )}
        </div>

        {isMobile ? (
          <div style={{ padding: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {mobileUsers.map(u => (
                <Card
                  key={u.id}
                  size="small"
                  styles={{ body: { padding: 12 } }}
                  style={{
                    borderRadius: 16,
                    border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
                    background: isDarkMode ? '#0f172a' : '#fff',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, fontSize: 16, color: isDarkMode ? '#f1f5f9' : '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {u.username}
                      </div>
                      <div style={{ marginTop: 6 }}>
                        {renderRoles(u.role_keys)}
                        <span style={{ marginLeft: 8 }}>
                          {u.status === 1
                            ? <Tag color="success">{t('users.active')}</Tag>
                            : <Tag color="default">{t('users.disabled')}</Tag>}
                        </span>
                        <span style={{ marginLeft: 8 }}>
                          {u.has_api_token
                            ? <Tag color="processing">{t('users.apiTokenConfigured')}</Tag>
                            : <Tag>{t('users.apiTokenUnset')}</Tag>}
                        </span>
                      </div>
                    </div>
                    <Space size={2} wrap>
                      <Button size="small" type="text" icon={<Pencil size={18} />} onClick={() => openEdit(u)} />
                      <Button size="small" type="text" icon={<KeyRound size={18} />} onClick={() => openReset(u)} />
                      <Button size="small" type="text" icon={<KeySquare size={18} />} onClick={() => openApiTokenModal(u)} />
                      {!u.role_keys?.includes('admin') && (
                        <Button size="small" type="text" icon={<ShieldCheck size={18} />} onClick={() => openUserPerm(u)} />
                      )}
                      <Dropdown
                        trigger={['click']}
                        menu={{
                          items: [
                            { key: 'delete', icon: <Trash2 size={16} />, label: <span style={{ fontWeight: 700 }}>{t('common.delete')}</span>, danger: true },
                          ],
                          onClick: ({ key }) => {
                            if (key !== 'delete') return;
                            Modal.confirm({
                              title: t('users.deleteConfirm', { name: u.username }),
                              okText: t('common.delete'),
                              cancelText: t('common.cancel'),
                              okButtonProps: { danger: true },
                              onOk: () => removeUser(u),
                            });
                          },
                        }}
                      >
                        <Button size="small" type="text" icon={<MoreHorizontal size={18} />} />
                      </Dropdown>
                    </Space>
                  </div>
                  {(u.real_name || u.remark) && (
                    <>
                      <Divider style={{ margin: '10px 0' }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {u.real_name && (
                          <div style={{ display: 'flex', gap: 8 }}>
                            <span style={{ color: isDarkMode ? '#94a3b8' : '#64748b', width: 64, flexShrink: 0 }}>{t('users.realName')}</span>
                            <span style={{ color: isDarkMode ? '#e2e8f0' : '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.real_name}</span>
                          </div>
                        )}
                        {u.remark && (
                          <div style={{ display: 'flex', gap: 8 }}>
                            <span style={{ color: isDarkMode ? '#94a3b8' : '#64748b', width: 64, flexShrink: 0 }}>{t('users.remark')}</span>
                            <span style={{ color: isDarkMode ? '#e2e8f0' : '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.remark}</span>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </Card>
              ))}
              {users.length > mobilePageSize && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                  <Pagination
                    simple
                    current={mobilePage}
                    pageSize={mobilePageSize}
                    total={users.length}
                    onChange={(p) => setMobilePage(Math.min(Math.max(1, p), mobileTotalPages))}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <Table
            rowKey="id"
            loading={loading}
            dataSource={users}
            size="middle"
            pagination={{ pageSize: 20, showSizeChanger: false }}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: t('users.username'), dataIndex: 'username', width: 140, ellipsis: true },
              { title: t('users.realName'), dataIndex: 'real_name', width: 96, ellipsis: true, render: (v: string) => v || '—' },
              { title: t('users.roles'), dataIndex: 'role_keys', width: 120, render: (v: string[]) => renderRoles(v) },
              {
                title: t('users.status'),
                dataIndex: 'status',
                width: 90,
                render: (v: number) => v === 1
                  ? <Tag color="success">{t('users.active')}</Tag>
                  : <Tag color="default">{t('users.disabled')}</Tag>,
              },
              {
                title: t('users.apiToken'),
                dataIndex: 'has_api_token',
                width: 100,
                render: (v: boolean) => v
                  ? <Tag color="processing">{t('users.apiTokenConfigured')}</Tag>
                  : <Tag>{t('users.apiTokenUnset')}</Tag>,
              },
              { title: t('users.remark'), dataIndex: 'remark', width: 200, render: (v: string) => v || '—' },
              {
                title: t('users.createdAt'),
                dataIndex: 'created_at',
                width: 170,
                render: (v: string) => (
                  <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {dayjs(v).isValid() ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : (v || '—')}
                  </span>
                ),
              },
              {
                title: t('common.action'),
                key: 'action',
                width: 280,
                render: (_: any, row: UserItem) => (
                  <Space size={2} wrap>
                    <Tooltip title={t('common.edit')}>
                      <Button size="small" type="text" icon={<Pencil size={16} />} onClick={() => openEdit(row)} style={{ color: '#334155' }} />
                    </Tooltip>
                    <Tooltip title={t('users.resetPassword')}>
                      <Button size="small" type="text" icon={<KeyRound size={16} />} onClick={() => openReset(row)} style={{ color: '#334155' }} />
                    </Tooltip>
                    <Tooltip title={t('users.apiTokenTitle')}>
                      <Button size="small" type="text" icon={<KeySquare size={16} />} onClick={() => openApiTokenModal(row)} style={{ color: '#334155' }} />
                    </Tooltip>
                    {!row.role_keys?.includes('admin') && (
                      <Tooltip title={t('users.permissions')}>
                        <Button size="small" type="text" icon={<ShieldCheck size={16} />} onClick={() => openUserPerm(row)} style={{ color: '#334155' }} />
                      </Tooltip>
                    )}
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [{ key: 'delete', icon: <Trash2 size={14} />, label: <span style={{ fontWeight: 700 }}>{t('common.delete')}</span>, danger: true }],
                        onClick: ({ key }) => {
                          if (key !== 'delete') return;
                          Modal.confirm({
                            title: t('users.deleteConfirm', { name: row.username }),
                            okText: t('common.delete'),
                            cancelText: t('common.cancel'),
                            okButtonProps: { danger: true },
                            onOk: () => removeUser(row),
                          });
                        },
                      }}
                    >
                      <Tooltip title={t('common.more')}>
                        <Button size="small" type="text" icon={<MoreHorizontal size={16} />} style={{ color: '#334155' }} />
                      </Tooltip>
                    </Dropdown>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal
        title={editing ? t('users.editUser') : t('users.createUser')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        confirmLoading={submitting}
        destroyOnClose
        okText={t('common.save')}
        cancelText={t('common.cancel')}
      >
        <Form
          form={form}
          layout="horizontal"
          colon={false}
          preserve={false}
          {...horizontalFormLayout}
        >
          <Form.Item
            name="username"
            label={t('users.username')}
            rules={[
              { required: true, message: t('users.usernameRule') },
              { pattern: /^[A-Za-z0-9_]{2,32}$/, message: t('users.usernameRule') },
            ]}
            style={{ marginBottom: 12 }}
          >
            <Input disabled={!!editing} placeholder={t('users.usernameRule')} />
          </Form.Item>

          {!editing && (
            <Form.Item
              name="password"
              label={t('users.password')}
              rules={[
                { required: true, min: 6, message: t('users.passwordTooShort') },
              ]}
              style={{ marginBottom: 12 }}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          )}

          <Form.Item name="real_name" label={t('users.realName')} style={{ marginBottom: 12 }}>
            <Input maxLength={64} />
          </Form.Item>

          <Form.Item name="remark" label={t('users.remark')} style={{ marginBottom: 12 }}>
            <Input.TextArea rows={2} maxLength={200} />
          </Form.Item>

          <Form.Item
            name="role_keys"
            label={t('users.roles')}
            rules={[{ required: true, message: t('users.rolesPlaceholder') }]}
            style={{ marginBottom: 12 }}
          >
            <Select
              mode="multiple"
              placeholder={t('users.rolesPlaceholder')}
              options={roleOptions}
            />
          </Form.Item>

          <Form.Item
            name="status"
            label={t('users.status')}
            valuePropName="checked"
            getValueFromEvent={(checked: boolean) => (checked ? 1 : 0)}
            getValueProps={(v) => ({ checked: v === 1 })}
            style={{ marginBottom: 0 }}
          >
            <Switch checkedChildren={t('users.active')} unCheckedChildren={t('users.disabled')} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`${t('users.resetPassword')}${resetTarget ? ` · ${resetTarget.username}` : ''}`}
        open={resetOpen}
        onCancel={() => setResetOpen(false)}
        onOk={submitReset}
        confirmLoading={submitting}
        destroyOnClose
        okText={t('common.save')}
        cancelText={t('common.cancel')}
      >
        <Form
          form={resetForm}
          layout="horizontal"
          colon={false}
          preserve={false}
          {...horizontalFormLayout}
        >
          <Form.Item
            name="password"
            label={t('users.newPassword')}
            rules={[{ required: true, min: 6, message: t('users.passwordTooShort') }]}
            style={{ marginBottom: 0 }}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`${t('users.apiTokenTitle')}${tokenTarget ? ` · ${tokenTarget.username}` : ''}`}
        open={tokenModalOpen}
        onCancel={() => {
          setTokenModalOpen(false);
          setTokenTarget(null);
          setTokenInfo(null);
        }}
        footer={null}
        destroyOnClose
        width={560}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13, lineHeight: 1.6 }}>
          {t('users.apiTokenHint')}
        </Text>
        {tokenLoading && !tokenInfo ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '28px 0' }}>
            <Spin />
          </div>
        ) : tokenInfo ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <Tag color={tokenInfo.configured ? 'success' : 'default'}>
                {tokenInfo.configured ? t('users.apiTokenConfigured') : t('users.apiTokenUnset')}
              </Tag>
            </div>
            {tokenInfo.configured && tokenInfo.token ? (
              <>
                <Input.TextArea
                  readOnly
                  autoSize={{ minRows: 2, maxRows: 5 }}
                  value={tokenInfo.token}
                  style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, marginBottom: 12 }}
                />
                <Space wrap>
                  <Button type="primary" icon={<Copy size={14} />} onClick={() => copyText(tokenInfo.token)}>
                    {t('users.apiTokenCopy')}
                  </Button>
                  <Button icon={<Link2 size={14} />} onClick={() => copyText(buildUserTokenLoginUrl(tokenInfo.token))}>
                    {t('users.apiTokenCopyLoginUrl')}
                  </Button>
                  <Button
                    danger
                    loading={tokenLoading}
                    onClick={() => {
                      Modal.confirm({
                        title: t('users.apiTokenReset'),
                        content: t('users.apiTokenResetConfirm'),
                        okText: t('common.confirm'),
                        cancelText: t('common.cancel'),
                        onOk: () => resetApiToken(),
                      });
                    }}
                  >
                    {t('users.apiTokenReset')}
                  </Button>
                </Space>
              </>
            ) : (
              <Button type="primary" loading={tokenLoading} onClick={generateApiToken}>
                {t('users.apiTokenGenerate')}
              </Button>
            )}
          </>
        ) : null}
      </Modal>

      <Modal
        title={`${t('users.userPermissions')}${permTarget ? ` · ${permTarget.username}` : ''}`}
        open={userPermOpen}
        onCancel={() => setUserPermOpen(false)}
        onOk={saveUserPerm}
        confirmLoading={submitting}
        destroyOnClose
        okText={t('common.save')}
        cancelText={t('common.cancel')}
      >
        <Tabs
          activeKey={userPermTab}
          onChange={(k) => setUserPermTab(k as any)}
          items={[
            {
              key: 'menu',
              label: t('users.menuPermissions', { defaultValue: '菜单权限' }),
              children: (
                <div style={{
                  border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
                  borderRadius: 12,
                  padding: 12,
                  maxHeight: 360,
                  overflow: 'auto',
                  background: isDarkMode ? '#0f172a' : '#fff',
                }}>
                  <Checkbox.Group
                    style={{ width: '100%' }}
                    value={selectedPermKeys}
                    onChange={(vals) => setSelectedPermKeys(vals as string[])}
                  >
                    <Space direction="vertical" size={14} style={{ width: '100%' }}>
                      {permGroups.map(g => (
                        <div key={g.title}>
                          <div style={{ fontWeight: 900, marginBottom: 8, color: isDarkMode ? '#e2e8f0' : '#0f172a' }}>
                            {g.title}
                          </div>
                          <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            {g.items.map(it => {
                              const p = permByMenuKey.get(it.menuKey);
                              const disabled = !p;
                              return (
                                <div key={it.menuKey} style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: 10,
                                  padding: '10px 12px',
                                  borderRadius: 12,
                                  border: `1px solid ${isDarkMode ? '#1e293b' : '#f1f5f9'}`,
                                  background: isDarkMode ? '#0b1220' : '#fff',
                                  opacity: disabled ? 0.5 : 1,
                                }}>
                                  <Checkbox value={p?.key} disabled={disabled} />
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 800 }}>{it.label}</div>
                                    <div style={{ fontSize: 12, color: isDarkMode ? '#94a3b8' : '#64748b' }}>
                                      {p ? `${p.key} · menu_key=${p.menu_key}` : `缺少权限点（menu_key=${it.menuKey}）`}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </Space>
                        </div>
                      ))}
                      {permissions.length === 0 && <Empty description="暂无权限点" />}
                    </Space>
                  </Checkbox.Group>
                </div>
              )
            },
            {
              key: 'bots',
              label: t('users.botPermissions', { defaultValue: 'Bot 权限' }),
              children: (
                <div style={{
                  border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
                  borderRadius: 12,
                  padding: 12,
                  maxHeight: 360,
                  overflow: 'auto',
                  background: isDarkMode ? '#0f172a' : '#fff',
                }}>
                  {botsLoading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
                      <Spin />
                    </div>
                  ) : (
                    <>
                      {bots.length === 0 ? (
                        <Empty description={t('bots.empty', { defaultValue: '暂无 Bot' })} />
                      ) : (
                        <Row gutter={[12, 12]}>
                          {bots.map((b) => {
                            const checked = selectedBotIDs.includes(b.id);
                            const supportsImage = !!(b.capabilities?.includes?.('image') || b.input?.includes?.('image'));
                            const toggle = () => {
                              setSelectedBotIDs((prev) => (
                                prev.includes(b.id) ? prev.filter(x => x !== b.id) : [...prev, b.id]
                              ));
                            };
                            return (
                              <Col xs={24} sm={24} md={12} lg={12} xl={12} key={b.id}>
                                <Card
                                  hoverable
                                  onClick={toggle}
                                  styles={{ body: { padding: 14 } }}
                                  style={{
                                    borderRadius: 16,
                                    border: checked
                                      ? `1px solid ${isDarkMode ? '#60a5fa' : '#3b82f6'}`
                                      : `1px solid ${isDarkMode ? '#1e293b' : '#e2e8f0'}`,
                                    background: isDarkMode ? '#0b1220' : '#fff',
                                    position: 'relative',
                                    minHeight: 86,
                                  }}
                                >
                                  <Checkbox
                                    checked={checked}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      toggle();
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ position: 'absolute', top: 10, right: 10 }}
                                  />
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div style={{
                                      width: 42,
                                      height: 42,
                                      borderRadius: 10,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      background: isDarkMode ? '#111827' : '#eff6ff',
                                      border: `1px solid ${isDarkMode ? '#1f2937' : '#dbeafe'}`,
                                      flexShrink: 0,
                                    }}>
                                      <Bot size={20} color={isDarkMode ? '#93c5fd' : '#2563eb'} />
                                    </div>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                      <div
                                        title={b.name || b.id}
                                        style={{
                                          fontWeight: 900,
                                          fontSize: 14,
                                          color: isDarkMode ? '#e2e8f0' : '#0f172a',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap'
                                        }}
                                      >
                                        {b.name || b.id}
                                      </div>
                                      <div
                                        title={b.model || b.id}
                                        style={{
                                          marginTop: 4,
                                          fontSize: 12,
                                          color: isDarkMode ? '#94a3b8' : '#64748b',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap'
                                        }}
                                      >
                                        {b.model || b.id}
                                      </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, color: isDarkMode ? '#94a3b8' : '#64748b' }}>
                                      <Cpu size={14} />
                                      {supportsImage && <ImageIcon size={14} />}
                                    </div>
                                  </div>
                                </Card>
                              </Col>
                            );
                          })}
                        </Row>
                      )}
                    </>
                  )}
                </div>
              )
            }
          ]}
        />
      </Modal>
    </div>
  );
};

export default UserManagerView;
