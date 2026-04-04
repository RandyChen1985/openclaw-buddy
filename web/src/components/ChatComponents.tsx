import React, { useEffect, useRef } from 'react';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import mermaid from 'mermaid';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

// --- Mermaid Component ---
export const Mermaid = ({ chart }: { chart: string }) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && chart) {
      mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'loose' });
      mermaid.contentLoaded();
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
      mermaid.render(id, chart).then(({ svg }) => {
        if (ref.current) ref.current.innerHTML = svg;
      }).catch(err => {
        if (ref.current) ref.current.innerHTML = `<div style="color: #ef4444; font-size: 12px; padding: 10px; border: 1px dashed #fecaca; border-radius: 8px;">${t('chat.mermaidError')}: ${err.message}</div>`;
      });
    }
  }, [chart, t]);
  return <div ref={ref} style={{ margin: '12px 0', overflowX: 'auto', display: 'flex', justifyContent: 'center' }} />;
};

// --- Code Block Component ---
export const CodeBlock = ({ language, value, isMobile }: { language: string, value: string, isMobile?: boolean }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ 
      position: 'relative', 
      margin: isMobile ? '8px 0' : '14px 0', 
      borderRadius: 12, 
      overflow: 'hidden', 
      border: '1px solid rgba(0,0,0,0.05)', 
      boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' 
    }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        background: '#1e293b', 
        padding: '6px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.05)'
      }}>
        <span style={{ color: '#94a3b8', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{language}</span>
        <Button 
          type="text" 
          size="small" 
          onClick={handleCopy}
          icon={copied ? <Check size={12} color="#10b981" /> : <Copy size={12} color="#94a3b8" />}
          style={{ height: 24, fontSize: 11, color: copied ? '#10b981' : '#94a3b8', background: 'rgba(255,255,255,0.05)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4 }}
        >
          {copied ? t('chat.copySuccess') : t('chat.copy')}
        </Button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: isMobile ? '10px' : '16px',
          fontSize: isMobile ? '12px' : '13px',
          background: '#0f172a'
        }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
};
