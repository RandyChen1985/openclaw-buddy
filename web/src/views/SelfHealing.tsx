import React, { useState, useEffect } from 'react';
import { Card, Badge, Button, List, Tag, Modal, Spin, message, Tabs, Table, Typography, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { Zap, Terminal, FileText, ChevronRight, RefreshCw, Clock, HardDrive, AlertCircle, History, FileSearch, Code } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeSanitize from 'rehype-sanitize';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import dayjs from 'dayjs';
import api from '../api';

interface SelfHealingProps {
  selfHealingEnabled: boolean;
  healEvents: any[];
  loadingSets: boolean;
  onToggle: (checked: boolean) => void;
  ocInstalled: boolean | null;
}

const SelfHealing: React.FC<SelfHealingProps> = ({ 
  selfHealingEnabled, 
  healEvents, 
  loadingSets, 
  onToggle,
  ocInstalled
}) => {
  const { t } = useTranslation();
  const isMobile = window.innerWidth < 768;
  
  // Reports State
  const [reports, setReports] = useState<any[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [reportContent, setReportContent] = useState('');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  
  // Backups State
  const [backups, setBackups] = useState<any[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [backupContent, setBackupContent] = useState('');
  const [backupDiff, setBackupDiff] = useState('');
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'content' | 'diff'>('content');
  const [selectedBackup, setSelectedBackup] = useState<any>(null);

  const [loadingContent, setLoadingContent] = useState(false);

  // --- Markdown 预处理逻辑 ---
  const preprocessMarkdown = (content: string) => {
    if (!content) return '';
    return content
      .replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2')
      .replace(/(#{1,6}\s.*)\n([^\n])/g, '$1\n\n$2')
      .replace(/([^\n])\n(```)/g, '$1\n\n$2')
      .replace(/(```[\s\S]*?```)\n([^\n])/g, '$1\n\n$2')
      .replace(/([^\n])\n(\|)/g, (match, p1, p2) => {
        return p1.trim().endsWith('|') ? match : p1 + '\n\n' + p2;
      })
      .replace(/(\|)\n([^|\n][^\n]*)/g, (match, p1, p2) => {
        return p2.trim().startsWith('|') ? match : p1 + '\n\n' + p2;
      })
      .replace(/(\n\|[^\n]+\|)\n(\|(?:\s*:-+\s*\|)+)/g, '$1\n$2');
  };

  useEffect(() => {
    fetchReports();
    fetchBackups();
  }, []);

  const fetchReports = async () => {
    setLoadingReports(true);
    try {
      const res = await api.get('/v1/heal/reports');
      setReports(res.data || []);
    } catch (err) {
      console.error('Failed to fetch reports:', err);
    } finally {
      setLoadingReports(false);
    }
  };

  const fetchBackups = async () => {
    setLoadingBackups(true);
    try {
      const res = await api.get('/v1/heal/backups');
      setBackups(res.data || []);
    } catch (err) {
      console.error('Failed to fetch backups:', err);
    } finally {
      setLoadingBackups(false);
    }
  };

  const viewReport = async (report: any) => {
    setSelectedReport(report);
    setIsReportModalOpen(true);
    setLoadingContent(true);
    setReportContent('');
    try {
      const res = await api.get(`/v1/heal/reports/${report.name}`);
      setReportContent(res.data.content);
    } catch (err) {
      message.error(t('heal.readReportFailed'));
      setIsReportModalOpen(false);
    } finally {
      setLoadingContent(false);
    }
  };

  const viewBackupContent = async (backup: any) => {
    setSelectedBackup(backup);
    setModalMode('content');
    setIsBackupModalOpen(true);
    setLoadingContent(true);
    setBackupContent('');
    try {
      const res = await api.get(`/v1/heal/backups/${backup.name}`);
      setBackupContent(res.data.content);
    } catch (err) {
      message.error(t('heal.readBackupFailed'));
      setIsBackupModalOpen(false);
    } finally {
      setLoadingContent(false);
    }
  };

  const viewBackupDiff = async (backup: any) => {
    setSelectedBackup(backup);
    setModalMode('diff');
    setIsBackupModalOpen(true);
    setLoadingContent(true);
    setBackupDiff('');
    try {
      const res = await api.get(`/v1/heal/backups/${backup.name}/diff`);
      setBackupDiff(res.data.diff);
    } catch (err) {
      message.error(t('heal.diffFailed'));
      setIsBackupModalOpen(false);
    } finally {
      setLoadingContent(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const markdownStyles = (
    <style>{`
      .markdown-body { font-size: 13.5px; line-height: 1.5; word-wrap: break-word; color: #334155; }
      .markdown-body h1, .markdown-body h2, .markdown-body h3 { margin-top: 16px; margin-bottom: 8px; font-weight: 700; color: #1e293b; border-bottom: 1px solid #f1f5f9; padding-bottom: 4px; }
      .markdown-body p { margin-bottom: 8px; }
      .markdown-body table th { background-color: #f8fafc; font-weight: 600; text-align: left; }
      .markdown-body pre { margin-bottom: 10px !important; border-radius: 8px; overflow: hidden; }
      .markdown-body blockquote { margin: 0 0 10px 0; padding: 0 12px; color: #64748b; border-left: 4px solid #e2e8f0; }
      .heal-tabs .ant-tabs-nav { margin-bottom: 0px !important; }
      .heal-tabs .ant-tabs-tab { padding: 12px 16px !important; }
    `}</style>
  );

  const backupColumns = [
    {
      title: t('common.name'),
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => (
        <Space size={8}>
          <HardDrive size={14} color="#64748b" />
          <Typography.Text strong style={{ fontSize: 13 }}>{text}</Typography.Text>
          {text === 'openclaw.json.bak' && <Tag color="blue">{t('heal.latest')}</Tag>}
        </Space>
      )
    },
    {
      title: t('common.time'),
      dataIndex: 'time',
      key: 'time',
      width: 180,
      render: (text: string) => (
        <Space size={4} style={{ color: '#94a3b8', fontSize: 12 }}>
          <Clock size={12} />
          {text}
        </Space>
      )
    },
    {
      title: t('common.size'),
      dataIndex: 'size',
      key: 'size',
      width: 100,
      render: (size: number) => <span style={{ color: '#94a3b8', fontSize: 12 }}>{formatSize(size)}</span>
    },
    {
      title: t('common.action'),
      key: 'action',
      width: 220,
      render: (_: any, record: any) => (
        <Space size={8}>
          <Button size="small" icon={<Code size={12} />} onClick={() => viewBackupContent(record)}>{t('heal.viewContent')}</Button>
          <Button size="small" type="primary" ghost icon={<FileSearch size={12} />} onClick={() => viewBackupDiff(record)}>{t('heal.viewDiff')}</Button>
        </Space>
      )
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {markdownStyles}
      {/* 软开关卡片 */}
      <Card
        styles={{ body: { padding: isMobile ? '20px' : '24px 28px' } }}
        style={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}
      >
        {/* ... (原有开关 UI 逻辑保持不变) ... */}
        <div style={{ 
          display: 'flex', 
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'flex-start' : 'center', 
          justifyContent: 'space-between',
          gap: 20
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 16 : 20 }}>
            <div style={{ 
              width: isMobile ? 44 : 52, 
              height: isMobile ? 44 : 52, 
              borderRadius: 12, 
              background: selfHealingEnabled ? '#f0f9ff' : '#f8fafc',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0
            }}>
              <Zap size={isMobile ? 22 : 26} color={selfHealingEnabled ? '#3b82f6' : '#94a3b8'} fill={selfHealingEnabled ? '#3b82f6' : 'none'} style={{ opacity: selfHealingEnabled ? 1 : 0.5 }} />
            </div>
            <div>
              <div style={{ fontWeight: 800, color: '#1e293b', fontSize: isMobile ? 16 : 17, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                {t('heal.title')}
                <Badge status={selfHealingEnabled ? 'processing' : 'default'} />
              </div>
              <div style={{ color: '#64748b', fontSize: 13, maxWidth: 600, lineHeight: 1.5 }}>
                {t('heal.description')}
                {ocInstalled === false && (
                  <div style={{ marginTop: 8, color: '#ef4444', fontWeight: 600, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <AlertCircle size={12} /> 核心组件 `openclaw` 未安装，功能暂不可用
                  </div>
                )}
              </div>
            </div>
          </div>
          <div style={{ 
            textAlign: isMobile ? 'left' : 'right',
            width: isMobile ? '100%' : 'auto',
            borderTop: isMobile ? '1px solid #f1f5f9' : 'none',
            paddingTop: isMobile ? 16 : 0,
            display: 'flex',
            flexDirection: isMobile ? 'row' : 'column',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: isMobile ? 0 : 8, fontWeight: 600 }}>
              {t('heal.status')}: <span style={{ color: selfHealingEnabled ? '#16a34a' : '#ef4444' }}>{selfHealingEnabled ? t('heal.running') : t('heal.disabled')}</span>
            </div>
            <Button 
              type={ocInstalled === null ? "default" : (selfHealingEnabled ? "default" : "primary")}
              size="large"
              loading={loadingSets || ocInstalled === null}
              disabled={ocInstalled === false || ocInstalled === null}
              onClick={() => onToggle(!selfHealingEnabled)}
              style={{ 
                borderRadius: 10, minWidth: 100, fontWeight: 700,
                background: (ocInstalled === false || ocInstalled === null) ? '#cbd5e1' : (selfHealingEnabled ? '#ef4444' : '#2563eb'),
                borderColor: (ocInstalled === false || ocInstalled === null) ? '#cbd5e1' : (selfHealingEnabled ? '#ef4444' : '#2563eb'),
                color: '#fff'
              }}
            >
              {ocInstalled === null ? "正在检测环境..." : (selfHealingEnabled ? t('heal.disableService') : t('heal.enableNow'))}
            </Button>
          </div>
        </div>
      </Card>

      {/* 核心内容 Tabs */}
      <Tabs 
        className="heal-tabs"
        type="card"
        items={[
          {
            key: 'events',
            label: <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Terminal size={14} /> {t('heal.historyEvents')}</span>,
            children: (
              <Card style={{ borderTopLeftRadius: 0, border: '1px solid #e2e8f0', borderTop: 'none' }}>
                <List
                  dataSource={healEvents}
                  locale={{ emptyText: t('heal.noEvents') }}
                  renderItem={(item: any) => (
                    <List.Item style={{ padding: '16px 0' }}>
                      <div style={{ width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                          <Tag color="warning" style={{ borderRadius: 4, fontWeight: 600 }}>{item.reason}</Tag>
                          <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>{dayjs(item.timestamp).format('YYYY-MM-DD HH:mm:ss')}</span>
                        </div>
                        <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: 8, border: '1px solid #f1f5f9' }}>
                          <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                            <span style={{ color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>{t('heal.recoveryMethod')}:</span>
                            <span style={{ color: '#1e293b' }}>{item.method}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 12, fontSize: 13, marginTop: 4 }}>
                            <span style={{ color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>{t('heal.disposalResult')}:</span>
                            <span style={{ color: item.result === 'Success' ? '#16a34a' : '#ef4444', fontWeight: 600 }}>{item.result === 'Success' ? '✅ ' + t('heal.recovered') : '❌ ' + t('heal.failed')}</span>
                          </div>
                        </div>
                      </div>
                    </List.Item>
                  )}
                />
              </Card>
            )
          },
          {
            key: 'backups',
            label: <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><History size={14} /> {t('heal.backupHistory')}</span>,
            children: (
              <Card 
                style={{ borderTopLeftRadius: 0, border: '1px solid #e2e8f0', borderTop: 'none' }}
                title={null}
                extra={<Button size="small" type="text" icon={<RefreshCw size={12} />} onClick={fetchBackups} loading={loadingBackups}>{t('common.refresh')}</Button>}
              >
                <Table 
                  dataSource={backups}
                  columns={backupColumns}
                  pagination={{ pageSize: 10 }}
                  loading={loadingBackups}
                  size="small"
                  rowKey="name"
                  scroll={{ x: 'max-content' }}
                />
              </Card>
            )
          },
          {
            key: 'reports',
            label: <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FileText size={14} /> {t('heal.reports')}</span>,
            children: (
              <Card style={{ borderTopLeftRadius: 0, border: '1px solid #e2e8f0', borderTop: 'none' }}>
                <List
                  dataSource={reports}
                  locale={{ emptyText: t('heal.noReports') }}
                  loading={loadingReports}
                  renderItem={(item: any) => (
                    <List.Item 
                      style={{ padding: '12px 0', cursor: 'pointer' }}
                      onClick={() => viewReport(item)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <FileText size={16} color="#64748b" />
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 13 }}>{item.name}</div>
                            <div style={{ display: 'flex', gap: 12, marginTop: 2 }}>
                              <span style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={10} /> {item.time}</span>
                              <span style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}><HardDrive size={10} /> {formatSize(item.size)}</span>
                            </div>
                          </div>
                        </div>
                        <ChevronRight size={16} color="#cbd5e1" />
                      </div>
                    </List.Item>
                  )}
                />
              </Card>
            )
          }
        ]}
      />

      {/* 报表查看 Modal */}
      <Modal
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FileText size={18} color="#3b82f6" /><span>{t('heal.reportDetail')}: {selectedReport?.name}</span></div>}
        open={isReportModalOpen}
        onCancel={() => setIsReportModalOpen(false)}
        footer={[<Button key="close" type="primary" onClick={() => setIsReportModalOpen(false)}>{t('common.close')}</Button>]}
        width={isMobile ? '95%' : 800}
        centered
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        {loadingContent ? <div style={{ padding: '60px 0', textAlign: 'center' }}><Spin /></div> : (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeSanitize]} components={{
              code: ({ node, inline, className, children, ...props }: any) => {
                const match = /language-(\w+)/.exec(className || '');
                return !inline && match ? <SyntaxHighlighter {...props} style={vscDarkPlus} language={match[1]} PreTag="div">{String(children).replace(/\n$/, '')}</SyntaxHighlighter> : <code className={className} {...props}>{children}</code>;
              }
            }}>
              {preprocessMarkdown(reportContent)}
            </ReactMarkdown>
          </div>
        )}
      </Modal>

      {/* 备份内容/Diff 查看 Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {modalMode === 'content' ? <Code size={18} color="#3b82f6" /> : <FileSearch size={18} color="#16a34a" />}
            <span>{modalMode === 'content' ? t('heal.viewContent') : t('heal.currentDiff')}: {selectedBackup?.name}</span>
          </div>
        }
        open={isBackupModalOpen}
        onCancel={() => setIsBackupModalOpen(false)}
        footer={[<Button key="close" type="primary" onClick={() => setIsBackupModalOpen(false)}>{t('common.close')}</Button>]}
        width={isMobile ? '95%' : 900}
        centered
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: 12 } }}
      >
        {loadingContent ? <div style={{ padding: '60px 0', textAlign: 'center' }}><Spin tip="Loading..." /></div> : (
          <div style={{ borderRadius: 8, overflow: 'hidden' }}>
            <SyntaxHighlighter 
              style={vscDarkPlus} 
              language={modalMode === 'content' ? 'json' : 'diff'}
              customStyle={{ margin: 0, fontSize: 12 }}
            >
              {modalMode === 'content' ? backupContent : (backupDiff || 'No changes detected between this backup and current config.')}
            </SyntaxHighlighter>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default SelfHealing;
