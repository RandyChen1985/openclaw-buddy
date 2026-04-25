import React from 'react';
import { estimateTokens } from '../utils/token';

interface TokenBadgeProps {
  text: string;
  style?: React.CSSProperties;
}

const TokenBadge: React.FC<TokenBadgeProps> = ({ text, style }) => {
  const count = estimateTokens(text);
  
  if (count === 0) return null;

  return (
    <div 
      style={{
        position: 'absolute',
        top: 8,
        right: 12,
        zIndex: 10,
        background: 'rgba(255, 255, 255, 0.8)',
        backdropFilter: 'blur(4px)',
        padding: '2px 8px',
        borderRadius: '6px',
        fontSize: '11px',
        color: '#64748b',
        fontWeight: 600,
        border: '1px solid #e2e8f0',
        pointerEvents: 'none', // 允许点击穿透到下方的文本框
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
        ...style
      }}
    >
      <span style={{ 
        display: 'inline-block', 
        width: '6px', 
        height: '6px', 
        borderRadius: '50%', 
        background: count > 2000 ? '#f59e0b' : '#22c55e' 
      }} />
      <span>{count.toLocaleString()} Tokens</span>
    </div>
  );
};

export default TokenBadge;
