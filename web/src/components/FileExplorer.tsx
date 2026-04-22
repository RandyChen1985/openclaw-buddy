import React, { useState, useEffect, useMemo } from 'react';
import { Modal, List, Button, message, Spin, Breadcrumb, Tabs, Input, Empty, Popconfirm } from 'antd';
import { Folder, FileText, ChevronRight, Save, ArrowLeft, Eye, PenLine, Trash2, FolderOpen } from 'lucide-react';
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

interface FileExplorerProps {
  open: boolean;
  onClose: () => void;
  rootPath: string;
  title: string;
  t: any;
  isMobile: boolean;
}

const FileExplorer: React.FC<FileExplorerProps> = ({ open, onClose, rootPath, title, t, isMobile }) => {
  const [currentPath, setCurrentPath] = useState(rootPath);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

  // Initialize path when modal opens
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
      const res = await api.get(`/v1/openclaw/files/list?path=${encodeURIComponent(path)}`);
      const sortedFiles = (res.data.files || []).sort((a: FileEntry, b: FileEntry) => {
        if (a.is_dir === b.is_dir) return a.name.localeCompare(b.name);
        return a.is_dir ? -1 : 1;
      });
      setFiles(sortedFiles);
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message || t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadFileContent = async (file: FileEntry) => {
    setLoading(true);
    try {
      const res = await api.get(`/v1/openclaw/files/get?path=${encodeURIComponent(file.path)}`);
      setFileContent(res.data.content || '');
      setSelectedFile(file);
      setIsEditing(true);
      setActiveTab(file.name.endsWith('.md') ? 'preview' : 'edit');
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message || t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    setIsSaving(true);
    try {
      await api.post('/v1/openclaw/files/save', {
        path: selectedFile.path,
        content: fileContent
      });
      message.success(t('common.saveSuccess'));
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message || t('common.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (file: FileEntry) => {
    try {
      await api.delete(`/v1/openclaw/files/delete?path=${encodeURIComponent(file.path)}`);
      message.success(t('common.deleteSuccess', { defaultValue: '删除成功' }));
      loadFiles(currentPath);
      if (selectedFile?.path === file.path) {
        setIsEditing(false);
        setSelectedFile(null);
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message || t('common.deleteFailed', { defaultValue: '删除失败' }));
    }
  };

  const handleFolderClick = (path: string) => {
    setCurrentPath(path);
    loadFiles(path);
  };

  // Breadcrumbs calculation
  const breadcrumbs = useMemo(() => {
    if (!rootPath) return [];
    
    // Check if currentPath is under rootPath
    if (!currentPath.startsWith(rootPath)) {
        return [{ name: '...', path: currentPath }];
    }

    const relativePath = currentPath.substring(rootPath.length);
    const parts = relativePath.split(/[/\\]/).filter(Boolean);
    const crumbs = [{ name: title || 'Root', path: rootPath }];
    let currentFullPath = rootPath;
    
    parts.forEach(part => {
      currentFullPath = currentFullPath.endsWith('/') || currentFullPath.endsWith('\\') 
        ? `${currentFullPath}${part}` 
        : `${currentFullPath}/${part}`;
      crumbs.push({ name: part, path: currentFullPath });
    });
    return crumbs;
  }, [currentPath, rootPath, title]);

  const isMarkdown = selectedFile?.name.endsWith('.md');
  const isHTML = selectedFile?.name.endsWith('.html') || selectedFile?.name.endsWith('.htm');
  const hasPreview = isMarkdown || isHTML;

  const protectedFiles = ['soul.md', 'agent.md', 'agents.md', 'identity.md', 'identify.md', 'user.md', 'tools.md', 'heartbeat.md'];
  const isProtected = (name: string) => protectedFiles.includes(name.toLowerCase());

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ background: '#f0f9ff', padding: 8, borderRadius: 10 }}>
              <FolderOpen size={20} color="#0ea5e9" />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
              <Breadcrumb
                style={{ fontSize: 11, marginTop: 2 }}
                items={breadcrumbs.map((crumb, idx) => ({
                  title: (
                    <span 
                      style={{ 
                        cursor: idx < breadcrumbs.length - 1 ? 'pointer' : 'default',
                        color: idx < breadcrumbs.length - 1 ? '#0ea5e9' : '#94a3b8'
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
              <Button type="primary" icon={<Save size={16} />} loading={isSaving} onClick={handleSave} style={{ background: '#0ea5e9', border: 'none' }}>
                {t('common.save')}
              </Button>
            </div>
          )}
        </div>
      }
      open={open}
      onCancel={onClose}
      width={isMobile ? '100%' : 1100}
      footer={null}
      styles={{ 
        body: { padding: 0, height: isMobile ? 'calc(100vh - 120px)' : 500, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
        header: { padding: '16px 24px', borderBottom: '1px solid #f1f5f9' }
      }}
      centered
      destroyOnClose
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f8fafc' }}>
        {loading && !isSaving ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin size="large" tip={t('common.loading')} />
          </div>
        ) : isEditing ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff' }}>
            <div style={{ padding: '8px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#475569' }}>
                <FileText size={16} />
                {selectedFile?.name}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {hasPreview && (
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
                {!isProtected(selectedFile?.name || '') && (
                  <Popconfirm
                    title={t('common.deleteConfirm', { defaultValue: '确定要删除此文件吗？' })}
                    onConfirm={() => selectedFile && handleDelete(selectedFile)}
                    okText={t('common.confirm')}
                    cancelText={t('common.cancel')}
                    okButtonProps={{ danger: true }}
                  >
                    <Button type="text" danger icon={<Trash2 size={16} />} />
                  </Popconfirm>
                )}
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {activeTab === 'preview' && isMarkdown ? (
                <div style={{ height: '100%', padding: 24, overflowY: 'auto', background: '#f1f5f9' }}>
                  <div style={{ maxWidth: 900, margin: '0 auto', background: '#fff', padding: 40, borderRadius: 12, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
                    <div className="markdown-body-v3">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeSanitize]}>
                        {fileContent}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              ) : activeTab === 'preview' && isHTML ? (
                <div style={{ height: '100%', background: '#fff', overflow: 'hidden' }}>
                  <iframe 
                    srcDoc={fileContent} 
                    style={{ width: '100%', height: '100%', border: 'none' }} 
                    title="HTML Preview"
                    sandbox="allow-scripts"
                  />
                </div>
              ) : (
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
              )}
            </div>
          </div>
        ) : files.length > 0 ? (
          <List
            className="file-explorer-list"
            style={{ padding: '12px 24px', overflowY: 'auto' }}
            dataSource={files}
            renderItem={(item) => (
              <List.Item
                style={{ 
                  cursor: 'pointer', 
                  borderRadius: 12, 
                  border: 'none', 
                  padding: '12px 16px',
                  marginBottom: 8,
                  transition: 'all 0.2s',
                  background: '#fff',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                }}
                className="file-item-hover"
                onClick={() => item.is_dir ? handleFolderClick(item.path) : loadFileContent(item)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%' }}>
                  <div style={{ 
                    background: item.is_dir ? '#e0f2fe' : '#f1f5f9', 
                    padding: 10, 
                    borderRadius: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {item.is_dir ? <Folder size={20} color="#0ea5e9" fill="#0ea5e933" /> : <FileText size={20} color="#64748b" />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, color: '#1e293b', fontWeight: 600 }}>{item.name}</div>
                    {!item.is_dir && (
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                        {(item.size / 1024).toFixed(1)} KB · {item.mod_time}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {!isProtected(item.name) && (
                      <Popconfirm
                        title={t('common.deleteConfirm', { defaultValue: '确定要删除吗？' })}
                        onConfirm={(e) => {
                          e?.stopPropagation();
                          handleDelete(item);
                        }}
                        onCancel={(e) => e?.stopPropagation()}
                        okText={t('common.confirm')}
                        cancelText={t('common.cancel')}
                        okButtonProps={{ danger: true }}
                      >
                        <Button 
                          type="text" 
                          size="small" 
                          danger 
                          icon={<Trash2 size={14} />} 
                          onClick={(e) => e.stopPropagation()}
                          className="delete-btn-hover"
                        />
                      </Popconfirm>
                    )}
                    <ChevronRight size={18} color="#cbd5e1" />
                  </div>
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
        .file-item-hover:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);
          background: #fdfdfd;
        }
        .delete-btn-hover { opacity: 0.3; transition: opacity 0.2s; }
        .file-item-hover:hover .delete-btn-hover { opacity: 1; }
        .markdown-body-v3 {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
          font-size: 16px;
          line-height: 1.6;
          color: #24292f;
        }
        .markdown-body-v3 h1, .markdown-body-v3 h2, .markdown-body-v3 h3 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; line-height: 1.25; }
        .markdown-body-v3 h1 { font-size: 2.25em; border-bottom: 1px solid #d0d7de; padding-bottom: .3em; }
        .markdown-body-v3 h2 { font-size: 1.75em; border-bottom: 1px solid #d0d7de; padding-bottom: .3em; }
        .markdown-body-v3 code { background: #afb8c133; padding: .2em .4em; border-radius: 6px; font-size: 85%; font-family: monospace; }
        .markdown-body-v3 pre { background: #f6f8fa; padding: 16px; border-radius: 8px; overflow: auto; margin-bottom: 16px; border: 1px solid #e2e8f0; }
        .markdown-body-v3 pre code { background: none; padding: 0; }
        .markdown-body-v3 table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
        .markdown-body-v3 th, .markdown-body-v3 td { border: 1px solid #d0d7de; padding: 8px 15px; }
        .markdown-body-v3 tr:nth-child(2n) { background: #f6f8fa; }
      `}</style>
    </Modal>
  );
};

export default FileExplorer;
