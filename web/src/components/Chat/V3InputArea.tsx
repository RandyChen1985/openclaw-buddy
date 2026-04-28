import React, { useState, useMemo, useImperativeHandle, forwardRef, useRef } from 'react';
import { Input, Button, Upload, message } from 'antd';
import { Send, Square, Paperclip, X, FileText, Loader2 } from 'lucide-react';
import storage from '../../utils/storage';
import { getBaseURL } from '../../utils/url';

interface FileInfo {
  url: string;
  thumbUrl?: string;
  path: string;
  filename: string;
  size: number;
  ext: string;
}

export interface InputAreaHandle {
  addFiles: (files: FileInfo[]) => void;
  uploadFiles: (files: File[]) => Promise<void>;
  focus: () => void;
  setValue: (val: string | ((prev: string) => string)) => void;
}

interface V3InputAreaProps {
  status: string;
  isMobile: boolean;
  isTyping: boolean;
  /** 与 isTyping 类似锁定发送，但不切换为「停止」按钮（如新会话 sessions.create 进行中） */
  sessionComposeBlocked?: boolean;
  onSend: (text: string, files?: FileInfo[]) => void;
  onStop: () => void;
  t: any;
  isComposing: boolean;
  setIsComposing: (val: boolean) => void;
  isFocused: boolean;
  setIsFocused: (val: boolean) => void;
  selectedBot: string;
}

const V3InputAreaInner: React.ForwardRefRenderFunction<InputAreaHandle, V3InputAreaProps> = ({ 
  status, isMobile, isTyping, sessionComposeBlocked = false, onSend, onStop, t, isComposing, setIsComposing, isFocused, setIsFocused, selectedBot
}, ref) => {
  const inputLocked = isTyping || sessionComposeBlocked;
  const [text, setText] = useState('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [uploading, setUploading] = useState(false);
  const textAreaRef = useRef<any>(null);

  /**
   * 统一上传入口：拖拽上传与点击上传都走该方法，避免两套上传逻辑长期漂移。
   */
  const uploadRawFiles = async (rawFiles: File[]) => {
    if (!rawFiles || rawFiles.length === 0) return;
    setUploading(true);
    try {
      const results = await Promise.all(rawFiles.map(async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('botId', selectedBot.replace('openclaw:', ''));
        
        const response = await fetch(`${getBaseURL()}/v1/openclaw/chat/upload`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${storage.getItem('guardian_token')}`
          },
          body: formData
        });
        const res = await response.json();
        if (res.code === 200) return res.data;
        throw new Error(res.message || t('chat.uploadFailed'));
      }));
      setFiles(prev => [...prev, ...results]);
    } catch (err: any) {
      message.error(err.message || t('chat.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  // 暴露方法给外部
  useImperativeHandle(ref, () => ({
    addFiles: (newFiles: FileInfo[]) => {
      setFiles(prev => [...prev, ...newFiles]);
    },
    uploadFiles: async (rawFiles: File[]) => uploadRawFiles(rawFiles),
    focus: () => {
      textAreaRef.current?.focus();
    },
    setValue: (val: string | ((prev: string) => string)) => {
      setText(val);
    }
  }), [selectedBot]);

  const handleInnerSend = () => {
    if ((!text.trim() && files.length === 0) || status !== 'authenticated' || inputLocked || uploading) return;
    onSend(text, files);
    setText('');
    setFiles([]);
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  // 优化 2 & 3: 提取状态逻辑，减少渲染开销
  const canSend = useMemo(() => {
    return status === 'authenticated' && (isTyping || text.trim().length > 0 || files.length > 0) && !uploading && !sessionComposeBlocked;
  }, [status, isTyping, text, files, uploading, sessionComposeBlocked]);

  const buttonStyle = useMemo(() => {
    const disabled = status !== 'authenticated' || (!isTyping && !text.trim() && files.length === 0) || uploading || sessionComposeBlocked;
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
  }, [isTyping, text, status, isMobile, files, uploading, sessionComposeBlocked]);

  return (
    <div className={`v3-input-wrapper ${isFocused ? 'focused' : ''}`} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
      {/* 文件预览区域 */}
      {(files.length > 0 || uploading) && (
        <div style={{ 
          display: 'flex', 
          flexWrap: 'wrap', 
          gap: 8, 
          padding: '8px 16px', 
          background: 'rgba(248, 250, 252, 0.5)', 
          borderTop: '1px solid #f1f5f9',
          maxHeight: 120,
          overflowY: 'auto'
        }}>
          {files.map((file, idx) => (
            <div key={idx} style={{ 
              position: 'relative', 
              width: 60, 
              height: 60, 
              borderRadius: 8, 
              border: '1px solid #e2e8f0',
              background: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
            }}>
              {file.ext.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) ? (
                <img src={file.thumbUrl || file.url} alt={file.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <FileText size={20} color="#64748b" />
                  <span style={{ fontSize: 9, color: '#94a3b8', maxWidth: 50, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.filename}
                  </span>
                </div>
              )}
              <button 
                onClick={() => removeFile(idx)}
                style={{ 
                  position: 'absolute', top: 2, right: 2, 
                  background: 'rgba(0,0,0,0.4)', color: '#fff', 
                  border: 'none', borderRadius: '50%', 
                  width: 16, height: 16, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0
                }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
          {uploading && (
            <div style={{ 
              width: 60, 
              height: 60, 
              borderRadius: 8, 
              border: '1px dashed #3b82f6',
              background: '#eff6ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Loader2 size={20} className="animate-spin" color="#3b82f6" />
            </div>
          )}
        </div>
      )}

      <div style={{ width: '100%', display: 'flex', alignItems: 'flex-end', gap: 8, padding: isMobile ? '4px 12px 8px' : '8px 16px 16px', boxSizing: 'border-box' }}>
        <div style={{ flexShrink: 0, marginBottom: 2 }}>
          <Upload
            name="file"
            multiple
            showUploadList={false}
            disabled={uploading || inputLocked}
            beforeUpload={(file) => {
              uploadRawFiles([file]);
              return false;
            }}
          >
              <Button 
                type="text" 
                icon={<Paperclip size={18} />} 
                disabled={uploading || inputLocked}
                style={{ 
                  color: (uploading || inputLocked) ? '#cbd5e1' : '#94a3b8', 
                  borderRadius: 10, 
                  height: 36, width: 36, 
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: (uploading || inputLocked) ? 0.5 : 1
                }} 
              />
          </Upload>
        </div>

        <div style={{ flex: 1, position: 'relative' }}>
          <Input.TextArea
            ref={textAreaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            // 优化 4: 回归原生占位符，移除模拟光标和额外层
            placeholder={
              status !== 'authenticated' ? t('chat.v3Connecting') : 
              sessionComposeBlocked ? t('chat.sessionPreparing', { defaultValue: '正在准备新会话…' }) :
              isTyping ? (t('chat.aiGeneratingPlaceholder') || t('chat.thinking')) : 
              uploading ? t('chat.fileUploadingPlaceholder') :
              t('chat.v3InputPlaceholder')
            }
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
            disabled={status !== 'authenticated' || inputLocked || uploading}
            variant="borderless"
            style={{ padding: '4px 0', fontSize: 13, opacity: inputLocked ? 0.6 : 1, minHeight: 32 }}
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
    </div>
  );
};

// 优化 3: 严格的重绘控制
const V3InputArea = React.memo(forwardRef(V3InputAreaInner), (prev, next) => {
  return prev.status === next.status &&
         prev.isMobile === next.isMobile &&
         prev.isTyping === next.isTyping &&
         prev.sessionComposeBlocked === next.sessionComposeBlocked &&
         prev.isComposing === next.isComposing &&
         prev.isFocused === next.isFocused &&
         prev.selectedBot === next.selectedBot;
});

export default V3InputArea;
