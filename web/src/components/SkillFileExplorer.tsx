import React, { useState, useEffect, useMemo } from 'react';
import { Modal, List, Button, message, Spin, Breadcrumb, Tabs, Input, Empty } from 'antd';
import { Folder, FileText, ChevronRight, Save, ArrowLeft, Eye, PenLine, FileCode } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeSanitize from 'rehype-sanitize';
import api from '../api';
import TokenBadge from './TokenBadge';

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  mod_time: string;
}

interface SkillFileExplorerProps {
  open: boolean;
  onClose: () => void;
  rootPath: string;
  skillName: string;
  t: any;
  isMobile: boolean;
}

const SkillFileExplorer: React.FC<SkillFileExplorerProps> = ({ open, onClose, rootPath, skillName, t, isMobile }) => {
  const [currentPath, setCurrentPath] = useState(rootPath);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

  // 初始化路径
  useEffect(() => {
    if (open && rootPath) {
      setCurrentPath(rootPath);
      loadFiles(rootPath);
      setSelectedFile(null);
      setIsEditing(false);
    }
  }, [open, rootPath]);

  const loadFiles = async (path: string) => {
    setLoading(true);
    try {
      const res = await api.get(`/v1/openclaw/skills/files/list?path=${encodeURIComponent(path)}`);
      // Sort: directories first, then alphabetically
      const sortedFiles = (res.data.files || []).sort((a: FileEntry, b: FileEntry) => {
        if (a.is_dir === b.is_dir) return a.name.localeCompare(b.name);
        return a.is_dir ? -1 : 1;
      });
      setFiles(sortedFiles);
    } catch (err: any) {
      message.error(err.message || t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadFileContent = async (file: FileEntry) => {
    setLoading(true);
    try {
      const res = await api.get(`/v1/openclaw/skills/files/get?path=${encodeURIComponent(file.path)}`);
      setFileContent(res.data.content || '');
      setSelectedFile(file);
      setIsEditing(true);
      setActiveTab(file.name.endsWith('.md') ? 'preview' : 'edit');
    } catch (err: any) {
      message.error(err.message || t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    setIsSaving(true);
    try {
      await api.post('/v1/openclaw/skills/files/save', {
        path: selectedFile.path,
        content: fileContent
      });
      message.success(t('common.saveSuccess'));
    } catch (err: any) {
      message.error(err.message || t('common.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleFolderClick = (path: string) => {
    setCurrentPath(path);
    loadFiles(path);
  };



  // Breadcrumbs calculation
  const breadcrumbs = useMemo(() => {
    const relativePath = currentPath.replace(rootPath, '');
    const parts = relativePath.split('/').filter(Boolean);
    const crumbs = [{ name: skillName, path: rootPath }];
    let currentFullPath = rootPath;
    parts.forEach(part => {
      currentFullPath = `${currentFullPath}/${part}`;
      crumbs.push({ name: part, path: currentFullPath });
    });
    return crumbs;
  }, [currentPath, rootPath, skillName]);

  const isMarkdown = selectedFile?.name.endsWith('.md');

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ background: '#eff6ff', padding: 8, borderRadius: 10 }}>
              <FileCode size={20} color="#2563eb" />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{skillName} {t('skills.resourceExplorer')}</div>
              <Breadcrumb
                style={{ fontSize: 11, marginTop: 2 }}
                items={breadcrumbs.map((crumb, idx) => ({
                  title: (
                    <span 
                      style={{ 
                        cursor: idx < breadcrumbs.length - 1 ? 'pointer' : 'default',
                        color: idx < breadcrumbs.length - 1 ? '#3b82f6' : '#94a3b8'
                      }}
                      onClick={() => idx < breadcrumbs.length - 1 && handleFolderClick(crumb.path)}
                    >
                      {crumb.name}
                    </span>
                  )
                }))}
              />
            </div>
          </div>
          {isEditing && (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button icon={<ArrowLeft size={16} />} onClick={() => setIsEditing(false)}>
                {t('common.back')}
              </Button>
              <Button type="primary" icon={<Save size={16} />} loading={isSaving} onClick={handleSave} style={{ background: '#2563eb' }}>
                {t('common.save')}
              </Button>
            </div>
          )}
        </div>
      }
      open={open}
      onCancel={onClose}
      width={isMobile ? '100%' : 1000}
      footer={null}
      styles={{ 
        body: { padding: 0, height: 750, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
        header: { padding: '16px 24px', borderBottom: '1px solid #f1f5f9' }
      }}
      centered
      destroyOnClose
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f8fafc' }}>
        {loading && !isSaving ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin size="large" />
          </div>
        ) : isEditing ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff' }}>
            <div style={{ padding: '8px 16px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#475569' }}>
                <FileText size={16} />
                {selectedFile?.name}
              </div>
              {isMarkdown && (
                 <Tabs 
                    size="small" 
                    activeKey={activeTab} 
                    onChange={(k) => setActiveTab(k as any)}
                    items={[
                      { key: 'edit', label: <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><PenLine size={14}/>{t('common.edit')}</div> },
                      { key: 'preview', label: <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Eye size={14}/>{t('common.preview')}</div> }
                    ]}
                 />
              )}
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {activeTab === 'edit' || !isMarkdown ? (
                <div style={{ position: 'relative', height: '100%' }}>
                  <TokenBadge text={fileContent} />
                  <Input.TextArea
                    value={fileContent}
                    onChange={(e) => setFileContent(e.target.value)}
                    style={{
                      height: '100%',
                      border: 'none',
                      borderRadius: 0,
                      resize: 'none',
                      fontFamily: 'monospace',
                      fontSize: 13,
                      padding: 16,
                      background: '#fff',
                      outline: 'none',
                      boxShadow: 'none'
                    }}
                  />
                </div>
              ) : (
                <div style={{ height: '100%', padding: 24, overflowY: 'auto' }}>
                  <div style={{ maxWidth: 800, margin: '0 auto', background: '#fff', padding: 32, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                    <div className="markdown-body-v3">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeSanitize]}>
                        {fileContent}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : files.length > 0 ? (
          <List
            className="skill-file-list"
            style={{ padding: '8px 16px', overflowY: 'auto' }}
            dataSource={files}
            renderItem={(item) => (
              <List.Item
                style={{ 
                  cursor: 'pointer', 
                  borderRadius: 8, 
                  border: 'none', 
                  padding: '10px 12px',
                  marginBottom: 4,
                  transition: 'all 0.2s'
                }}
                className="hover-bg-slate"
                onClick={() => item.is_dir ? handleFolderClick(item.path) : loadFileContent(item)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                  {item.is_dir ? <Folder size={18} color="#3b82f6" fill="#3b82f633" /> : <FileText size={18} color="#64748b" />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, color: '#334155', fontWeight: 500 }}>{item.name}</div>
                    {!item.is_dir && (
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>
                        {(item.size / 1024).toFixed(1)} KB · {item.mod_time}
                      </div>
                    )}
                  </div>
                  <ChevronRight size={16} color="#cbd5e1" />
                </div>
              </List.Item>
            )}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty description={t('common.noContent')} />
          </div>
        )}
      </div>
      <style>{`
        .skill-file-list .ant-list-item:hover {
          background: #f1f5f9;
        }
        .markdown-body-v3 {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
          font-size: 14px;
          line-height: 1.6;
          color: #24292f;
        }
        .markdown-body-v3 h1, .markdown-body-v3 h2, .markdown-body-v3 h3 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; line-height: 1.25; }
        .markdown-body-v3 h1 { font-size: 2em; border-bottom: 1px solid #d0d7de; padding-bottom: .3em; }
        .markdown-body-v3 h2 { font-size: 1.5em; border-bottom: 1px solid #d0d7de; padding-bottom: .3em; }
        .markdown-body-v3 code { background: #afb8c133; padding: .2em .4em; border-radius: 6px; font-size: 85%; font-family: monospace; }
        .markdown-body-v3 pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow: auto; margin-bottom: 16px; }
        .markdown-body-v3 pre code { background: none; padding: 0; }
        .markdown-body-v3 table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
        .markdown-body-v3 th, .markdown-body-v3 td { border: 1px solid #d0d7de; padding: 6px 13px; }
        .markdown-body-v3 tr:nth-child(2n) { background: #f6f8fa; }
      `}</style>
    </Modal>
  );
};

export default SkillFileExplorer;
