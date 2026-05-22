import React, { useState, useMemo, useImperativeHandle, forwardRef, useRef, useCallback } from 'react';
import {
  isWorkspaceFileDragEvent,
  parseWorkspaceDragItems,
  type WorkspaceDragItem,
} from '../../utils/workspaceDrag';
import { isDockPanelDragEvent } from '../../views/chatV3/v3RightDockLayout';
import { Input, Button, Upload, message, Dropdown } from 'antd';
import { Send, Square, X, FileText, Loader2, Plus, AtSign, Zap, Image } from 'lucide-react';
import storage from '../../utils/storage';
import { getBaseURL } from '../../utils/url';
import V3MentionSelector from './V3MentionSelector';
import type { MentionEntity } from './V3MentionSelector';
import type { FileInfo } from '../../hooks/useChatV3WebSocket';

export interface InputAreaHandle {
  addFiles: (files: FileInfo[]) => void;
  uploadFiles: (files: File[]) => Promise<void>;
  focus: () => void;
  setValue: (val: string | ((prev: string) => string)) => void;
}

interface V3InputAreaProps {
  status: string;
  isMobile: boolean;
  /** 与 App 全局暗色同步（输入区、附件条、实体 Chip） */
  isDarkMode?: boolean;
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
  supportsImage?: boolean;
  botsModels: any;
}

const V3InputAreaInner: React.ForwardRefRenderFunction<InputAreaHandle, V3InputAreaProps> = ({ 
  status, isMobile, isDarkMode = false, isTyping, sessionComposeBlocked = false, onSend, onStop, t, isComposing, setIsComposing, isFocused, setIsFocused, selectedBot, supportsImage = false, botsModels
}, ref) => {
  const inputLocked = isTyping || sessionComposeBlocked;
  const [text, setText] = useState('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [uploading, setUploading] = useState(false);
  const textAreaRef = useRef<any>(null);

  // 提及功能相关状态
  const [showMentionSelector, setShowMentionSelector] = useState(false);
  const [mentionSelectorTab, setMentionSelectorTab] = useState<'files' | 'dirs' | 'skills'>('files');
  const [workspacePathDropActive, setWorkspacePathDropActive] = useState(false);
  const workspacePathDropCounterRef = useRef(0);

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
      setFiles(prev => {
        const next = [...prev];
        let addedCount = 0;
        for (const nf of newFiles) {
          if (!next.some(f => f.entityId === nf.entityId || f.path === nf.path)) {
            next.push(nf);
            addedCount++;
          }
        }
        if (addedCount === 0 && newFiles.length > 0) {
          message.warning(t('chat.mentionAlreadyAdded', { defaultValue: '已添加该项' }));
        }
        return next;
      });
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
    
    // 增加拦截：如果包含图片但模型不支持，禁止发送
    if (hasImages && !supportsImage) return;

    onSend(text, files);
    setText('');
    setFiles([]);
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const workspaceItemToFileInfo = useCallback((item: WorkspaceDragItem): FileInfo => {
    const ext = item.is_dir ? 'dir' : (item.name.split('.').pop() || 'file');
    const isImage = !item.is_dir && Boolean(ext.match(/^(jpg|jpeg|png|gif|webp|svg)$/i));
    return {
      url:
        isImage
          ? `${getBaseURL()}/v1/openclaw/files/download?path=${encodeURIComponent(item.path)}&authorization=${encodeURIComponent(`Bearer ${storage.getItem('guardian_token')}`)}`
          : '',
      path: item.path,
      filename: item.name,
      size: item.size ?? 0,
      ext,
      type: isImage ? undefined : 'workspace_file',
      entityId: item.path,
    };
  }, []);

  const attachWorkspaceItems = useCallback(
    (items: WorkspaceDragItem[]) => {
      if (items.length === 0) return;

      setFiles(prev => {
        const next = [...prev];
        let added = 0;
        for (const item of items) {
          const info = workspaceItemToFileInfo(item);
          if (next.some(f => f.entityId === info.entityId || f.path === info.path)) continue;
          next.push(info);
          added += 1;
        }
        if (added > 0) {
          message.success(
            t('chat.mentionInserted', {
              defaultValue: added > 1 ? `已添加 ${added} 个附件` : '已添加附件',
            }),
          );
        } else if (items.length > 0) {
          message.warning(t('chat.mentionAlreadyAdded', { defaultValue: '已添加该项' }));
        }
        return next;
      });

      setTimeout(() => textAreaRef.current?.focus(), 50);
    },
    [t, workspaceItemToFileInfo],
  );

  const handleWorkspacePathDragEnter = useCallback((e: React.DragEvent) => {
    if (!isWorkspaceFileDragEvent(e) || isDockPanelDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    workspacePathDropCounterRef.current += 1;
    setWorkspacePathDropActive(true);
  }, []);

  const handleWorkspacePathDragLeave = useCallback((e: React.DragEvent) => {
    if (!isWorkspaceFileDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    workspacePathDropCounterRef.current -= 1;
    if (workspacePathDropCounterRef.current <= 0) {
      workspacePathDropCounterRef.current = 0;
      setWorkspacePathDropActive(false);
    }
  }, []);

  const handleWorkspacePathDragOver = useCallback((e: React.DragEvent) => {
    if (!isWorkspaceFileDragEvent(e) || isDockPanelDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleWorkspacePathDrop = useCallback(
    (e: React.DragEvent) => {
      if (!isWorkspaceFileDragEvent(e) || isDockPanelDragEvent(e)) return;
      e.preventDefault();
      e.stopPropagation();
      workspacePathDropCounterRef.current = 0;
      setWorkspacePathDropActive(false);
      const items = parseWorkspaceDragItems(e.dataTransfer);
      if (items) attachWorkspaceItems(items);
    },
    [attachWorkspaceItems],
  );

  const handleSelectMention = (entity: MentionEntity) => {
    if (files.some(f => f.entityId === entity.id || f.path === entity.id)) {
      message.warning(t('chat.mentionAlreadyAdded', { defaultValue: '已添加该项' }));
      setShowMentionSelector(false);
      return;
    }

    const isDir = Boolean(entity.is_dir);
    const ext = entity.type === 'skill' ? 'skill' : isDir ? 'dir' : (entity.label.split('.').pop() || 'file');
    const isImage = !isDir && Boolean(ext.match(/^(jpg|jpeg|png|gif|webp|svg)$/i));

    const newFile: FileInfo = {
      url:
        isImage && entity.type === 'workspace_file'
          ? `${getBaseURL()}/v1/openclaw/files/download?path=${encodeURIComponent(entity.id)}&authorization=${encodeURIComponent(`Bearer ${storage.getItem('guardian_token')}`)}`
          : '',
      path: entity.id,
      filename: entity.label,
      size: 0,
      ext,
      type: isImage ? undefined : entity.type,
      entityId: entity.id,
    };

    setFiles(prev => [...prev, newFile]);

    if (text.endsWith('@')) {
      setText(prev => prev.slice(0, -1));
    }

    setShowMentionSelector(false);
    setTimeout(() => textAreaRef.current?.focus(), 50);
  };

  // 优化 2 & 3: 提取状态逻辑，减少渲染开销
  const hasImages = useMemo(() => files.some(f => f.ext.replace(/^\./, '').match(/^(jpg|jpeg|png|gif|webp|svg)$/i) && !f.type), [files]);

  const canSend = useMemo(() => {
    const baseConditions = status === 'authenticated' && (isTyping || text.trim().length > 0 || files.length > 0) && !uploading && !sessionComposeBlocked;
    if (isTyping) return baseConditions; // 正在生成时，「停止」按钮必须可用
    
    // 如果包含图片，但当前模型不支持图片能力，则锁定发送
    if (hasImages && !supportsImage) return false;
    
    return baseConditions;
  }, [status, isTyping, text, files, uploading, sessionComposeBlocked, hasImages, supportsImage]);

  const buttonStyle = useMemo(() => {
    const disabled = !canSend;
    if (disabled) {
      return {
        width: isMobile ? 36 : 40, height: isMobile ? 36 : 40, borderRadius: 12,
        background: isDarkMode ? '#334155' : '#e2e8f0', border: 'none', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: isDarkMode ? '#64748b' : '#94a3b8', transition: 'all 0.2s'
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
  }, [isTyping, text, status, isMobile, files, uploading, sessionComposeBlocked, canSend, isDarkMode]);

  return (
    <div
      className={`v3-input-wrapper ${isFocused ? 'focused' : ''} ${isDarkMode ? 'v3-input-wrapper--dark' : ''}${workspacePathDropActive ? ' v3-input-wrapper--path-drop' : ''}`}
      style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 0, position: 'relative', overflow: 'visible' }}
      onDragEnter={handleWorkspacePathDragEnter}
      onDragLeave={handleWorkspacePathDragLeave}
      onDragOver={handleWorkspacePathDragOver}
      onDrop={handleWorkspacePathDrop}
    >
      
      {/* 提及选择器弹出层 */}
      {showMentionSelector && (
        <V3MentionSelector 
          selectedBot={selectedBot}
          botsModels={botsModels}
          t={t}
          initialTab={mentionSelectorTab}
          onSelect={handleSelectMention}
          onClose={() => {
            setShowMentionSelector(false);
            setTimeout(() => textAreaRef.current?.focus(), 50);
          }}
        />
      )}

      {/* 图像能力告警 */}
      {files.some(f => f.ext.replace(/^\./, '').match(/^(jpg|jpeg|png|gif|webp|svg)$/i) && !f.type) && !supportsImage && (
        <div style={{ 
          background: isDarkMode ? 'rgba(251, 191, 36, 0.12)' : '#fff7ed', 
          borderTop: isDarkMode ? '1px solid rgba(251, 191, 36, 0.35)' : '1px solid #ffedd5', 
          padding: '6px 16px', 
          display: 'flex', 
          alignItems: 'center', 
          gap: 8,
          animation: 'fadeIn 0.3s'
        }}>
          <div style={{ background: '#f59e0b', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={10} color="#fff" />
          </div>
          <span style={{ fontSize: 11, color: isDarkMode ? '#fcd34d' : '#9a3412', fontWeight: 500 }}>
            {t('chat.modelNoImageSupport', { defaultValue: '当前模型不支持图片，请切换到“图片型”模型后再发送。' })}
          </span>
        </div>
      )}
      
      {/* 文件预览区域 */}
      {(files.length > 0 || uploading) && (
        <div style={{ 
          display: 'flex', 
          flexWrap: 'wrap', 
          gap: 8, 
          padding: '8px 16px', 
          background: isDarkMode ? 'rgba(15, 23, 42, 0.65)' : 'rgba(248, 250, 252, 0.5)', 
          borderTop: isDarkMode ? '1px solid #334155' : '1px solid #f1f5f9',
          maxHeight: 120,
          overflowY: 'auto'
        }}>
          {files.map((file, idx) => (
            <div key={idx} style={{ 
              position: 'relative', 
              minWidth: 60,
              height: file.type ? 'auto' : 60,
              display: 'flex',
              alignItems: 'center',
            }}>
              {file.type ? (
                /* 实体徽标 (Chip) 样式 */
                <div className={`v3-entity-chip ${file.type === 'skill' ? 'skill' : ''}`}>
                  <div className="v3-entity-chip-icon">
                    {file.type === 'skill' ? <Zap size={14} /> : <FileText size={14} />}
                  </div>
                  <span className="v3-entity-chip-label" title={file.path}>{file.filename}</span>
                  <div className="v3-entity-chip-remove" onClick={() => removeFile(idx)}>
                    <X size={12} />
                  </div>
                </div>
              ) : (
                /* 传统文件预览样式 */
                <div style={{ 
                  position: 'relative', width: 60, height: 60, borderRadius: 8, border: isDarkMode ? '1px solid #334155' : '1px solid #e2e8f0', background: isDarkMode ? '#0f172a' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: isDarkMode ? 'none' : '0 2px 4px rgba(0,0,0,0.02)' 
                }}>
                  {file.ext.replace(/^\./, '').match(/^(jpg|jpeg|png|gif|webp|svg)$/i) ? (
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
              )}
            </div>
          ))}
          {uploading && (
            <div style={{ 
              width: 60, 
              height: 60, 
              borderRadius: 8, 
              border: isDarkMode ? '1px dashed #60a5fa' : '1px dashed #3b82f6',
              background: isDarkMode ? 'rgba(30, 58, 138, 0.35)' : '#eff6ff',
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
          <Dropdown
            trigger={['click']}
            disabled={uploading || inputLocked}
            overlayStyle={{ borderRadius: 12, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.15)' }}
            menu={{
              items: [
                {
                  key: 'upload',
                  label: (
                    <Upload
                      name="file"
                      multiple
                      showUploadList={false}
                      beforeUpload={(file) => {
                        uploadRawFiles([file]);
                        return false;
                      }}
                      style={{ width: '100%', display: 'block' }}
                    >
                      <div className="v3-plus-menu-item">
                        <div className="v3-plus-menu-icon"><Image size={16} /></div>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{t('chat.uploadMedia', { defaultValue: 'Media (上传文件)' })}</span>
                      </div>
                    </Upload>
                  ),
                },
                {
                  key: 'mentions',
                  label: (
                    <div className="v3-plus-menu-item" onClick={() => {
                      setMentionSelectorTab('files');
                      setShowMentionSelector(true);
                    }}>
                      <div className="v3-plus-menu-icon"><AtSign size={16} /></div>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{t('chat.mentions', { defaultValue: 'Mentions (@文件)' })}</span>
                    </div>
                  ),
                },
                {
                  key: 'skills',
                  label: (
                    <div className="v3-plus-menu-item" onClick={() => {
                      setMentionSelectorTab('skills');
                      setShowMentionSelector(true);
                    }}>
                      <div className="v3-plus-menu-icon"><Zap size={16} /></div>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{t('chat.workflows', { defaultValue: 'Workflows (技能)' })}</span>
                    </div>
                  ),
                },
              ]
            }}
          >
            <Button 
              type="text" 
              icon={<Plus size={20} />} 
              disabled={uploading || inputLocked}
              style={{ 
                color: (uploading || inputLocked)
                  ? (isDarkMode ? '#475569' : '#cbd5e1')
                  : (isDarkMode ? '#94a3b8' : '#64748b'), 
                borderRadius: 12, 
                height: 38, width: 38, 
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isDarkMode ? '#1e293b' : '#f1f5f9',
                border: isDarkMode ? '1px solid #334155' : 'none',
                opacity: (uploading || inputLocked) ? 0.5 : 1,
                transition: 'all 0.2s'
              }} 
            />
          </Dropdown>
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
              } else if (e.key === '@' && !isComposing) {
                // 仅当输入点位于首位，或前驱字符为空格时，方可呼出提及面板（规避邮箱等输入误触发）
                const selectionStart = e.currentTarget.selectionStart;
                const val = e.currentTarget.value;
                const isStart = selectionStart === 0;
                const isAfterSpace = selectionStart > 0 && val.charAt(selectionStart - 1) === ' ';
                if (isStart || isAfterSpace) {
                  setMentionSelectorTab('files');
                  setShowMentionSelector(true);
                }
              }
            }}
            onPaste={async (e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              
              const imageFiles: File[] = [];
              for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                  const file = items[i].getAsFile();
                  if (file) imageFiles.push(file);
                }
              }
              
              if (imageFiles.length > 0) {
                // 💡 发现图片，阻止默认粘贴行为（避免在文本框出现 [object File] 或重复文本），触发自动上传
                e.preventDefault();
                await uploadRawFiles(imageFiles);
              }
            }}
            disabled={status !== 'authenticated' || inputLocked || uploading}
            variant="borderless"
            style={{
              padding: '4px 0',
              fontSize: 13,
              opacity: inputLocked ? 0.6 : 1,
              minHeight: 32,
              color: isDarkMode ? '#e2e8f0' : undefined,
              background: 'transparent'
            }}
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
         prev.isDarkMode === next.isDarkMode &&
         prev.isTyping === next.isTyping &&
         prev.sessionComposeBlocked === next.sessionComposeBlocked &&
         prev.isComposing === next.isComposing &&
         prev.isFocused === next.isFocused &&
         prev.selectedBot === next.selectedBot &&
         prev.supportsImage === next.supportsImage &&
         prev.t === next.t &&
         prev.botsModels === next.botsModels &&
         prev.onSend === next.onSend &&
         prev.onStop === next.onStop &&
         prev.setIsComposing === next.setIsComposing &&
         prev.setIsFocused === next.setIsFocused;
});

export default V3InputArea;
