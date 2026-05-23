import React, { useState, useEffect, useRef } from 'react';
import { useArtifact } from './V3ArtifactContext';
import { Button, Select, Radio, Alert, message, Input } from 'antd';
import { Play, Code, ExternalLink, Sparkles } from 'lucide-react';
import mermaid from 'mermaid';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

interface V3CanvasPaneProps {
  isDarkMode: boolean;
}

export const V3CanvasPane: React.FC<V3CanvasPaneProps> = ({ isDarkMode }) => {
  const { activeArtifact, setActiveArtifact, artifactsHistory, registerArtifact } = useArtifact();
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [sandboxError, setSandboxError] = useState<{ message: string; line?: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const mermaidRef = useRef<HTMLDivElement>(null);

  // 微调状态
  const [editCode, setEditCode] = useState('');

  // 同步微调代码
  useEffect(() => {
    if (activeArtifact) {
      setEditCode(activeArtifact.code);
    }
  }, [activeArtifact]);

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

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(activeArtifact.code);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = activeArtifact.code;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (!successful) throw new Error('execCommand copy returned false');
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Canvas copy failed:', err);
      message.error('复制失败，请手动复制');
    }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const blob = new Blob([activeArtifact.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = activeArtifact.title;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  // 全屏打开 Blob URL
  const openFullScreen = () => {
    const blob = new Blob([activeArtifact.code], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  // 微调代码保存并预览
  const handleSaveAndPreview = () => {
    if (!activeArtifact) return;
    registerArtifact({
      id: activeArtifact.id,
      title: activeArtifact.title,
      type: activeArtifact.type,
      code: editCode,
      messageId: activeArtifact.messageId
    }, true);
    setViewMode('preview');
    message.success('微调已保存并重新渲染预览！');
  };

  // 一键向 AI 发送报错修复请求
  const handleFixSandboxError = () => {
    if (!activeArtifact || !sandboxError) return;
    const promptText = `我在运行刚刚生成的 Canvas \`${activeArtifact.title}\` (类型: \`${activeArtifact.type}\`) 时遇到了以下运行时报错：

> ❌ \`${sandboxError.message}\` (第 \`${sandboxError.line}\` 行)

这是我当前的代码：
\`\`\`${activeArtifact.type}
${activeArtifact.code}
\`\`\`

请帮我分析报错原因，并给我一份修复后的代码。`;

    const event = new CustomEvent('claw-chat-send', {
      detail: { text: promptText }
    });
    window.dispatchEvent(event);
    message.success('已自动向 AI 发送报错分析指令');
    setSandboxError(null);
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
        borderBottom: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
        flexWrap: 'nowrap',
        overflowX: 'auto',
        msOverflowStyle: 'none', // 隐藏IE滚动条
        scrollbarWidth: 'none',   // 隐藏Firefox滚动条
      }}>
        {/* 隐藏Chrome滚动条的内联样式 */}
        <style dangerouslySetInnerHTML={{__html: `
          div::-webkit-scrollbar {
            display: none;
          }
        `}} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 13.5, color: isDarkMode ? '#f3f4f6' : '#111827', whiteSpace: 'nowrap' }}>⚡ 画布</span>
          {versionsList.length > 1 && (
            <Select
              size="small"
              value={activeArtifact.version}
              style={{ width: 110, flexShrink: 0 }}
              dropdownStyle={isDarkMode ? { background: '#1f2937' } : undefined}
              onChange={handleVersionChange}
              options={versionsList.map(x => ({
                value: x.version,
                label: `v${x.version}${x.version === versionsList.length ? ' (最新)' : ''}`
              }))}
            />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <Radio.Group 
            size="small" 
            value={viewMode} 
            onChange={e => setViewMode(e.target.value)}
            style={{ flexShrink: 0, display: 'inline-flex', whiteSpace: 'nowrap' }}
          >
            <Radio.Button value="preview" style={isDarkMode ? { background: '#374151', color: '#e5e7eb', borderColor: '#4b5563', whiteSpace: 'nowrap' } : { whiteSpace: 'nowrap' }}><Play size={11} style={{ marginRight: 4, display: 'inline-block', verticalAlign: '-1px' }} />预览</Radio.Button>
            <Radio.Button value="code" style={isDarkMode ? { background: '#374151', color: '#e5e7eb', borderColor: '#4b5563', whiteSpace: 'nowrap' } : { whiteSpace: 'nowrap' }}><Code size={11} style={{ marginRight: 4, display: 'inline-block', verticalAlign: '-1px' }} />代码</Radio.Button>
          </Radio.Group>
          {activeArtifact.type === 'html' && (
            <Button size="small" icon={<ExternalLink size={12} />} onClick={openFullScreen} style={isDarkMode ? { background: '#374151', color: '#e5e7eb', borderColor: '#4b5563', flexShrink: 0, whiteSpace: 'nowrap' } : { flexShrink: 0, whiteSpace: 'nowrap' }}>全屏</Button>
          )}
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
                  message={
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span>{`运行时错误: ${sandboxError.message} (第 ${sandboxError.line} 行)`}</span>
                      <Button
                        size="small"
                        type="primary"
                        danger
                        icon={<Sparkles size={11} />}
                        onClick={handleFixSandboxError}
                        style={{ alignSelf: 'flex-start', borderRadius: 6, fontSize: 11, height: 24, padding: '0 8px' }}
                      >
                        一键发送给 AI 修复
                      </Button>
                    </div>
                  }
                  type="error"
                  showIcon
                  closable
                  onClose={() => setSandboxError(null)}
                  style={{ position: 'absolute', bottom: 12, left: 12, right: 12, zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
                />
              )}
            </div>
          ) : activeArtifact.type === 'markdown' ? (
            <div style={{
              padding: 24,
              overflow: 'auto',
              flex: 1,
              background: isDarkMode ? '#0b0f19' : '#fafafa'
            }}>
              <div style={{
                maxWidth: 860,
                margin: '0 auto',
                padding: 28,
                borderRadius: 10,
                background: isDarkMode ? '#111827' : '#fff',
                color: isDarkMode ? '#e5e7eb' : '#111827',
                border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`
              }}>
                <div className={`markdown-body-v3${isDarkMode ? ' v3-model-chat-md--dark' : ''}`}>
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                    {activeArtifact.code}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          ) : activeArtifact.type === 'image' ? (
            <div style={{
              padding: 24,
              overflow: 'auto',
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isDarkMode ? '#0b0f19' : '#fafafa'
            }}>
              <div style={{
                maxWidth: '100%',
                maxHeight: '100%',
                padding: 16,
                borderRadius: 12,
                background: isDarkMode ? '#111827' : '#fff',
                border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
                boxShadow: isDarkMode ? 'none' : '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden'
              }}>
                <img
                  src={activeArtifact.code}
                  alt={activeArtifact.title}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '70vh',
                    objectFit: 'contain',
                    borderRadius: 8,
                    cursor: 'zoom-in'
                  }}
                  onClick={() => {
                    const newTab = window.open();
                    if (newTab) {
                      newTab.document.write(`<img src="${activeArtifact.code}" style="max-width:100%; max-height:100vh; display:block; margin:auto;" />`);
                      newTab.document.title = activeArtifact.title;
                    }
                  }}
                  title="点击在新标签页打开高清原图"
                />
              </div>
            </div>
          ) : activeArtifact.type === 'pdf' ? (
            <div style={{ width: '100%', height: '100%', position: 'relative', background: '#fff' }}>
              <iframe
                src={activeArtifact.code}
                title={activeArtifact.title}
                style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
              />
            </div>
          ) : activeArtifact.type === 'text' ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              <pre style={{
                margin: 0,
                padding: '24px 32px',
                flex: 1,
                overflow: 'auto',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: 13,
                lineHeight: 1.6,
                background: isDarkMode ? '#0b0f19' : '#fafafa',
                color: isDarkMode ? '#e5e7eb' : '#111827',
                border: 'none',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }}>
                <code>{activeArtifact.code}</code>
              </pre>
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
            {activeArtifact.type === 'image' || activeArtifact.type === 'pdf' ? (
              <div style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: 16,
                background: isDarkMode ? '#0b0f19' : '#f8fafc',
                color: isDarkMode ? '#9ca3af' : '#64748b',
                fontSize: 13
              }}>
                <Code size={40} strokeWidth={1.5} style={{ opacity: 0.6 }} />
                <span>该文件为二进制{activeArtifact.type === 'pdf' ? 'PDF' : '图片'}，不提供纯文本代码查看</span>
                <span style={{ fontSize: 11, opacity: 0.7 }}>Base64 数据大小: {(activeArtifact.code.length / 1024).toFixed(1)} KB</span>
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                <Input.TextArea
                  value={editCode}
                  onChange={(e) => setEditCode(e.target.value)}
                  style={{
                    flex: 1,
                    margin: 0,
                    padding: 16,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: '12.5px',
                    background: isDarkMode ? '#0b0f19' : '#f8fafc',
                    color: isDarkMode ? '#e5e7eb' : '#111827',
                    border: 'none',
                    borderRadius: 0,
                    resize: 'none',
                    height: '100%'
                  }}
                />
              </div>
            )}
            {/* 代码快捷操作栏 */}
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              padding: '8px 16px',
              background: isDarkMode ? '#1f2937' : '#f3f4f6',
              borderTop: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`
            }}>
              {!(activeArtifact.type === 'image' || activeArtifact.type === 'pdf') && (
                <Button 
                  size="small" 
                  type="primary" 
                  onClick={handleSaveAndPreview}
                  style={{
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    border: 'none',
                    boxShadow: '0 2px 4px rgba(16, 185, 129, 0.15)'
                  }}
                >
                  保存并预览
                </Button>
              )}
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
