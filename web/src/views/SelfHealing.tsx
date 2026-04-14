import React, { useState, useEffect, useRef } from 'react';
import { Card, Badge, Button, List, Tag, Modal, Spin, message, Tabs, Table, Typography, Space, Radio, Descriptions, Collapse } from 'antd';
import { useTranslation } from 'react-i18next';
import { Zap, Terminal, FileText, ChevronRight, RefreshCw, Clock, HardDrive, AlertCircle, History, Code, Wand2, Save, Layout as LayoutIcon, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeSanitize from 'rehype-sanitize';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import dayjs from 'dayjs';
import api from '../api';

// --- Global Styles for SelfHealing ---
const styles = `
  .heal-tabs .ant-tabs-nav {
    margin-bottom: 0 !important;
  }
  .heal-tabs .ant-tabs-tab {
    background: #f8fafc !important;
    border: 1px solid #e2e8f0 !important;
    border-bottom: none !important;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
    border-radius: 8px 8px 0 0 !important;
    margin-right: 4px !important;
  }
  .heal-tabs .ant-tabs-tab-active {
    background: #fff !important;
    border-top: 2px solid #3b82f6 !important;
  }
  .heal-tabs .ant-tabs-tab:hover {
    color: #3b82f6 !important;
    background: #fff !important;
  }
`;

// --- Sub-components for Config Management ---

const HighlightedJsonEditor: React.FC<{ 
  value: string; 
  onChange: (val: string) => void; 
  onCopy?: (text: string) => void;
  disabled?: boolean;
  isMobile?: boolean;
}> = ({ value, onChange, onCopy, disabled, isMobile }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid #334155', background: '#1e1e1e', height: '100%', minHeight: 400 }}>
      <Button
        icon={<Copy size={14} />}
        size="small"
        onClick={() => onCopy && onCopy(value)}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 20,
          background: 'rgba(255, 255, 255, 0.1)',
          borderColor: 'rgba(255, 255, 255, 0.2)',
          color: '#fff',
          borderRadius: 6
        }}
      />
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        disabled={disabled}
        spellCheck={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          background: 'transparent',
          color: 'transparent',
          caretColor: disabled ? 'transparent' : '#fff',
          border: 'none',
          outline: 'none',
          padding: isMobile ? '16px 12px' : '24px 20px',
          fontSize: isMobile ? 12 : 13,
          lineHeight: 1.6,
          fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
          resize: 'none',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          zIndex: 10,
          cursor: disabled ? 'not-allowed' : 'text'
        }}
      />
      <div 
        ref={preRef}
        style={{ 
          position: 'absolute', 
          inset: 0, 
          overflow: 'hidden', 
          padding: isMobile ? '16px 12px' : '24px 20px', 
          zIndex: 1, 
          opacity: disabled ? 0.6 : 1 
        }}
      >
        <SyntaxHighlighter
          language="json"
          style={vscDarkPlus}
          customStyle={{
            margin: 0,
            padding: 0,
            background: 'transparent',
            fontSize: isMobile ? 12 : 13,
            lineHeight: 1.6,
            fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
            pointerEvents: 'none',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all'
          }}
        >
          {value + (value.endsWith('\n') ? ' ' : '')}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};

const JsonVisualizer = ({ content, isMobile }: { content: string, isMobile?: boolean }) => {
  const { t } = useTranslation();
  let data: any = {};
  try {
    data = JSON.parse(content);
  } catch (e) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: '#94a3b8' }}>
        <AlertCircle size={40} style={{ marginBottom: 12, opacity: 0.5 }} />
        <div>{t('heal.parseFailed', { defaultValue: 'JSON 解析失败，请检查语法' })}</div>
      </div>
    );
  }

  const renderSection = (title: string, obj: any) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    
    const entries = Object.entries(obj).filter(([_, val]) => val !== undefined && val !== null);
    if (entries.length === 0) return null;

    return (
      <Descriptions 
        title={<span style={{ fontSize: 13, color: '#3b82f6', fontWeight: 700 }}>{title}</span>}
        column={isMobile ? 1 : { xxl: 2, xl: 2, lg: 2, md: 1, sm: 1, xs: 1 }}
        size="small"
        bordered
        style={{ marginBottom: 20 }}
      >
        {entries.map(([key, val]: [string, any]) => (
          <Descriptions.Item label={key} key={key}>
            {typeof val === 'object' ? (
              <pre style={{ margin: 0, fontSize: 11, background: '#f1f5f9', padding: '4px 8px', borderRadius: 4 }}>
                {JSON.stringify(val, null, 2)}
              </pre>
            ) : (
              <Typography.Text copyable={typeof val === 'string' && val.length > 20}>{String(val)}</Typography.Text>
            )}
          </Descriptions.Item>
        ))}
      </Descriptions>
    );
  };

  const providers = data.models?.providers || {};
  const flattenedModels: any[] = [];
  Object.entries(providers).forEach(([providerId, provider]: [string, any]) => {
    const models = provider.models || {};
    Object.entries(models).forEach(([modelId, model]: [string, any]) => {
      flattenedModels.push({
        ...model,
        id: modelId,
        provider: providerId
      });
    });
  });

  return (
    <div style={{ background: '#fff', padding: isMobile ? '12px' : '20px', borderRadius: 12, border: '1px solid #f1f5f9' }}>
      <Collapse ghost defaultActiveKey={['gateway', 'defaults', 'agents', 'plugins']}>
        <Collapse.Panel header={<Typography.Text strong>网关设置 (Gateway)</Typography.Text>} key="gateway">
          {renderSection('HTTP', data.gateway?.http)}
          {renderSection('Server', { host: data.host, port: data.port, debug: data.debug, logLevel: data.logLevel })}
        </Collapse.Panel>
        
        <Collapse.Panel header={<Typography.Text strong>缺省配置 (Defaults)</Typography.Text>} key="defaults">
          {renderSection('Compaction', data.defaults?.compaction)}
          {renderSection('Model', data.defaults?.model)}
          <Descriptions size="small" bordered column={1} labelStyle={{ background: '#f8fafc', width: 140 }}>
            <Descriptions.Item label="maxConcurrent">{data.defaults?.maxConcurrent}</Descriptions.Item>
          </Descriptions>
        </Collapse.Panel>

        <Collapse.Panel header={<Typography.Text strong>运行环境 (Agents & Scripts)</Typography.Text>} key="agents">
          {renderSection('Agent Defaults', data.agents?.defaults)}
          {data.external && renderSection('External Services', data.external)}
        </Collapse.Panel>

        <Collapse.Panel header={<Typography.Text strong>模型资产库 (Models Inventory)</Typography.Text>} key="models">
          <Table 
            size="small" 
            pagination={{ pageSize: isMobile ? 5 : 10, size: 'small' }}
            dataSource={flattenedModels}
            scroll={{ x: isMobile ? 600 : undefined }}
            columns={[
              { title: 'ID', dataIndex: 'id', key: 'id', render: (v) => <Tag color="blue">{v}</Tag> },
              { title: 'Name', dataIndex: 'name', key: 'name' },
              { title: 'Provider', dataIndex: 'provider', key: 'provider', render: (v) => <Tag color="cyan">{v}</Tag> },
              { title: 'Capabilities', dataIndex: 'capabilities', key: 'caps', render: (v) => Array.isArray(v) ? v.map(c => <Tag key={c}>{c}</Tag>) : '-' }
            ]}
          />
        </Collapse.Panel>

        <Collapse.Panel header={<Typography.Text strong>扩展插件 (Plugins, Skills, Tools)</Typography.Text>} key="plugins">
           <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
             {data.plugins && renderSection('Plugins Configuration', data.plugins)}
             {data.tools && renderSection('Available Tools', data.tools)}
             {data.skills && renderSection('Skills Config', data.skills)}
             <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
               {Object.keys(data.plugins || {}).map(p => <Tag key={p}>{p}</Tag>)}
               {Object.keys(data.tools || {}).map(t => <Tag key={t} color="purple">{t}</Tag>)}
             </div>
           </div>
        </Collapse.Panel>
      </Collapse>
    </div>
  );
};

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
  onToggle
}) => {
  const { t } = useTranslation();
  
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    message.success(t('common.copySuccess'));
  };
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  const [reports, setReports] = useState<any[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [reportContent, setReportContent] = useState('');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  
  const [backups, setBackups] = useState<any[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [backupContent, setBackupContent] = useState('');
  const [backupDiff, setBackupDiff] = useState('');
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'content' | 'diff'>('content');
  const [selectedBackup, setSelectedBackup] = useState<any>(null);

  const [loadingContent, setLoadingContent] = useState(false);

  // Config Modal State
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [configContent, setConfigContent] = useState('');
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [editMode, setEditMode] = useState<'editor' | 'visual'>('editor');
  const [runningDoctor, setRunningDoctor] = useState(false);

  const preprocessMarkdown = (content: string) => {
    if (!content) return '';
    return content
      .replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2')
      .replace(/(#{1,6}\s.*)\n([^\n])/g, '$1\n\n$2')
      .replace(/([^\n])\n(```)/g, '$1\n\n$2')
      .replace(/(```[\s\S]*?```)\n([^\n])/g, '$1\n\n$2')
      .replace(/([^\n])\n(\|)/g, (match, p1, p2) => p1.trim().endsWith('|') ? match : p1 + '\n\n' + p2)
      .replace(/(\|)\n([^|\n][^\n]*)/g, (match, p1, p2) => p2.trim().startsWith('|') ? match : p1 + '\n\n' + p2)
      .replace(/(\n\|[^\n]+\|)\n(\|(?:\s*:-+\s*\|)+)/g, '$1\n$2');
  };

  useEffect(() => {
    const styleTag = document.createElement('style');
    styleTag.innerHTML = styles;
    document.head.appendChild(styleTag);
    fetchReports();
    fetchBackups();
    return () => { document.head.removeChild(styleTag); };
  }, []);

  const fetchReports = async () => {
    setLoadingReports(true);
    try {
      const res = await api.get('/v1/heal/reports');
      setReports(res.data || []);
    } catch (err) { console.error(err); } finally { setLoadingReports(false); }
  };

  const fetchBackups = async () => {
    setLoadingBackups(true);
    try {
      const res = await api.get('/v1/heal/backups');
      setBackups(res.data || []);
    } catch (err) { console.error(err); } finally { setLoadingBackups(false); }
  };

  const fetchConfig = async () => {
    setLoadingConfig(true);
    try {
      const res = await api.get('/v1/openclaw/config');
      setConfigContent(res.data.content);
    } catch (err) {
      message.error(t('heal.readConfigFailed', { defaultValue: '读取配置失败' }));
    } finally {
      setLoadingConfig(false);
    }
  };

  useEffect(() => {
    if (isConfigModalOpen) {
      fetchConfig();
    }
  }, [isConfigModalOpen]);

  const cleanErrorMessage = (msg: string) => {
    if (!msg) return "";
    let clean = msg.replace(/^Error: /i, '').replace(/^failed to update config: /i, '');
    const marker = "Problem:";
    const index = clean.indexOf(marker);
    if (index !== -1) {
      clean = clean.substring(index + marker.length).trim();
    }
    return clean;
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      await api.post('/v1/openclaw/config', { content: configContent });
      message.success(t('common.saveSuccess'));
      fetchBackups();
    } catch (err: any) {
      const rawMsg = err.response?.data?.message || err.message || String(err);
      const cleaned = cleanErrorMessage(rawMsg);
      Modal.error({
        title: t('heal.configErrorTitle', { defaultValue: '配置校验未通过' }),
        width: 600,
        centered: true,
        content: (
          <div style={{ marginTop: 12 }}>
            <div style={{ background: '#fff1f0', border: '1px solid #ffccc7', padding: '12px 16px', borderRadius: 8, color: '#cf1322', fontSize: 13, fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>
              {cleaned}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
              {t('heal.configErrorTip', { defaultValue: '建议检查 JSON 语法或必填字段。系统已自动回滚，您的更改尚未生效。' })}
            </div>
          </div>
        )
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleRunDoctor = async () => {
    setRunningDoctor(true);
    try {
      await api.post('/v1/openclaw/doctor');
      message.success(t('heal.doctorSuccess'));
    } catch (err) { message.error(t('heal.doctorFailed')); } finally { setRunningDoctor(false); }
  };

  const viewReport = async (report: any) => {
    setSelectedReport(report);
    setIsReportModalOpen(true);
    setLoadingContent(true);
    try {
      const res = await api.get(`/v1/heal/reports/${report.name}`);
      setReportContent(res.data.content);
    } catch (err) { message.error(t('heal.readReportFailed')); setIsReportModalOpen(false); } finally { setLoadingContent(false); }
  };

  const viewBackupContent = async (backup: any) => {
    setSelectedBackup(backup);
    setModalMode('content');
    setIsBackupModalOpen(true);
    setLoadingContent(true);
    try {
      const res = await api.get(`/v1/heal/backups/${backup.name}`);
      setBackupContent(res.data.content);
    } catch (err) { message.error(t('heal.readBackupFailed')); setIsBackupModalOpen(false); } finally { setLoadingContent(false); }
  };

  const viewBackupDiff = async (backup: any) => {
    setSelectedBackup(backup);
    setModalMode('diff');
    setIsBackupModalOpen(true);
    setLoadingContent(true);
    try {
      const res = await api.get(`/v1/heal/backups/${backup.name}/diff`);
      setBackupDiff(res.data.diff);
    } catch (err) { message.error(t('heal.diffFailed')); setIsBackupModalOpen(false); } finally { setLoadingContent(false); }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const backupColumns = [
    { title: t('common.name'), dataIndex: 'name', key: 'name', render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span> },
    { title: t('common.time'), dataIndex: 'time', key: 'time', render: (v: string) => <span style={{ fontSize: 12, color: '#64748b' }}>{v}</span> },
    { title: t('common.size'), dataIndex: 'size', key: 'size', render: (v: number) => <span style={{ fontSize: 12 }}>{formatSize(v)}</span> },
    { title: t('common.action'), key: 'action', render: (_: any, record: any) => (
      <Space>
        <Button size="small" type="link" onClick={() => viewBackupContent(record)}>{t('heal.viewContent')}</Button>
        <Button size="small" type="link" onClick={() => viewBackupDiff(record)}>{t('heal.viewDiff')}</Button>
      </Space>
    )}
  ];

  return (
    <div style={{ padding: isMobile ? '12px' : '20px' }}>
      <Card styles={{ body: { padding: isMobile ? '20px' : '24px' } }} style={{ borderRadius: 16, border: '1px solid #e2e8f0', marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 16 : 20 }}>
            <div style={{ width: isMobile ? 44 : 52, height: isMobile ? 44 : 52, borderRadius: 12, background: selfHealingEnabled ? '#f0f9ff' : '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={isMobile ? 22 : 26} color={selfHealingEnabled ? '#3b82f6' : '#94a3b8'} fill={selfHealingEnabled ? '#3b82f6' : 'none'} />
            </div>
            <div>
              <div style={{ fontWeight: 800, color: '#1e293b', fontSize: isMobile ? 16 : 17, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                {t('heal.title')} <Badge status={selfHealingEnabled ? 'processing' : 'default'} />
              </div>
              <div style={{ color: '#64748b', fontSize: 13, maxWidth: 600, lineHeight: 1.5 }}>{t('heal.description')}</div>
            </div>
          </div>
          <div style={{ textAlign: isMobile ? 'left' : 'right', width: isMobile ? '100%' : 'auto', display: 'flex', flexDirection: isMobile ? 'row' : 'column', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: isMobile ? 0 : 8, fontWeight: 600 }}>
              {t('heal.status')}: <span style={{ color: selfHealingEnabled ? '#16a34a' : '#ef4444' }}>{selfHealingEnabled ? t('heal.running') : t('heal.disabled')}</span>
            </div>
            <Button 
               type={selfHealingEnabled ? "primary" : "primary"} 
               danger={selfHealingEnabled} 
               onClick={() => onToggle(!selfHealingEnabled)} 
               style={{ borderRadius: 10, minWidth: 100, fontWeight: 700 }}
            >
              {selfHealingEnabled ? t('heal.disableService') : t('heal.enableNow')}
            </Button>
          </div>
        </div>
      </Card>

      <Card styles={{ body: { padding: isMobile ? '16px' : '20px' } }} style={{ borderRadius: 16, border: '1px solid #e2e8f0', background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexDirection: isMobile ? 'column' : 'row', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Code size={20} color="#3b82f6" /></div>
            <div><div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>{t('heal.coreConfigTitle')}</div><div style={{ fontSize: 12, color: '#64748b' }}>{t('heal.coreConfigDesc')}</div></div>
          </div>
          <Space>
            <Button type="primary" icon={<Wand2 size={14} />} onClick={() => setIsConfigModalOpen(true)} disabled={runningDoctor} style={{ borderRadius: 8, height: 40, fontWeight: 600, padding: '0 20px' }}>{t('heal.manageConfig')}</Button>
            <Button icon={<RefreshCw size={14} />} onClick={handleRunDoctor} loading={runningDoctor} style={{ borderRadius: 8, height: 40, fontWeight: 600, borderColor: '#3b82f6', color: '#3b82f6' }}>{t('heal.doctorFix')}</Button>
          </Space>
        </div>
      </Card>

      <Modal
        title={
          <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', width: '95%', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Code size={18} color="#3b82f6" /></div>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{t('heal.configModalTitle')}</span>
            </div>
            <Radio.Group value={editMode} onChange={(e) => setEditMode(e.target.value)} size="small" optionType="button" buttonStyle="solid">
              <Radio.Button value="editor"><Space size={4}><Code size={12} />{t('heal.editorMode')}</Space></Radio.Button>
              <Radio.Button value="visual"><Space size={4}><LayoutIcon size={12} />{t('heal.visualMode')}</Space></Radio.Button>
            </Radio.Group>
          </div>
        }
        open={isConfigModalOpen}
        onCancel={() => setIsConfigModalOpen(false)}
        width={isMobile ? '100%' : 1000}
        style={isMobile ? { top: 0, margin: 0, maxWidth: '100vw' } : {}}
        bodyStyle={isMobile ? { height: 'calc(100vh - 120px)', padding: '12px' } : {}}
        centered={!isMobile}
        footer={[
          <div key="footer" style={{ display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'space-between', flexDirection: isMobile ? 'column' : 'row', gap: 12 }}>
            <div style={{ fontSize: 12, color: '#64748b', display: (isMobile && editMode === 'visual') ? 'none' : 'flex', alignItems: 'center', gap: 8, background: '#f8fafc', padding: '10px 14px', borderRadius: 8, textAlign: 'left', width: isMobile ? '100%' : 'auto' }}>
              <AlertCircle size={14} color="#3b82f6" style={{ flexShrink: 0 }} /><span style={{ flex: 1 }}>{t('heal.configSaveTip')}</span>
            </div>
            <Space style={{ width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'space-between' : 'flex-end' }}>
              <Button icon={<RefreshCw size={14} />} onClick={fetchConfig} loading={loadingConfig}>{t('common.refresh')}</Button>
              <Button type="primary" icon={<Save size={14} />} onClick={handleSaveConfig} loading={savingConfig} disabled={editMode === 'visual' || savingConfig || loadingConfig} style={{ fontWeight: 600 }}>{t('common.save')}</Button>
              <Button onClick={() => setIsConfigModalOpen(false)}>{t('common.close')}</Button>
            </Space>
          </div>
        ]}
      >
        <div style={{ marginTop: isMobile ? 0 : 16, height: '100%' }}>
          {editMode === 'editor' ? (
            <div style={{ height: isMobile ? '100%' : '65vh' }}>
              <HighlightedJsonEditor value={configContent} onChange={setConfigContent} onCopy={handleCopy} disabled={savingConfig || loadingConfig} isMobile={isMobile} />
            </div>
          ) : (
            <JsonVisualizer content={configContent} isMobile={isMobile} />
          )}
        </div>
      </Modal>

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
                          <div style={{ display: 'flex', gap: 12, fontSize: 13 }}><span style={{ color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>{t('heal.recoveryMethod')}:</span><span style={{ color: '#1e293b' }}>{item.method}</span></div>
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
              <Card style={{ borderTopLeftRadius: 0, border: '1px solid #e2e8f0', borderTop: 'none' }} extra={<Button size="small" type="text" icon={<RefreshCw size={12} />} onClick={fetchBackups} loading={loadingBackups}>{t('common.refresh')}</Button>}>
                <Table dataSource={backups} columns={backupColumns} pagination={{ pageSize: 10 }} loading={loadingBackups} size="small" rowKey="name" scroll={{ x: 'max-content' }} />
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
                    <List.Item style={{ padding: '12px 0', cursor: 'pointer' }} onClick={() => viewReport(item)}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileText size={16} color="#64748b" /></div>
                          <div><div style={{ fontWeight: 600, color: '#1e293b', fontSize: 13 }}>{item.name}</div><div style={{ display: 'flex', gap: 12, marginTop: 2 }}><span style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={10} /> {item.time}</span><span style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}><HardDrive size={10} /> {formatSize(item.size)}</span></div></div>
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

      <Modal title={<span>{t('heal.reportDetail')}: {selectedReport?.name}</span>} open={isReportModalOpen} onCancel={() => setIsReportModalOpen(false)} 
        footer={[
          <Button key="copy" icon={<Copy size={14} />} onClick={() => handleCopy(reportContent)}>{t('common.copy')}</Button>,
          <Button key="close" type="primary" onClick={() => setIsReportModalOpen(false)}>{t('common.close')}</Button>
        ]} 
        width={isMobile ? '95%' : 800} centered styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}>
        {loadingContent ? <div style={{ padding: '60px 0', textAlign: 'center' }}><Spin /></div> : <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeSanitize]}>{preprocessMarkdown(reportContent)}</ReactMarkdown></div>}
      </Modal>

      <Modal 
        title={<span>{modalMode === 'content' ? t('heal.viewContent') : t('heal.currentDiff')}: {selectedBackup?.name}</span>} 
        open={isBackupModalOpen} onCancel={() => setIsBackupModalOpen(false)} 
        footer={[
          <Button key="copy" icon={<Copy size={14} />} onClick={() => handleCopy(modalMode === 'content' ? backupContent : backupDiff)}>{t('common.copy')}</Button>,
          <Button key="close" type="primary" onClick={() => setIsBackupModalOpen(false)}>{t('common.close')}</Button>
        ]} 
        width={isMobile ? '95%' : 900} centered styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: 12 } }}
      >
        {loadingContent ? <Spin /> : <SyntaxHighlighter style={vscDarkPlus} language={modalMode === 'content' ? 'json' : 'diff'}>{modalMode === 'content' ? backupContent : backupDiff}</SyntaxHighlighter>}
      </Modal>
    </div>
  );
};

export default SelfHealing;
