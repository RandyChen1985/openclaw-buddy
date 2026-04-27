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
/** 尝试补全可能不完整的 JSON/JS 对象字符串（常见于 AI 流式输出过程） */
function autoFixOptionStr(str: string): string {
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;
  let stringChar = '';

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    // 处理各种引号的闭合
    if ((char === '"' || char === "'" || char === "`") && (!inString || char === stringChar)) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else {
        inString = false;
        stringChar = '';
      }
      continue;
    }
    if (!inString) {
      if (char === '{') openBraces++;
      if (char === '}') openBraces = Math.max(0, openBraces - 1);
      if (char === '[') openBrackets++;
      if (char === ']') openBrackets = Math.max(0, openBrackets - 1);
    }
  }

  let fixed = str;
  if (inString) fixed += stringChar; // 补全字符串
  // 按照闭合顺序反向补全
  if (openBrackets > 0) fixed += ']'.repeat(openBrackets);
  if (openBraces > 0) fixed += '}'.repeat(openBraces);
  
  return fixed;
}

export const ECharts = ({ optionStr, isTyping }: { optionStr: string, isTyping?: boolean }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [hasValidRender, setHasValidRender] = React.useState(false);

  // 初始化与销毁逻辑
  useEffect(() => {
    // 容器挂载后延迟初始化，确保宽高已计算
    const initChart = () => {
      if (chartRef.current && !chartInstanceRef.current) {
        chartInstanceRef.current = echarts.init(chartRef.current);
      }
    };

    const timer = setTimeout(initChart, 0);

    const resizeHandler = () => {
      chartInstanceRef.current?.resize();
    };
    window.addEventListener('resize', resizeHandler);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', resizeHandler);
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
    };
  }, []);

  // 配置更新逻辑
  useEffect(() => {
    if (!chartRef.current) return;
    
    // 如果尚未初始化（例如之前 display: none），尝试初始化
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }

    const trimmedStr = (optionStr || '').trim();
    if (!trimmedStr) return;

    // 尝试解析，如果失败则尝试补全后再解析
    const tryParse = (s: string) => {
      let content = s.trim();
      
      // 1. 尝试直接 JSON 解析
      try {
        return JSON.parse(content);
      } catch (e) {}

      // 2. 预处理：剥离常见的 JS 前缀 (LLM 经常会多吐这些)
      content = content.replace(/^(export\s+default\s+|module\.exports\s*=\s*|(const|let|var)\s+\w+\s*=\s*)/, '');
      content = content.replace(/;$/, '');

      // 3. 尝试使用 Function 解析（处理带注释、单引号、无引号 Key 等）
      try {
        const wrappedStr = (content.startsWith('{') || content.startsWith('[')) ? `return (${content})` : `return ${content}`;
        const fn = new Function(wrappedStr);
        return fn();
      } catch (e2) {
        // 4. 提取：如果包含多余文本，尝试提取第一个 { 或 [ 到最后一个 } 或 ] 之间的内容
        const firstIdx = Math.min(
          content.indexOf('{') === -1 ? Infinity : content.indexOf('{'),
          content.indexOf('[') === -1 ? Infinity : content.indexOf('[')
        );
        const lastIdx = Math.max(content.lastIndexOf('}'), content.lastIndexOf(']'));
        
        if (firstIdx !== Infinity && lastIdx !== -1 && lastIdx > firstIdx) {
          const extracted = content.substring(firstIdx, lastIdx + 1);
          try {
            const fn2 = new Function(`return (${extracted})`);
            return fn2();
          } catch (e3) {}
        }
        return null;
      }
    };

    let option = tryParse(trimmedStr);
    
    // 如果直接解析失败，尝试补全（即使非正在输入状态，最后的输出也可能由于 token 截断导致不完整）
    if (!option) {
      const fixedStr = autoFixOptionStr(trimmedStr);
      if (fixedStr !== trimmedStr) {
        option = tryParse(fixedStr);
      }
    }

    if (option && typeof option === 'object') {
      try {
        chartInstanceRef.current?.setOption(option, true);
        setError(null);
        setHasValidRender(true);
      } catch (renderErr: any) {
        // 如果渲染过程报错（可能是补全出的配置逻辑不对），仅在非输入状态展示
        if (!isTyping) {
          setError(renderErr.message || '图表渲染失败');
        }
      }
    } else {
      // 无法解析的情况
      if (!isTyping) {
        setError('配置解析失败，请检查格式');
      }
    }
  }, [optionStr, isTyping]);

  return (
    <div className="v3-echarts-container" style={{ 
      margin: '16px 0', 
      padding: '12px',
      background: '#fff', 
      borderRadius: '16px', 
      border: '1px solid #eef2ff',
      boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
      position: 'relative',
      minHeight: '200px',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* 顶部标题栏（可选） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '0 4px' }}>
        <BarChart3 size={14} color="#6366f1" />
        <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
          Data Visualization {isTyping && '· Generating...'}
        </span>
      </div>

      {/* 加载占位符：仅在从未渲染成功过且正在生成时显示 */}
      {isTyping && !hasValidRender && !error && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '40px 0' }}>
          <div className="v3-loading-spinner" style={{ width: 24, height: 24, border: '3px solid #eef2ff', borderTop: '3px solid #6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
          <span style={{ fontSize: 13, color: '#94a3b8' }}>正在解析图表配置...</span>
        </div>
      )}

      {/* 错误提示 */}
      {error && !isTyping && (
        <div style={{ margin: '20px', padding: '12px', color: '#ef4444', fontSize: '12px', border: '1px dashed #fecaca', borderRadius: '12px', background: '#fef2f2', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BarChart3 size={16} />
          <span>ECharts 渲染错误: {error}</span>
        </div>
      )}

      {/* 图表实体：始终存在，但由 visibility 控制 */}
      <div 
        ref={chartRef} 
        style={{ 
          width: '100%', 
          height: '320px',
          visibility: (hasValidRender && !error) ? 'visible' : 'hidden',
          position: (hasValidRender && !error) ? 'relative' : 'absolute',
          opacity: (hasValidRender && !error) ? 1 : 0,
          transition: 'opacity 0.3s'
        }} 
      />
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
