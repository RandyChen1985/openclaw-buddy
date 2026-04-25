import React, { useEffect, useRef } from 'react';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { Check, Copy, BarChart3 } from 'lucide-react';
import mermaid from 'mermaid';
import * as echarts from 'echarts';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

/** Markdown 围栏语言：识别为 ECharts option（与网关/模型常用 ` ```chart ` 对齐） */
export function isEchartsCodeFenceLanguage(language: string): boolean {
  const l = (language || '').toLowerCase();
  return l === 'echarts' || l === 'chart';
}

// --- ECharts Component ---
export const ECharts = ({ optionStr, isTyping }: { optionStr: string, isTyping?: boolean }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [error, setError] = React.useState<string | null>(null);

  useEffect(() => {
    if (chartRef.current) {
      let chartInstance: echarts.ECharts | null = null;
      try {
        chartInstance = echarts.init(chartRef.current);
        
        let option: any;
        const trimmedStr = optionStr.trim();
        
        try {
          option = JSON.parse(trimmedStr);
        } catch (e) {
          const wrappedStr = trimmedStr.startsWith('{') ? `return (${trimmedStr})` : `return ${trimmedStr}`;
          const fn = new Function(wrappedStr);
          option = fn();
        }
        
        if (option && typeof option === 'object') {
          chartInstance.setOption(option);
          setError(null);
        } else {
          throw new Error('解析结果不是有效的配置对象');
        }
        
        const resizeHandler = () => chartInstance?.resize();
        window.addEventListener('resize', resizeHandler);
        
        return () => {
          window.removeEventListener('resize', resizeHandler);
          chartInstance?.dispose();
        };
      } catch (err: any) {
        if (!isTyping) {
          console.error('ECharts parse error:', err);
          setError(err.message || '配置解析失败');
        }
        chartInstance?.dispose();
      }
    }
  }, [optionStr, isTyping]);

  return (
    <div style={{ 
      margin: '16px 0', 
      padding: '12px',
      background: '#fff', 
      borderRadius: '16px', 
      border: '1px solid #eef2ff',
      boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
      minHeight: (error || isTyping) ? 'auto' : '320px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center'
    }}>
      {isTyping && !error ? (
        <div style={{ padding: '40px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: '#6366f1' }}>
          <div className="v3-loading-spinner" style={{ width: 24, height: 24, border: '3px solid #eef2ff', borderTop: '3px solid #6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#64748b' }}>图表生成中...</span>
        </div>
      ) : error ? (
        <div style={{ color: '#ef4444', fontSize: '12px', padding: '20px', border: '1px dashed #fecaca', borderRadius: '12px', background: '#fef2f2', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BarChart3 size={16} />
          <span>ECharts 渲染错误: {error}</span>
        </div>
      ) : (
        <div ref={chartRef} style={{ width: '100%', height: '300px' }} />
      )}
    </div>
  );
};

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
          background: '#0f172a',
          overflowX: 'auto',
          maxWidth: '100%',
          WebkitOverflowScrolling: 'touch'
        }}
        codeTagProps={{
          style: {
            whiteSpace: 'pre',
            wordBreak: 'normal',
            overflowWrap: 'normal'
          }
        }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
};
