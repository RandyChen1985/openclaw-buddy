import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Drawer, Empty, Popconfirm, Popover, Space, Spin, Table, Tag, Tooltip, Typography, message } from 'antd';
import { RefreshCw, Clock, CheckCircle2, XCircle, Trash2, HelpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import api from '../api';

const { Text, Paragraph, Title } = Typography;

type CronSchedule = { expr?: string; kind?: string; tz?: string };
type CronDelivery = { mode?: string; to?: string; channel?: string };
type CronState = {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
};

type CronJob = {
  id: string;
  name?: string;
  enabled?: boolean;
  agentId?: string;
  sessionKey?: string;
  sessionTarget?: string;
  schedule?: CronSchedule;
  delivery?: CronDelivery;
  state?: CronState;
  updatedAtMs?: number;
};

type CronJobsResponse = {
  jobs?: CronJob[];
  total?: number;
};

export type CronJobsViewProps = {
  isDarkMode?: boolean;
};

const formatMs = (ms?: number) => {
  if (!ms || ms <= 0) return '-';
  return dayjs(ms).format('YYYY-MM-DD HH:mm:ss');
};

export default function CronJobsView({ isDarkMode = false }: CronJobsViewProps) {
  const { t } = useTranslation();
  const borderDefault = isDarkMode ? '#334155' : '#e2e8f0';
  const cardBg = isDarkMode ? '#1e293b' : '#fff';
  const pageHeading = isDarkMode ? '#f1f5f9' : '#0f172a';
  const pageMuted = isDarkMode ? '#94a3b8' : '#64748b';
  const [loading, setLoading] = useState(false);
  const [operatingId, setOperatingId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState('');
  const [data, setData] = useState<CronJobsResponse | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [helpOpen, setHelpOpen] = useState(false);

  const fetchData = async (refresh = false) => {
    setLoading(true);
    try {
      const res = await api.get(`/v1/openclaw/cron-jobs${refresh ? '?refresh=true' : ''}`);
      const raw = res.data;
      const payload = raw?.data ?? raw;
      setData(payload?.data ?? payload);
      setUpdatedAt(payload?.updated_at || '');
      if (refresh) message.success(t('cron.syncSuccess', { defaultValue: '定时任务已同步' }));
    } catch (e: any) {
      message.error(e?.message || t('cron.fetchFailed', { defaultValue: '获取定时任务失败' }));
    } finally {
      setLoading(false);
    }
  };

  const operate = async (action: 'enable' | 'disable' | 'remove', id: string) => {
    if (!id) return;
    setOperatingId(id);
    try {
      if (action === 'remove') {
        await api.delete(`/v1/openclaw/cron-jobs/${id}`);
      } else {
        await api.post(`/v1/openclaw/cron-jobs/${action}`, { id });
      }
      message.info(t('cron.taskStarted', { defaultValue: '任务已提交，请关注任务中心状态' }));
      // 轻量自动对账：稍后强制刷新一次缓存
      setTimeout(() => fetchData(true), 1200);
    } catch (e: any) {
      message.error(e?.message || t('common.error', { defaultValue: '错误' }));
    } finally {
      setOperatingId(null);
    }
  };

  useEffect(() => {
    fetchData(false);
  }, []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const jobs = useMemo(() => {
    const j = (data as any)?.jobs || (data as any)?.data?.jobs || [];
    return Array.isArray(j) ? j : [];
  }, [data]);

  const columns = useMemo(
    () => [
      {
        title: t('cron.jobName', { defaultValue: '任务名称' }),
        dataIndex: 'name',
        key: 'name',
        responsive: ['md'],
        render: (_: any, row: CronJob) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Text style={{ color: pageHeading, fontWeight: 700 }} ellipsis={{ tooltip: row.name || row.id }}>
              {row.name || row.id}
            </Text>
            <Text
              type="secondary"
              style={{ fontSize: 11 }}
              ellipsis={{ tooltip: row.id }}
              copyable={{ text: row.id }}
            >
              ID: {row.id}
            </Text>
          </div>
        ),
      },
      {
        title: t('cron.enabled', { defaultValue: '启用' }),
        dataIndex: 'enabled',
        key: 'enabled',
        width: 88,
        responsive: ['md'],
        render: (v: boolean) =>
          v ? (
            <Tag color="green" icon={<CheckCircle2 size={12} />}>
              {t('cron.enabledOn', { defaultValue: '开启' })}
            </Tag>
          ) : (
            <Tag color="default" icon={<XCircle size={12} />}>
              {t('cron.enabledOff', { defaultValue: '关闭' })}
            </Tag>
          ),
      },
      {
        title: t('cron.planTime', { defaultValue: '计划时间' }),
        key: 'planTime',
        responsive: ['md'],
        render: (_: any, row: CronJob) => {
          const expr = row.schedule?.expr || '-';
          const tz = row.schedule?.tz || '-';
          const last = formatMs(row.state?.lastRunAtMs);
          const next = formatMs(row.state?.nextRunAtMs);

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
                <Text type="secondary" style={{ fontSize: 12, flex: '0 0 auto' }}>
                  {t('cron.schedule', { defaultValue: '计划' })}:
                </Text>
                <Text style={{ fontFamily: 'monospace', fontSize: 12, minWidth: 0, color: pageHeading }} ellipsis={{ tooltip: expr }}>
                  {expr}
                </Text>
                <Text type="secondary" style={{ fontSize: 11, flex: '0 0 auto' }} ellipsis={{ tooltip: tz }}>
                  {tz}
                </Text>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <Text type="secondary" style={{ fontSize: 12, flex: '0 0 auto' }}>
                  {t('cron.lastRun', { defaultValue: '上次执行' })}:
                </Text>
                <Text style={{ fontSize: 12, color: pageHeading }}>{last}</Text>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <Text type="secondary" style={{ fontSize: 12, flex: '0 0 auto' }}>
                  {t('cron.nextRun', { defaultValue: '下次执行' })}:
                </Text>
                <Text style={{ fontSize: 12, color: pageHeading }}>{next}</Text>
              </div>
            </div>
          );
        },
      },
      {
        title: t('cron.lastStatus', { defaultValue: '结果' }),
        key: 'status',
        width: 100,
        responsive: ['md'],
        render: (_: any, row: CronJob) => {
          const st = row.state?.lastRunStatus || '-';
          const isOk = st.toLowerCase() === 'ok' || st.toLowerCase() === 'delivered';
          const color = isOk ? 'green' : st === '-' ? 'default' : 'red';
          return <Tag color={color}>{st}</Tag>;
        },
      },
      {
        title: t('cron.delivery', { defaultValue: '投递' }),
        key: 'delivery',
        responsive: ['md'],
        render: (_: any, row: CronJob) => {
          const d = row.delivery || {};
          const text = [d.channel, d.mode].filter(Boolean).join(' / ') || '-';
          const to = d.to;
          return (
            <Tooltip title={to ? `to: ${to}` : ''}>
              <Text style={{ whiteSpace: 'nowrap', color: pageHeading }} ellipsis={{ tooltip: text }}>
                {text}
              </Text>
            </Tooltip>
          );
        },
      },
      {
        title: t('common.action', { defaultValue: '操作' }),
        key: 'actions',
        width: 170,
        responsive: ['md'],
        render: (_: any, row: CronJob) => {
          const id = row.id;
          const isBusy = operatingId === id;
          const enabled = !!row.enabled;
          return (
            <Space size={8} wrap>
              <Button
                size="small"
                onClick={() => operate(enabled ? 'disable' : 'enable', id)}
                loading={isBusy}
              >
                {enabled ? t('cron.disable', { defaultValue: '禁用' }) : t('cron.enable', { defaultValue: '启用' })}
              </Button>
              <Popconfirm
                title={t('cron.removeConfirmTitle', { defaultValue: '确认删除该定时任务？' })}
                okText={t('common.confirm', { defaultValue: '确定' })}
                cancelText={t('common.cancel', { defaultValue: '取消' })}
                onConfirm={() => operate('remove', id)}
              >
                <Tooltip title={t('common.delete', { defaultValue: '删除' })}>
                  <Button size="small" danger icon={<Trash2 size={14} />} loading={isBusy} />
                </Tooltip>
              </Popconfirm>
            </Space>
          );
        },
      },
    ],
    [t, pageHeading]
  );

  const renderMobileCard = (job: CronJob) => {
    const id = job.id;
    const isBusy = operatingId === id;
    const enabled = !!job.enabled;
    const st = job.state?.lastRunStatus || '-';
    const isOk = st.toLowerCase() === 'ok' || st.toLowerCase() === 'delivered';
    const statusColor = isOk ? 'green' : st === '-' ? 'default' : 'red';
    const deliveryText = [job.delivery?.channel, job.delivery?.mode].filter(Boolean).join(' / ') || '-';

    return (
      <Card
        key={id}
        size="small"
        style={{ borderRadius: 12, border: `1px solid ${borderDefault}`, background: cardBg }}
        styles={{ body: { padding: 14 } }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, color: pageHeading, fontSize: 13, lineHeight: 1.3 }}>
                {job.name || job.id}
              </div>
              <div style={{ color: pageMuted, fontSize: 11, marginTop: 2, wordBreak: 'break-all' }}>
                <Text
                  type="secondary"
                  style={{ fontSize: 11 }}
                  ellipsis={{ tooltip: job.id }}
                  copyable={{ text: job.id }}
                >
                  ID: {job.id}
                </Text>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              {enabled ? (
                <Tag color="green" style={{ margin: 0 }}>
                  {t('cron.enabledOn', { defaultValue: '开启' })}
                </Tag>
              ) : (
                <Tag color="default" style={{ margin: 0 }}>
                  {t('cron.enabledOff', { defaultValue: '关闭' })}
                </Tag>
              )}
              <Tag color={statusColor} style={{ margin: 0 }}>
                {st}
              </Tag>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('cron.schedule', { defaultValue: '计划' })}
              </Text>
              <Text style={{ fontFamily: 'monospace', fontSize: 12, textAlign: 'right', color: pageHeading }}>
                {job.schedule?.expr || '-'}
              </Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('cron.nextRun', { defaultValue: '下次执行' })}
              </Text>
              <Text style={{ fontSize: 12, textAlign: 'right', color: pageHeading }}>{formatMs(job.state?.nextRunAtMs)}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('cron.lastRun', { defaultValue: '上次执行' })}
              </Text>
              <Text style={{ fontSize: 12, textAlign: 'right', color: pageHeading }}>{formatMs(job.state?.lastRunAtMs)}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('cron.delivery', { defaultValue: '投递' })}
              </Text>
              <Tooltip title={job.delivery?.to ? `to: ${job.delivery?.to}` : ''}>
                <Text style={{ fontSize: 12, textAlign: 'right', color: pageHeading }}>{deliveryText}</Text>
              </Tooltip>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
            <Button
              size="small"
              onClick={() => operate(enabled ? 'disable' : 'enable', id)}
              loading={isBusy}
            >
              {enabled ? t('cron.disable', { defaultValue: '禁用' }) : t('cron.enable', { defaultValue: '启用' })}
            </Button>
            <Popconfirm
              title={t('cron.removeConfirmTitle', { defaultValue: '确认删除该定时任务？' })}
              okText={t('common.confirm', { defaultValue: '确定' })}
              cancelText={t('common.cancel', { defaultValue: '取消' })}
              onConfirm={() => operate('remove', id)}
            >
              <Button size="small" danger icon={<Trash2 size={14} />} loading={isBusy}>
                {t('common.delete', { defaultValue: '删除' })}
              </Button>
            </Popconfirm>
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div style={{ padding: 20 }}>
      <Card
        title={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, color: pageHeading }}>
              <Clock size={16} />
              <span style={{ fontWeight: 800 }}>{t('cron.title', { defaultValue: '定时任务' })}</span>
            </div>
            {updatedAt && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('cron.syncedAt', { defaultValue: '同步于' })}: {updatedAt}
              </Text>
            )}
          </div>
        }
        extra={
          <Space>
            <Button
              size="small"
              icon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
              onClick={() => fetchData(true)}
              style={isDarkMode ? { background: '#0f172a', borderColor: '#334155', color: pageMuted } : undefined}
            >
              {t('common.refresh', { defaultValue: '刷新' })}
            </Button>
            {isMobile ? (
              <Button
                size="small"
                type="text"
                icon={<HelpCircle size={16} />}
                onClick={() => setHelpOpen(true)}
                aria-label={t('cron.helpTitle', { defaultValue: '如何创建定时任务？' })}
                style={{ color: pageMuted }}
              />
            ) : (
              <Popover
                trigger="click"
                placement="bottomRight"
                arrow={false}
                overlayStyle={{ maxWidth: 820 }}
                styles={{
                  body: {
                    maxWidth: 820,
                    maxHeight: 'min(85vh, 720px)',
                    overflowY: 'auto',
                    padding: 16,
                    background: isDarkMode ? '#0f172a' : '#fff',
                    border: isDarkMode ? '1px solid #334155' : '1px solid #e2e8f0',
                    borderRadius: 12,
                    boxShadow: isDarkMode ? '0 8px 24px rgba(0,0,0,0.45)' : '0 8px 24px rgba(15,23,42,0.12)',
                  },
                }}
                content={<CronHelpContent isDarkMode={isDarkMode} />}
              >
                <Button
                  size="small"
                  type="text"
                  icon={<HelpCircle size={16} />}
                  aria-label={t('cron.helpTitle', { defaultValue: '如何创建定时任务？' })}
                  style={{ color: pageMuted }}
                />
              </Popover>
            )}
          </Space>
        }
        style={{ borderRadius: 12, border: `1px solid ${borderDefault}`, background: cardBg }}
      >
        {loading ? (
          <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin />
          </div>
        ) : jobs.length === 0 ? (
          <Empty description={t('cron.noJobs', { defaultValue: '暂无定时任务' })} />
        ) : (
          <>
            {isMobile ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {jobs.map(renderMobileCard)}
              </div>
            ) : (
              <Table
                rowKey="id"
                dataSource={jobs}
                columns={columns as any}
                pagination={{ pageSize: 20, hideOnSinglePage: true }}
                size="small"
                tableLayout="auto"
              />
            )}
          </>
        )}
      </Card>

      {/* Help: 如何用自然语言创建定时任务（桌面：Popover 无全屏遮罩；窄屏：底部 Drawer） */}
      {isMobile && (
        <Drawer
          title={t('cron.helpTitle', { defaultValue: '如何用自然语言创建定时任务？' })}
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
          placement="bottom"
          height="78vh"
          styles={{
            body: { padding: 16, background: isDarkMode ? '#0f172a' : undefined },
            header: isDarkMode ? { background: '#1e293b', borderBottom: '1px solid #334155' } : undefined,
          }}
        >
          <CronHelpContent isDarkMode={isDarkMode} />
        </Drawer>
      )}
    </div>
  );
}

function CronHelpContent({ isDarkMode = false }: { isDarkMode?: boolean }) {
  const { t } = useTranslation();
  const textPrimary = isDarkMode ? '#f1f5f9' : '#0f172a';
  const textSecondary = isDarkMode ? '#cbd5e1' : '#334155';
  const textBody = isDarkMode ? '#94a3b8' : '#475569';

  return (
    <div style={{ color: textPrimary }}>
      <Paragraph style={{ color: textSecondary }}>
        {t('cron.helpIntro', {
          defaultValue:
            '目前控制台暂不支持在此页面直接“新增定时任务”。推荐做法是：用自然语言告诉 AI 你的需求，由 AI 在后台调用 openclaw 的 cron add 来创建任务。',
        })}
      </Paragraph>

      <Paragraph style={{ color: textSecondary }}>
        {t('cron.helpMentalModel', {
          defaultValue:
            '创建定时任务（Cron Job）可以理解为给 AI 设定一个“闹钟”：时间到了，就让它执行特定指令，并按你的要求通知你。',
        })}
      </Paragraph>

      <Title level={5} style={{ marginTop: 14 }}>
        {t('cron.helpCore', { defaultValue: '需要你提供的 4 个核心要素' })}
      </Title>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <Text strong>1) schedule — 什么时候运行？</Text>
          <Paragraph style={{ marginBottom: 0, color: textBody }}>
            支持三种模式：<Text code>at</Text>（单次）、<Text code>every</Text>（间隔）、<Text code>cron</Text>（Cron 表达式）。
          </Paragraph>
          <Paragraph style={{ marginBottom: 0, color: textBody }}>
            例：<Text code>{`{"kind":"cron","expr":"0 9 * * 1-5","tz":"Asia/Shanghai"}`}</Text>
          </Paragraph>
        </div>

        <div>
          <Text strong>2) payload — 到点做什么？</Text>
          <Paragraph style={{ marginBottom: 0, color: textBody }}>
            推荐 <Text code>kind: "agentTurn"</Text>，提供 <Text code>message</Text>，让 AI 像正常对话一样执行任务并汇报。
          </Paragraph>
        </div>

        <div>
          <Text strong>3) sessionTarget — 在哪里运行？</Text>
          <Paragraph style={{ marginBottom: 0, color: textBody }}>
            常见：<Text code>current</Text>（当前会话）、<Text code>isolated</Text>（隔离会话）、或 <Text code>session:&lt;id&gt;</Text>（指定会话）。
          </Paragraph>
        </div>

        <div>
          <Text strong>4) delivery — 结果怎么通知？</Text>
          <Paragraph style={{ marginBottom: 0, color: textBody }}>
            常见：<Text code>announce</Text>（发到对话频道）、<Text code>webhook</Text>（回调 URL）、<Text code>none</Text>（静默）。
          </Paragraph>
        </div>
      </div>

      <Title level={5} style={{ marginTop: 16 }}>
        {t('cron.helpExampleTitle', { defaultValue: '示例：每小时提醒喝水' })}
      </Title>

      <Paragraph style={{ color: textBody }}>
        你只需要说：<Text code>“帮我创建一个每小时提醒我喝水的任务，提醒方式发到当前群聊。”</Text>
      </Paragraph>

      <pre
        style={{
          background: '#0b1220',
          color: '#e2e8f0',
          padding: 12,
          borderRadius: 12,
          overflowX: 'auto',
          fontSize: 12,
          lineHeight: 1.5,
          border: '1px solid rgba(148,163,184,0.15)',
        }}
      >{`{
  "action": "add",
  "job": {
    "name": "喝水提醒",
    "schedule": { "kind": "every", "everyMs": 3600000 },
    "payload": { "kind": "agentTurn", "message": "提醒我喝水啦！记得起身活动一下。" },
    "sessionTarget": "current",
    "delivery": { "mode": "announce" }
  }
}`}</pre>

      <Paragraph style={{ marginTop: 12, color: textSecondary }}>
        <Text strong>总结：</Text>你只要讲清楚 “多久一次 → 做什么 → 怎么通知”，剩下的 JSON/命令细节交给 AI 处理即可。
      </Paragraph>
    </div>
  );
}

