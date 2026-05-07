import React, { useEffect, useRef, useState } from 'react';
import { message, Button, Tooltip, Space, Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { RotateCcw, XCircle, Server, Monitor, Cpu, Terminal as TerminalIcon } from 'lucide-react';
import api from '../api';
import {
  V3TerminalSession,
  genTerminalTabId,
  type V3TerminalSessionHandle,
} from './chatV3/V3TerminalSession';
import './chatV3/v3TerminalTabs.css';

interface ServerInfo {
  hostname: string;
  os: string;
  arch: string;
  cpus: number;
}

const ShellView: React.FC = () => {
  const { t } = useTranslation();

  const seedRef = useRef<string | null>(null);
  if (!seedRef.current) seedRef.current = genTerminalTabId();

  const [tabIds, setTabIds] = useState<string[]>(() => [seedRef.current!]);
  const [activeKey, setActiveKey] = useState<string>(() => seedRef.current!);
  const [restartByTab, setRestartByTab] = useState<Record<string, number>>(() => ({ [seedRef.current!]: 0 }));

  const sessionRefs = useRef<Map<string, V3TerminalSessionHandle>>(new Map());

  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [viewportW, setViewportW] = useState(() => window.innerWidth);

  useEffect(() => {
    const handleWinResize = () => {
      setIsMobile(window.innerWidth < 768);
      setViewportW(window.innerWidth);
    };
    window.addEventListener('resize', handleWinResize);
    return () => window.removeEventListener('resize', handleWinResize);
  }, []);

  const fetchServerInfo = async () => {
    try {
      const res = await api.get('/v1/system/info');
      setServerInfo(res.data);
    } catch (err) {
      console.error('Failed to fetch server info:', err);
    }
  };

  const handleRestart = () => {
    setRestartByTab((prev) => ({
      ...prev,
      [activeKey]: (prev[activeKey] ?? 0) + 1,
    }));
    message.success(t('common.restarting', { defaultValue: '正在重启终端...' }));
  };

  const handleInterrupt = () => {
    sessionRefs.current.get(activeKey)?.interrupt();
    message.info(t('common.interruptSent', { defaultValue: '已发送中断信号 (Ctrl+C)' }));
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

  const focusActiveShell = () => {
    const h = sessionRefs.current.get(activeKey);
    h?.focusTerminal();
    if (isMobile) {
      setTimeout(() => sessionRefs.current.get(activeKey)?.focusTerminal(), 100);
    }
    h?.scrollToBottom();
  };

  useEffect(() => {
    fetchServerInfo();
  }, []);

  const getOSDisplay = (os: string) => {
    const lowerOS = os.toLowerCase();
    if (lowerOS === 'darwin') return { name: 'macOS', color: '#cbd5e1', icon: <Monitor size={14} /> };
    if (lowerOS === 'windows') return { name: 'Windows', color: '#60a5fa', icon: <Monitor size={14} /> };
    if (lowerOS === 'linux') return { name: 'Linux', color: '#fbbf24', icon: <Monitor size={14} /> };
    return { name: os, color: '#94a3b8', icon: <Monitor size={14} /> };
  };

  const osInfo = serverInfo ? getOSDisplay(serverInfo.os) : null;

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
          width={viewportW}
          isActive={activeKey === id}
          restartKey={restartByTab[id] ?? 0}
          fontSize={isMobile ? 12 : 14}
          cursorStyle={isMobile ? 'bar' : 'block'}
          screenReaderMode={isMobile}
        />
      </div>
    ),
  }));

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        background: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '48px',
          minHeight: '48px',
          background: 'rgba(30, 41, 59, 0.8)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          zIndex: 100,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8' }}>
            <TerminalIcon size={16} style={{ color: '#312e81' }} />
            {!isMobile && (
              <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '13px' }}>{t('common.shell')}</span>
            )}
          </div>

          {serverInfo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '16px', fontSize: '12px' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8', maxWidth: isMobile ? '80px' : 'none' }}
              >
                <Server size={14} />
                <span
                  style={{
                    color: '#cbd5e1',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {serverInfo.hostname.split('.')[0]}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
                {osInfo?.icon}
                {!isMobile && (
                  <span style={{ color: osInfo?.color }}>
                    {osInfo?.name} ({serverInfo.arch})
                  </span>
                )}
              </div>
              {!isMobile && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
                  <Cpu size={14} />
                  <span>{serverInfo.cpus} Cores</span>
                </div>
              )}
            </div>
          )}
        </div>

        <Space size={isMobile ? 8 : 12}>
          <Tooltip title={t('common.interrupt', { defaultValue: '强制中断 (Ctrl+C)' })}>
            <Button
              size={isMobile ? 'middle' : 'small'}
              icon={<XCircle size={14} />}
              onClick={handleInterrupt}
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#fca5a5',
                width: isMobile ? '38px' : 'auto',
                height: isMobile ? '38px' : 'auto',
                padding: isMobile ? 0 : '4px 15px',
                borderRadius: isMobile ? '50%' : '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              className="hover:bg-red-500/20 transition-all border-none"
            >
              {!isMobile && '中断'}
            </Button>
          </Tooltip>

          <Tooltip title={t('common.restartTerminal', { defaultValue: '重启维护终端' })}>
            <Button
              size={isMobile ? 'middle' : 'small'}
              icon={<RotateCcw size={14} />}
              onClick={handleRestart}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#e2e8f0',
                width: isMobile ? '38px' : 'auto',
                height: isMobile ? '38px' : 'auto',
                padding: isMobile ? 0 : '4px 15px',
                borderRadius: isMobile ? '50%' : '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              className="hover:bg-white/10 transition-all"
            >
              {!isMobile && '重启'}
            </Button>
          </Tooltip>
        </Space>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          cursor: 'text',
          outline: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
        onContextMenu={(e) => isMobile && e.preventDefault()}
        onClick={focusActiveShell}
        onTouchEnd={(e) => {
          if (!isMobile) return;
          const nav = (e.target as HTMLElement).closest?.('.ant-tabs-nav');
          if (nav) return;
          e.preventDefault();
          focusActiveShell();
        }}
      >
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
    </div>
  );
};

export default ShellView;
