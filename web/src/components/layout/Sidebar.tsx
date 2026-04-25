import React from 'react';
import { Menu, Button, Tooltip } from 'antd';
import { APP_VERSION } from '../../version';
import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { hasNewVersion } from '../../utils/version';

interface SidebarProps {
  activeTab: string;
  collapsed: boolean;
  onSelect: (key: string) => void;
  onLogout: () => void;
  navItems: any[];
  versionUpdate?: { latest: string, current: string, release_url: string } | null;
  tag?: string;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, collapsed, onSelect, onLogout, navItems, versionUpdate, tag }) => {
  const { t } = useTranslation();
  
  // 处理标签截断逻辑
  const displayTag = tag && tag.length > 10 ? tag.substring(0, 8) + '...' : tag;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#001529' }}>
      {/* Logo Area */}
      <div style={{ 
        height: 72, padding: collapsed ? '0 12px' : '0 20px', 
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'linear-gradient(to bottom, #0f172a, #131c31)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
        flexShrink: 0,
        overflow: 'hidden'
      }}>
        {/* Lobster Icon with Badge Hint */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{ 
            width: 40, height: 40, borderRadius: 12, 
            background: 'rgba(99, 102, 241, 0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid rgba(99, 102, 241, 0.12)',
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)'
          }}>
            <span style={{ fontSize: 24, lineHeight: 1 }}>🦞</span>
          </div>
          {collapsed && tag && (
            <div style={{ 
              position: 'absolute', top: -1, right: -1, 
              width: 10, height: 10, borderRadius: '50%',
              background: 'linear-gradient(135deg, #6366f1, #a855f7)',
              border: '2px solid #0f172a',
              boxShadow: '0 0 6px rgba(99, 102, 241, 0.6)'
            }} />
          )}
        </div>

        {!collapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
              <span style={{ 
                fontSize: 14, fontWeight: 800, color: '#f8fafc', 
                letterSpacing: '0.01em', lineHeight: 1.2,
                whiteSpace: 'nowrap', textShadow: '0 2px 4px rgba(0,0,0,0.1)',
                flexShrink: 0
              }}>
                OpenClaw Buddy
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              <a 
                href={versionUpdate?.release_url || "https://github.com/RandyChen1985/openclaw-buddy/releases"}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
              >
                <div style={{ 
                  width: 8, height: 8, borderRadius: '50%', background: '#22c55e', 
                  animation: 'glow-pulse 2s infinite ease-in-out' 
                }}></div>
                <span style={{ 
                  fontSize: 9, color: '#64748b', fontWeight: 800, 
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                  fontFamily: 'monospace', opacity: 0.8
                }}>
                  REL-{APP_VERSION}
                </span>
                <Tooltip title="GitHub 源码">
                  <div 
                    style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', opacity: 0.6 }}
                    onClick={(e: React.MouseEvent) => {
                      e.preventDefault();
                      window.open('https://github.com/RandyChen1985/openclaw-buddy', '_blank');
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.28 1.15-.28 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                      <path d="M9 18c-4.51 2-5-2-7-2" />
                    </svg>
                  </div>
                </Tooltip>
                {versionUpdate && hasNewVersion(versionUpdate.current, versionUpdate.latest) && (
                  <span style={{
                    fontSize: 10, padding: '0 5px', borderRadius: 4,
                    background: '#ff4d4f', color: '#fff', fontWeight: 900,
                    marginLeft: 4, transformOrigin: 'center',
                    animation: 'badgePulse 2s ease-in-out infinite',
                    display: 'inline-block',
                    lineHeight: '14px'
                  }}>
                    NEW
                  </span>
                )}
              </a>
              {tag && (
                <Tooltip title={tag} placement="bottom">
                  <span style={{
                    fontSize: 8, padding: '1px 6px', borderRadius: 10,
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    color: '#ffffff', fontWeight: 800, border: '1px solid rgba(255, 255, 255, 0.1)',
                    whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.05em',
                    boxShadow: '0 2px 6px rgba(99, 102, 241, 0.3)',
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    lineHeight: '12px',
                    animation: 'fadeIn 0.3s ease-out'
                  }}>
                    {displayTag}
                  </span>
                </Tooltip>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0% { opacity: 0.6; transform: scale(0.95); }
          50% { opacity: 1; transform: scale(1.05); }
          100% { opacity: 0.6; transform: scale(0.95); }
        }
        @keyframes badgePulse {
          0% { transform: scale(0.9); box-shadow: 0 0 0 0 rgba(255, 77, 79, 0.4); }
          50% { transform: scale(1.05); box-shadow: 0 0 10px 3px rgba(255, 77, 79, 0.5); }
          100% { transform: scale(0.9); box-shadow: 0 0 0 0 rgba(255, 77, 79, 0.2); }
        }
        /* 微调子菜单背景色，使其与父级更贴合 */
        .ant-menu-sub.ant-menu-inline {
          background: #001021 !important;
          border-radius: 8px;
        }
        /* 稍微减弱子菜单项的缩进，让视觉更紧凑 */
        .ant-menu-inline .ant-menu-item {
          margin-top: 2px !important;
          margin-bottom: 2px !important;
        }
      `}</style>

      {/* Nav */}
      <div style={{ padding: '12px 0', flex: 1, overflowY: 'auto' }}>
        <Menu
          mode="inline"
          selectedKeys={[activeTab]}
          defaultOpenKeys={['grp-monitor', 'grp-assets', 'grp-binding']}
          onClick={({ key }) => onSelect(key)}
          items={navItems}
          theme="dark"
          style={{ background: 'transparent', padding: '0 8px', border: 'none' }}
        />
      </div>

      {/* Logout */}
      <div style={{ padding: '0 8px 16px', borderTop: '1px solid rgba(51,65,85,0.3)', flexShrink: 0 }}>
        <Tooltip title={collapsed ? t('common.logout') : ''} placement="right">
          <Button
            block
            icon={<LogOut size={14} />}
            onClick={onLogout}
            style={{
              background: 'transparent', border: '1px solid #334155',
              color: '#64748b', height: 38, borderRadius: 8,
              display: 'flex', alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start',
              paddingLeft: collapsed ? 0 : 12, gap: 8,
            }}
          >
            {!collapsed && <span style={{ fontSize: 12 }}>{t('common.logout')}</span>}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
};

export default Sidebar;
