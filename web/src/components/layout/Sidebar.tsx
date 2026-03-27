import React from 'react';
import { Menu, Button, Tooltip } from 'antd';
import { LogOut } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  collapsed: boolean;
  onSelect: (key: string) => void;
  onLogout: () => void;
  navItems: any[];
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, collapsed, onSelect, onLogout, navItems }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#001529' }}>
      {/* Logo */}
      <div style={{
        height: 56, display: 'flex', alignItems: 'center',
        borderBottom: '1px solid rgba(51,65,85,0.6)',
        padding: collapsed ? '0 18px' : '0 20px', gap: 10,
        overflow: 'hidden', whiteSpace: 'nowrap',
      }}>
        <div style={{ fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          🦞
        </div>
        {!collapsed && (
          <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', letterSpacing: '0.02em', marginLeft: 8 }}>
            OpenClaw Buddy
          </span>
        )}
      </div>

      {/* Nav */}
      <div style={{ padding: '12px 0', flex: 1, overflowY: 'auto' }}>
        {!collapsed && (
          <div style={{ padding: '4px 20px 8px', fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
            Monitor
          </div>
        )}
        <Menu
          mode="inline"
          selectedKeys={[activeTab]}
          onClick={({ key }) => onSelect(key)}
          items={navItems}
          theme="dark"
          style={{ background: 'transparent', padding: '0 8px', border: 'none' }}
        />
      </div>

      {/* Logout */}
      <div style={{ padding: '0 8px 16px', borderTop: '1px solid rgba(51,65,85,0.3)' }}>
        <Tooltip title={collapsed ? '退出登录' : ''} placement="right">
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
            {!collapsed && <span style={{ fontSize: 12 }}>退出登录</span>}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
};

export default Sidebar;
