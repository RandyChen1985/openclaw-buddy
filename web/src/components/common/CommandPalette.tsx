import React, { useState, useEffect, useRef } from 'react';
import { Modal, Input, List, Empty } from 'antd';
import { Search, Command, LayoutDashboard, Boxes, MessageSquare, Smartphone, Terminal, ChevronRight, Cpu } from 'lucide-react';

interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
  onAction: (action: string, params?: any) => void;
  bots: any[];
  isDarkMode?: boolean;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ visible, onClose, onAction, bots, isDarkMode = false }) => {
  const c = isDarkMode ? {
    panel: '#1e293b',
    hairline: '#334155',
    headerBg: '#0f172a',
    muted: '#94a3b8',
    text: '#f1f5f9',
    textSoft: '#cbd5e1',
    rowSel: 'rgba(99,102,241,0.2)',
    iconBg: '#334155',
    iconBgSel: 'rgba(99,102,241,0.35)',
    iconColor: '#94a3b8',
    iconColorSel: '#a5b4fc',
    escBg: '#334155',
    footerBg: '#0f172a',
    kbdBg: '#1e293b',
    kbdBorder: '#475569',
  } : {
    panel: '#fff',
    hairline: '#f1f5f9',
    headerBg: '#fff',
    muted: '#64748b',
    text: '#1e293b',
    textSoft: '#475569',
    rowSel: '#f8fafc',
    iconBg: '#f1f5f9',
    iconBgSel: '#eff6ff',
    iconColor: '#64748b',
    iconColorSel: '#2563eb',
    escBg: '#f1f5f9',
    footerBg: '#f8fafc',
    kbdBg: '#fff',
    kbdBorder: '#e2e8f0',
  };
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<any>(null);

  const navigationActions = [
    { id: 'nav-dashboard', title: '跳转至 仪表盘', category: '页面导航', icon: <LayoutDashboard size={16} />, action: 'nav', params: 'dashboard' },
    { id: 'nav-bots', title: '跳转至 机器人管理', category: '页面导航', icon: <Boxes size={16} />, action: 'nav', params: 'bots-models' },
    { id: 'nav-chat', title: '跳转至 对话实验室', category: '页面导航', icon: <MessageSquare size={16} />, action: 'nav', params: 'chat' },
    { id: 'nav-devices', title: '跳转至 终端发现', category: '页面导航', icon: <Smartphone size={16} />, action: 'nav', params: 'devices' },
    { id: 'nav-logs', title: '跳转至 实时日志', category: '页面导航', icon: <Terminal size={16} />, action: 'nav', params: 'logs' },
  ];

  const botActions = bots.map(bot => ({
    id: `bot-${bot.id}`,
    title: `选择对话: ${bot.name || bot.id}`,
    category: '对话机器人',
    icon: <Cpu size={16} />,
    action: 'select-bot',
    params: bot.id
  }));

  const allActions = [...navigationActions, ...botActions];
  const filteredActions = allActions.filter(a => 
    a.title.toLowerCase().includes(search.toLowerCase()) || 
    a.category.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    if (visible) {
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % filteredActions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredActions.length) % filteredActions.length);
    } else if (e.key === 'Enter') {
      const selected = filteredActions[selectedIndex];
      if (selected) {
        onAction(selected.action, selected.params);
        onClose();
      }
    }
  };

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={600}
      styles={{
        mask: { backdropFilter: 'blur(4px)' },
        body: { padding: 0, overflow: 'hidden', borderRadius: 12, background: c.panel },
        content: { background: c.panel }
      }}
      style={{ top: 100 }}
    >
      <div style={{ background: c.panel, borderRadius: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: `1px solid ${c.hairline}`, background: c.headerBg }}>
          <Search size={20} color={c.muted} style={{ marginRight: 12 }} />
          <Input 
            ref={inputRef}
            placeholder="输入关键词进行搜索 (支持页面跳转、选择机器人)..." 
            variant="borderless"
            style={{ fontSize: 16, border: 'none', padding: 0, boxShadow: 'none' }}
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: c.escBg, padding: '4px 8px', borderRadius: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: c.muted }}>ESC</span>
          </div>
        </div>

        <div style={{ maxHeight: 400, overflowY: 'auto', padding: '8px 0' }}>
          {filteredActions.length > 0 ? (
            <List
              dataSource={filteredActions}
              renderItem={(item, index) => (
                <div 
                  onClick={() => {
                    onAction(item.action, item.params);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  style={{ 
                    padding: '12px 20px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    background: index === selectedIndex ? c.rowSel : 'transparent',
                    borderLeft: `4px solid ${index === selectedIndex ? '#2563eb' : 'transparent'}`,
                    transition: 'all 0.1s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ 
                      width: 32, height: 32, borderRadius: 8, 
                      background: index === selectedIndex ? c.iconBgSel : c.iconBg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: index === selectedIndex ? c.iconColorSel : c.iconColor
                    }}>
                      {item.icon}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: index === selectedIndex ? c.text : c.textSoft }}>{item.title}</div>
                      <div style={{ fontSize: 11, color: c.muted }}>{item.category}</div>
                    </div>
                  </div>
                  {index === selectedIndex && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: c.muted }}>
                      <span style={{ fontSize: 11 }}>回车确认</span>
                      <ChevronRight size={14} />
                    </div>
                  )}
                </div>
              )}
            />
          ) : (
            <div style={{ padding: '40px 0' }}>
              <Empty description="未找到匹配的操作" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: `1px solid ${c.hairline}`, background: c.footerBg, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
           <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <kbd style={{ background: c.kbdBg, border: `1px solid ${c.kbdBorder}`, padding: '2px 6px', borderRadius: 4, fontSize: 10, boxShadow: '0 1px 0 rgba(0,0,0,0.05)' }}>↑↓</kbd>
                <span style={{ fontSize: 11, color: c.muted }}>选择</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <kbd style={{ background: c.kbdBg, border: `1px solid ${c.kbdBorder}`, padding: '2px 6px', borderRadius: 4, fontSize: 10, boxShadow: '0 1px 0 rgba(0,0,0,0.05)' }}>Enter</kbd>
                <span style={{ fontSize: 11, color: c.muted }}>确认</span>
              </div>
           </div>
           <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Command size={12} color={c.muted} />
              <span style={{ fontSize: 11, color: c.muted }}>智联控制台</span>
           </div>
        </div>
      </div>
    </Modal>
  );
};

export default CommandPalette;
