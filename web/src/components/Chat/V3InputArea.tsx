import React, { useState, useMemo } from 'react';
import { Input, Button } from 'antd';
import { Send, Square } from 'lucide-react';

interface V3InputAreaProps {
  status: string;
  isMobile: boolean;
  isTyping: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  t: any;
  isComposing: boolean;
  setIsComposing: (val: boolean) => void;
  isFocused: boolean;
  setIsFocused: (val: boolean) => void;
}

const V3InputArea: React.FC<V3InputAreaProps> = ({ 
  status, isMobile, isTyping, onSend, onStop, t, isComposing, setIsComposing, setIsFocused 
}) => {
  const [text, setText] = useState('');

  const handleInnerSend = () => {
    if (!text.trim() || status !== 'authenticated' || isTyping) return;
    onSend(text);
    setText('');
  };

  // 优化 2 & 3: 提取状态逻辑，减少渲染开销
  const canSend = useMemo(() => {
    return status === 'authenticated' && (isTyping || text.trim().length > 0);
  }, [status, isTyping, text]);

  const buttonStyle = useMemo(() => {
    const disabled = status !== 'authenticated' || (!isTyping && !text.trim());
    if (disabled) {
      return {
        width: isMobile ? 36 : 40, height: isMobile ? 36 : 40, borderRadius: 12,
        background: '#e2e8f0', border: 'none', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#94a3b8', transition: 'all 0.2s'
      };
    }
    
    return {
      width: isMobile ? 36 : 40, height: isMobile ? 36 : 40, borderRadius: 12,
      background: isTyping ? '#ef4444' : '#2563eb', 
      border: 'none', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: isTyping ? '0 4px 12px rgba(239,68,68,0.25)' : '0 4px 12px rgba(37,99,235,0.25)',
      transition: 'all 0.2s',
      color: '#fff'
    };
  }, [isTyping, text, status, isMobile]);

  return (
    <div style={{ width: '100%', display: 'flex', alignItems: 'flex-end', gap: 8, padding: isMobile ? '4px 12px 8px' : '8px 16px 16px', position: 'relative' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <Input.TextArea
          value={text}
          onChange={e => setText(e.target.value)}
          // 优化 4: 回归原生占位符，移除模拟光标和额外层
          placeholder={status === 'authenticated' ? t('chat.v3InputPlaceholder') : t('chat.v3Connecting')}
          // 优化 1: 保持 autoSize 但精简配置
          autoSize={{ minRows: 1, maxRows: 6 }}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
              e.preventDefault();
              handleInnerSend();
            }
          }}
          disabled={status !== 'authenticated' || isTyping}
          variant="borderless"
          style={{ padding: '4px 0', fontSize: 13, opacity: isTyping ? 0.6 : 1, minHeight: 32 }}
        />
      </div>
      <Button
        type="primary"
        icon={isTyping ? <Square size={16} fill="#fff" /> : <Send size={17} />}
        onClick={isTyping ? onStop : handleInnerSend}
        disabled={!canSend}
        style={buttonStyle as React.CSSProperties}
      />
    </div>
  );
};

// 优化 3: 严格的重绘控制
export default React.memo(V3InputArea, (prev, next) => {
  return prev.status === next.status &&
         prev.isMobile === next.isMobile &&
         prev.isTyping === next.isTyping &&
         prev.isComposing === next.isComposing &&
         prev.isFocused === next.isFocused;
});
