import React, { useState, useEffect, useRef } from 'react';
import { useArtifact } from './V3ArtifactContext';
import { Button, Select, Radio, Alert } from 'antd';
import { X, Play, Code, ExternalLink } from 'lucide-react';
import mermaid from 'mermaid';

export const V3CanvasPane: React.FC<{ isDarkMode: boolean; onClose?: () => void }> = ({ isDarkMode, onClose }) => {
  const { activeArtifact, setActiveArtifact, setCanvasVisible, artifactsHistory } = useArtifact();
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [sandboxError, setSandboxError] = useState<{ message: string; line?: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const mermaidRef = useRef<HTMLDivElement>(null);

  // 监听并接收 iframe 沙箱传上来的报错
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'CLAW_SANDBOX_ERROR') {
        setSandboxError({
          message: event.data.error.message,
          line: event.data.error.lineno
        });
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // 重置报错
  useEffect(() => {
    setSandboxError(null);
  }, [activeArtifact]);

  // 当切换 Artifact 的预览模式且为 mermaid 时进行渲染
  useEffect(() => {
    if (activeArtifact && activeArtifact.type === 'mermaid' && viewMode === 'preview' && mermaidRef.current) {
      const chartCode = activeArtifact.code;
      mermaidRef.current.innerHTML = '<div style="color: #94a3b8; font-size: 13px; text-align: center; padding: 20px;">渲染中...</div>';
      try {
        // loose 安全级别以允许更多 mermaid 自定义交互，且 theme 自适应
        mermaid.initialize({
          startOnLoad: false,
          theme: isDarkMode ? 'dark' : 'default',
          securityLevel: 'loose'
        });
        const id = `mermaid-canvas-${Math.random().toString(36).substr(2, 9)}`;
        mermaid.render(id, chartCode).then(({ svg }) => {
          if (mermaidRef.current) {
            mermaidRef.current.innerHTML = svg;
          }
        }).catch(err => {
          console.error('Mermaid render error inner:', err);
          if (mermaidRef.current) {
            mermaidRef.current.innerHTML = `<div style="color: #ef4444; font-size: 12px; padding: 12px; border: 1px dashed #fecaca; border-radius: 8px; background: ${isDarkMode ? 'rgba(239,68,68,0.1)' : '#fef2f2'}">Mermaid 语法解析失败: ${err.message}</div>`;
          }
        });
      } catch (err: any) {
        console.error('Mermaid render error outer:', err);
        if (mermaidRef.current) {
          mermaidRef.current.innerHTML = `<div style="color: #ef4444; font-size: 12px; padding: 12px; border: 1px dashed #fecaca; border-radius: 8px; background: ${isDarkMode ? 'rgba(239,68,68,0.1)' : '#fef2f2'}">Mermaid 初始化失败: ${err.message}</div>`;
        }
      }
    }
  }, [activeArtifact, viewMode, isDarkMode]);

  if (!activeArtifact) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#94a3b8',
        fontSize: 14,
        background: isDarkMode ? '#111827' : '#fafafa'
      }}>
        暂无选中的实时画布
      </div>
    );
  }

  // 获取该组件的所有历史版本
  const versionsList = artifactsHistory[activeArtifact.title] || [];

  const handleVersionChange = (versionVal: number) => {
    const selected = versionsList.find(x => x.version === versionVal);
    if (selected) {
      setActiveArtifact(selected);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(activeArtifact.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([activeArtifact.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = activeArtifact.title;
    link.click();
    URL.revokeObjectURL(url);
  };

  // 全屏打开 Blob URL
  const openFullScreen = () => {
    const blob = new Blob([activeArtifact.code], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  // 在 iframe 中运行 safe srcDoc，并注入 window.onerror 以将子页面报错 postMessage 到父级捕获
  const getSafeSrcDoc = () => {
    if (activeArtifact.type !== 'html') return '';
    const injection = `
      <script>
        window.onerror = function(message, source, lineno, colno, error) {
          window.parent.postMessage({
            type: 'CLAW_SANDBOX_ERROR',
            error: { message: message, lineno: lineno, colno: colno }
          }, '*');
          return true; // 阻止浏览器控制台报错
        };
      </script>
    `;
    const code = activeArtifact.code;
    
    // 注入逻辑：查找 <head> 或 <html>，将其注入。如果没有 head，则直接加到最前面。
    if (code.includes('<head>')) {
      return code.replace('<head>', `<head>${injection}`);
    } else if (code.includes('<HEAD>')) {
      return code.replace('<HEAD>', `<HEAD>${injection}`);
    } else if (code.includes('<html>')) {
      return code.replace('<html>', `<html><head>${injection}</head>`);
    } else {
      return injection + code;
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: isDarkMode ? '#111827' : '#fff',
      borderLeft: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`
    }}>
      {/* 顶部工具条 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        background: isDarkMode ? '#1f2937' : '#f9fafb',
        borderBottom: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 13.5, color: isDarkMode ? '#f3f4f6' : '#111827' }}>⚡ 画布</span>
          {versionsList.length > 1 && (
            <Select
              size="small"
              value={activeArtifact.version}
              style={{ width: 110 }}
              dropdownStyle={isDarkMode ? { background: '#1f2937' } : undefined}
              onChange={handleVersionChange}
              options={versionsList.map(x => ({
                value: x.version,
                label: `v${x.version}${x.version === versionsList.length ? ' (最新)' : ''}`
              }))}
            />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Radio.Group size="small" value={viewMode} onChange={e => setViewMode(e.target.value)}>
            <Radio.Button value="preview" style={isDarkMode ? { background: '#374151', color: '#e5e7eb', borderColor: '#4b5563' } : {}}><Play size={11} style={{ marginRight: 4, display: 'inline', verticalAlign: '-1px' }} />预览</Radio.Button>
            <Radio.Button value="code" style={isDarkMode ? { background: '#374151', color: '#e5e7eb', borderColor: '#4b5563' } : {}}><Code size={11} style={{ marginRight: 4, display: 'inline', verticalAlign: '-1px' }} />代码</Radio.Button>
          </Radio.Group>
          {activeArtifact.type === 'html' && (
            <Button size="small" icon={<ExternalLink size={12} />} onClick={openFullScreen} style={isDarkMode ? { background: '#374151', color: '#e5e7eb', borderColor: '#4b5563' } : {}}>全屏</Button>
          )}
          <Button size="small" type="text" icon={<X size={16} />} onClick={() => {
            setCanvasVisible(false);
            if (onClose) onClose();
          }} style={isDarkMode ? { color: '#9ca3af' } : {}} />
        </div>
      </div>

      {/* 视口/代码展示区域 */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {viewMode === 'preview' ? (
          activeArtifact.type === 'html' ? (
            <div style={{ width: '100%', height: '100%', position: 'relative', background: '#fff' }}>
              <iframe
                ref={iframeRef}
                srcDoc={getSafeSrcDoc()}
                title={activeArtifact.title}
                sandbox="allow-scripts allow-downloads allow-modals allow-popups allow-forms"
                style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
              />
              {sandboxError && (
                <Alert
                  message={`运行时错误: ${sandboxError.message} (第 ${sandboxError.line} 行)`}
                  type="error"
                  showIcon
                  closable
                  onClose={() => setSandboxError(null)}
                  style={{ position: 'absolute', bottom: 12, left: 12, right: 12, zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
                />
              )}
            </div>
          ) : activeArtifact.type === 'mermaid' ? (
            <div style={{
              padding: 24,
              overflow: 'auto',
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isDarkMode ? '#0b0f19' : '#fafafa'
            }}>
              <div ref={mermaidRef} style={{ width: '100%', display: 'flex', justifyContent: 'center' }} />
            </div>
          ) : (
            // SVG 渲染
            <div style={{
              padding: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              overflow: 'auto',
              background: isDarkMode ? '#0b0f19' : '#fafafa'
            }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  filter: isDarkMode ? 'invert(0.95) hue-rotate(180deg)' : 'none'
                }}
                dangerouslySetInnerHTML={{ __html: activeArtifact.code }}
              />
            </div>
          )
        ) : (
          // 代码查看模式
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <pre style={{
              margin: 0,
              padding: 16,
              flex: 1,
              overflow: 'auto',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 12.5,
              background: isDarkMode ? '#0b0f19' : '#f8fafc',
              color: isDarkMode ? '#e5e7eb' : '#111827',
              border: 'none'
            }}>
              <code>{activeArtifact.code}</code>
            </pre>
            {/* 代码快捷操作栏 */}
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              padding: '8px 16px',
              background: isDarkMode ? '#1f2937' : '#f3f4f6',
              borderTop: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`
            }}>
              <Button size="small" onClick={handleCopy} style={isDarkMode ? { background: '#374151', color: '#e5e7eb', borderColor: '#4b5563' } : {}}>
                {copied ? '已复制' : '复制代码'}
              </Button>
              <Button size="small" onClick={handleDownload} style={isDarkMode ? { background: '#374151', color: '#e5e7eb', borderColor: '#4b5563' } : {}}>
                下载文件
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
