import React, { useRef, useState } from 'react';
import { Button, Tabs } from 'antd';
import { RotateCcw, XCircle, Terminal as TerminalIcon, X, Maximize2, Minimize2 } from 'lucide-react';
import { V3TerminalSession, genTerminalTabId, type V3TerminalSessionHandle } from './V3TerminalSession';
import './v3TerminalTabs.css';
import Tooltip from '../../components/common/AppTooltip';

interface V3TerminalPaneProps {
  t: (key: string, opts?: Record<string, unknown>) => string;
  cwd?: string;
  width?: number;
  onWidthChange?: (width: number) => void;
  onClose: () => void;
  transition?: string;
  /** 嵌入右侧 Dock 时由父级控制宽高 */
  fillParent?: boolean;
  dockExpanded?: boolean;
  onToggleDockExpanded?: () => void;
  onSendSelectionToChat?: (text: string) => void;
}

export const V3TerminalPane: React.FC<V3TerminalPaneProps> = ({
  t,
  cwd,
  width = 450,
  onWidthChange,
  onClose,
  transition: customTransition,
  fillParent = false,
  dockExpanded = false,
  onToggleDockExpanded,
  onSendSelectionToChat,
}) => {
  const seedRef = useRef<string | null>(null);
  if (!seedRef.current) seedRef.current = genTerminalTabId();

  const [tabIds, setTabIds] = useState<string[]>(() => [seedRef.current!]);
  const [activeKey, setActiveKey] = useState<string>(() => seedRef.current!);
  const [restartByTab, setRestartByTab] = useState<Record<string, number>>(() => ({ [seedRef.current!]: 0 }));

  const sessionRefs = useRef<Map<string, V3TerminalSessionHandle>>(new Map());

  const handleRestart = () => {
    setRestartByTab((prev) => ({
      ...prev,
      [activeKey]: (prev[activeKey] ?? 0) + 1,
    }));
  };

  const handleInterrupt = () => {
    sessionRefs.current.get(activeKey)?.interrupt();
  };

  const onTabEdit = (
    targetKey: string | number | React.MouseEvent | React.KeyboardEvent,
    action: 'add' | 'remove'
  ) => {
    if (action === 'add') {
      const id = genTerminalTabId();
      setTabIds((prev) => [...prev, id]);
      setRestartByTab((prev) => ({ ...prev, [id]: 0 }));
      setActiveKey(id);
      return;
    }
    const key = String(targetKey);
    setTabIds((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((tid) => tid !== key);
      const idx = prev.indexOf(key);
      setActiveKey((cur) => {
        if (cur !== key) return cur;
        return next[Math.max(0, idx - 1)] ?? next[0];
      });
      setRestartByTab((r) => {
        const { [key]: _, ...rest } = r;
        return rest;
      });
      sessionRefs.current.delete(key);
      return next;
    });
  };

  const tabItems = tabIds.map((id, index) => ({
    key: id,
    label: t('common.terminalTabLabel', { n: index + 1, defaultValue: `终端 ${index + 1}` }),
    closable: tabIds.length > 1,
    children: (
      <div style={{ height: '100%', padding: 12, paddingTop: 8, boxSizing: 'border-box' }}>
        <V3TerminalSession
          ref={(h) => {
            if (h) sessionRefs.current.set(id, h);
            else sessionRefs.current.delete(id);
          }}
          t={t}
          cwd={cwd}
          width={width}
          isActive={activeKey === id}
          restartKey={restartByTab[id] ?? 0}
          onSendSelectionToChat={onSendSelectionToChat}
        />
      </div>
    ),
  }));

  return (
    <div
      className="v3-terminal-pane"
      style={{
        width: fillParent ? '100%' : width,
        height: '100%',
        background: '#0f172a',
        borderLeft: fillParent ? undefined : '1px solid #334155',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: fillParent ? undefined : '-4px 0 15px rgba(0,0,0,0.2)',
        zIndex: fillParent ? undefined : 20,
        transition: fillParent ? undefined : (customTransition !== undefined ? customTransition : 'width 0.2s ease-in-out'),
        minWidth: 0,
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #334155',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#1e293b',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f8fafc' }}>
          <TerminalIcon size={14} className="text-indigo-400" />
          <span style={{ fontSize: 13, fontWeight: 800 }}>{t('common.terminal', { defaultValue: '运维终端' })}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Tooltip title={t('common.interrupt', { defaultValue: '中断 (Ctrl+C)' })}>
            <Button
              size="small"
              type="text"
              icon={<XCircle size={14} />}
              onClick={handleInterrupt}
              style={{ color: '#ef4444' }}
            />
          </Tooltip>
          <Tooltip title={t('common.restart', { defaultValue: '重启' })}>
            <Button
              size="small"
              type="text"
              icon={<RotateCcw size={14} />}
              onClick={handleRestart}
              style={{ color: '#94a3b8' }}
            />
          </Tooltip>
          <Tooltip
            title={
              dockExpanded
                ? t('common.minimize', { defaultValue: '还原宽度' })
                : t('common.maximize', { defaultValue: '最大化占满右侧' })
            }
          >
            <Button
              size="small"
              type="text"
              icon={dockExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              onClick={() => {
                if (onToggleDockExpanded) {
                  onToggleDockExpanded();
                  return;
                }
                const target = width > 600 ? 450 : 800;
                onWidthChange?.(target);
              }}
              style={{ color: '#94a3b8' }}
            />
          </Tooltip>
          <Button size="small" type="text" icon={<X size={16} />} onClick={onClose} style={{ color: '#94a3b8' }} />
        </div>
      </div>
      <Tabs
        className="v3-terminal-multi-tabs"
        type="editable-card"
        size="small"
        activeKey={activeKey}
        onChange={setActiveKey}
        onEdit={onTabEdit}
        items={tabItems}
        destroyInactiveTabPane={false}
      />
    </div>
  );
};
