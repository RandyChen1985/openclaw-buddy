import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Modal, message } from 'antd';
import { ChevronDown, ChevronUp, Command, Plus, Trash2 } from 'lucide-react';

export interface V3QuickCommandsProps {
  t: any;
  status: 'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error';
  onSend: (text: string) => void;
  isMobile: boolean;
  /** App 全局暗色：快捷 pill 与工具条 */
  isDarkMode?: boolean;
  /** 与新建会话等互斥：为 true 时禁用快捷指令发送 */
  sendBlocked?: boolean;
  /** 折叠/展开状态变化通知（用于上层控制分割线等 UI） */
  onExpandedChange?: (expanded: boolean) => void;
}

/**
 * v3 快捷指令组件：负责指令列表展示、展开/折叠、以及管理（新增/删除）弹窗。
 *
 * 说明：
 * - 保持原有接口：仍调用 `/v1/openclaw/chat/quick-commands` 的 get/post/delete
 * - 外部通过 `onSend` 决定发送行为（是否带引用/附件等）
 */
export function V3QuickCommands({
  t,
  status,
  onSend,
  isMobile,
  isDarkMode = false,
  sendBlocked = false,
  onExpandedChange
}: V3QuickCommandsProps) {
  const [quickCommands, setQuickCommands] = useState<any[]>([]);
  const [showQuickActions, setShowQuickActions] = useState<boolean>(() => localStorage.getItem('v3_show_quick_actions') !== 'false');
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [form] = Form.useForm();

  const canSend = status === 'authenticated' && !sendBlocked;

  /**
   * 拉取快捷指令列表。
   */
  const fetchQuickCommands = async () => {
    try {
      const api = await import('../../api').then(m => m.default);
      const res = await api.get('/v1/openclaw/chat/quick-commands');
      setQuickCommands(res.data || []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch quick commands:', err);
    }
  };

  useEffect(() => {
    fetchQuickCommands();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onExpandedChange?.(showQuickActions);
  }, [onExpandedChange, showQuickActions]);

  /**
   * 新增快捷指令。
   */
  const handleAddQuickCommand = async (values: any) => {
    try {
      const api = await import('../../api').then(m => m.default);
      const res = await api.post('/v1/openclaw/chat/quick-commands', values);
      if (res.data.status === 'success') {
        message.success(t('common.success'));
        form.resetFields();
        fetchQuickCommands();
      }
    } catch {
      message.error(t('common.error'));
    }
  };

  /**
   * 删除快捷指令。
   */
  const handleDeleteQuickCommand = async (id: number) => {
    try {
      const api = await import('../../api').then(m => m.default);
      const res = await api.delete(`/v1/openclaw/chat/quick-commands/${id}`);
      if (res.data.status === 'success') {
        message.success(t('common.success'));
        fetchQuickCommands();
      }
    } catch {
      message.error(t('common.error'));
    }
  };

  const topGap = useMemo(() => (isMobile ? 8 : 12), [isMobile]);

  const pillStyle = useMemo(
    () =>
      isDarkMode
        ? {
            borderRadius: 16,
            fontSize: 12,
            display: 'flex' as const,
            alignItems: 'center' as const,
            gap: 4,
            background: 'rgba(148, 163, 184, 0.12)',
            color: '#e2e8f0',
            border: '1px solid #334155',
            flexShrink: 0 as const
          }
        : {
            borderRadius: 16,
            fontSize: 12,
            display: 'flex' as const,
            alignItems: 'center' as const,
            gap: 4,
            background: '#f8fafc',
            color: '#64748b',
            border: '1px solid #e2e8f0',
            flexShrink: 0 as const
          },
    [isDarkMode]
  );

  const iconBtnStyle = useMemo(
    () => ({
      color: '#94a3b8',
      background: isDarkMode ? '#1e293b' : '#f1f5f9',
      border: isDarkMode ? '1px solid #334155' : 'none',
      borderRadius: 12,
      height: 24,
      width: 24,
      padding: 0,
      display: 'flex' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const
    }),
    [isDarkMode]
  );

  const expandBarLine = isDarkMode ? '#334155' : '#f1f5f9';
  const expandBtnStyle = {
    fontSize: 11,
    color: isDarkMode ? '#94a3b8' : '#94a3b8',
    height: 20,
    padding: '0 8px',
    borderRadius: 10,
    background: isDarkMode ? 'rgba(148, 163, 184, 0.12)' : '#f8fafc',
    border: isDarkMode ? '1px solid #334155' : 'none',
    display: 'flex' as const,
    alignItems: 'center' as const,
    flexShrink: 0 as const
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: showQuickActions ? 12 : 8, alignItems: 'center', transition: 'all 0.3s ease', paddingTop: topGap, width: '100%', overflow: 'hidden', boxSizing: 'border-box' }}>
        {showQuickActions ? (
          <>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', flex: 1, paddingBottom: 6, scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', whiteSpace: 'nowrap', minWidth: 0 } as React.CSSProperties}>
              {quickCommands.length === 0 ? (
                <span
                  onClick={() => setIsManageModalOpen(true)}
                  style={{ fontSize: 12, color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, userSelect: 'none' }}
                >
                  {t('chat.noQuickCommandsAdd')} <Command size={12} />
                </span>
              ) : quickCommands.map((item: any) => (
                <Button
                  key={item.id}
                  size="small"
                  style={pillStyle}
                  onClick={() => onSend(item.prompt)}
                  disabled={!canSend}
                >
                  {item.label}
                </Button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
              <Button
                type="text" size="small" icon={<Command size={14} />}
                style={iconBtnStyle}
                onClick={() => setIsManageModalOpen(true)}
              />
              <Button
                type="text" size="small" icon={<ChevronUp size={16} />}
                style={iconBtnStyle}
                onClick={() => { setShowQuickActions(false); localStorage.setItem('v3_show_quick_actions', 'false'); }}
              />
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
            <div style={{ height: 1, flex: 1, background: expandBarLine }} />
            <Button
              type="text" size="small" icon={<ChevronDown size={14} style={{ marginRight: 4 }} />}
              onClick={() => { setShowQuickActions(true); localStorage.setItem('v3_show_quick_actions', 'true'); }}
              style={expandBtnStyle}
            >
              {t('chat.expandQuickCommands', { defaultValue: '快捷指令' })}
            </Button>
            <div style={{ height: 1, flex: 1, background: expandBarLine }} />
          </div>
        )}
      </div>

      <Modal
        title={(
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: isDarkMode ? '#f1f5f9' : undefined }}>
            <Command size={20} color={isDarkMode ? '#93c5fd' : '#2563eb'} />
            <span>{t('chat.manageQuickCommands', { defaultValue: '管理快捷指令' })}</span>
          </div>
        )}
        open={isManageModalOpen}
        onCancel={() => setIsManageModalOpen(false)}
        footer={null}
        width={500}
        styles={isDarkMode ? {
          content: { background: '#1e293b' },
          header: { background: '#1e293b', borderBottom: '1px solid #334155', color: '#f1f5f9' },
          body: { background: '#1e293b' }
        } : undefined}
      >
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ fontSize: 13, color: isDarkMode ? '#94a3b8' : '#64748b', marginBottom: 12 }}>{t('chat.currentCommands', { defaultValue: '已添加' })}</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {quickCommands.map((cmd: any) => (
              <div key={cmd.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: isDarkMode ? '#0f172a' : '#f8fafc', borderRadius: 8, border: isDarkMode ? '1px solid #334155' : '1px solid #f1f5f9' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, color: isDarkMode ? '#e2e8f0' : '#1e293b', fontSize: 14 }}>{cmd.label}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmd.prompt}</div>
                </div>
                {!cmd.is_system && (
                  <Button type="text" danger icon={<Trash2 size={14} />} size="small" onClick={() => handleDeleteQuickCommand(cmd.id)} />
                )}
              </div>
            ))}
          </div>
        </div>
        <div style={{ borderTop: isDarkMode ? '1px solid #334155' : '1px solid #f1f5f9', paddingTop: 24 }}>
          <h4 style={{ fontSize: 13, color: isDarkMode ? '#94a3b8' : '#64748b', marginBottom: 12 }}>{t('chat.addCommand', { defaultValue: '添加新指令' })}</h4>
          <Form form={form} layout="vertical" onFinish={handleAddQuickCommand}>
            <Form.Item name="label" label={t('chat.commandLabel', { defaultValue: '按钮名称' })} rules={[{ required: true }]}>
              <Input placeholder={t('chat.commandLabelPlaceholder', { defaultValue: '例如：写一首诗' })} style={{ borderRadius: 8 }} />
            </Form.Item>
            <Form.Item name="prompt" label={t('chat.commandPrompt', { defaultValue: '指令内容' })} rules={[{ required: true }]}>
              <Input.TextArea placeholder={t('chat.commandPromptPlaceholder', { defaultValue: '输入该按钮触发的内容...' })} autoSize={{ minRows: 2 }} style={{ borderRadius: 8 }} />
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<Plus size={16} />} block style={{ borderRadius: 8, height: 40 }}>
              {t('chat.addCommandBtn', { defaultValue: '添加快捷指令' })}
            </Button>
          </Form>
        </div>
      </Modal>
    </>
  );
}

