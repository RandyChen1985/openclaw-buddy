import React, { useState, useEffect, useRef } from 'react';
import { Modal, Input, List, Empty } from 'antd';
import { Search, Command, LayoutDashboard, Boxes, MessageSquare, Smartphone, Terminal, ChevronRight, Cpu } from 'lucide-react';

interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
  onAction: (action: string, params?: any) => void;
  bots: any[];
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ visible, onClose, onAction, bots }) => {
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
        body: { padding: 0, overflow: 'hidden', borderRadius: 12 }
      }}
      style={{ top: 100 }}
    >
      <div style={{ background: '#fff', borderRadius: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
          <Search size={20} color="#94a3b8" style={{ marginRight: 12 }} />
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f1f5f9', padding: '4px 8px', borderRadius: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b' }}>ESC</span>
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
                    background: index === selectedIndex ? '#f8fafc' : 'transparent',
                    borderLeft: `4px solid ${index === selectedIndex ? '#2563eb' : 'transparent'}`,
                    transition: 'all 0.1s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ 
                      width: 32, height: 32, borderRadius: 8, 
                      background: index === selectedIndex ? '#eff6ff' : '#f1f5f9',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: index === selectedIndex ? '#2563eb' : '#64748b'
                    }}>
                      {item.icon}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: index === selectedIndex ? '#1e293b' : '#475569' }}>{item.title}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.category}</div>
                    </div>
                  </div>
                  {index === selectedIndex && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#94a3b8' }}>
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

        <div style={{ padding: '12px 20px', borderTop: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
           <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <kbd style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '2px 6px', borderRadius: 4, fontSize: 10, boxShadow: '0 1px 0 rgba(0,0,0,0.05)' }}>↑↓</kbd>
                <span style={{ fontSize: 11, color: '#64748b' }}>选择</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <kbd style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '2px 6px', borderRadius: 4, fontSize: 10, boxShadow: '0 1px 0 rgba(0,0,0,0.05)' }}>Enter</kbd>
                <span style={{ fontSize: 11, color: '#64748b' }}>确认</span>
              </div>
           </div>
           <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Command size={12} color="#94a3b8" />
              <span style={{ fontSize: 11, color: '#94a3b8' }}>智联控制台</span>
           </div>
        </div>
      </div>
    </Modal>
  );
};

export default CommandPalette;
