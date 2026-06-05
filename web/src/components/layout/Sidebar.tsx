import React from 'react';
import { Menu, Button, message } from 'antd';
import { APP_VERSION } from '../../version';
import { LogOut, Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../common/AppTooltip';

import { hasNewVersion } from '../../utils/version';

/** 侧栏品牌区与菜单共用壳色，不随全局浅色/深色切换 */
const SIDEBAR_SHELL = '#0f172a';
/** 品牌条高度（与主区顶栏 56px 同高，仅尺寸参考；颜色仍跟侧栏壳） */
const SIDEBAR_BRAND_HEIGHT = 56;

interface SidebarProps {
  activeTab: string;
  collapsed: boolean;
  onSelect: (key: string) => void;
  onLogout: () => void;
  principalName?: string;
  navItems: any[];
  versionUpdate?: { latest: string, current: string, release_url: string } | null;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, collapsed, onSelect, onLogout, principalName, navItems, versionUpdate }) => {
  const { t } = useTranslation();
  const logoutText = principalName ? `${t('common.logout')}(${principalName})` : t('common.logout');

  const [openKeys, setOpenKeys] = React.useState<string[]>(collapsed ? [] : ['grp-monitor', 'grp-assets', 'grp-binding']);

  React.useEffect(() => {
    if (collapsed) {
      setOpenKeys([]);
    } else {
      setOpenKeys(['grp-monitor', 'grp-assets', 'grp-binding']);
    }
  }, [collapsed]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: SIDEBAR_SHELL }}>
      {/* Logo Area：56px 与主顶栏同高便于对齐；壳色与下方菜单一致，不随全局主题变白 */}
      <div style={{ 
        height: SIDEBAR_BRAND_HEIGHT,
        minHeight: SIDEBAR_BRAND_HEIGHT,
        padding: collapsed ? '0 12px' : '0 16px', 
        display: 'flex', alignItems: 'center', gap: 10,
        background: SIDEBAR_SHELL,
        borderBottom: '1px solid rgba(51, 65, 85, 0.45)',
        flexShrink: 0,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}>
        {/* Lobster Icon with Badge Hint */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{ 
            width: 34, height: 34, borderRadius: 10, 
            background: 'rgba(99, 102, 241, 0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid rgba(99, 102, 241, 0.12)',
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)'
          }}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>🦞</span>
          </div>
        </div>

        {!collapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
              <span style={{ 
                fontSize: 13, fontWeight: 800, color: '#f8fafc', 
                letterSpacing: '0.01em', lineHeight: 1.2,
                whiteSpace: 'nowrap', textShadow: '0 2px 4px rgba(0,0,0,0.1)',
                flexShrink: 0
              }}>
                OpenClaw Buddy
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                </a>
                <Tooltip title="GitHub 源码">
                  <a 
                    href="https://github.com/RandyChen1985/openclaw-buddy"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', opacity: 0.6 }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.28 1.15-.28 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                      <path d="M9 18c-4.51 2-5-2-7-2" />
                    </svg>
                  </a>
                </Tooltip>
                <div 
                  style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', opacity: 0.6, marginLeft: 2 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText('cexlong@163.com');
                    message.success('邮箱已复制到剪贴板');
                  }}
                >
                  <Mail size={10} color="#64748b" strokeWidth={2.5} />
                </div>
                {versionUpdate && hasNewVersion(versionUpdate.current, versionUpdate.latest) && (
                  <a 
                    href={versionUpdate.release_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ textDecoration: 'none' }}
                  >
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
                  </a>
                )}
              </div>
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
        /* 子菜单背景与侧栏壳、父级菜单一致 */
        .ant-menu-sub.ant-menu-inline {
          background: ${SIDEBAR_SHELL} !important;
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
          openKeys={openKeys}
          onOpenChange={(keys) => setOpenKeys(keys)}
          onClick={({ key }) => onSelect(key)}
          items={navItems}
          theme="dark"
          style={{ background: 'transparent', padding: '0 8px', border: 'none' }}
        />
      </div>

      {/* Logout */}
      <div style={{ padding: '0 8px 16px', borderTop: '1px solid rgba(51,65,85,0.3)', flexShrink: 0 }}>
        <Tooltip title={collapsed ? logoutText : ''} placement="right">
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
            {!collapsed && <span style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{logoutText}</span>}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
};

export default Sidebar;
