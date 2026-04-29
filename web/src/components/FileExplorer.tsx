import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Modal, Button, message, Spin, Breadcrumb, Tabs, Input, Empty, 
  Popconfirm, Tooltip, Tree, Table, Dropdown, Checkbox, Space, 
  Segmented, Card 
} from 'antd';
import type { MenuProps } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeSanitize from 'rehype-sanitize';
import api, { getFullUrl } from '../api';
import storage from '../utils/storage';
import TokenBadge from './TokenBadge';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import Editor from '@monaco-editor/react';
import { 
  Folder, FileText, ChevronLeft, Save, Eye, PenLine, Trash2, FolderOpen, 
  Upload, Download, Search, LayoutList, Maximize2, Minimize2, 
  FileJson, FileCode2, Image as ImageIcon, Monitor, Terminal, File,
  FolderPlus, FilePlus, Copy, PanelLeftOpen, PanelLeftClose, Send,
  MoreVertical, Edit3, Grid, List as ListIcon, RefreshCcw, Sparkles, Shield
} from 'lucide-react';

const { DirectoryTree } = Tree;

const protectedFiles = ['soul.md', 'agent.md', 'agents.md', 'identity.md', 'identify.md', 'user.md', 'tools.md', 'heartbeat.md', 'memory.md', 'soul', 'agent', 'memory', 'identity', 'heartbeat'];

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

interface FileExplorerProps {
  open: boolean;
  onClose: () => void;
  rootPath: string;
  title: string;
  t: any;
  isMobile: boolean;
  onSendToChat?: (content: string, fileName: string) => void;
  pendingSaveContent?: string;
  onClearPendingSave?: () => void;
}

const getFileIcon = (name: string, isDir: boolean, size: number = 20, isProtected: boolean = false) => {
  if (isProtected && !isDir) return <Shield size={size} color="#8b5cf6" fill="#8b5cf622" />;
  if (isDir) return <Folder size={size} color="#0ea5e9" fill="#0ea5e933" />;
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

const FileExplorer: React.FC<FileExplorerProps> = ({ 
  open, onClose, rootPath, title, t, isMobile, 
  onSendToChat, pendingSaveContent, onClearPendingSave 
}) => {
  const [currentPath, setCurrentPath] = useState(rootPath);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [isUploading, setIsUploading] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<TreeDataItem[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [excelData, setExcelData] = useState<{ columns: any[], dataSource: any[] } | null>(null);
  const [wordHtml, setWordHtml] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [selectedBulkKeys, setSelectedBulkKeys] = useState<string[]>([]);
  const [searchMode, setSearchMode] = useState<'current' | 'global'>('current');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'time'>('name');
  
  // Rename States
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [oldRenamePath, setOldRenamePath] = useState('');
  const [renameTargetName, setRenameTargetName] = useState('');
  
  // Create Modal States
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createType, setCreateType] = useState<'file' | 'dir'>('file');
  const [newName, setNewName] = useState('');
  const [createParentPath, setCreateParentPath] = useState('');

  // Context Menu States
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [contextPath, setContextPath] = useState('');
  const [contextIsFile, setContextIsFile] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });

  const isProtected = (name: string, path: string) => {
    if (path === rootPath) return true;
    const baseName = name.toLowerCase().replace(/\.md$/, '');
    return protectedFiles.includes(name.toLowerCase()) || protectedFiles.includes(baseName);
  };

  const isMarkdown = selectedFile?.name.endsWith('.md');
  const isHTML = selectedFile?.name.endsWith('.html') || selectedFile?.name.endsWith('.htm');
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];
  const ext = selectedFile?.name.split('.').pop()?.toLowerCase() || '';
  const isImage = imageExts.includes(ext);
  const isPDF = ext === 'pdf';
  const isExcel = ['xls', 'xlsx'].includes(ext);
  const isWord = ['doc', 'docx'].includes(ext);
  const hasPreview = isMarkdown || isHTML || isImage || isPDF || isExcel || isWord;
  const textExts = ['txt', 'json', 'js', 'ts', 'tsx', 'py', 'go', 'sh', 'yml', 'yaml', 'css', 'less', 'scss', 'conf', 'env', 'xml', 'sql', 'bat', 'ps1', 'ini', 'toml', 'log', 'prop', 'properties', 'dockerfile', 'ignore', 'gitignore'];
  const isText = textExts.includes(ext) || isMarkdown || isHTML;
  const canView = hasPreview || isText;

  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Initialize path and tree when modal opens
  useEffect(() => {
    if (open && rootPath) {
      setCurrentPath(rootPath);
      loadFiles(rootPath);
      setSelectedFile(null);
      setIsEditing(false);
      setFilterText('');
      setIsFullscreen(false);
      
      const initialRoot: TreeDataItem = {
        title: title || 'Root',
        key: rootPath,
        isLeaf: false,
        children: [],
      };
      setTreeData([initialRoot]);
      setExpandedKeys([rootPath]);
      setSelectedKeys([rootPath]);
      
      loadTreeChildren(rootPath).then(children => {
        setTreeData([{ ...initialRoot, children }]);
      });
    }
  }, [open, rootPath, title]);

  const loadFiles = async (path: string) => {
    setLoading(true);
    try {
      let res;
      if (searchMode === 'global' && filterText.trim()) {
        res = await api.get(`/v1/openclaw/files/search?path=${encodeURIComponent(path)}&query=${encodeURIComponent(filterText)}`);
      } else {
        res = await api.get(`/v1/openclaw/files/list?path=${encodeURIComponent(path)}`);
      }
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

  const loadTreeChildren = async (path: string): Promise<TreeDataItem[]> => {
    try {
      const res = await api.get(`/v1/openclaw/files/list?path=${encodeURIComponent(path)}`);
      const entries = (res.data.files || []) as FileEntry[];
      return entries.map(item => ({
        title: item.name,
        key: item.path,
        isLeaf: !item.is_dir,
        data: item,
      })).sort((a, b) => {
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
      if (children && children.length > 0) {
        resolve();
        return;
      }
      const newChildren = await loadTreeChildren(key);
      setTreeData((origin) =>
        updateTreeData(origin, key, newChildren)
      );
      resolve();
    });
  };

  const updateTreeData = (list: TreeDataItem[], key: React.Key, children: TreeDataItem[]): TreeDataItem[] =>
    list.map((node) => {
      if (node.key === key) {
        return { ...node, children };
      }
      if (node.children) {
        return { ...node, children: updateTreeData(node.children, key, children) };
      }
      return node;
    });

  const loadFileContent = async (file: FileEntry) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const isImg = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext || '');
    const isPDF = ext === 'pdf';
    const isExcel = ['xls', 'xlsx'].includes(ext || '');
    const isWord = ['docx'].includes(ext || ''); // mammoth mainly supports .docx

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
        const url = getFullUrl(`/v1/openclaw/files/download?path=${encodeURIComponent(file.path)}`);
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
      const res = await api.get(`/v1/openclaw/files/get?path=${encodeURIComponent(file.path)}`);
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
      const newChildren = await loadTreeChildren(currentPath);
      setTreeData(origin => updateTreeData(origin, currentPath, newChildren));
      if (selectedFile?.path === file.path) {
        setIsEditing(false);
        setSelectedFile(null);
        setSelectedKeys([currentPath]);
      }
      setSelectedBulkKeys(prev => prev.filter(k => k !== file.path));
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message || t('common.deleteFailed'));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedBulkKeys.length === 0) return;
    setLoading(true);
    let successCount = 0;
    for (const path of selectedBulkKeys) {
      try {
        await api.delete(`/v1/openclaw/files/delete?path=${encodeURIComponent(path)}`);
        successCount++;
      } catch (err: any) {
        message.error(`${path}: ${err.message}`);
      }
    }
    setLoading(false);
    if (successCount > 0) {
      message.success(t('common.deleteSuccess'));
      setSelectedBulkKeys([]);
      loadFiles(currentPath);
      // Refresh tree
      const newChildren = await loadTreeChildren(currentPath);
      setTreeData(origin => updateTreeData(origin, currentPath, newChildren));
    }
  };

  const handleRename = async () => {
    if (!renameTargetName || !oldRenamePath) return;
    const parentPath = oldRenamePath.substring(0, oldRenamePath.lastIndexOf(oldRenamePath.includes('/') ? '/' : '\\'));
    const newPath = parentPath ? `${parentPath}/${renameTargetName}` : renameTargetName;
    
    try {
      await api.post('/v1/openclaw/files/rename', {
        oldPath: oldRenamePath,
        newPath: newPath
      });
      message.success(t('common.renameSuccess', { defaultValue: '重命名成功' }));
      setRenameModalOpen(false);
      loadFiles(currentPath);
      // Refresh tree
      if (parentPath) {
        const newChildren = await loadTreeChildren(parentPath);
        setTreeData(origin => updateTreeData(origin, parentPath, newChildren));
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    }
  };

  const getEditorLanguage = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js': return 'javascript';
      case 'ts': return 'typescript';
      case 'tsx': return 'typescript';
      case 'json': return 'json';
      case 'py': return 'python';
      case 'go': return 'go';
      case 'sh': return 'shell';
      case 'yml':
      case 'yaml': return 'yaml';
      case 'css': return 'css';
      case 'html': return 'html';
      case 'md': return 'markdown';
      case 'sql': return 'sql';
      case 'xml': return 'xml';
      default: return 'plaintext';
    }
  };

  const handleDownload = (file: FileEntry | null) => {
    if (!file) return;
    const token = storage.getItem('guardian_token') || '';
    const url = getFullUrl(`/v1/openclaw/files/download?path=${encodeURIComponent(file.path)}`);
    let fileName = file.name || file.path.split(/[/\\]/).pop() || 'download';

    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.blob() : r.json().then(e => { throw new Error(e.error); }))
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(blobUrl);
      })
      .catch(err => message.error(err.message || t('common.downloadFailed')));
  };

  const handleUploadClick = () => uploadInputRef.current?.click();

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;
    setIsUploading(true);
    let successCount = 0;
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const formData = new FormData();
      formData.append('path', currentPath);
      formData.append('file', file);
      try {
        await api.post('/v1/openclaw/files/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        successCount++;
      } catch (err: any) {
        message.error(`${file.name}: ${err.response?.data?.error || err.message}`);
      }
    }
    setIsUploading(false);
    e.target.value = '';
    if (successCount > 0) {
      message.success(t('common.uploadSuccess'));
      loadFiles(currentPath);
      const newChildren = await loadTreeChildren(currentPath);
      setTreeData(origin => updateTreeData(origin, currentPath, newChildren));
    }
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
      const endpoint = createType === 'file' ? '/v1/openclaw/files/create' : '/v1/openclaw/files/mkdir';
      const payload = createType === 'file' 
        ? { path: createParentPath, filename: newName, content: pendingSaveContent || '' } 
        : { path: createParentPath, dirname: newName };
      await api.post(endpoint, payload);
      message.success(t('common.createSuccess'));
      setCreateModalOpen(false);
      if (createType === 'file' && pendingSaveContent && onClearPendingSave) {
        onClearPendingSave();
      }
      loadFiles(currentPath);
      const newChildren = await loadTreeChildren(createParentPath);
      setTreeData(origin => updateTreeData(origin, createParentPath, newChildren));
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    }
  };

  const copyToClipboard = (text: string) => {
    if (!text) return;
    
    // 优先尝试现代 Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        message.success(t('common.copySuccess', { defaultValue: '复制成功' }));
      }).catch(err => {
        console.warn('Modern Clipboard API failed, trying fallback:', err);
        fallbackCopyTextToClipboard(text);
      });
    } else {
      // API 不可用（如非安全上下文）时使用后备方案
      fallbackCopyTextToClipboard(text);
    }
  };

  const fallbackCopyTextToClipboard = (text: string) => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      
      // 确保元素在视口外且不可见
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      
      textArea.focus();
      textArea.select();

      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);

      if (successful) {
        message.success(t('common.copySuccess', { defaultValue: '复制成功' }));
      } else {
        throw new Error('execCommand copy returned false');
      }
    } catch (err) {
      console.error('Fallback copy failed:', err);
      message.error(t('common.copyFailed', { defaultValue: '复制失败' }));
    }
  };

  const handleRightClick = (event: any, key: string, isDir: boolean) => {
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    
    // Support both React.MouseEvent and antd's event wrapper
    const clientX = event.clientX || (event.nativeEvent && event.nativeEvent.clientX);
    const clientY = event.clientY || (event.nativeEvent && event.nativeEvent.clientY);
    
    setContextPath(key);
    setContextIsFile(!isDir);
    setMenuPosition({ x: clientX, y: clientY });
    setContextMenuVisible(true);
  };


  const contextMenuItems: MenuProps['items'] = useMemo(() => {
    const items: MenuProps['items'] = [];
    
    if (contextIsFile) {
      if (onSendToChat) {
        const fileName = contextPath.split(/[/\\]/).pop() || 'file';
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        const isTextFile = ['txt', 'log', 'csv', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'go', 'sh', 'bash', 'yml', 'yaml', 'css', 'html', 'htm', 'md', 'dockerfile'].includes(ext) || fileName.endsWith('.md') || fileName.endsWith('.html');
        
        items.push({
          key: 'sendToChat',
          icon: <Send size={14} />,
          label: t('chat.sendToChat', { defaultValue: '发送到会话' }),
          onClick: async () => {
            try {
              const res = await api.get(`/v1/openclaw/files/get?path=${encodeURIComponent(contextPath)}`);
              onSendToChat(res.data.content || '', fileName);
              onClose();
            } catch (err: any) {
              message.error(err.response?.data?.error || err.message || t('common.loadFailed'));
            }
          }
        });
        
        if (isTextFile) {
          items.push({
            key: 'aiSummary',
            icon: <Sparkles size={14} color="#8b5cf6" />,
            label: t('chat.aiSummary', { defaultValue: 'AI 一键总结' }),
            onClick: async () => {
              try {
                const res = await api.get(`/v1/openclaw/files/get?path=${encodeURIComponent(contextPath)}`);
                onSendToChat(`请帮我总结并分析这个文件的内容：\n\n文件名: ${fileName}\n\n内容:\n${res.data.content || ''}`, fileName);
                onClose();
              } catch (err: any) {
                message.error(err.response?.data?.error || err.message || t('common.loadFailed'));
              }
            }
          });
        }
        items.push({ type: 'divider' });
      }
      const isRoot = contextPath === rootPath;
      const fileName = contextPath.split(/[/\\]/).pop() || '';
      if (!isRoot && !isProtected(fileName, contextPath)) {
        items.push({ 
          key: 'rename', 
          icon: <Edit3 size={14} />, 
          label: t('common.rename', { defaultValue: '重命名' }), 
          onClick: () => {
            setOldRenamePath(contextPath);
            setRenameTargetName(fileName);
            setRenameModalOpen(true);
          } 
        });
        items.push({ 
          key: 'delete', 
          icon: <Trash2 size={14} />, 
          label: t('common.delete', { defaultValue: '删除' }), 
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: t('common.deleteConfirm'),
              onOk: () => handleDelete({ name: fileName, path: contextPath, is_dir: !contextIsFile, size: 0, mod_time: '' })
            });
          }
        });
        items.push({ type: 'divider' });
      }
      items.push({ 
        key: 'copyPath', 
        icon: <Copy size={14} />, 
        label: t('common.copyPath', { defaultValue: '复制绝对路径' }), 
        onClick: () => copyToClipboard(contextPath) 
      });
    } else {
      items.push({ key: 'newFile', icon: <FilePlus size={14} />, label: t('common.newFile'), onClick: () => handleCreateFile(contextPath) });
      if (pendingSaveContent) {
        items.push({
          key: 'savePendingContent',
          icon: <Save size={14} />,
          label: t('chat.saveMessageHere', { defaultValue: '在此保存消息' }),
          onClick: () => {
            setCreateType('file');
            setCreateParentPath(contextPath);
            setNewName(`msg_${new Date().getTime()}.md`);
            setCreateModalOpen(true);
          }
        });
      }
      items.push({ key: 'newFolder', icon: <FolderPlus size={14} />, label: t('common.newFolder'), onClick: () => handleCreateDir(contextPath) });
      items.push({ type: 'divider' });
      const isRoot = contextPath === rootPath;
      const dirName = contextPath.split(/[/\\]/).pop() || '';
      if (!isRoot && !isProtected(dirName, contextPath)) {
        items.push({ 
          key: 'rename', 
          icon: <Edit3 size={14} />, 
          label: t('common.rename', { defaultValue: '重命名' }), 
          onClick: () => {
            setOldRenamePath(contextPath);
            setRenameTargetName(dirName);
            setRenameModalOpen(true);
          } 
        });
        items.push({ 
          key: 'delete', 
          icon: <Trash2 size={14} />, 
          label: t('common.delete', { defaultValue: '删除' }), 
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: t('common.deleteConfirm'),
              onOk: () => handleDelete({ name: dirName, path: contextPath, is_dir: !contextIsFile, size: 0, mod_time: '' })
            });
          }
        });
        items.push({ type: 'divider' });
      }
      items.push({ 
        key: 'copyPath', 
        icon: <Copy size={14} />, 
        label: t('common.copyPath', { defaultValue: '复制绝对路径' }), 
        onClick: () => copyToClipboard(contextPath) 
      });
    }
    
    return items;
  }, [contextPath, contextIsFile, t, onSendToChat, onClose, pendingSaveContent]);

  const handleFolderClick = (path: string) => {
    setCurrentPath(path);
    loadFiles(path);
    setIsEditing(false);
    setSelectedFile(null);
    setSelectedKeys([path]);
    if (!expandedKeys.includes(path)) setExpandedKeys(prev => [...prev, path]);
  };

  // Keep tree selected keys in sync with currentPath when not editing a specific file
  useEffect(() => {
    if (!selectedFile && currentPath) {
      setSelectedKeys([currentPath]);
      // 自动展开到当前路径
      const parts = currentPath.replace(rootPath, '').split(/[/\\]/).filter(Boolean);
      let currentExpand = rootPath;
      const newExpandedKeys = [rootPath];
      parts.forEach(p => {
        currentExpand = currentExpand.endsWith('/') || currentExpand.endsWith('\\') ? `${currentExpand}${p}` : `${currentExpand}/${p}`;
        newExpandedKeys.push(currentExpand);
      });
      setExpandedKeys(prev => Array.from(new Set([...prev, ...newExpandedKeys])));
    }
  }, [currentPath, selectedFile, rootPath]);

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
    // Always keep the root node expanded
    if (!keys.includes(rootPath)) {
      setExpandedKeys([rootPath, ...keys]);
    } else {
      setExpandedKeys(keys);
    }
  };

  const filteredFiles = useMemo(() => {
    let result = [...files];
    if (filterText.trim() && searchMode === 'current') {
      const term = filterText.toLowerCase();
      result = files.filter(f => f.name.toLowerCase().includes(term));
    }
    
    // Sorting logic
    result.sort((a, b) => {
      // Folders always first
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      
      switch (sortBy) {
        case 'size': return b.size - a.size;
        case 'time': return b.mod_time.localeCompare(a.mod_time) * -1;
        default: return a.name.localeCompare(b.name);
      }
    });

    if (currentPath !== rootPath && !filterText && searchMode === 'current') {
      // Find parent path
      const parts = currentPath.split(/[/\\]/).filter(Boolean);
      parts.pop();
      const parentPath = currentPath.startsWith('/') ? '/' + parts.join('/') : parts.join('/');
      
      return [
        { name: '..', path: parentPath || rootPath, is_dir: true, size: 0, mod_time: '' },
        ...result
      ];
    }
    return result;
  }, [files, filterText, currentPath, rootPath, sortBy, searchMode]);

  const breadcrumbs = useMemo(() => {
    if (!rootPath) return [];
    if (!currentPath.startsWith(rootPath)) return [{ name: '...', path: currentPath }];
    const relativePath = currentPath.substring(rootPath.length);
    const parts = relativePath.split(/[/\\]/).filter(Boolean);
    const crumbs = [{ name: title || 'Root', path: rootPath }];
    let currentFullPath = rootPath;
    parts.forEach(part => {
      currentFullPath = currentFullPath.endsWith('/') || currentFullPath.endsWith('\\') ? `${currentFullPath}${part}` : `${currentFullPath}/${part}`;
      crumbs.push({ name: part, path: currentFullPath });
    });
    return crumbs;
  }, [currentPath, rootPath, title]);


  return (
    <>
      <Modal
        title={null}
        open={open}
        onCancel={onClose}
        footer={null}
        width={isFullscreen ? '100%' : (isMobile ? '100%' : 1200)}
        style={isFullscreen ? { top: 0, paddingBottom: 0, maxWidth: 'none' } : { top: 20, maxWidth: '95vw' }}
        bodyStyle={{ padding: 0, height: isFullscreen ? '100vh' : 'calc(100vh - 120px)', overflow: 'hidden', borderRadius: 12 }}
        maskStyle={{ backdropFilter: 'blur(4px)', background: 'rgba(0,0,0,0.45)' }}
        destroyOnClose
      >
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#fff' }}>
          {/* Custom Header */}
          <div style={{ 
            padding: isMobile ? '12px 16px' : '16px 24px', 
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'flex-start' : 'center',
            justifyContent: 'space-between',
            gap: isMobile ? 12 : 0,
            background: '#fff',
            zIndex: 10
          }}>
            {(isEditing || (isMobile && currentPath !== rootPath)) && (
              <Button 
                type="text" 
                icon={<ChevronLeft size={isMobile ? 18 : 20} />} 
                onClick={() => {
                  if (isEditing) {
                    setIsEditing(false);
                    setSelectedFile(null);
                  } else if (isMobile && currentPath !== rootPath) {
                    // Go up one level
                    const parts = currentPath.split(/[/\\]/).filter(Boolean);
                    parts.pop();
                    const parentPath = currentPath.startsWith('/') ? '/' + parts.join('/') : parts.join('/');
                    handleFolderClick(parentPath || rootPath);
                  }
                }}
                style={{ padding: 0, width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              />
            )}
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12, flex: 1, minWidth: 0 }}>
            {!isMobile && (
              <Button
                type="text"
                size="small"
                icon={isSidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                style={{ color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              />
            )}
            {!isMobile && (
              <div 
                style={{ background: '#f0f9ff', padding: 8, borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => handleFolderClick(rootPath)}
              >
                <FolderOpen size={20} color="#0ea5e9" />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2, marginBottom: 2 }}>{title}</div>
              <Breadcrumb
                style={{ fontSize: 12 }}
                items={breadcrumbs.map((crumb, idx) => ({
                  title: (
                    <span 
                      style={{ 
                        cursor: 'pointer',
                        color: idx < breadcrumbs.length - 1 ? '#0ea5e9' : '#94a3b8',
                        transition: 'color 0.2s'
                      }}
                      onClick={() => handleFolderClick(crumb.path)}
                      className="breadcrumb-item"
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
            gap: isMobile ? 4 : 8, 
            alignItems: 'center', 
            width: isMobile ? '100%' : 'auto',
            justifyContent: isMobile ? 'flex-end' : 'flex-start',
            marginTop: isMobile ? 4 : 0
          }}>
            {!isEditing && (
              <Space.Compact style={{ flex: isMobile ? 1 : 'none' }}>
                <Input
                  placeholder={searchMode === 'current' ? t('common.searchPlaceholder') : t('common.globalSearch', { defaultValue: '全局搜索...' })}
                  prefix={<Search size={isMobile ? 14 : 16} color="#94a3b8" style={{ marginRight: 4 }} />}
                  value={filterText}
                  onChange={e => setFilterText(e.target.value)}
                  onPressEnter={() => searchMode === 'global' && loadFiles(currentPath)}
                  allowClear
                  style={{ 
                    borderRadius: '8px 0 0 8px', 
                    height: isMobile ? 28 : 32, 
                    width: isMobile ? 'auto' : 180,
                  }}
                />
                <Segmented
                  size={isMobile ? 'small' : 'middle'}
                  value={searchMode}
                  onChange={(v) => setSearchMode(v as any)}
                  options={[
                    { value: 'current', label: <Tooltip title={t('common.currentDir', { defaultValue: '当前目录' })}><Folder size={14}/></Tooltip> },
                    { value: 'global', label: <Tooltip title={t('common.globalRecursive', { defaultValue: '全局递归' })}><Search size={14}/></Tooltip> }
                  ]}
                  style={{ borderRadius: '0 8px 8px 0', background: '#f1f5f9' }}
                />
              </Space.Compact>
            )}
            <Button 
              type="text"
              size={isMobile ? 'small' : undefined}
              icon={isFullscreen ? <Minimize2 size={isMobile ? 16 : 18} /> : <Maximize2 size={isMobile ? 16 : 18} />}
              onClick={() => setIsFullscreen(!isFullscreen)}
              style={{ color: '#64748b' }}
            />

            <Tooltip title={t('common.upload', { defaultValue: '上传' })}>
              <Button 
                size={isMobile ? 'small' : undefined}
                icon={<Upload size={isMobile ? 14 : 16} />} 
                loading={isUploading} 
                onClick={handleUploadClick} 
                style={{ borderRadius: 8 }}
              >
                {!isMobile && t('common.upload', { defaultValue: '上传' })}
              </Button>
            </Tooltip>
            {!isEditing && (
              <>
                <Dropdown
                  menu={{
                    items: [
                      { key: 'name', label: t('common.sortByName', { defaultValue: '按名称排序' }), onClick: () => setSortBy('name') },
                      { key: 'size', label: t('common.sortBySize', { defaultValue: '按大小排序' }), onClick: () => setSortBy('size') },
                      { key: 'time', label: t('common.sortByTime', { defaultValue: '按时间排序' }), onClick: () => setSortBy('time') },
                    ],
                    selectedKeys: [sortBy]
                  }}
                  trigger={['click']}
                >
                  <Button 
                    size={isMobile ? 'small' : undefined}
                    icon={<RefreshCcw size={14} />} 
                    style={{ borderRadius: 8 }}
                  >
                    {!isMobile && (
                      sortBy === 'name' ? t('common.sortByName', { defaultValue: '按名称排序' }) :
                      sortBy === 'size' ? t('common.sortBySize', { defaultValue: '按大小排序' }) :
                      t('common.sortByTime', { defaultValue: '按时间排序' })
                    )}
                  </Button>
                </Dropdown>
                <Segmented
                  size={isMobile ? 'small' : 'middle'}
                  value={viewMode}
                  onChange={(v) => setViewMode(v as any)}
                  options={[
                    { value: 'list', icon: <ListIcon size={14} /> },
                    { value: 'grid', icon: <Grid size={14} /> }
                  ]}
                  style={{ borderRadius: 8, background: '#f1f5f9' }}
                />
                <Tooltip title={t('common.newFile', { defaultValue: '新建文件' })}>
                  <Button 
                    size={isMobile ? 'small' : undefined}
                    icon={<FilePlus size={14} />} 
                    onClick={() => handleCreateFile()} 
                    style={{ borderRadius: 8 }}
                  />
                </Tooltip>
                <Tooltip title={t('common.newFolder', { defaultValue: '新建文件夹' })}>
                  <Button 
                    size={isMobile ? 'small' : undefined}
                    icon={<FolderPlus size={14} />} 
                    onClick={() => handleCreateDir()} 
                    style={{ borderRadius: 8 }}
                  />
                </Tooltip>
              </>
            )}
          </div>
        </div>

      <input ref={uploadInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileSelected} />

      {pendingSaveContent && (
        <div style={{ 
          background: '#fff7ed', 
          borderBottom: '1px solid #fed7aa', 
          padding: '8px 16px', 
          display: 'flex', 
          alignItems: 'center', 
          gap: 8,
          color: '#c2410c',
          fontSize: 12,
          fontWeight: 600
        }}>
          <Save size={14} />
          {t('chat.savingMessageMode', { defaultValue: '消息保存模式：请在目标文件夹上右键选择“在此保存消息”' })}
          <Button type="link" size="small" onClick={onClearPendingSave} style={{ marginLeft: 'auto', padding: 0, height: 'auto', fontSize: 12 }}>
            {t('common.cancel')}
          </Button>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#fff' }}>
        {!isMobile && (
          <div style={{ 
            width: isSidebarCollapsed ? 0 : 280, 
            display: 'flex', 
            flexDirection: 'column', 
            background: '#fcfdfe', 
            borderRight: isSidebarCollapsed ? 'none' : '1px solid #f1f5f9',
            transition: 'all 0.3s ease-in-out',
            overflow: 'hidden',
            opacity: isSidebarCollapsed ? 0 : 1,
            pointerEvents: isSidebarCollapsed ? 'none' : 'auto'
          }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', fontSize: 12, fontWeight: 700, color: '#64748b', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
              <LayoutList size={14} /> {t('common.directory')}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 8px', minWidth: 280 }}>
                <DirectoryTree
                  loadData={onLoadData}
                  treeData={treeData}
                  onSelect={onTreeSelect}
                  onRightClick={({ event, node }: any) => handleRightClick(event, node.key, !node.isLeaf)}
                  expandedKeys={expandedKeys}
                  onExpand={handleExpand}
                  selectedKeys={selectedKeys}
                  showIcon={true}
                  blockNode
                  expandAction={false}
                  className="custom-directory-tree"
                />
              </div>
          </div>
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f8fafc' }}>


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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {onSendToChat && selectedFile && !selectedFile.is_dir && (
                      <Tooltip title={t('chat.sendToChat', { defaultValue: '发送到会话' })}>
                        <Button 
                          type="text" size="small" icon={<Send size={16} />} 
                          onClick={() => {
                            const fileName = selectedFile.name;
                            onSendToChat(fileContent, fileName);
                            onClose();
                          }} 
                        />
                      </Tooltip>
                    )}
                    {onSendToChat && selectedFile && !selectedFile.is_dir && isText && (
                      <Tooltip title={t('chat.aiSummary', { defaultValue: 'AI 一键总结' })}>
                        <Button 
                          type="text" size="small" icon={<Sparkles size={16} color="#8b5cf6" />} 
                          onClick={() => {
                            const fileName = selectedFile.name;
                            onSendToChat(`请帮我总结并分析这个文件的内容：\n\n文件名: ${fileName}\n\n内容:\n${fileContent}`, fileName);
                            onClose();
                          }} 
                        />
                      </Tooltip>
                    )}
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
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>{t('common.unsupported')}</div>
                    )}
                    <Tooltip title={t('common.download')}>
                      <Button type="text" size="small" icon={<Download size={16} />} onClick={() => handleDownload(selectedFile)} />
                    </Tooltip>
                    {!isProtected(selectedFile?.name || '', selectedFile?.path || '') && (
                      <Popconfirm title={t('common.deleteConfirm')} onConfirm={() => selectedFile && handleDelete(selectedFile)} okButtonProps={{ danger: true }}>
                        <Button type="text" danger icon={<Trash2 size={16} />} />
                      </Popconfirm>
                    )}
                  </div>
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  {!canView ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
                      <Empty 
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={
                          <div style={{ textAlign: 'center' }}>
                            <p style={{ color: '#64748b', marginBottom: 12 }}>{t('common.unsupportedFile')}</p>
                            <Button type="primary" icon={<Download size={14} />} onClick={() => handleDownload(selectedFile)} style={{ background: '#0ea5e9' }}>
                              {t('common.download')}
                            </Button>
                          </div>
                        } 
                      />
                    </div>
                  ) : activeTab === 'preview' && isMarkdown ? (
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
                    <iframe srcDoc={fileContent} style={{ width: '100%', height: '100%', border: 'none' }} title="HTML Preview" sandbox="allow-scripts" />
                  ) : activeTab === 'preview' && isImage ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', padding: 20 }}>
                      {imagePreviewUrl ? (
                        <img 
                          src={imagePreviewUrl} 
                          alt={selectedFile?.name} 
                          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', borderRadius: 4, background: '#fff' }} 
                        />
                      ) : (
                        <Spin />
                      )}
                    </div>
                  ) : activeTab === 'preview' && isPDF ? (
                    <div style={{ height: '100%', background: '#f1f5f9' }}>
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
                    <div style={{ height: '100%', overflowY: 'auto', background: '#f1f5f9', padding: 20 }}>
                      <div style={{ background: '#fff', padding: 12, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
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
                    <div style={{ height: '100%', padding: 24, overflowY: 'auto', background: '#f1f5f9' }}>
                      <div style={{ maxWidth: 900, margin: '0 auto', background: '#fff', padding: '40px 60px', borderRadius: 12, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
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
                        className="save-float-btn"
                      >
                        {t('common.save', { defaultValue: '保存' })}
                      </Button>
                      <Editor
                        height="100%"
                        defaultLanguage={getEditorLanguage(selectedFile?.name || '')}
                        value={fileContent}
                        onChange={(val) => setFileContent(val || '')}
                        theme="vs-light"
                        options={{
                          fontSize: 13,
                          minimap: { enabled: false },
                          scrollBeyondLastLine: false,
                          automaticLayout: true,
                          tabSize: 2,
                          wordWrap: 'on',
                          padding: { top: 16, bottom: 16 }
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div 
                style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
                onContextMenu={(e) => handleRightClick(e, currentPath, true)}
              >
                {selectedBulkKeys.length > 0 && (
                  <div style={{ padding: '8px 24px', background: '#fff', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Checkbox 
                      indeterminate={selectedBulkKeys.length > 0 && selectedBulkKeys.length < filteredFiles.filter(f => !isProtected(f.name, f.path) && f.name !== '..').length}
                      checked={selectedBulkKeys.length === filteredFiles.filter(f => !isProtected(f.name, f.path) && f.name !== '..').length && filteredFiles.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) {
                          const selectable = filteredFiles.filter(f => !isProtected(f.name, f.path) && f.name !== '..').map(f => f.path);
                          setSelectedBulkKeys(selectable);
                        } else {
                          setSelectedBulkKeys([]);
                        }
                      }}
                    />
                    <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>
                      {t('common.selectedCount', { count: selectedBulkKeys.length, defaultValue: `已选择 ${selectedBulkKeys.length} 项` })}
                    </span>
                    <Button size="small" type="link" onClick={() => setSelectedBulkKeys([])}>{t('common.cancelSelect', { defaultValue: '取消选择' })}</Button>
                    <div style={{ marginLeft: 'auto' }}>
                      <Popconfirm 
                        title={t('common.bulkDeleteConfirm', { defaultValue: '确定删除选中的所有项吗？' })} 
                        onConfirm={handleBulkDelete}
                        okText={t('common.confirm')}
                        cancelText={t('common.cancel')}
                      >
                        <Button size="small" danger type="primary" icon={<Trash2 size={14} />}>{t('common.delete')}</Button>
                      </Popconfirm>
                    </div>
                  </div>
                )}
                
                {filteredFiles.length === 0 ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Empty description={t('common.noContent')} />
                  </div>
                ) : viewMode === 'list' ? (
                  <div style={{ height: '100%', overflowY: 'auto' }}>
                    {filteredFiles.map((item, index) => (
                      <div 
                        key={item.path + index}
                        style={{ 
                          padding: isMobile ? '4px 12px' : '4px 24px',
                          background: selectedFile?.path === item.path ? '#eff6ff' : 'transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          transition: 'all 0.2s',
                          borderBottom: '1px solid #f8fafc',
                          position: 'relative'
                        }}
                        onClick={() => item.is_dir ? handleFolderClick(item.path) : loadFileContent(item)}
                        onContextMenu={(e) => handleRightClick(e, item.path, item.is_dir)}
                        className="file-item-hover"
                      >
                        <Checkbox 
                          style={{ 
                            opacity: selectedBulkKeys.includes(item.path) ? 1 : 0.2,
                            visibility: (isProtected(item.name, item.path) || item.name === '..') ? 'hidden' : 'visible'
                          }}
                          checked={selectedBulkKeys.includes(item.path)}
                          onChange={(e) => {
                            e.stopPropagation();
                            if (e.target.checked) setSelectedBulkKeys(prev => [...prev, item.path]);
                            else setSelectedBulkKeys(prev => prev.filter(k => k !== item.path));
                          }}
                          className="item-checkbox"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div style={{ 
                          background: item.is_dir ? '#e0f2fe' : isProtected(item.name, item.path) ? '#f5f3ff' : '#f8fafc', 
                          padding: 8, borderRadius: 8,
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          {getFileIcon(item.name, item.is_dir, 20, isProtected(item.name, item.path))}
                        </div>
                        <div style={{ flex: 1, overflow: 'hidden' }}>
                          <div style={{ fontSize: 14, color: '#1e293b', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>
                            {item.is_dir ? t('common.folder', { defaultValue: '文件夹' }) : `${(item.size / 1024).toFixed(1)} KB · ${item.mod_time}`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} className="action-btns">
                          {item.name !== '..' && (
                            <Tooltip title={t('common.download')}>
                              <Button type="text" size="small" icon={<Download size={14} />} onClick={(e) => { e.stopPropagation(); handleDownload(item); }} className="action-btn-hover" style={{ color: '#0ea5e9' }} />
                            </Tooltip>
                          )}
                          {item.name !== '..' && !isProtected(item.name, item.path) && (
                            <Dropdown menu={{ items: [
                              ...(!item.is_dir && onSendToChat ? [
                                { key: 'send', icon: <Send size={14} />, label: t('chat.sendToChat', { defaultValue: '发送到会话' }), onClick: async (e: any) => { 
                                  e.domEvent.stopPropagation(); 
                                  try {
                                    const res = await api.get(`/v1/openclaw/files/get?path=${encodeURIComponent(item.path)}`);
                                    onSendToChat(res.data.content || '', item.name);
                                    onClose();
                                  } catch (err: any) { message.error(err.message); }
                                } },
                                { key: 'ai', icon: <Sparkles size={14} color="#8b5cf6" />, label: t('chat.aiSummary', { defaultValue: 'AI 一键总结' }), onClick: async (e: any) => { 
                                  e.domEvent.stopPropagation(); 
                                  try {
                                    const res = await api.get(`/v1/openclaw/files/get?path=${encodeURIComponent(item.path)}`);
                                    onSendToChat(`请帮我总结并分析这个文件的内容：\n\n文件名: ${item.name}\n\n内容:\n${res.data.content || ''}`, item.name);
                                    onClose();
                                  } catch (err: any) { message.error(err.message); }
                                } },
                                { type: 'divider' as const }
                              ] : []),
                              { key: 'rename', icon: <Edit3 size={14} />, label: t('common.rename', { defaultValue: '重命名' }), onClick: (e: any) => { e.domEvent.stopPropagation(); setOldRenamePath(item.path); setRenameTargetName(item.name); setRenameModalOpen(true); } },
                              { key: 'delete', icon: <Trash2 size={14} />, label: t('common.delete', { defaultValue: '删除' }), danger: true, onClick: (e: any) => { e.domEvent.stopPropagation(); handleDelete(item); } }
                            ] }}>
                              <Button type="text" size="small" icon={<MoreVertical size={14} />} onClick={(e) => e.stopPropagation()} className="action-btn-hover" />
                            </Dropdown>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 16 }}>
                      {filteredFiles.map(item => (
                        <Card
                          key={item.path}
                          hoverable
                          size="small"
                          style={{ 
                            borderRadius: 12, 
                            textAlign: 'center', 
                            background: selectedBulkKeys.includes(item.path) ? '#f0f9ff' : '#fff',
                            border: selectedBulkKeys.includes(item.path) ? '1px solid #0ea5e9' : '1px solid #f1f5f9'
                          }}
                          onClick={() => item.is_dir ? handleFolderClick(item.path) : loadFileContent(item)}
                          onContextMenu={(e) => handleRightClick(e, item.path, item.is_dir)}
                          cover={
                            <div style={{ padding: '24px 0 12px 0', position: 'relative' }}>
                              {!isProtected(item.name, item.path) && item.name !== '..' && (
                                <Checkbox 
                                  style={{ position: 'absolute', top: 8, left: 8 }}
                                  checked={selectedBulkKeys.includes(item.path)}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    if (e.target.checked) setSelectedBulkKeys(prev => [...prev, item.path]);
                                    else setSelectedBulkKeys(prev => prev.filter(k => k !== item.path));
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              )}
                              {getFileIcon(item.name, item.is_dir, 48, isProtected(item.name, item.path))}
                            </div>
                          }
                        >
                          <Card.Meta 
                            title={<div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>}
                            description={!item.is_dir ? `${(item.size / 1024).toFixed(0)} KB` : t('common.folder')}
                          />
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dropdown
        menu={{ items: contextMenuItems }}
        trigger={['contextMenu']}
        open={contextMenuVisible}
        onOpenChange={(visible) => setContextMenuVisible(visible)}
      >
        <div style={{ 
          position: 'fixed', 
          left: menuPosition.x, 
          top: menuPosition.y,
          width: 1,
          height: 1,
          visibility: 'hidden',
          pointerEvents: 'none'
        }} />
      </Dropdown>
      <style>{`
        .file-item-hover:hover {
          transform: scale(1.005);
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
          background: #fff;
        }
        .action-btn-hover { opacity: 0; transition: opacity 0.2s; }
        .file-item-hover:hover .action-btn-hover { opacity: 1; }
        .save-float-btn:hover {
          transform: translateY(-2px) scale(1.05);
          box-shadow: 0 12px 24px rgba(14, 165, 233, 0.5) !important;
        }
        .custom-directory-tree .ant-tree-node-content-wrapper {
          border-radius: 6px;
          transition: all 0.2s;
          padding: 4px 8px !important;
        }
        .custom-directory-tree .ant-tree-node-selected {
          background-color: #3b82f6 !important;
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
          font-size: 15px; line-height: 1.6; color: #24292f;
        }
        .markdown-body-v3 h1, .markdown-body-v3 h2, .markdown-body-v3 h3 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; line-height: 1.25; }
        .markdown-body-v3 code { background: #afb8c133; padding: .2em .4em; border-radius: 6px; font-size: 85%; font-family: monospace; }
        .markdown-body-v3 pre { background: #f6f8fa; padding: 16px; border-radius: 8px; overflow: auto; margin-bottom: 16px; border: 1px solid #e2e8f0; }
        .word-preview-v3 { font-family: "Times New Roman", Times, serif; font-size: 16px; line-height: 1.5; color: #333; }
        .word-preview-v3 h1, .word-preview-v3 h2, .word-preview-v3 h3 { margin-top: 1.2em; margin-bottom: 0.6em; }
        .word-preview-v3 p { margin-bottom: 1em; text-align: justify; }
        .word-preview-v3 table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
        .word-preview-v3 table td, .word-preview-v3 table th { border: 1px solid #ddd; padding: 8px; }
      `}</style>
        </div>
      </Modal>

      {/* Auxiliary Modals (Create, Rename) */}
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
            {createType === 'file' ? t('common.enterFileName', { defaultValue: '请输入文件名' }) : t('common.enterFolderName', { defaultValue: '请输入文件夹名' })}
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

      <Modal
        title={t('common.rename', { defaultValue: '重命名' })}
        open={renameModalOpen}
        onOk={handleRename}
        onCancel={() => setRenameModalOpen(false)}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        destroyOnClose
      >
        <div style={{ paddingTop: 10 }}>
          <div style={{ marginBottom: 8, fontSize: 12, color: '#64748b' }}>{t('common.enterNewName', { defaultValue: '请输入新名称' })}</div>
          <Input 
            autoFocus 
            value={renameTargetName} 
            onChange={e => setRenameTargetName(e.target.value)} 
            onPressEnter={handleRename}
          />
        </div>
      </Modal>
    </>
  );
};

export default FileExplorer;
