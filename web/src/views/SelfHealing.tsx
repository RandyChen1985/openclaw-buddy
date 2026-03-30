import React, { useState, useEffect } from 'react';
import { Card, Badge, Button, List, Tag, Modal, Spin, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { Zap, Terminal, FileText, ChevronRight, RefreshCw, Clock, HardDrive, AlertCircle } from 'lucide-react';
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
  const [reports, setReports] = useState<any[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [reportContent, setReportContent] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);

  // --- Markdown 预处理逻辑，修复模型输出不规范导致的渲染问题 ---
  const preprocessMarkdown = (content: string) => {
    if (!content) return '';
    return content
      // 1. 确保标题 (#) 前后有空行
      .replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2')
      .replace(/(#{1,6}\s.*)\n([^\n])/g, '$1\n\n$2')
      // 2. 确保代码块 (```) 前后有空行
      .replace(/([^\n])\n(```)/g, '$1\n\n$2')
      .replace(/(```[\s\S]*?```)\n([^\n])/g, '$1\n\n$2')
      // 3. 强化表格 (|) 前后空行，确保表格不被普通文本截断
      .replace(/([^\n])\n(\|)/g, (match, p1, p2) => {
        return p1.trim().endsWith('|') ? match : p1 + '\n\n' + p2;
      })
      .replace(/(\|)\n([^|\n][^\n]*)/g, (match, p1, p2) => {
        return p2.trim().startsWith('|') ? match : p1 + '\n\n' + p2;
      })
      // 4. 修复模型输出中可能存在的非标准表格分隔线
      .replace(/(\n\|[^\n]+\|)\n(\|(?:\s*:-+\s*\|)+)/g, '$1\n$2');
  };

  useEffect(() => {
    fetchReports();
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

  const viewReport = async (report: any) => {
    setSelectedReport(report);
    setIsModalOpen(true);
    setLoadingContent(true);
    setReportContent('');
    try {
      const res = await api.get(`/v1/heal/reports/${report.name}`);
      setReportContent(res.data.content);
    } catch (err) {
      message.error(t('heal.readReportFailed'));
      setIsModalOpen(false);
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

  // --- Styles for Markdown Content (Copied from OnlineChat for consistency) ---
  const markdownStyles = (
    <style>{`
      .markdown-body {
        font-size: 13.5px;
        line-height: 1.5;
        word-wrap: break-word;
        color: #334155;
      }
      .markdown-body h1, .markdown-body h2, .markdown-body h3 {
        margin-top: 16px;
        margin-bottom: 8px;
        font-weight: 700;
        color: #1e293b;
        border-bottom: 1px solid #f1f5f9;
        padding-bottom: 4px;
      }
      .markdown-body p { margin-bottom: 8px; }
      .markdown-body table th {
        background-color: #f8fafc;
        font-weight: 600;
        text-align: left;
      }
      .markdown-body pre {
        margin-bottom: 10px !important;
        border-radius: 8px;
        overflow: hidden;
      }
      .markdown-body blockquote {
        margin: 0 0 10px 0;
        padding: 0 12px;
        color: #64748b;
        border-left: 4px solid #e2e8f0;
      }
    `}</style>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {markdownStyles}
      {/* 软开关卡片 */}
      <Card
        styles={{ body: { padding: isMobile ? '20px' : '24px 28px' } }}
        style={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}
      >
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
              <div style={{ color: '#64748b', fontSize: 13, maxWidth: 500, lineHeight: 1.5 }}>
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


      {/* 自愈日志列表 */}
      <Card
        title={<span style={{ fontSize: 14, fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: 8 }}><Terminal size={16} /> {t('heal.historyEvents')}</span>}
        styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 48 }, body: { padding: '0 24px' } }}
        style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
      >
        {healEvents.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>☕</div>
            <div style={{ fontSize: 13 }}>{t('heal.noEvents')}</div>
          </div>
        ) : (
          <List
            dataSource={healEvents}
            renderItem={(item: any) => (
              <List.Item style={{ padding: '20px 0', borderBottom: '1px solid #f8fafc' }}>
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
        )}
      </Card>

      {/* 诊断报表列表 */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={16} /> {t('heal.reports')}
            </span>
            <Button size="small" type="text" icon={<RefreshCw size={12} />} onClick={fetchReports} loading={loadingReports}>
              {t('common.refresh')}
            </Button>
          </div>
        }
        styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 48 }, body: { padding: isMobile ? '8px 16px' : '12px 24px' } }}
        style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
      >
        {reports.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
            <div style={{ fontSize: 12 }}>{t('heal.noReports')}</div>
          </div>
        ) : (
          <List
            dataSource={reports}
            renderItem={(item: any) => (
              <List.Item 
                style={{ padding: '12px 0', borderBottom: '1px solid #f8fafc', cursor: 'pointer' }}
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
        )}
      </Card>

      {/* 报表内容弹窗 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={18} color="#3b82f6" />
            <span>{t('heal.reportDetail')}: {selectedReport?.name}</span>
          </div>
        }
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setIsModalOpen(false)}>{t('common.close')}</Button>
        ]}
        width={isMobile ? '95%' : 800}
        centered
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: '20px 24px' } }}
      >
        {loadingContent ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}><Spin tip={t('heal.loadingReport')} /></div>
        ) : (
          <div className="markdown-body">
            <ReactMarkdown 
              remarkPlugins={[remarkGfm, remarkBreaks]}
              rehypePlugins={[rehypeSanitize]}
              components={{
                table: ({ node, ...props }: any) => (
                  <div style={{ 
                    width: '100%', 
                    overflowX: 'auto', 
                    marginBottom: 12, 
                    borderRadius: 8,
                    border: '1px solid #e2e8f0',
                    background: '#fff'
                  }}>
                    <table {...props} style={{ 
                      width: '100%', 
                      borderCollapse: 'collapse',
                      fontSize: '13px',
                      minWidth: isMobile ? '500px' : 'auto'
                    }} />
                  </div>
                ),
                th: ({ node, ...props }: any) => (
                  <th {...props} style={{ 
                    padding: '8px 12px', 
                    background: '#f8fafc', 
                    borderBottom: '1px solid #e2e8f0', 
                    borderRight: '1px solid #e2e8f0',
                    textAlign: 'left',
                    fontWeight: 600
                  }} />
                ),
                td: ({ node, ...props }: any) => (
                  <td {...props} style={{ 
                    padding: '8px 12px', 
                    borderBottom: '1px solid #e2e8f0', 
                    borderRight: '1px solid #e2e8f0'
                  }} />
                ),
                code: ({ node, inline, className, children, ...props }: any) => {
                  const match = /language-(\w+)/.exec(className || '');
                  const language = match ? match[1] : '';
                  return !inline && language ? (
                    <SyntaxHighlighter
                      {...props}
                      style={vscDarkPlus}
                      language={language}
                      PreTag="div"
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                  ) : (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                }
              }}
            >
              {preprocessMarkdown(reportContent)}
            </ReactMarkdown>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default SelfHealing;
