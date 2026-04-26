import React, { useState, useEffect, useMemo } from 'react';
import { Modal, List, Button, message, Spin, Breadcrumb, Tabs, Input, Empty, Tree } from 'antd';
import { 
  Folder, FileText, ChevronRight, ChevronLeft, Save, Eye, PenLine, FileCode, Search, 
  LayoutList, Maximize2, Minimize2, 
  FileJson, FileCode2, Image as ImageIcon, Monitor, Terminal, File
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeSanitize from 'rehype-sanitize';
import api from '../api';
import TokenBadge from './TokenBadge';

const { DirectoryTree } = Tree;

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  mod_time: string;
}

interface TreeDataItem {
  title: string;
  key: string;
  isLeaf?: boolean;
  children?: TreeDataItem[];
  data?: FileEntry;
}

interface SkillFileExplorerProps {
  open: boolean;
  onClose: () => void;
  rootPath: string;
  skillName: string;
  t: any;
  isMobile: boolean;
}

const getFileIcon = (name: string, isDir: boolean, size: number = 20) => {
  if (isDir) return <Folder size={size} color="#2563eb" fill="#2563eb33" />;
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'json': return <FileJson size={size} color="#eab308" />;
    case 'js':
    case 'ts':
    case 'tsx':
    case 'py':
    case 'go': return <FileCode2 size={size} color="#3b82f6" />;
    case 'md': return <FileText size={size} color="#6366f1" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg': return <ImageIcon size={size} color="#ec4899" />;
    case 'html':
    case 'htm': return <Monitor size={size} color="#f97316" />;
    case 'sh':
    case 'bash': return <Terminal size={size} color="#10b981" />;
    default: return <File size={size} color="#64748b" />;
  }
};

const SkillFileExplorer: React.FC<SkillFileExplorerProps> = ({ open, onClose, rootPath, skillName, t, isMobile }) => {
  const [currentPath, setCurrentPath] = useState(rootPath);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [filterText, setFilterText] = useState('');
  const [treeData, setTreeData] = useState<TreeDataItem[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (open && rootPath) {
      setCurrentPath(rootPath);
      loadFiles(rootPath);
      setSelectedFile(null);
      setIsEditing(false);
      setFilterText('');
      setIsFullscreen(false);
      const initialRoot: TreeDataItem = { title: skillName || 'Skill', key: rootPath, isLeaf: false, children: [] };
      setTreeData([initialRoot]);
      setExpandedKeys([rootPath]);
      setSelectedKeys([rootPath]);
      loadTreeChildren(rootPath).then(children => setTreeData([{ ...initialRoot, children }]));
    }
  }, [open, rootPath, skillName]);

  const loadFiles = async (path: string) => {
    setLoading(true);
    setFilterText('');
    try {
      const res = await api.get(`/v1/openclaw/skills/files/list?path=${encodeURIComponent(path)}`);
      const sortedFiles = (res.data.files || []).sort((a: FileEntry, b: FileEntry) => {
        if (a.is_dir === b.is_dir) return a.name.localeCompare(b.name);
        return a.is_dir ? -1 : 1;
      });
      setFiles(sortedFiles);
    } catch (err: any) {
      message.error(err.message || t('skills.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadTreeChildren = async (path: string): Promise<TreeDataItem[]> => {
    try {
      const res = await api.get(`/v1/openclaw/skills/files/list?path=${encodeURIComponent(path)}`);
      const entries = (res.data.files || []) as FileEntry[];
      return entries.map(item => ({ title: item.name, key: item.path, isLeaf: !item.is_dir, data: item })).sort((a, b) => {
        if (a.isLeaf === b.isLeaf) return a.title.localeCompare(b.title);
        return a.isLeaf ? 1 : -1;
      });
    } catch (err) {
      console.error('Failed to load tree children:', err);
      return [];
    }
  };

  const onLoadData = ({ key, children }: any) => {
    return new Promise<void>(async (resolve) => {
      if (children && children.length > 0) { resolve(); return; }
      const newChildren = await loadTreeChildren(key);
      setTreeData((origin) => updateTreeData(origin, key, newChildren));
      resolve();
    });
  };

  const updateTreeData = (list: TreeDataItem[], key: React.Key, children: TreeDataItem[]): TreeDataItem[] =>
    list.map((node) => {
      if (node.key === key) return { ...node, children };
      if (node.children) return { ...node, children: updateTreeData(node.children, key, children) };
      return node;
    });

  const loadFileContent = async (file: FileEntry) => {
    setLoading(true);
    try {
      const res = await api.get(`/v1/openclaw/skills/files/get?path=${encodeURIComponent(file.path)}`);
      setFileContent(res.data.content || '');
      setSelectedFile(file);
      setIsEditing(true);
      setActiveTab(file.name.endsWith('.md') ? 'preview' : 'edit');
      setSelectedKeys([file.path]);
    } catch (err: any) {
      message.error(err.message || t('skills.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    setIsSaving(true);
    try {
      await api.post('/v1/openclaw/skills/files/save', { path: selectedFile.path, content: fileContent });
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
    setIsEditing(false);
    setSelectedFile(null);
    setSelectedKeys([path]);
    if (!expandedKeys.includes(path)) setExpandedKeys(prev => [...prev, path]);
  };

  const onTreeSelect = (selectedKeys: React.Key[], info: any) => {
    if (selectedKeys.length === 0) return;
    const key = selectedKeys[0].toString();
    const node = info.node;
    setSelectedKeys(selectedKeys);
    if (node.isLeaf) {
      if (node.data) loadFileContent(node.data);
    } else {
      setCurrentPath(key);
      loadFiles(key);
      setIsEditing(false);
      setSelectedFile(null);
    }
  };

  const handleExpand = (keys: React.Key[]) => {
    if (!keys.includes(rootPath)) {
      setExpandedKeys([rootPath, ...keys]);
    } else {
      setExpandedKeys(keys);
    }
  };

  const breadcrumbs = useMemo(() => {
    const relativePath = currentPath.replace(rootPath, '');
    const parts = relativePath.split('/').filter(Boolean);
    const crumbs = [{ name: skillName, path: rootPath }];
    let currentFullPath = rootPath;
    parts.forEach(part => { 
      currentFullPath = currentFullPath.endsWith('/') ? `${currentFullPath}${part}` : `${currentFullPath}/${part}`; 
      crumbs.push({ name: part, path: currentFullPath }); 
    });
    return crumbs;
  }, [currentPath, rootPath, skillName]);

  const filteredFiles = useMemo(() => {
    let result = files;
    if (filterText.trim()) {
      const term = filterText.toLowerCase();
      result = files.filter(f => f.name.toLowerCase().includes(term));
    }
    
    if (currentPath !== rootPath && !filterText) {
      const parts = currentPath.split('/').filter(Boolean);
      parts.pop();
      const parentPath = currentPath.startsWith('/') ? '/' + parts.join('/') : parts.join('/');
      
      return [
        { name: '..', path: parentPath || rootPath, is_dir: true, size: 0, mod_time: '' },
        ...result
      ];
    }
    return result;
  }, [files, filterText, currentPath, rootPath]);

  const isMarkdown = selectedFile?.name.endsWith('.md');

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: isMobile ? 8 : 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12 }}>
            {(isEditing || (isMobile && currentPath !== rootPath)) && (
              <Button 
                type="text" 
                icon={<ChevronLeft size={isMobile ? 18 : 20} />} 
                onClick={() => {
                  if (isEditing) {
                    setIsEditing(false);
                    setSelectedFile(null);
                  } else if (isMobile && currentPath !== rootPath) {
                    const parts = currentPath.split('/').filter(Boolean);
                    parts.pop();
                    const parentPath = currentPath.startsWith('/') ? '/' + parts.join('/') : parts.join('/');
                    handleFolderClick(parentPath || rootPath);
                  }
                }}
                style={{ padding: 0, width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              />
            )}
            {!isMobile && (
              <div style={{ background: '#eff6ff', padding: 8, borderRadius: 10 }}>
                <FileCode size={20} color="#2563eb" />
              </div>
            )}
            <div>
              <div style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, lineHeight: 1.2 }}>{skillName} {t('skills.resourceExplorer')}</div>
              {!isMobile && (
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
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button 
              type="text"
              icon={isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              onClick={() => setIsFullscreen(!isFullscreen)}
              style={{ color: '#64748b' }}
            />
            {isEditing && (
              <Button type="primary" icon={<Save size={16} />} loading={isSaving} onClick={handleSave} style={{ background: '#2563eb' }}>
                {t('common.save')}
              </Button>
            )}
          </div>
        </div>
      }
      open={open}
      onCancel={onClose}
      width={isFullscreen ? '100%' : (isMobile ? '100%' : 1000)}
      style={isFullscreen ? { top: 0, paddingBottom: 0, maxWidth: 'none' } : {}}
      footer={null}
      styles={{ 
        body: { padding: 0, height: isFullscreen ? 'calc(100vh - 110px)' : (isMobile ? 'calc(100vh - 120px)' : 550), display: 'flex', flexDirection: 'column', overflow: 'hidden' },
        header: { padding: '16px 24px', borderBottom: '1px solid #f1f5f9' }
      }}
      centered={!isFullscreen}
      destroyOnClose
    >
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#fff' }}>
        {!isMobile && (
          <div style={{ width: 260, borderRight: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column', background: '#fcfdfe' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', fontSize: 12, fontWeight: 700, color: '#64748b', display: 'flex', alignItems: 'center', gap: 8 }}>
               <LayoutList size={14} /> {t('common.directory')}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 8px' }}>
              <DirectoryTree
                loadData={onLoadData} treeData={treeData} onSelect={onTreeSelect}
                expandedKeys={expandedKeys} onExpand={handleExpand} selectedKeys={selectedKeys}
                showIcon={true} blockNode expandAction={false} className="custom-directory-tree"
              />
            </div>
          </div>
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f8fafc' }}>
          {!isEditing && (
            <div style={{ padding: '12px 24px', background: '#fff', borderBottom: '1px solid #f1f5f9' }}>
              <Input
                placeholder={t('common.searchPlaceholder')}
                prefix={<Search size={16} color="#94a3b8" style={{ marginRight: 4 }} />}
                value={filterText} onChange={e => setFilterText(e.target.value)} allowClear
                style={{ borderRadius: 8, height: 36 }}
              />
            </div>
          )}

          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {loading && !isSaving ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Spin size="large" tip={t('common.loading')} />
              </div>
            ) : isEditing ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff' }}>
                <div style={{ padding: '8px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#475569' }}>
                    {getFileIcon(selectedFile?.name || '', false, 16)}
                    {selectedFile?.name}
                  </div>
                  {isMarkdown && (
                    <Tabs 
                        size="small" activeKey={activeTab} onChange={(k) => setActiveTab(k as any)}
                        items={[
                          { key: 'edit', label: <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><PenLine size={14}/>{t('common.edit')}</div> },
                          { key: 'preview', label: <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Eye size={14}/>{t('common.preview')}</div> }
                        ]}
                        style={{ marginBottom: -12 }}
                    />
                  )}
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  {activeTab === 'edit' || !isMarkdown ? (
                    <div style={{ position: 'relative', height: '100%' }}>
                      <TokenBadge text={fileContent} />
                      <Input.TextArea
                        value={fileContent} onChange={(e) => setFileContent(e.target.value)} spellCheck={false}
                        style={{
                          height: '100%', border: 'none', borderRadius: 0, resize: 'none', fontFamily: 'monospace',
                          fontSize: 13, padding: 16, background: '#fff', outline: 'none', boxShadow: 'none'
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
            ) : filteredFiles.length > 0 ? (
              <List
                className="skill-file-list" style={{ padding: '12px 24px', overflowY: 'auto' }}
                dataSource={filteredFiles}
                renderItem={(item) => (
                  <List.Item
                    style={{ 
                      cursor: 'pointer', borderRadius: 12, border: 'none', padding: '10px 16px', marginBottom: 8,
                      transition: 'all 0.2s', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                    }}
                    className="file-item-hover"
                    onClick={() => item.is_dir ? handleFolderClick(item.path) : loadFileContent(item)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                      <div style={{ 
                        background: item.is_dir ? '#eff6ff' : '#f8fafc', padding: 8, borderRadius: 8,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        {getFileIcon(item.name, item.is_dir)}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, color: '#334155', fontWeight: 600 }}>{item.name}</div>
                        {!item.is_dir && (
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
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
        </div>
      </div>
      <style>{`
        .file-item-hover:hover {
          transform: scale(1.005);
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
          background: #fff;
        }
        .custom-directory-tree .ant-tree-node-content-wrapper {
          border-radius: 6px;
          transition: all 0.2s;
          padding: 4px 8px !important;
        }
        .custom-directory-tree .ant-tree-node-selected {
          background-color: #2563eb !important;
        }
        .custom-directory-tree .ant-tree-node-selected .ant-tree-title {
          color: #fff !important;
          font-weight: 600;
        }
        /* Ensure non-selected nodes have proper color */
        .custom-directory-tree .ant-tree-node-content-wrapper:not(.ant-tree-node-selected) .ant-tree-title {
          color: #475569 !important;
        }
        .markdown-body-v3 {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
          font-size: 14px; line-height: 1.6; color: #24292f;
        }
        .markdown-body-v3 h1, .markdown-body-v3 h2, .markdown-body-v3 h3 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; line-height: 1.25; }
        .markdown-body-v3 code { background: #afb8c133; padding: .2em .4em; border-radius: 6px; font-size: 85%; font-family: monospace; }
        .markdown-body-v3 pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow: auto; margin-bottom: 16px; border: 1px solid #e2e8f0; }
      `}</style>
    </Modal>
  );
};

export default SkillFileExplorer;
