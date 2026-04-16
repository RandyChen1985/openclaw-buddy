import { Button } from 'antd';
import { Activity, ChevronDown, ChevronUp } from 'lucide-react';

export interface V3FloatingButtonsProps {
  t: any;
  isMobile: boolean;
  showScrollTopBtn: boolean;
  showScrollBottomBtn: boolean;
  hasNewMessages: boolean;
  onScrollTop: () => void;
  onScrollBottom: () => void;
}

/**
 * v3 浮动按钮：返回顶部 / 返回底部（含新消息提示）。
 *
 * 说明：该组件只渲染与触发回调，显示状态由父组件决定。
 */
export function V3FloatingButtons({
  t,
  isMobile,
  showScrollTopBtn,
  showScrollBottomBtn,
  hasNewMessages,
  onScrollTop,
  onScrollBottom
}: V3FloatingButtonsProps) {
  return (
    <>
      {showScrollTopBtn && (
        <div style={{ position: 'absolute', top: isMobile ? 70 : 80, right: isMobile ? 16 : 24, zIndex: 100, animation: 'v3-fade-in 0.3s' }}>
          <Button
            className="v3-floating-btn"
            shape="circle"
            onClick={onScrollTop}
            icon={<ChevronUp size={16} />}
            style={{
              height: 36,
              width: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#64748b',
              background: 'rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(0,0,0,0.05)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}
          />
        </div>
      )}

      {showScrollBottomBtn && (
        <div style={{ position: 'absolute', bottom: isMobile ? 170 : 210, right: isMobile ? 16 : 24, zIndex: 100, animation: 'v3-fade-in 0.3s' }}>
          <Button
            className={`v3-floating-btn ${hasNewMessages ? 'v3-floating-btn-active' : ''}`}
            shape="round"
            onClick={onScrollBottom}
            icon={hasNewMessages ? <Activity size={14} className="animate-pulse" /> : <ChevronDown size={14} />}
            style={{
              height: 32,
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: hasNewMessages ? '0 12px' : '0 10px',
              background: hasNewMessages ? '#2563eb' : '#fff',
              color: hasNewMessages ? '#fff' : '#64748b',
              border: hasNewMessages ? 'none' : '1px solid #e2e8f0',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              transition: 'all 0.2s'
            }}
          >
            {hasNewMessages && t('chat.newMessages')}
          </Button>
        </div>
      )}
    </>
  );
}

