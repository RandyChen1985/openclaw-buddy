import React from 'react';
import { Button, Tooltip } from 'antd';
import { X, Folder, Maximize2, Minimize2 } from 'lucide-react';
import { FileExplorerContent } from '../../components/FileExplorer';

interface V3ExplorerPaneProps {
  t: any;
  rootPath: string;
  width?: number;
  onWidthChange?: (width: number) => void;
  onClose: () => void;
  onSendToChat?: (content: string, fileName: string, fileInfo?: any) => void;
}

export const V3ExplorerPane: React.FC<V3ExplorerPaneProps> = ({ t, rootPath, width = 400, onWidthChange, onClose, onSendToChat }) => {
  const [refreshKey, setRefreshKey] = React.useState(0);

  const handleBackToRoot = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="v3-explorer-pane" style={{
      width: width,
      height: '100%',
      background: '#fff',
      borderLeft: '1px solid #e2e8f0',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '-4px 0 15px rgba(0,0,0,0.1)',
      zIndex: 20,
      transition: 'width 0.2s ease-in-out'
    }}>
      <div style={{ 
        padding: '12px 16px', 
        borderBottom: '1px solid #e2e8f0', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        background: '#f8fafc'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', overflow: 'hidden' }}>
          <Folder size={14} className="text-sky-500" style={{ flexShrink: 0 }} />
          <div 
            onClick={handleBackToRoot}
            style={{ 
              fontSize: 13, 
              fontWeight: 800, 
              cursor: 'pointer', 
              whiteSpace: 'nowrap', 
              overflow: 'hidden', 
              textOverflow: 'ellipsis',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
            className="hover:text-sky-600 transition-colors"
          >
            <span style={{ flexShrink: 0 }}>{t('bots.workspace', { defaultValue: '工作区' })}</span>
            <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              ({rootPath})
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Tooltip title={width > 600 ? t('common.minimize', { defaultValue: '最小化' }) : t('common.maximize', { defaultValue: '最大化' })}>
            <Button 
              size="small" 
              type="text" 
              icon={width > 600 ? <Minimize2 size={14} /> : <Maximize2 size={14} />} 
              onClick={() => {
                const target = width > 600 ? 400 : 800;
                onWidthChange?.(target);
              }}
              style={{ color: '#64748b' }}
            />
          </Tooltip>
          <Button 
            size="small" 
            type="text" 
            icon={<X size={16} />} 
            onClick={onClose} 
            style={{ color: '#64748b' }}
          />
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <FileExplorerContent
          key={refreshKey}
          open={true}
          onClose={onClose}
          rootPath={rootPath}
          title=""
          t={t}
          isMobile={false}
          onSendToChat={onSendToChat}
          simplified={true}
        />
      </div>
      <style>{`
        .v3-explorer-pane {
          animation: slideInRight 0.3s ease-out;
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
};
