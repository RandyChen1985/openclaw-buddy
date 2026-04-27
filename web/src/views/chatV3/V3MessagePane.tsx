import React, { useMemo, useRef, useState } from 'react';
import { Spin } from 'antd';
import { Virtuoso } from 'react-virtuoso';
import type { VirtuosoHandle } from 'react-virtuoso';
import { Plus } from 'lucide-react';
import type { Message } from '../../hooks/useChatV3WebSocket';
import V3MessageItem from '../../components/Chat/V3MessageItem';

export interface V3MessagePaneProps {
  t: any;
  isMobile: boolean;
  messages: Message[];
  isTyping: boolean;
  showThinking: boolean;
  isStalled: boolean;
  isLoadingHistory: boolean;
  tpsData: number[];
  selectedBot: string;

  // refs
  scrollRef: React.RefObject<HTMLDivElement>;
  virtuosoRef: React.RefObject<VirtuosoHandle>;
  inputAreaRef: React.RefObject<any>;

  // empty state renderer
  emptyState: React.ReactNode;

  // scrolling state (由父组件持有，用于驱动浮动按钮与消息层滚动 ref)
  scrollState: {
    showScrollBtnRef: React.MutableRefObject<boolean>;
    setShowScrollBtn: (val: boolean) => void;
    showScrollTopBtn: boolean;
    setShowScrollTopBtn: (val: boolean) => void;
    setHasNewMessages: (val: boolean) => void;
  };

  // message actions
  editingMsgIndex: number | null;
  editContent: string;
  setEditContent: (val: string) => void;
  onEdit: (idx: number, content: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: (idx: number) => void;
  onQuote: (content: string) => void;
  onSend: (text: string, files?: any[]) => void;
  onRegenerate: () => void;
  copyToClipboard: (text: string) => void;
}

/**
 * v3 消息面板：承载 Virtuoso 列表、历史加载遮罩、拖拽上传遮罩、以及滚动状态回调。
 *
 * 说明：
 * - 该组件内部管理拖拽状态，并在 drop 时调用 `inputAreaRef.current.uploadFiles(files)`
 * - 滚动状态（是否到底/是否显示返回顶部）由父组件维护，以便与浮动按钮保持一致
 */
export function V3MessagePane({
  t,
  isMobile,
  messages,
  isTyping,
  showThinking,
  isStalled,
  isLoadingHistory,
  tpsData,
  selectedBot,
  scrollRef,
  virtuosoRef,
  inputAreaRef,
  emptyState,
  scrollState,
  editingMsgIndex,
  editContent,
  setEditContent,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onQuote,
  onSend,
  onRegenerate,
  copyToClipboard
}: V3MessagePaneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // _uiMetaOnly 气泡不再作为独立消息渲染，改为嵌入到同 runId 主气泡的底部。
  // 同时过滤掉系统自动生成的哨兵提示词、心跳提示词以及对应的 HEARTBEAT_OK 回复。
  const visibleMessages = useMemo(
    () => messages.filter(m => {
      // 1. 过滤内部 meta 消息
      if ((m as any)._uiMetaOnly) return false;

      const content = (m.content || '').trim();
      
      // 2. 过滤系统注入的提示词 (role: user)
      if (m.role === 'user') {
        // 匹配 "System:" 或 "System (untrusted):" 等前缀
        if (/^System\s*(\(.*\))?:/.test(content)) return false;
        
        // 匹配心跳指令
        if (content.includes('Read HEARTBEAT.md if it exists')) return false;
        
        // 匹配异步命令完成提示
        if (content.includes('An async command you ran earlier has completed')) return false;

        // 匹配纯时间戳提示行
        if (content.startsWith('Current time:')) return false;
      }

      // 3. 过滤系统心跳确认 (role: assistant)
      if (m.role === 'assistant') {
        if (content === 'HEARTBEAT_OK') return false;
      }

      return true;
    }),
    [messages],
  );

  // 按 runId 聚合 meta 气泡 content（showThinking 关闭时不传，实现整体隐藏）
  const metaContentByRunId = useMemo(() => {
    const map = new Map<string, string>();
    if (!showThinking) return map;
    for (const m of messages) {
      if (!(m as any)._uiMetaOnly) continue;
      if (!m.runId || !m.content) continue;
      map.set(m.runId, m.content);
    }
    return map;
  }, [messages, showThinking]);

  // 主气泡"已开始吐字正文"的 runId 集合：meta 折叠区据此自动折叠。
  // 判定：同 runId 的主气泡 content 非空、非思考占位、非纯手动停止标签。
  const thinkingLabel = t('chat.thinking');
  const deepThinkingLabel = t('chat.deepThinking', { defaultValue: '深度思考中...' });
  const stoppedLabel = t('chat.manuallyStopped', { defaultValue: '已手动停止' });
  const runIdsWithTranscript = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) {
      if ((m as any)._uiMetaOnly) continue;
      if (m.role !== 'assistant' || !m.runId) continue;
      const c = (m.content || '').trim();
      if (!c) continue;
      if (c === thinkingLabel || c === deepThinkingLabel) continue;
      if (c === stoppedLabel || c === `(${stoppedLabel})`) continue;
      set.add(m.runId);
    }
    return set;
  }, [messages, thinkingLabel, deepThinkingLabel, stoppedLabel]);

  const virtuosoComponents = useMemo(() => ({
    Scroller: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
      <div
        ref={(el) => {
          if (typeof ref === 'function') ref(el);
          else if (ref) (ref as any).current = el;
          (scrollRef as any).current = el;
        }}
        {...props}
        style={{ ...(props.style || {}), overflowX: 'hidden' }}
      />
    ))
  }), [scrollRef]);

  /**
   * 处理拖拽进入：显示遮罩并计数，避免子元素触发 leave 造成闪烁。
   */
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  /**
   * 处理拖拽离开：计数归零时关闭遮罩。
   */
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  /**
   * 处理拖拽悬停：允许 drop。
   */
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  /**
   * 处理 drop：上传文件并关闭遮罩。
   */
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && inputAreaRef.current) {
      inputAreaRef.current.uploadFiles(files);
    }
  };

  return (
    <div
      ref={scrollRef}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{ flex: 1, position: 'relative', width: '100%', overflow: 'hidden' }}
    >
      {isDragging && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(79, 70, 229, 0.08)',
          backdropFilter: 'blur(4px)',
          border: '3px dashed #6366f1',
          borderRadius: 16,
          zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 12,
          pointerEvents: 'none',
          animation: 'v3-fade-in 0.2s'
        }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Plus size={32} color="#4f46e5" />
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#4f46e5' }}>
            {t('chat.dropToUpload', { defaultValue: '松开即可上传文件' })}
          </span>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            {t('chat.dropHint', { defaultValue: '支持图片、文档等文件类型' })}
          </span>
        </div>
      )}

      {isLoadingHistory && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(248, 250, 252, 0.85)',
          backdropFilter: 'blur(4px)',
          zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 12,
          animation: 'v3-fade-in 0.2s'
        }}>
          <Spin size="large" />
          <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>
            {t('chat.loadingHistory', { defaultValue: '加载会话历史...' })}
          </span>
        </div>
      )}

      {visibleMessages.length === 0 && !isLoadingHistory ? (
        emptyState
      ) : !isLoadingHistory ? (
        <Virtuoso
          ref={virtuosoRef as any}
          data={visibleMessages}
          overscan={200}
          followOutput={(isAtBottom) => isAtBottom ? (isTyping ? 'auto' : 'smooth') : false}
          atBottomStateChange={(atBottom) => {
            // 到底/离底：同步浮动按钮与消息层滚动 ref
            scrollState.setShowScrollBtn(!atBottom);
            scrollState.showScrollBtnRef.current = !atBottom;
            if (atBottom) scrollState.setHasNewMessages(false);
          }}
          isScrolling={(scrolling) => {
            if (!scrolling && scrollRef.current) {
              const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;

              // 滚动停止时做一次“双重校验”，确保按钮显示状态绝对正确
              const isActuallyAtBottom = scrollHeight - scrollTop - clientHeight < 20;
              if (isActuallyAtBottom) {
                scrollState.setShowScrollBtn(false);
                scrollState.showScrollBtnRef.current = false;
                scrollState.setHasNewMessages(false);
              } else {
                scrollState.setShowScrollBtn(true);
                scrollState.showScrollBtnRef.current = true;
              }

              // 只要向下滚动超过阈值就显示返回顶部
              const shouldShowTop = scrollTop > 400;
              if (scrollState.showScrollTopBtn !== shouldShowTop) {
                scrollState.setShowScrollTopBtn(shouldShowTop);
              }
            }
          }}
          style={{ flex: 1, width: '100%' }}
          components={virtuosoComponents}
          itemContent={(index, msg) => {
            // visibleMessages 可能是 messages 的过滤子集，映射回原索引以便 onDelete/onEdit 正确定位
            const realIndex = messages.indexOf(msg);
            const isMetaMsg = !!(msg as any)._uiMetaOnly;
            const mainHasTranscript = isMetaMsg
              ? !!msg.runId && runIdsWithTranscript.has(msg.runId)
              : !!msg.runId && runIdsWithTranscript.has(msg.runId);
            // 本气泡是主气泡时，把同 runId 的 meta 内容"借"过来，渲染在正文最底部
            const metaContent = !isMetaMsg && msg.runId ? metaContentByRunId.get(msg.runId) : undefined;
            return (
              <div style={{ padding: isMobile ? '0 12px' : '0 24px', paddingTop: index === 0 ? (isMobile ? 12 : 24) : 0, paddingBottom: 20 }}>
                <V3MessageItem
                  key={(msg as any).id || realIndex}
                  msg={msg as any}
                  index={realIndex !== -1 ? realIndex : index}
                  isMobile={!!isMobile}
                  showThinking={showThinking}
                  selectedBot={selectedBot}
                  editingMsgIndex={editingMsgIndex}
                  editContent={editContent}
                  setEditContent={setEditContent}
                  onEdit={(idx, content) => onEdit(idx, content)}
                  onSaveEdit={onSaveEdit}
                  onCancelEdit={onCancelEdit}
                  onDelete={(idx) => onDelete(idx)}
                  onQuote={onQuote}
                  onSend={onSend}
                  onRegenerate={onRegenerate}
                  copyToClipboard={copyToClipboard}
                  isTyping={isTyping}
                  isLast={index === visibleMessages.length - 1}
                  isStalled={isStalled}
                  tpsData={tpsData}
                  mainHasTranscript={mainHasTranscript}
                  metaContent={metaContent}
                  t={t}
                />
              </div>
            );
          }}
        />
      ) : null}
    </div>
  );
}

