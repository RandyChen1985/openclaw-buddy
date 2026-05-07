import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Modal, List, Button, message, Spin, Breadcrumb, Tabs, Input, Empty, Tree, Tooltip, Dropdown, type MenuProps } from 'antd';
import { 
  Folder, FileText, ChevronRight, ChevronLeft, Save, Eye, PenLine, FileCode, Search, 
  LayoutList, Maximize2, Minimize2, 
  FileJson, FileCode2, Image as ImageIcon, Monitor, Terminal, File,
  FolderPlus, FilePlus, Download, PanelLeftOpen, PanelLeftClose, Copy, X
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeSanitize from 'rehype-sanitize';
import api, { getFullUrl } from '../api';
import storage from '../utils/storage';
import TokenBadge from './TokenBadge';
import { CodeMirrorTextEditor } from './CodeMirrorTextEditor';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { Table } from 'antd';
import { FE_THEME_DARK, FE_THEME_LIGHT } from '../theme/feSurfaceTheme';
import Draggable from 'react-draggable';
import type { DraggableBounds, DraggableData, DraggableEvent } from 'react-draggable';

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
  isDarkMode?: boolean;
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
    case 'pdf': return <FileText size={size} color="#ef4444" />;
    case 'xls':
    case 'xlsx': return <FileText size={size} color="#22c55e" />;
    case 'doc':
    case 'docx': return <FileText size={size} color="#2563eb" />;
    default: return <File size={size} color="#64748b" />;
  }
};

const SkillFileExplorer: React.FC<SkillFileExplorerProps> = ({ open, onClose, rootPath, skillName, t, isMobile, isDarkMode = false }) => {
  const fe = useMemo(() => (isDarkMode ? FE_THEME_DARK : FE_THEME_LIGHT), [isDarkMode]);
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
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [excelData, setExcelData] = useState<{ columns: any[], dataSource: any[] } | null>(null);
  const [wordHtml, setWordHtml] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const [dragDisabled, setDragDisabled] = useState(true);
  const [bounds, setBounds] = useState<DraggableBounds>({ left: 0, top: 0, bottom: 0, right: 0 });
  const [dragPos, setDragPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const savedDragPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const draggleRef = useRef<HTMLDivElement>(null);

  const noDragProps = {
    onMouseEnter: () => setDragDisabled(true),
    onMouseLeave: () => setDragDisabled(false),
  };

  // Create Modal States
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createType, setCreateType] = useState<'file' | 'dir'>('file');
  const [newName, setNewName] = useState('');
  const [createParentPath, setCreateParentPath] = useState('');

  // Context Menu States
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [contextPath, setContextPath] = useState('');

  useEffect(() => {
    if (open && rootPath) {
      setCurrentPath(rootPath);
      loadFiles(rootPath);
      setSelectedFile(null);
      setIsEditing(false);
      setFilterText('');
      setIsFullscreen(false);
      setDragPos({ x: 0, y: 0 });
      savedDragPos.current = { x: 0, y: 0 };
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

  const handleDownload = (file: FileEntry) => {
    const token = storage.getItem('guardian_token') || '';
    const url = getFullUrl(`/v1/openclaw/skills/files/download?path=${encodeURIComponent(file.path)}`);
    const link = document.createElement('a');
    link.href = `${url}&authorization=Bearer ${token}`;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
    const ext = file.name.split('.').pop()?.toLowerCase();
    const isImg = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext || '');
    const isPDF = ext === 'pdf';
    const isExcel = ['xls', 'xlsx'].includes(ext || '');
    const isWord = ['docx'].includes(ext || '');

    if (isImg || isPDF || isExcel || isWord) {
      setSelectedFile(file);
      setIsEditing(true);
      setActiveTab('preview');
      setSelectedKeys([file.path]);
      
      // Clear previous previews
      if (imagePreviewUrl) { URL.revokeObjectURL(imagePreviewUrl); setImagePreviewUrl(null); }
      if (pdfPreviewUrl) { URL.revokeObjectURL(pdfPreviewUrl); setPdfPreviewUrl(null); }
      setExcelData(null);
      setWordHtml(null);

      try {
        const token = storage.getItem('guardian_token') || '';
        const url = getFullUrl(`/v1/openclaw/skills/files/download?path=${encodeURIComponent(file.path)}`);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          if (isImg) {
            const blob = await res.blob();
            setImagePreviewUrl(URL.createObjectURL(blob));
          } else if (isPDF) {
            const blob = await res.blob();
            const pdfBlob = new Blob([blob], { type: 'application/pdf' });
            setPdfPreviewUrl(URL.createObjectURL(pdfBlob));
          } else if (isExcel) {
            const buffer = await res.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
            
            if (data.length > 0) {
              const columns = data[0].map((col: any, index: number) => ({
                title: col || `Col ${index + 1}`,
                dataIndex: index.toString(),
                key: index.toString(),
                ellipsis: true,
              }));
              const dataSource = data.slice(1).map((row: any[], rIndex: number) => {
                const obj: any = { key: rIndex };
                row.forEach((cell, cIndex) => {
                  obj[cIndex.toString()] = cell;
                });
                return obj;
              });
              setExcelData({ columns, dataSource });
            }
          } else if (isWord) {
            const buffer = await res.arrayBuffer();
            const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
            setWordHtml(result.value);
          }
        }
      } catch (err) {
        console.error('Failed to load file preview:', err);
        message.error(t('common.loadFailed'));
      }
      return;
    }

    setLoading(true);
    try {
      const res = await api.get(`/v1/openclaw/skills/files/get?path=${encodeURIComponent(file.path)}`);
      setFileContent(res.data.content || '');
      setSelectedFile(file);
      setIsEditing(true);
      const isHtml = file.name.endsWith('.html') || file.name.endsWith('.htm');
      setActiveTab((file.name.endsWith('.md') || isHtml) ? 'preview' : 'edit');
      setSelectedKeys([file.path]);

      // Clear previous previews
      if (imagePreviewUrl) { URL.revokeObjectURL(imagePreviewUrl); setImagePreviewUrl(null); }
      if (pdfPreviewUrl) { URL.revokeObjectURL(pdfPreviewUrl); setPdfPreviewUrl(null); }
      setExcelData(null);
      setWordHtml(null);
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

  const handleCreateFile = (parentPath: string = currentPath) => {
    setCreateType('file');
    setCreateParentPath(parentPath);
    setNewName('');
    setCreateModalOpen(true);
  };

  const handleCreateDir = (parentPath: string = currentPath) => {
    setCreateType('dir');
    setCreateParentPath(parentPath);
    setNewName('');
    setCreateModalOpen(true);
  };

  const submitCreate = async () => {
    if (!newName) return;
    try {
      const payload = createType === 'file' ? { path: createParentPath, filename: newName } : { path: createParentPath, dirname: newName };
      await api.post(createType === 'file' ? '/v1/openclaw/files/create' : '/v1/openclaw/files/mkdir', payload);
      message.success(t('common.createSuccess'));
      setCreateModalOpen(false);
      loadFiles(currentPath);
      const newChildren = await loadTreeChildren(createParentPath);
      setTreeData(origin => updateTreeData(origin, createParentPath, newChildren));
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    }
  };

  const handleRightClick = ({ event, node }: any) => {
    if (node.isLeaf) return;
    event.preventDefault();
    setContextPath(node.key);
    setContextMenuVisible(true);
  };

  const contextMenuItems: MenuProps['items'] = [
    { key: 'newFile', icon: <FilePlus size={14} />, label: t('common.newFile'), onClick: () => handleCreateFile(contextPath) },
    { key: 'newFolder', icon: <FolderPlus size={14} />, label: t('common.newFolder'), onClick: () => handleCreateDir(contextPath) },
  ];

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
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];
  const ext = selectedFile?.name.split('.').pop()?.toLowerCase() || '';
  const isImage = imageExts.includes(ext);
  const isPDF = ext === 'pdf';
  const isExcel = ['xls', 'xlsx'].includes(ext);
  const isWord = ['doc', 'docx'].includes(ext);
  const isHTML = selectedFile?.name.endsWith('.html') || selectedFile?.name.endsWith('.htm');
  const hasPreview = isMarkdown || isImage || isPDF || isExcel || isWord || isHTML;
  const textExts = ['txt', 'json', 'js', 'ts', 'tsx', 'py', 'go', 'sh', 'yml', 'yaml', 'css', 'less', 'scss', 'conf', 'env', 'xml', 'sql', 'bat', 'ps1', 'ini', 'toml', 'log', 'prop', 'properties', 'dockerfile', 'ignore', 'gitignore'];
  const isText = textExts.includes(ext) || isMarkdown || isHTML;
  const canView = hasPreview || isText;

  const onDragStart = (_event: DraggableEvent, uiData: DraggableData) => {
    const { clientWidth, clientHeight } = window.document.documentElement;
    const targetRect = draggleRef.current?.getBoundingClientRect();
    if (!targetRect) return;
    setBounds({
      left: -targetRect.left + uiData.x,
      right: clientWidth - (targetRect.right - uiData.x),
      top: -targetRect.top + uiData.y,
      bottom: clientHeight - (targetRect.bottom - uiData.y),
    });
  };

  const onDragStop = (_event: DraggableEvent, uiData: DraggableData) => {
    const newPos = { x: uiData.x, y: uiData.y };
    setDragPos(newPos);
    savedDragPos.current = newPos;
  };

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => {
      const next = !prev;
      if (next) {
        setDragPos({ x: 0, y: 0 });
      } else {
        setDragPos(savedDragPos.current);
      }
      return next;
    });
  };

  return (
    <Modal
      title={
        <div
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'stretch' : 'center',
            justifyContent: 'space-between',
            width: '100%',
            gap: isMobile ? 12 : 0,
            cursor: isFullscreen || isMobile ? 'default' : 'move',
            boxSizing: 'border-box',
            padding: isMobile ? '12px 12px' : '8px 16px',
            background: fe.modalHeader,
            borderRadius: isFullscreen ? 0 : '12px 12px 0 0',
          }}
          onMouseOver={() => {
            if (dragDisabled) setDragDisabled(false);
          }}
          onMouseOut={() => setDragDisabled(true)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12, flex: 1, minWidth: 0 }}>
            {!isMobile && (
              <Button
                type="text"
                size="small"
                icon={isSidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                style={{ color: fe.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                {...noDragProps}
              />
            )}
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
                {...noDragProps}
              />
            )}
            {!isMobile && (
              <div style={{ background: fe.folderChipBg, padding: 8, borderRadius: 10 }}>
                <FileCode size={20} color={isDarkMode ? fe.link : '#2563eb'} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, lineHeight: 1.2, color: fe.text }}>{skillName} {t('skills.resourceExplorer')}</div>
              <Breadcrumb
                style={{ fontSize: isMobile ? 10 : 11, marginTop: isMobile ? 1 : 2 }}
                items={breadcrumbs.map((crumb, idx) => ({
                  title: (
                    <span 
                      style={{ 
                        cursor: idx < breadcrumbs.length - 1 ? 'pointer' : 'default',
                        color: idx < breadcrumbs.length - 1 ? fe.link : fe.crumbCurrent
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
          <div style={{ 
            display: 'flex', 
            gap: 8, 
            alignItems: 'center', 
            flexShrink: 0,
            flexWrap: 'wrap',
            justifyContent: isMobile ? 'flex-end' : 'flex-end',
          }}>
            {!isEditing && (
              <span style={{ flex: isMobile ? 1 : 'none', minWidth: 0 }} {...noDragProps}>
                <Input
                  placeholder={t('common.searchPlaceholder')}
                  prefix={<Search size={isMobile ? 14 : 16} color={fe.textFaint} style={{ marginRight: 4 }} />}
                  value={filterText}
                  onChange={e => setFilterText(e.target.value)}
                  allowClear
                  style={{ 
                    borderRadius: 8, 
                    height: isMobile ? 28 : 32, 
                    flex: isMobile ? 1 : 'none',
                    width: isMobile ? 'auto' : 200,
                  }}
                />
              </span>
            )}
            {!isEditing && (
              <>
                <Tooltip title={t('common.newFile', { defaultValue: '新建文件' })}>
                  <Button 
                    size={isMobile ? 'small' : undefined}
                    icon={<FilePlus size={14} />} 
                    onClick={() => handleCreateFile()} 
                    style={{ borderRadius: 8 }}
                    {...noDragProps}
                  />
                </Tooltip>
                <Tooltip title={t('common.newFolder', { defaultValue: '新建文件夹' })}>
                  <Button 
                    size={isMobile ? 'small' : undefined}
                    icon={<FolderPlus size={14} />} 
                    onClick={() => handleCreateDir()} 
                    style={{ borderRadius: 8 }}
                    {...noDragProps}
                  />
                </Tooltip>
              </>
            )}
            <Tooltip title={isFullscreen ? t('common.minimize') : t('common.maximize')}>
              <Button 
                type="text"
                size="small"
                icon={isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                onClick={toggleFullscreen}
                style={{ color: fe.textMuted }}
                {...noDragProps}
              />
            </Tooltip>
            <Button 
              type="text" 
              size="small" 
              icon={<X size={18} />} 
              onClick={onClose} 
              style={{ color: fe.textMuted }}
              {...noDragProps}
            />
          </div>
        </div>
      }
      closeIcon={null}
      open={open}
      onCancel={onClose}
      width={isFullscreen ? '100vw' : (isMobile ? '100%' : 1000)}
      style={isFullscreen ? { top: 0, maxWidth: '100vw', width: '100vw', margin: 0, padding: 0, paddingBottom: 0 } : {}}
      footer={null}
      styles={{
        ...(isFullscreen ? { wrapper: { padding: 0 } } : {}),
        body: {
          padding: 0,
          background: fe.modalBody,
          overflow: 'hidden',
          borderRadius: isFullscreen ? 0 : '0 0 12px 12px',
          display: 'flex',
          flexDirection: 'column',
          ...(isFullscreen
            ? { flex: 1, minHeight: 0, height: 'auto' }
            : { height: isMobile ? 'calc(100vh - 120px)' : 550 }),
        },
        content: {
          padding: 0,
          background: fe.modalBody,
          borderRadius: isFullscreen ? 0 : 12,
          overflow: 'hidden',
          ...(isFullscreen
            ? {
                display: 'flex',
                flexDirection: 'column',
                height: '100vh',
                maxHeight: '100vh',
                maxWidth: '100vw',
                margin: 0,
              }
            : {}),
        },
        header: {
          padding: 0,
          background: fe.modalHeader,
          borderBottom: `1px solid ${fe.editHeaderBorder}`,
          marginBottom: 0,
          borderRadius: isFullscreen ? 0 : '12px 12px 0 0',
          flexShrink: 0,
        },
      }}
      centered={!isFullscreen}
      destroyOnClose
      modalRender={(modal) => (
        <Draggable
          disabled={dragDisabled || isFullscreen || isMobile}
          bounds={bounds}
          position={dragPos}
          onStart={onDragStart}
          onStop={onDragStop}
        >
          <div ref={draggleRef} style={isFullscreen ? { width: '100%', minHeight: '100%' } : undefined}>
            {modal}
          </div>
        </Draggable>
      )}
    >
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: fe.bg, color: fe.text }}>
        {!isMobile && (
          <div style={{ 
            width: isSidebarCollapsed ? 0 : 260, 
            borderRight: isSidebarCollapsed ? 'none' : `1px solid ${fe.border}`, 
            display: 'flex', 
            flexDirection: 'column', 
            background: fe.bgTree,
            transition: 'all 0.3s ease-in-out',
            overflow: 'hidden',
            opacity: isSidebarCollapsed ? 0 : 1,
            pointerEvents: isSidebarCollapsed ? 'none' : 'auto'
          }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${fe.border}`, fontSize: 12, fontWeight: 700, color: fe.textMuted, display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
               <LayoutList size={14} /> {t('common.directory')}
            </div>
            <Dropdown menu={{ items: contextMenuItems }} trigger={['contextMenu']} open={contextMenuVisible} onOpenChange={(visible) => setContextMenuVisible(visible)}>
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 8px', minWidth: 260 }}>
                <DirectoryTree
                  loadData={onLoadData} treeData={treeData} onSelect={onTreeSelect}
                  onRightClick={handleRightClick}
                  expandedKeys={expandedKeys} onExpand={handleExpand} selectedKeys={selectedKeys}
                  showIcon={true} blockNode expandAction={false} className="custom-directory-tree"
                />
              </div>
            </Dropdown>
          </div>
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: fe.bgMuted }}>


          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {loading && !isSaving ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Spin size="large" tip={t('common.loading')} />
              </div>
            ) : isEditing ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: fe.bg }}>
                <div style={{ padding: '8px 16px', background: fe.editHeaderBg, borderBottom: `1px solid ${fe.editHeaderBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: fe.textSecondary }}>
                    {getFileIcon(selectedFile?.name || '', false, 16)}
                    {selectedFile?.name}
                  </div>
                  {canView ? (
                    <Tabs 
                        size="small" activeKey={activeTab} onChange={(k) => setActiveTab(k as any)}
                        items={[
                          isText && { key: 'edit', label: <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><PenLine size={14}/>{t('common.edit')}</div> },
                          hasPreview && { key: 'preview', label: <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Eye size={14}/>{t('common.preview')}</div> }
                        ].filter(Boolean) as any}
                        style={{ marginBottom: -12 }}
                    />
                  ) : (
                    <div style={{ fontSize: 12, color: fe.textFaint }}>{t('common.unsupported')}</div>
                  )}
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  {!canView ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: fe.centerWell }}>
                      <Empty 
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={
                          <div style={{ textAlign: 'center' }}>
                            <p style={{ color: fe.unsupportedText, marginBottom: 12 }}>{t('common.unsupportedFile')}</p>
                            <Button type="primary" icon={<Download size={14} />} onClick={() => selectedFile && handleDownload(selectedFile)} style={{ background: fe.link }}>
                              {t('common.download')}
                            </Button>
                          </div>
                        } 
                      />
                    </div>
                  ) : activeTab === 'preview' && isMarkdown ? (
                      <div style={{ height: '100%', overflowY: 'auto', background: fe.previewOuter, padding: '24px' }}>
                        <div style={{ maxWidth: 800, margin: '0 auto', background: fe.previewInner, padding: 32, borderRadius: 8, boxShadow: fe.docShadow }}>
                          <div className="markdown-body-v3">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeSanitize]}>
                              {fileContent}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    ) : activeTab === 'preview' && isImage ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: fe.imgBackdrop, padding: 20 }}>
                      {imagePreviewUrl ? (
                        <img 
                          src={imagePreviewUrl} 
                          alt={selectedFile?.name} 
                          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', boxShadow: fe.docShadow, borderRadius: 4, background: fe.imgBg }} 
                        />
                      ) : (
                        <Spin />
                      )}
                      </div>
                    ) : activeTab === 'preview' && isPDF ? (
                    <div style={{ height: '100%', background: fe.previewOuter }}>
                      {pdfPreviewUrl ? (
                        <object data={pdfPreviewUrl} type="application/pdf" style={{ width: '100%', height: '100%', border: 'none' }}>
                          <div style={{ padding: 40, textAlign: 'center' }}>
                            <p>{t('common.pdfSupportError', { defaultValue: '您的浏览器不支持 PDF 预览' })}</p>
                            <Button href={pdfPreviewUrl} download={selectedFile?.name}>{t('common.download')}</Button>
                          </div>
                        </object>
                      ) : (
                        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin /></div>
                      )}
                      </div>
                    ) : activeTab === 'preview' && isExcel ? (
                    <div style={{ height: '100%', overflowY: 'auto', background: fe.previewOuter, padding: 20 }}>
                      <div style={{ background: fe.excelWrap, padding: 12, borderRadius: 8, boxShadow: fe.excelShadow }}>
                        {excelData ? (
                          <Table 
                            columns={excelData.columns} 
                            dataSource={excelData.dataSource} 
                            pagination={false} 
                            size="small" 
                            scroll={{ x: 'max-content' }}
                          />
                        ) : (
                          <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>
                        )}
                      </div>
                      </div>
                    ) : activeTab === 'preview' && isWord ? (
                      <div style={{ height: '100%', padding: 24, overflowY: 'auto', background: fe.previewOuter }}>
                      <div style={{ maxWidth: 900, margin: '0 auto', background: fe.previewInner, padding: '40px 60px', borderRadius: 12, boxShadow: fe.docShadow }}>
                        {wordHtml ? (
                          <div className="word-preview-v3" dangerouslySetInnerHTML={{ __html: wordHtml }} />
                        ) : (
                          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                        )}
                      </div>
                      </div>
                    ) : (
                      <div style={{ position: 'relative', height: '100%' }}>
                      <TokenBadge text={fileContent} />
                      <Tooltip title={t('common.copyContent', { defaultValue: '复制全部内容' })}>
                        <Button 
                          type="default"
                          icon={<Copy size={16} />} 
                          onClick={() => {
                            navigator.clipboard.writeText(fileContent).then(() => {
                              message.success(t('common.copied', { defaultValue: '已复制到剪贴板' }));
                            }).catch(() => {
                              message.error(t('common.copyFailed', { defaultValue: '复制失败，请手动复制' }));
                            });
                          }}
                          style={{ 
                            position: 'absolute', 
                            bottom: 32, 
                            right: 160,
                            zIndex: 100, 
                            borderRadius: 22, 
                            height: 44, 
                            width: 44,
                            padding: 0,
                            boxShadow: '0 4px 14px rgba(100, 116, 139, 0.3)',
                            background: fe.copyFloatBg,
                            border: `1px solid ${fe.copyFloatBorder}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: fe.copyFloatColor,
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                          }}
                          className="skill-copy-float-btn"
                        />
                      </Tooltip>
                      <Button 
                        type="primary" 
                        icon={<Save size={16} />} 
                        loading={isSaving} 
                        onClick={handleSave} 
                        style={{ 
                          position: 'absolute', 
                          bottom: 32, 
                          right: 32, 
                          zIndex: 100, 
                          borderRadius: 24, 
                          height: 44, 
                          padding: '0 24px', 
                          boxShadow: '0 8px 20px rgba(14, 165, 233, 0.4)',
                          background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
                          border: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 15,
                          fontWeight: 600,
                          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                        }}
                        className="skill-save-float-btn"
                      >
                        {t('common.save', { defaultValue: '保存' })}
                      </Button>
                      <div style={{ height: '100%', minHeight: 0 }}>
                        <CodeMirrorTextEditor
                          filename={selectedFile?.name || ''}
                          value={fileContent}
                          onChange={setFileContent}
                          isDarkMode={isDarkMode}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : filteredFiles.length > 0 ? (
              <List
                className="skill-file-list" style={{ padding: isMobile ? '12px 12px' : '12px 24px', overflowY: 'auto' }}
                dataSource={filteredFiles}
                renderItem={(item) => (
                  <List.Item
                    style={{ 
                      cursor: 'pointer', borderRadius: 12, border: 'none', padding: '10px 16px', marginBottom: 8,
                      transition: 'all 0.2s', background: fe.cardBg, boxShadow: isDarkMode ? '0 1px 2px rgba(0,0,0,0.25)' : '0 1px 2px rgba(0,0,0,0.05)'
                    }}
                    className="file-item-hover"
                    onClick={() => item.is_dir ? handleFolderClick(item.path) : loadFileContent(item)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                      <div style={{ 
                        background: item.is_dir ? fe.iconDir : fe.iconFile, padding: 8, borderRadius: 8,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        {getFileIcon(item.name, item.is_dir)}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, color: fe.text, fontWeight: 600 }}>{item.name}</div>
                        {!item.is_dir && (
                          <div style={{ fontSize: 11, color: fe.textFaint, marginTop: 2 }}>
                            {(item.size / 1024).toFixed(1)} KB · {item.mod_time}
                          </div>
                        )}
                      </div>
                      <ChevronRight size={16} color={fe.textFaint} />
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
        .skill-save-float-btn:hover {
          transform: translateY(-2px) scale(1.05);
          box-shadow: 0 12px 24px rgba(14, 165, 233, 0.5) !important;
        }
        .skill-copy-float-btn:hover {
          transform: translateY(-2px) scale(1.05);
          box-shadow: 0 8px 20px rgba(100, 116, 139, 0.35) !important;
          background: ${fe.copyFloatHoverBg} !important;
          border-color: ${fe.copyFloatHoverBorder} !important;
          color: ${fe.copyFloatHoverColor} !important;
        }
        .file-item-hover:hover {
          transform: scale(1.005);
          box-shadow: 0 4px 12px ${fe.hoverShadow};
          background: ${fe.rowHover};
        }
        .custom-directory-tree .ant-tree-node-content-wrapper {
          border-radius: 6px;
          transition: all 0.2s;
          padding: 4px 8px !important;
          display: flex !important;
          align-items: center;
        }
        .custom-directory-tree .ant-tree-node-selected {
          background-color: ${fe.treeNodeSelBg} !important;
        }
        .custom-directory-tree .ant-tree-node-selected .ant-tree-title {
          color: ${fe.treeTitleSelColor} !important;
          font-weight: 600;
        }
        .custom-directory-tree .ant-tree-node-content-wrapper:not(.ant-tree-node-selected) .ant-tree-title {
          color: ${fe.treeTitle} !important;
        }
        .markdown-body-v3 {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
          font-size: 14px; line-height: 1.6;
          color: ${isDarkMode ? 'rgba(255,255,255,0.88)' : '#24292f'};
        }
        .markdown-body-v3 h1, .markdown-body-v3 h2, .markdown-body-v3 h3 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; line-height: 1.25; }
        .markdown-body-v3 code { background: ${isDarkMode ? 'rgba(255,255,255,0.1)' : '#afb8c133'}; padding: .2em .4em; border-radius: 6px; font-size: 85%; font-family: monospace; }
        .markdown-body-v3 pre { background: ${isDarkMode ? '#262626' : '#f6f8fa'}; padding: 16px; border-radius: 6px; overflow: auto; margin-bottom: 16px; border: 1px solid ${isDarkMode ? 'rgba(255,255,255,0.12)' : '#e2e8f0'}; }
        .word-preview-v3 { font-family: "Times New Roman", Times, serif; font-size: 16px; line-height: 1.5; color: ${isDarkMode ? 'rgba(255,255,255,0.85)' : '#333'}; }
        .word-preview-v3 h1, .word-preview-v3 h2, .word-preview-v3 h3 { margin-top: 1.2em; margin-bottom: 0.6em; }
        .word-preview-v3 p { margin-bottom: 1em; text-align: justify; }
        .word-preview-v3 table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
        .word-preview-v3 table td, .word-preview-v3 table th { border: 1px solid ${isDarkMode ? 'rgba(255,255,255,0.15)' : '#ddd'}; padding: 8px; }
      `}</style>

      <Modal
        title={createType === 'file' ? t('common.newFile') : t('common.newFolder')}
        open={createModalOpen}
        onOk={submitCreate}
        onCancel={() => setCreateModalOpen(false)}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        destroyOnClose
      >
        <div style={{ paddingTop: 10 }}>
          <div style={{ marginBottom: 8, fontSize: 12, color: '#64748b' }}>
            {createType === 'file' ? t('common.enterFileName') : t('common.enterFolderName')}
          </div>
          <Input 
            autoFocus 
            value={newName} 
            onChange={e => setNewName(e.target.value)} 
            onPressEnter={submitCreate}
            placeholder={createType === 'file' ? "example.txt" : "new_folder"}
          />
        </div>
      </Modal>
    </Modal>
  );
};

export default SkillFileExplorer;
