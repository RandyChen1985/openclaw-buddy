import React, { useState, useMemo } from 'react';
import { Input, Button, Upload, message, Tooltip } from 'antd';
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

interface V3InputAreaProps {
  status: string;
  isMobile: boolean;
  isTyping: boolean;
  onSend: (text: string, files?: FileInfo[]) => void;
  onStop: () => void;
  t: any;
  isComposing: boolean;
  setIsComposing: (val: boolean) => void;
  isFocused: boolean;
  setIsFocused: (val: boolean) => void;
  selectedBot: string;
}

const V3InputArea: React.FC<V3InputAreaProps> = ({ 
  status, isMobile, isTyping, onSend, onStop, t, isComposing, setIsComposing, setIsFocused, selectedBot
}) => {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [uploading, setUploading] = useState(false);

  const handleInnerSend = () => {
    if ((!text.trim() && files.length === 0) || status !== 'authenticated' || isTyping || uploading) return;
    onSend(text, files);
    setText('');
    setFiles([]);
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  // 优化 2 & 3: 提取状态逻辑，减少渲染开销
  const canSend = useMemo(() => {
    return status === 'authenticated' && (isTyping || text.trim().length > 0 || files.length > 0) && !uploading;
  }, [status, isTyping, text, files, uploading]);

  const buttonStyle = useMemo(() => {
    const disabled = status !== 'authenticated' || (!isTyping && !text.trim() && files.length === 0) || uploading;
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
  }, [isTyping, text, status, isMobile, files, uploading]);

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
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
                <img src={file.url} alt={file.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
            action={`${getBaseURL()}/v1/openclaw/chat/upload`}
            data={{ botId: selectedBot.replace('openclaw:', '') }}
            headers={{
              Authorization: `Bearer ${storage.getItem('guardian_token')}`
            }}
            showUploadList={false}
            disabled={uploading || isTyping}
            onChange={(info) => {
              if (info.file.status === 'uploading') {
                setUploading(true);
              }
              if (info.file.status === 'done') {
                setUploading(false);
                const res = info.file.response;
                if (res && res.code === 200) {
                  setFiles(prev => [...prev, res.data]);
                } else {
                  message.error(res?.message || 'Upload failed');
                }
              } else if (info.file.status === 'error') {
                setUploading(false);
                message.error(`${info.file.name} upload failed.`);
              }
            }}
          >
            <Tooltip title={
              uploading ? t('chat.uploading', { defaultValue: '正在上传...' }) : 
              isTyping ? t('chat.responding', { defaultValue: '回复中...' }) : 
              t('chat.uploadFile', { defaultValue: '上传文件' })
            }>
              <Button 
                type="text" 
                icon={<Paperclip size={18} />} 
                disabled={uploading || isTyping}
                style={{ 
                  color: (uploading || isTyping) ? '#cbd5e1' : '#94a3b8', 
                  borderRadius: 10, 
                  height: 36, width: 36, 
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: (uploading || isTyping) ? 0.5 : 1
                }} 
              />
            </Tooltip>
          </Upload>
        </div>

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
    </div>
  );
};

// 优化 3: 严格的重绘控制
export default React.memo(V3InputArea, (prev, next) => {
  return prev.status === next.status &&
         prev.isMobile === next.isMobile &&
         prev.isTyping === next.isTyping &&
         prev.isComposing === next.isComposing &&
         prev.isFocused === next.isFocused &&
         prev.selectedBot === next.selectedBot;
});
