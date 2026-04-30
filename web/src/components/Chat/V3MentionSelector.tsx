import React, { useState, useEffect, useRef } from 'react';
import { Spin, Empty } from 'antd';
import { 
  FileText, Zap, Search, Folder, CornerUpLeft,
  FileJson, FileCode2, Image as ImageIcon, Monitor, Terminal, File
} from 'lucide-react';
import api from '../../api';

export interface MentionEntity {
  type: 'workspace_file' | 'skill';
  id: string; // 路径或技能名称
  label: string;
  icon?: React.ReactNode;
}

const getFileIcon = (name: string, isDir: boolean, size: number = 16) => {
  if (isDir) return <Folder size={size} color="#0ea5e9" />;
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

interface V3MentionSelectorProps {
  onSelect: (entity: MentionEntity) => void;
  onClose: () => void;
  selectedBot: string;
  botsModels: any;
  t: any;
  initialTab?: 'files' | 'skills';
}

const V3MentionSelector: React.FC<V3MentionSelectorProps> = ({ onSelect, onClose, selectedBot, botsModels, t, initialTab = 'files' }) => {
  const [activeTab, setActiveTab] = useState<'files' | 'skills'>(initialTab);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [debouncedSearchText, setDebouncedSearchText] = useState('');
  
  const searchInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 初始化 workspace
  const botId = selectedBot.replace('openclaw:', '');
  const bot = botsModels?.data?.bots?.find((b: any) => b.id === botId);
  const defaultWorkspace = bot?.workspace || './data/uploads';
  const [currentPath, setCurrentPath] = useState<string>(defaultWorkspace);

  // 点击外部和 ESC 关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        // 延迟关闭，防止与触发按钮冲突
        setTimeout(onClose, 50);
      }
    };
    
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleGlobalKeyDown);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    // 聚焦搜索框
    setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [currentPath, activeTab]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        if (activeTab === 'files') {
          let allItems = [];
          if (debouncedSearchText.trim()) {
            const res = await api.get(`/v1/openclaw/files/search?path=${encodeURIComponent(currentPath)}&query=${encodeURIComponent(debouncedSearchText)}`);
            allItems = res.data.files || [];
          } else {
            const res = await api.get(`/v1/openclaw/files/list?path=${encodeURIComponent(currentPath)}`);
            allItems = res.data.files || [];
          }
          
          // 先按目录/文件分类，再按名称排序
          allItems.sort((a: any, b: any) => {
            if (a.is_dir === b.is_dir) {
              return a.name.localeCompare(b.name);
            }
            return a.is_dir ? -1 : 1;
          });
          
          const mappedItems = allItems.map((f: any) => ({
            id: f.path,
            label: f.name,
            type: f.is_dir ? 'directory' : 'workspace_file',
            is_dir: f.is_dir,
            desc: f.is_dir ? t('common.folder', { defaultValue: '文件夹' }) : (f.path.length > 40 ? '...' + f.path.slice(-37) : f.path)
          }));
          
          if (!debouncedSearchText.trim() && currentPath !== defaultWorkspace) {
             const parentParts = currentPath.split(/[/\\]/);
             parentParts.pop();
             const parentPath = parentParts.join('/') || defaultWorkspace;
             mappedItems.unshift({
                id: parentPath,
                label: '..',
                type: 'directory',
                is_dir: true,
                desc: t('common.goUp', { defaultValue: '返回上一级' })
             });
          }
          setItems(mappedItems);
        } else {
          const res = await api.get('/v1/openclaw/skills');
          const rawData = res.data;
          let skillsList: any[] = [];
          if (rawData.data) {
            skillsList = Array.isArray(rawData.data.skills) ? rawData.data.skills : [];
          } else {
            skillsList = Array.isArray(rawData.skills) ? rawData.skills : (Array.isArray(rawData) ? rawData : []);
          }
          setItems(skillsList.map((s: any) => ({
            id: s.name,
            label: s.name,
            type: 'skill',
            is_dir: false,
            desc: s.description || t('chat.noSkillDesc', { defaultValue: '暂无技能描述' })
          })));
        }
      } catch (err) {
        console.error('Failed to fetch mentions data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [activeTab, currentPath, defaultWorkspace, debouncedSearchText, t]);

  const filteredItems = items.filter(item => {
    if (activeTab === 'files') return true; // Files are already filtered by backend search
    return item.label.toLowerCase().includes(searchText.toLowerCase()) ||
           (item.desc && item.desc.toLowerCase().includes(searchText.toLowerCase()));
  });

  const handleItemAction = (item: any) => {
    if (item.is_dir) {
      setCurrentPath(item.id);
      setSearchText('');
      setActiveIndex(0);
    } else {
      onSelect(item);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev + 1) % filteredItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev - 1 + filteredItems.length) % filteredItems.length);
    } else if (e.key === 'Enter' && filteredItems[activeIndex]) {
      e.preventDefault();
      handleItemAction(filteredItems[activeIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setActiveTab(prev => prev === 'files' ? 'skills' : 'files');
      setActiveIndex(0);
    }
  };

  return (
    <div className="v3-mention-selector" onKeyDown={handleKeyDown} ref={containerRef}>
      <div className="v3-mention-search-wrapper">
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#94a3b8' }} />
          <input
            ref={searchInputRef}
            className="v3-mention-search"
            style={{ paddingLeft: 32 }}
            placeholder={activeTab === 'files' ? t('chat.searchFiles', { defaultValue: '搜索文件或目录...' }) : t('chat.searchSkills', { defaultValue: '搜索技能...' })}
            value={searchText}
            onChange={e => {
              setSearchText(e.target.value);
              setActiveIndex(0);
            }}
          />
        </div>
      </div>
      
      <div className="v3-mention-tabs">
        <div 
          className={`v3-mention-tab ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => { setActiveTab('files'); setActiveIndex(0); }}
        >
          {t('chat.filesTab', { defaultValue: '文件' })}
        </div>
        <div 
          className={`v3-mention-tab ${activeTab === 'skills' ? 'active' : ''}`}
          onClick={() => { setActiveTab('skills'); setActiveIndex(0); }}
        >
          {t('chat.skillsTab', { defaultValue: '技能' })}
        </div>
      </div>

      <div className="v3-mention-list">
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center' }}><Spin size="small" /></div>
        ) : filteredItems.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('common.noContent')} />
        ) : (
          filteredItems.map((item, idx) => (
            <div 
              key={item.id} 
              className={`v3-mention-item ${idx === activeIndex ? 'active' : ''}`}
              onClick={() => handleItemAction(item)}
              onMouseEnter={() => setActiveIndex(idx)}
            >
              <div className="v3-mention-item-icon">
                {item.label === '..' ? <CornerUpLeft size={16} color="#64748b" /> : 
                 item.type === 'directory' ? <Folder size={16} color="#0ea5e9" /> : 
                 item.type === 'workspace_file' ? getFileIcon(item.label, false, 16) : 
                 <Zap size={16} color="#0d9488" />}
              </div>
              <div className="v3-mention-item-info">
                <div className="v3-mention-item-name">{item.label}</div>
                <div className="v3-mention-item-desc">{item.desc}</div>
              </div>
            </div>
          ))
        )}
      </div>
      
      <div style={{ padding: '8px 12px', borderTop: '1px solid #f1f5f9', background: '#f8fafc', fontSize: 10, color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
        <span>↑↓ 选择 • Enter 确认</span>
        <span>Tab 切换分类</span>
      </div>
    </div>
  );
};

export default V3MentionSelector;
