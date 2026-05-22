# Interactive Artifact Canvas (IAC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the "Interactive Artifact Canvas (IAC)" progressive preview sandboxed dashboard to capture, render and isolate generated HTML/SVG/Mermaid components dynamic output.

**Architecture:** Context-driven reactive interface. A parser extracts code blocks from chat streams, publishes them to `ActiveArtifactContext`, and triggers the smooth-expanding side panel `V3CanvasPane` containing an iframe sandbox with zero parental privileges, error boundaries, and adaptive dark mode filters.

**Tech Stack:** React (TypeScript), Ant Design (UI framework), Lucide icons, Mermaid.js, standard HTML5 sandbox iframe.

---

## Files To Be Created/Modified

### New Files
1.  `web/src/views/chatV3/V3CanvasPane.tsx` (Canvas core rendering container)

### Modified Files
1.  `web/src/views/chatV3/V3MessagePane.tsx` (Add code parser interceptor & fold Card UI)
2.  `web/src/views/chatV3/V3RightDock.tsx` (Register Canvas Tab, trigger auto-expand width)
3.  `web/src/locales/zh.json` & `web/src/locales/en.json` (Provide clean multilanguage tags)

---

## Detailed Tasks

### Task 1: [Context & State] Create Context State Management

**Files:**
*   Create: `web/src/views/chatV3/V3ArtifactContext.tsx`
*   Modify: `web/src/views/chatV3/V3ComposerBar.tsx` (if needed for propagating context)

- [ ] **Step 1: Write the Context and Provider**
  Create `web/src/views/chatV3/V3ArtifactContext.tsx` containing the context provider:
  ```typescript
  import React, { createContext, useContext, useState } from 'react';

  export interface Artifact {
    id: string;
    title: string;
    type: 'html' | 'mermaid' | 'svg';
    code: string;
    messageId: string;
    version: number;
  }

  interface ArtifactContextType {
    activeArtifact: Artifact | null;
    setActiveArtifact: (artifact: Artifact | null) => void;
    canvasVisible: boolean;
    setCanvasVisible: (visible: boolean) => void;
    artifactsHistory: Record<string, Artifact[]>; // filename -> versions
    registerArtifact: (artifact: Omit<Artifact, 'version'>) => void;
  }

  const ArtifactContext = createContext<ArtifactContextType | undefined>(undefined);

  export const ArtifactProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
    const [canvasVisible, setCanvasVisible] = useState(false);
    const [artifactsHistory, setArtifactsHistory] = useState<Record<string, Artifact[]>>({});

    const registerArtifact = (art: Omit<Artifact, 'version'>) => {
      setArtifactsHistory(prev => {
        const list = prev[art.title] || [];
        const matchesMsgId = list.some(item => item.messageId === art.messageId && item.code === art.code);
        if (matchesMsgId) return prev; // Avoid duplicate registrations for stream chunks
        
        const newVersionNum = list.length + 1;
        const newArt: Artifact = { ...art, version: newVersionNum };
        const updated = [...list.filter(x => x.messageId !== art.messageId), newArt];
        
        // Auto set active if it is the latest updated chunk
        setActiveArtifact(newArt);
        setCanvasVisible(true);
        
        return { ...prev, [art.title]: updated };
      });
    };

    return (
      <ArtifactContext.Provider value={{
        activeArtifact,
        setActiveArtifact,
        canvasVisible,
        setCanvasVisible,
        artifactsHistory,
        registerArtifact
      }}>
        {children}
      </ArtifactContext.Provider>
    );
  };

  export const useArtifact = () => {
    const context = useContext(ArtifactContext);
    if (!context) throw new Error('useArtifact must be used within ArtifactProvider');
    return context;
  };
  ```

- [ ] **Step 2: Commit Context creation**
  ```bash
  git add web/src/views/chatV3/V3ArtifactContext.tsx
  git commit -m "feat(canvas): add V3ArtifactContext state manager"
  ```

---

### Task 2: [Parser Interceptor] Parse markdown code blocks into Artifact Card in V3MessagePane

**Files:**
*   Modify: `web/src/views/chatV3/V3MessagePane.tsx`

- [ ] **Step 1: Write Custom Renderer in Markdown Engine**
  Locate Markdown component inside `web/src/views/chatV3/V3MessagePane.tsx` (usually react-markdown or custom marked parser) and inject an interceptor override for code blocks:
  ```typescript
  // Import useArtifact hook at the top
  import { useArtifact } from './V3ArtifactContext';
  import { LayoutTemplate, Copy, Download, Check } from 'lucide-react';
  
  // Inside message rendering component:
  const { registerArtifact } = useArtifact();
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({});

  const handleCopy = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedMap(prev => ({ ...prev, [id]: true }));
    setTimeout(() => {
      setCopiedMap(prev => ({ ...prev, [id]: false }));
    }, 2000);
  };

  const handleDownload = (code: string, filename: string) => {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };
  ```

- [ ] **Step 2: Fold HTML / Mermaid / SVG into Card Component**
  Replace standard Markdown `<pre><code>` block with custom interactive element:
  ```typescript
  const renderArtifactCard = (type: 'html' | 'mermaid' | 'svg', code: string, messageId: string) => {
    // Determine filename
    let filename = `app_${messageId.slice(0, 5)}.${type === 'html' ? 'html' : type === 'mermaid' ? 'mermaid' : 'svg'}`;
    const commentMatch = code.match(/(?:<!--|\/\*)\s*filename:\s*([a-zA-Z0-9_\-\.]+)\s*(?:-->|\*\/)/);
    if (commentMatch && commentMatch[1]) {
      filename = commentMatch[1];
    }

    // Auto-register to trigger visual canvas sidebar updates
    React.useEffect(() => {
      if (code && code.trim().length > 20) {
        registerArtifact({ id: `${messageId}-${filename}`, title: filename, type, code, messageId });
      }
    }, [code, messageId, filename]);

    return (
      <div style={{
        margin: '12px 0',
        borderRadius: 12,
        background: isDarkMode ? '#1e293b' : '#f8fafc',
        border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
        overflow: 'hidden',
        boxShadow: '0 4px 12px rgba(0,0,0,0.03)'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: isDarkMode ? '#0f172a' : '#f1f5f9',
          borderBottom: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600 }}>
            <LayoutTemplate size={14} color="#6366f1" />
            <span style={{ color: isDarkMode ? '#f1f5f9' : '#1e293b' }}>{filename}</span>
            <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>({(code.length / 1024).toFixed(1)} KB)</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, padding: '12px 14px', background: isDarkMode ? '#1e293b' : '#fff' }}>
          <Button
            type="primary"
            size="small"
            style={{ borderRadius: 6, fontSize: 11.5, background: '#6366f1' }}
            onClick={() => registerArtifact({ id: `${messageId}-${filename}`, title: filename, type, code, messageId })}
          >
            👁️ 预览此应用
          </Button>
          <Button
            size="small"
            icon={copiedMap[`${messageId}-${filename}`] ? <Check size={12} /> : <Copy size={12} />}
            onClick={() => handleCopy(code, `${messageId}-${filename}`)}
            style={{ borderRadius: 6, fontSize: 11.5 }}
          >
            {copiedMap[`${messageId}-${filename}`] ? '已复制' : '复制代码'}
          </Button>
          <Button
            size="small"
            icon={<Download size={12} />}
            onClick={() => handleDownload(code, filename)}
            style={{ borderRadius: 6, fontSize: 11.5 }}
          >
            下载文件
          </Button>
        </div>
      </div>
    );
  };
  ```

- [ ] **Step 3: Commit Parser modifications**
  ```bash
  git add web/src/views/chatV3/V3MessagePane.tsx
  git commit -m "feat(canvas): intercept HTML, Mermaid and SVG code blocks into Cards"
  ```

---

### Task 3: [Canvas Component] Create V3CanvasPane with Sandbox and Mermaid/SVG Engines

**Files:**
*   Create: `web/src/views/chatV3/V3CanvasPane.tsx`

- [ ] **Step 1: Write V3CanvasPane base implementation**
  Develop the core side previewer support tabs, sandbox iframe, download and Blob URL:
  ```typescript
  import React, { useState, useEffect, useRef } from 'react';
  import { useArtifact } from './V3ArtifactContext';
  import { Button, Select, Radio, Alert } from 'antd';
  import { X, Play, Code, ExternalLink, Copy, Download, AlertTriangle } from 'lucide-react';
  // Include Mermaid dynamically if needed, or import directly
  import mermaid from 'mermaid';

  export const V3CanvasPane: React.FC<{ isDarkMode: boolean }> = ({ isDarkMode }) => {
    const { activeArtifact, setActiveArtifact, setCanvasVisible, artifactsHistory } = useArtifact();
    const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
    const [sandboxError, setSandboxError] = useState<{ message: string; line?: number } | null>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    // Watch runtime iframe errors
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

    if (!activeArtifact) return null;

    // Handle Blob URL full screen
    const openFullScreen = () => {
      const blob = new Blob([activeArtifact.code], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    };

    // Inject unique origin safe sandbox runtime scripts
    const getSafeSrcDoc = () => {
      if (activeArtifact.type !== 'html') return '';
      const injection = `
        <script>
          window.onerror = function(message, source, lineno, colno, error) {
            window.parent.postMessage({
              type: 'CLAW_SANDBOX_ERROR',
              error: { message: message, lineno: lineno, colno: colno }
            }, '*');
          };
        </script>
      `;
      return activeArtifact.code.replace('<head>', `<head>${injection}`);
    };

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: isDarkMode ? '#1e293b' : '#fff',
        borderLeft: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`
      }}>
        {/* Header toolbar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: isDarkMode ? '#0f172a' : '#f8fafc',
          borderBottom: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontWeight: 700, fontSize: 13.5 }}>⚡ 画布</span>
            <Select
              size="small"
              value={activeArtifact.version}
              style={{ width: 100 }}
              options={(artifactsHistory[activeArtifact.title] || []).map(x => ({
                value: x.version,
                label: `v${x.version}${x.version === (artifactsHistory[activeArtifact.title]?.length || 1) ? ' (最新)' : ''}`
              }))}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Radio.Group size="small" value={viewMode} onChange={e => setViewMode(e.target.value)}>
              <Radio.Button value="preview"><Play size={12} style={{ marginRight: 4 }} />预览</Radio.Button>
              <Radio.Button value="code"><Code size={12} style={{ marginRight: 4 }} />代码</Radio.Button>
            </Radio.Group>
            <Button size="small" icon={<ExternalLink size={12} />} onClick={openFullScreen}>全屏</Button>
            <Button size="small" type="text" icon={<X size={16} />} onClick={() => setCanvasVisible(false)} />
          </div>
        </div>

        {/* Viewport Area */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {viewMode === 'preview' ? (
            activeArtifact.type === 'html' ? (
              <div style={{ width: '100%', height: '100%' }}>
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
                    style={{ position: 'absolute', bottom: 12, left: 12, right: 12, zIndex: 10 }}
                  />
                )}
              </div>
            ) : activeArtifact.type === 'mermaid' ? (
              <div style={{
                padding: 24,
                overflow: 'auto',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isDarkMode ? '#0f172a' : '#fafafa'
              }}>
                <div id="mermaid-renderer" className="mermaid">
                  {activeArtifact.code}
                </div>
              </div>
            ) : (
              // SVG renderer
              <div
                style={{
                  padding: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  filter: isDarkMode ? 'invert(0.95) hue-rotate(180deg)' : 'none'
                }}
                dangerouslySetInnerHTML={{ __html: activeArtifact.code }}
              />
            )
          ) : (
            <pre style={{
              margin: 0,
              padding: 16,
              height: '100%',
              overflow: 'auto',
              fontSize: 12.5,
              background: isDarkMode ? '#0f172a' : '#f8fafc',
              color: isDarkMode ? '#e2e8f0' : '#0f172a'
            }}>
              <code>{activeArtifact.code}</code>
            </pre>
          )}
        </div>
      </div>
    );
  };
  ```

- [ ] **Step 2: Integrate Mermaid initialization hook**
  ```typescript
  // Inside useEffect inside V3CanvasPane.tsx for Mermaid rendering trigger:
  useEffect(() => {
    if (activeArtifact && activeArtifact.type === 'mermaid' && viewMode === 'preview') {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: isDarkMode ? 'dark' : 'default',
          securityLevel: 'loose'
        });
        const container = document.getElementById('mermaid-renderer');
        if (container) {
          container.removeAttribute('data-processed');
          mermaid.contentLoaded();
        }
      } catch (err) {
        console.error('Mermaid render error:', err);
      }
    }
  }, [activeArtifact, viewMode, isDarkMode]);
  ```

- [ ] **Step 3: Commit Canvas Component implementation**
  ```bash
  git add web/src/views/chatV3/V3CanvasPane.tsx
  git commit -m "feat(canvas): complete V3CanvasPane renderer with sandbox and theme adapters"
  ```

---

### Task 4: [Integration & Layout] Register Tab in Right Dock and Implement Smooth Broaden Animation

**Files:**
*   Modify: `web/src/views/chatV3/V3RightDock.tsx`
*   Modify: `web/src/views/chatV3/V3ComposerBar.tsx` (wrap workspace with ArtifactProvider)

- [ ] **Step 1: Wrap Main App with Provider**
  Open the main entry file (`web/src/views/chatV3/V3ComposerBar.tsx` or its top wrapper layout) and enclose it within the `ArtifactProvider`:
  ```typescript
  import { ArtifactProvider } from './V3ArtifactContext';
  // ... inside ChatV3Layout renderer:
  return (
    <ArtifactProvider>
      {/* existing chat structures */}
    </ArtifactProvider>
  );
  ```

- [ ] **Step 2: Add Canvas Tab and Dynamic Auto-expand width in V3RightDock.tsx**
  Locate `V3RightDock.tsx` panel and append the Tab option:
  ```typescript
  import { useArtifact } from './V3ArtifactContext';
  import { V3CanvasPane } from './V3CanvasPane';
  
  // Inside V3RightDock element:
  const { canvasVisible, setCanvasVisible, activeArtifact } = useArtifact();
  
  // Dynamically change layout width in CSS when canvas is active
  const dockWidth = canvasVisible ? 650 : 400;
  
  // Add styling transition
  const transitionStyle = {
    width: dockWidth,
    transition: 'width 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
    zIndex: 1000
  };
  ```

- [ ] **Step 3: Commit Layout registrations and test run**
  ```bash
  git add web/src/views/chatV3/V3RightDock.tsx
  git commit -m "feat(canvas): integrate V3CanvasPane in right dock and support auto-broaden layout"
  ```
