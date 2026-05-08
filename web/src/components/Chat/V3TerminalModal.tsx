import React, { useEffect, useRef, useState } from 'react';
import { Button, Modal, Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { RotateCcw, XCircle, Terminal as TerminalIcon, Maximize2, Minimize2 } from 'lucide-react';
import Draggable from 'react-draggable';
import type { DraggableBounds, DraggableData, DraggableEvent } from 'react-draggable';
import {
  V3TerminalSession,
  genTerminalTabId,
  type V3TerminalSessionHandle,
} from '../../views/chatV3/V3TerminalSession';
import '../../views/chatV3/v3TerminalTabs.css';
import Tooltip from '../common/AppTooltip';

interface V3TerminalModalProps {
  open: boolean;
  onClose: () => void;
  cwd?: string;
  title?: string;
  showSider?: boolean;
}

export const V3TerminalModal: React.FC<V3TerminalModalProps> = ({ open, onClose, cwd, title, showSider }) => {
  const { t } = useTranslation();
  const [isMobile] = useState(window.innerWidth < 768);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewportW, setViewportW] = useState(() => window.innerWidth);

  const modalTabSeedRef = useRef<string | null>(null);
  if (!modalTabSeedRef.current) modalTabSeedRef.current = genTerminalTabId();

  const [tabIds, setTabIds] = useState<string[]>(() => [modalTabSeedRef.current!]);
  const [activeKey, setActiveKey] = useState<string>(() => modalTabSeedRef.current!);
  const [restartByTab, setRestartByTab] = useState<Record<string, number>>(() => ({
    [modalTabSeedRef.current!]: 0,
  }));

  const sessionRefs = useRef<Map<string, V3TerminalSessionHandle>>(new Map());
  const prevOpenRef = useRef(false);

  const sessionWidth = isFullscreen ? viewportW : 1000;

  useEffect(() => {
    const onR = () => setViewportW(window.innerWidth);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  // Draggable states
  const [dragDisabled, setDragDisabled] = useState(true);
  const [bounds, setBounds] = useState<DraggableBounds>({ left: 0, top: 0, bottom: 0, right: 0 });
  const draggleRef = useRef<HTMLDivElement>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const savedDragPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const prevShowSiderOpenRef = useRef<boolean | null>(null);

  const onStart = (_event: DraggableEvent, uiData: DraggableData) => {
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

  useEffect(() => {
    if (open) {
      setIsFullscreen(false);
      setDragPos({ x: 0, y: 0 });
      savedDragPos.current = { x: 0, y: 0 };
    }
  }, [open]);

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const id = genTerminalTabId();
      setTabIds([id]);
      setActiveKey(id);
      setRestartByTab({ [id]: 0 });
      sessionRefs.current.clear();
    }
    prevOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    const siderOpen = !!showSider;
    const prev = prevShowSiderOpenRef.current;
    if (prev === null) {
      prevShowSiderOpenRef.current = siderOpen;
      return;
    }
    if (prev === false && siderOpen) {
      setIsFullscreen((m) => {
        if (m) {
          setDragPos({ x: 0, y: 0 });
          return false;
        }
        return m;
      });
    }
    prevShowSiderOpenRef.current = siderOpen;
  }, [showSider]);

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
          width={sessionWidth}
          isActive={open && activeKey === id}
          restartKey={restartByTab[id] ?? 0}
          fontSize={isMobile ? 12 : 13}
        />
      </div>
    ),
  }));

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={isFullscreen ? '100vw' : 1000}
      centered={!isFullscreen}
      destroyOnClose
      styles={{
        body: {
          padding: 0,
          height: isFullscreen ? 'calc(100vh - 40px)' : '600px',
          background: '#0f172a',
          overflow: 'hidden',
          borderRadius: isFullscreen ? 0 : '0 0 12px 12px',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        },
        content: { padding: 0, background: '#0f172a', borderRadius: isFullscreen ? 0 : 12, overflow: 'hidden' },
        header: {
          padding: '12px 16px',
          background: '#1e293b',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          marginBottom: 0,
          borderRadius: isFullscreen ? 0 : '12px 12px 0 0',
        },
      }}
      modalRender={(modal) => (
        <Draggable
          disabled={dragDisabled || isFullscreen}
          bounds={bounds}
          position={dragPos}
          onStart={(event, uiData) => onStart(event, uiData)}
          onStop={(event, uiData) => onDragStop(event, uiData)}
        >
          <div ref={draggleRef}>{modal}</div>
        </Draggable>
      )}
      title={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: 'calc(100% - 32px)',
            cursor: isFullscreen ? 'default' : 'move',
          }}
          onMouseOver={() => {
            if (dragDisabled) setDragDisabled(false);
          }}
          onMouseOut={() => {
            setDragDisabled(true);
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f8fafc' }}>
            <TerminalIcon size={16} className="text-indigo-400" />
            <span style={{ fontSize: 14, fontWeight: 700 }}>{title || t('common.terminal', { defaultValue: '运维终端' })}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tooltip title={t('common.interrupt', { defaultValue: '中断 (Ctrl+C)' })}>
              <Button
                size="small"
                type="text"
                icon={<XCircle size={14} />}
                onClick={handleInterrupt}
                style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)' }}
                onMouseEnter={() => setDragDisabled(true)}
                onMouseLeave={() => setDragDisabled(false)}
              />
            </Tooltip>
            <Tooltip title={t('common.restart', { defaultValue: '重启' })}>
              <Button
                size="small"
                type="text"
                icon={<RotateCcw size={14} />}
                onClick={handleRestart}
                style={{ color: '#94a3b8' }}
                onMouseEnter={() => setDragDisabled(true)}
                onMouseLeave={() => setDragDisabled(false)}
              />
            </Tooltip>
            <Tooltip title={isFullscreen ? t('common.exitFullscreen') : t('common.fullscreen')}>
              <Button
                size="small"
                type="text"
                icon={isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                onClick={toggleFullscreen}
                style={{ color: '#94a3b8' }}
                onMouseEnter={() => setDragDisabled(true)}
                onMouseLeave={() => setDragDisabled(false)}
              />
            </Tooltip>
          </div>
        </div>
      }
      closeIcon={
        <span
          style={{ color: '#94a3b8' }}
          onMouseEnter={() => setDragDisabled(true)}
          onMouseLeave={() => setDragDisabled(false)}
        >
          ×
        </span>
      }
      style={isFullscreen ? { top: 0, maxWidth: '100vw', margin: 0, padding: 0 } : {}}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
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
    </Modal>
  );
};
