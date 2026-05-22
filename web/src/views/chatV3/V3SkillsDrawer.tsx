import React, { useMemo, useState, useEffect } from 'react';
import { Drawer, Input, Spin, Button, message, Tooltip, Segmented, Empty, Popconfirm } from 'antd';
import { Puzzle, RefreshCw, X, Copy, Search, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react';
import api from '../../api';

export interface V3SkillsDrawerProps {
  t: any;
  isMobile: boolean;
  isDarkMode?: boolean;
  selectedBot: string;
  botsModels: any;
  status: 'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error';
  inputAreaRef?: React.RefObject<any>;
}

export function V3SkillsDrawer({
  t,
  isMobile,
  isDarkMode = false,
  selectedBot,
  botsModels,
  status,
  inputAreaRef
}: V3SkillsDrawerProps) {
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'global' | 'private'>('all');
  const [hoveredSkillName, setHoveredSkillName] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const botId = useMemo(() => (selectedBot || '').replace('openclaw:', ''), [selectedBot]);
  const bot = useMemo(() => botsModels?.data?.bots?.find((b: any) => b.id === botId), [botId, botsModels]);

  // 监听全局技能更新事件进行局部同步对账刷新
  useEffect(() => {
    const handleSkillsUpdate = () => {
      fetchSkills();
    };
    window.addEventListener('openclaw:skills-updated', handleSkillsUpdate);
    return () => {
      window.removeEventListener('openclaw:skills-updated', handleSkillsUpdate);
    };
  }, [selectedBot]);

  const shell = useMemo(
    () =>
      isDarkMode
        ? {
            triggerBg: 'rgba(13, 148, 136, 0.18)',
            headerBorder: '#334155',
            title: '#f1f5f9',
            subtitle: '#94a3b8',
            iconWrapBg: 'rgba(13, 148, 136, 0.12)',
            iconWrapBorder: 'rgba(13, 148, 136, 0.35)',
            bodyBg: 'rgba(15, 23, 42, 0.85)',
            drawerClass: 'v3-skills-drawer-dark',
            cardBg: '#1e293b',
            cardHoverBg: '#334155',
            cardBorder: '#334155',
            cardHoverBorder: '#0d9488',
            textPrimary: '#f1f5f9',
            textMuted: '#94a3b8',
            searchBg: '#1e293b',
            searchBorder: '#334155',
            tabBarBg: '#1e293b',
            footerBg: '#1e293b',
            footerBorder: '#334155',
            emptyHint: '#94a3b8',
            loadBg: '#0f172a'
          }
        : {
            triggerBg: '#f0fdfa',
            headerBorder: '#f1f5f9',
            title: '#1e293b',
            subtitle: '#94a3b8',
            iconWrapBg: '#f0fdfa',
            iconWrapBorder: '#ccfbf1',
            bodyBg: 'rgba(255, 255, 255, 0.9)',
            drawerClass: 'v3-skills-drawer-light',
            cardBg: '#ffffff',
            cardHoverBg: '#f0fdfa',
            cardBorder: '#e2e8f0',
            cardHoverBorder: '#0d9488',
            textPrimary: '#1e293b',
            textMuted: '#64748b',
            searchBg: '#ffffff',
            searchBorder: '#cbd5e1',
            tabBarBg: '#ffffff',
            footerBg: '#ffffff',
            footerBorder: '#f1f5f9',
            emptyHint: '#94a3b8',
            loadBg: '#f8fafc'
          },
    [isDarkMode]
  );

  /**
   * 加载技能列表（与 V3MentionSelector 的过滤和排序逻辑完全对齐）
   */
  const fetchSkills = async (showMsg = false) => {
    if (!selectedBot) return;
    try {
      setIsLoading(true);
      const res = await api.get('/v1/openclaw/skills');
      const rawData = res.data;
      let skillsList: any[] = [];
      if (rawData.data) {
        skillsList = Array.isArray(rawData.data.skills) ? rawData.data.skills : [];
      } else {
        skillsList = Array.isArray(rawData.skills) ? rawData.skills : (Array.isArray(rawData) ? rawData : []);
      }

      // 1. 过滤：只显示全局的技能和当前 bot 的私有技能，且必须是已就绪且启用的
      const filtered = skillsList.filter((s: any) => 
        (s.is_global || s.bot_id === botId) && s.eligible && !s.disabled
      );

      // 2. 排序：私有技能优先，其次按首字母升序
      filtered.sort((a: any, b: any) => {
        const aGlobal = Boolean(a.is_global);
        const bGlobal = Boolean(b.is_global);
        if (aGlobal !== bGlobal) {
          return aGlobal ? 1 : -1; // 私有技能排前面
        }
        return a.name.localeCompare(b.name);
      });

      setSkills(filtered);
      if (showMsg) {
        message.success(t('skills.syncSuccess', { defaultValue: '技能同步成功' }));
      }
    } catch (err) {
      console.error('Failed to load skills:', err);
      message.error(t('skills.fetchFailed', { defaultValue: '获取技能列表失败' }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpen = () => {
    setOpen(true);
    setSearchText('');
    setFilterType('all');
    fetchSkills();
  };

  /**
   * 卸载/删除当前 Bot 的私有专属技能
   */
  const handleDeletePrivateSkill = async (e: any, name: string) => {
    if (e && e.stopPropagation) e.stopPropagation();
    try {
      setIsDeleting(true);
      message.loading(t('common.processing', { defaultValue: '正在处理中...' }), 1.5);
      
      const res = await api.delete(`/v1/openclaw/skills/${name}`);
      const tid = res.data?.taskID ?? res.data?.taskId;
      
      if (tid) {
        message.info(t('chat.waitingGatewaySync', { defaultValue: '正在同步网关任务，请稍候...' }));
        
        let pollCount = 0;
        const maxPoll = 12; // 最多轮询 12 次 (约 18 秒)
        const pollInterval = setInterval(async () => {
          pollCount++;
          try {
            const taskRes = await api.get('/v1/tasks/status');
            const tasksList = Array.isArray(taskRes.data?.data) ? taskRes.data.data : (Array.isArray(taskRes.data) ? taskRes.data : []);
            const targetTask = tasksList.find((tk: any) => tk.id === tid);
            
            if (targetTask) {
              if (targetTask.status === 'Completed') {
                clearInterval(pollInterval);
                message.success(t('skills.uninstallSuccess', { name, defaultValue: `技能 ${name} 已成功卸载` }));
                fetchSkills();
              } else if (['Failed', 'Timeout', 'Interrupted'].includes(targetTask.status)) {
                clearInterval(pollInterval);
                message.error(targetTask.error || t('skills.uninstallFailed', { defaultValue: '卸载技能失败' }));
                fetchSkills();
              }
            } else {
              // 任务在列表中消失，说明可能已被消费并清除，执行刷新
              clearInterval(pollInterval);
              fetchSkills();
            }
          } catch (pollErr) {
            console.error('Failed to poll task status:', pollErr);
          }
          
          if (pollCount >= maxPoll) {
            clearInterval(pollInterval);
            fetchSkills();
          }
        }, 1500);
      } else {
        message.success(t('skills.uninstallSuccess', { name, defaultValue: `技能 ${name} 已成功卸载` }));
        setTimeout(() => {
          fetchSkills();
        }, 800);
      }
      
    } catch (err: any) {
      console.error('Failed to delete skill:', err);
      message.error(err.response?.data?.error || t('skills.uninstallFailed', { defaultValue: '卸载技能失败' }));
    } finally {
      setIsDeleting(false);
    }
  };

  /**
   * 复制技能名称
   */
  const handleCopy = (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(name).then(() => {
      message.success(t('common.copySuccess', { defaultValue: '已成功复制技能名称到剪贴板！' }));
    }).catch(() => {
      // 传统回退方案
      const textArea = document.createElement('textarea');
      textArea.value = name;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        message.success(t('common.copySuccess', { defaultValue: '已成功复制技能名称到剪贴板！' }));
      } catch {
        message.error(t('common.copyFailed', { defaultValue: '复制失败' }));
      }
      document.body.removeChild(textArea);
    });
  };

  /**
   * 一键快捷插入到输入框（作为技能 Chip/药丸）并重新聚焦
   */
  const handleQuickInsert = (name: string) => {
    if (inputAreaRef && inputAreaRef.current) {
      const newFile = {
        url: '',
        path: name,
        filename: name,
        size: 0,
        ext: 'skill',
        type: 'skill',
        entityId: name
      };

      inputAreaRef.current.addFiles([newFile]);

      setTimeout(() => {
        inputAreaRef.current?.focus();
      }, 50);
      message.success(t('chat.mentionInserted', { defaultValue: '已成功插入技能标签' }));
    } else {
      // 降级只复制
      navigator.clipboard.writeText(`@${name} `);
      message.success(t('common.copySuccess', { defaultValue: '已复制技能标签到剪贴板' }));
    }
  };

  // 根据属性和搜索框筛选
  const filteredSkills = useMemo(() => {
    return skills.filter((s: any) => {
      const matchSearch =
        s.name.toLowerCase().includes(searchText.toLowerCase()) ||
        (s.description && s.description.toLowerCase().includes(searchText.toLowerCase()));
      
      const matchType =
        filterType === 'all' ||
        (filterType === 'global' && s.is_global) ||
        (filterType === 'private' && !s.is_global);

      return matchSearch && matchType;
    });
  }, [skills, searchText, filterType]);

  // 环境依赖详情 Tooltip 排版
  const renderRequirementsTooltip = (s: any) => {
    const missing = s.missing || { bins: [], env: [], config: [] };
    const hasRequirements = missing.bins?.length > 0 || missing.env?.length > 0 || missing.config?.length > 0;
    
    return (
      <div style={{ padding: '4px', fontSize: '11px', maxWidth: '300px', lineHeight: '1.5' }}>
        <div style={{
          fontWeight: 700,
          marginBottom: '6px',
          color: hasRequirements ? '#ef4444' : '#10b981',
          borderBottom: '1px solid rgba(255,255,255,0.15)',
          paddingBottom: '4px',
          display: 'flex',
          alignItems: 'center',
          gap: 4
        }}>
          {hasRequirements ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}
          {hasRequirements 
            ? t('skills.environmentNotMet', { defaultValue: '环境未满足' })
            : t('skills.environmentMet', { defaultValue: '环境已就绪' })}
        </div>
        <div style={{ marginBottom: '8px', color: '#cbd5e1' }}>
          {s.description || t('chat.noSkillDesc', { defaultValue: '暂无技能描述' })}
        </div>
        {hasRequirements ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: 'rgba(0,0,0,0.25)', padding: '6px', borderRadius: '4px' }}>
            {missing.bins?.length > 0 && (
              <div><span style={{ color: '#fbbf24', fontWeight: 600 }}>{t('skills.missingBins', { defaultValue: '依赖指令' })}:</span> {missing.bins.join(', ')}</div>
            )}
            {missing.env?.length > 0 && (
              <div><span style={{ color: '#fbbf24', fontWeight: 600 }}>{t('skills.missingEnv', { defaultValue: '环境变量' })}:</span> {missing.env.join(', ')}</div>
            )}
            {missing.config?.length > 0 && (
              <div><span style={{ color: '#fbbf24', fontWeight: 600 }}>{t('skills.missingConfig', { defaultValue: '缺少配置' })}:</span> {missing.config.join(', ')}</div>
            )}
          </div>
        ) : (
          <div style={{ color: '#34d399', fontWeight: 600 }}>✨ {t('skills.ready', { defaultValue: '运行环境已完全就绪' })}</div>
        )}
        {s.path && (
          <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '6px' }}>
            <div style={{ color: '#94a3b8', fontSize: '9px', fontWeight: 500 }}>{t('skills.path', { defaultValue: '绝对安装路径' })}:</div>
            <div style={{ color: '#a1a1aa', fontSize: '9px', fontFamily: 'monospace', wordBreak: 'break-all', marginTop: '2px', background: 'rgba(0,0,0,0.2)', padding: '3px 5px', borderRadius: '3px' }}>
              {s.path}
            </div>
          </div>
        )}
        {s.updated_at && (
          <div style={{ marginTop: '6px', borderTop: '1px dotted rgba(255,255,255,0.1)', paddingTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#94a3b8', fontSize: '9px', fontWeight: 500 }}>{t('skills.updatedAt', { defaultValue: '更新时间' })}:</span>
            <span style={{ color: '#cbd5e1', fontSize: '9px', fontFamily: 'monospace' }}>
              {new Date(s.updated_at * 1000).toLocaleString('zh-CN', { hour12: false })}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <Tooltip title={t('skills.title', { defaultValue: '可用技能' })}>
        <Button
          type="text"
          size="small"
          icon={<Puzzle size={18} color="#0d9488" />}
          onClick={handleOpen}
          disabled={!selectedBot || status !== 'authenticated'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: shell.triggerBg,
            border: 'none',
            borderRadius: 10,
            height: 38,
            width: 38,
            padding: 0,
            boxShadow: '0 2px 4px rgba(13, 148, 136, 0.06)'
          }}
        />
      </Tooltip>

      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  background: shell.iconWrapBg,
                  padding: 6,
                  borderRadius: 10,
                  border: `1px solid ${shell.iconWrapBorder}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Puzzle size={18} color="#0d9488" />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: shell.title, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {t('skills.title', { defaultValue: '可用技能' })}
                  <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '10px', background: 'rgba(13, 148, 136, 0.15)', color: '#0d9488' }}>
                    {skills.length}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: shell.subtitle, fontWeight: 500 }}>
                  {t('chat.belongBot', { defaultValue: '会话归属Bot' })}: {bot?.name || botId}
                </div>
              </div>
            </div>
          </div>
        }
        placement="right"
        onClose={() => setOpen(false)}
        open={open}
        width={isMobile ? '100%' : 500}
        extra={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              icon={<RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />}
              onClick={() => fetchSkills(true)}
              disabled={isLoading}
            />
            <Button icon={<X size={16} />} onClick={() => setOpen(false)} />
          </div>
        }
        styles={{
          header: { borderBottom: `1px solid ${shell.headerBorder}`, padding: '16px 24px', background: shell.tabBarBg },
          body: {
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flex: 1,
            minHeight: 0,
            background: shell.bodyBg,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)'
          }
        }}
        className={shell.drawerClass}
        closable={false}
      >
        {/* 工具栏：属性过滤 + 快速搜索 */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${shell.headerBorder}`, display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 }}>
          <Segmented
            block
            value={filterType}
            onChange={(value) => setFilterType(value as any)}
            options={[
              { label: t('skills.filterAll', { defaultValue: '全部属性' }), value: 'all' },
              { label: t('skills.globalSkill', { defaultValue: '全局技能' }), value: 'global' },
              { label: t('skills.privateSkill', { defaultValue: '私有技能' }), value: 'private' }
            ]}
            className="v3-skills-drawer-segmented"
            style={{ borderRadius: '8px' }}
          />

          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: shell.textMuted }} />
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={t('skills.search', { defaultValue: '搜索可用技能...' })}
              style={{
                paddingLeft: 32,
                borderRadius: 8,
                background: shell.searchBg,
                borderColor: shell.searchBorder,
                color: shell.textPrimary,
                height: 34
              }}
              allowClear
            />
          </div>
        </div>

        {/* 技能卡片列表 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {isLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', gap: 12 }}>
              <Spin />
              <div style={{ color: shell.textMuted, fontSize: 12 }}>{t('skills.loading', { defaultValue: '正在努力加载可用技能...' })}</div>
            </div>
          ) : filteredSkills.length === 0 ? (
            <div style={{ padding: '40px 0', display: 'flex', justifyContent: 'center' }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('common.noContent', { defaultValue: '暂无可用技能' })} />
            </div>
          ) : (
            filteredSkills.map((s: any) => {
              const isGlobal = Boolean(s.is_global);
              const isHovered = hoveredSkillName === s.name;
              return (
                <Tooltip
                  key={s.name}
                  title={renderRequirementsTooltip(s)}
                  placement="left"
                  mouseEnterDelay={0.4}
                  overlayClassName="v3-skills-drawer-tooltip-overlay"
                >
                  <div
                    onClick={() => handleQuickInsert(s.name)}
                    onMouseEnter={(e) => {
                      setHoveredSkillName(s.name);
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.borderColor = shell.cardHoverBorder;
                      e.currentTarget.style.boxShadow = isDarkMode
                        ? '0 8px 20px rgba(13, 148, 136, 0.15)'
                        : '0 8px 20px rgba(13, 148, 136, 0.08)';
                      if (!isDarkMode) e.currentTarget.style.background = shell.cardHoverBg;
                    }}
                    onMouseLeave={(e) => {
                      setHoveredSkillName(null);
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.borderColor = shell.cardBorder;
                      e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.02)';
                      e.currentTarget.style.background = shell.cardBg;
                    }}
                    style={{
                      background: shell.cardBg,
                      border: `1px solid ${shell.cardBorder}`,
                      borderRadius: 12,
                      padding: '14px 18px',
                      cursor: 'pointer',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      position: 'relative',
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      flexShrink: 0,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0, paddingRight: 32 }}>
                      <div
                        style={{
                          fontSize: 20,
                          width: 38,
                          height: 38,
                          background: isDarkMode ? 'rgba(255,255,255,0.05)' : '#f8fafc',
                          border: `1px solid ${shell.cardBorder}`,
                          borderRadius: 8,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'transform 0.2s',
                          transform: isHovered ? 'scale(1.05)' : 'scale(1)'
                        }}
                      >
                        {s.emoji || '👾'}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 4, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 600, fontSize: 13.5, color: shell.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.name}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              padding: '1px 5px',
                              borderRadius: '4px',
                              background: isGlobal ? 'rgba(37, 99, 235, 0.08)' : 'rgba(6, 182, 212, 0.08)',
                              color: isGlobal ? '#2563eb' : '#0891b2',
                              border: isGlobal ? '1px solid rgba(37, 99, 235, 0.15)' : '1px solid rgba(6, 182, 212, 0.15)',
                              flexShrink: 0
                            }}
                          >
                            {isGlobal ? t('skills.globalSkill', { defaultValue: '全局' }) : t('skills.privateSkill', { defaultValue: '私有' })}
                          </span>
                        </div>
                        <span style={{
                          fontSize: 11.5,
                          color: shell.textMuted,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: 2,
                          lineHeight: '1.4',
                          wordBreak: 'break-all',
                          marginTop: 1
                        }}>
                          {s.description || t('chat.noSkillDesc', { defaultValue: '暂无技能描述' })}
                        </span>
                      </div>
                    </div>

                    {/* 卡片右侧悬浮动作组：绝对定位悬停展现，物理上绝不挤压左侧空间 */}
                    <div style={{
                      position: 'absolute',
                      right: 14,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      opacity: isHovered ? 1 : 0,
                      visibility: isHovered ? 'visible' : 'hidden',
                      transition: 'all 0.2s ease-in-out'
                    }}>
                      <Tooltip title={t('common.copy', { defaultValue: '复制技能名' })}>
                        <Button
                          size="small"
                          type="text"
                          icon={<Copy size={13} />}
                          onClick={(e) => handleCopy(e, s.name)}
                          style={{
                            width: 28,
                            height: 28,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '6px',
                            background: isDarkMode ? '#334155' : '#f1f5f9',
                            color: shell.textPrimary
                          }}
                        />
                      </Tooltip>

                      {/* 只有私有技能支持强物理卸载/删除，不可逆 */}
                      {!isGlobal && (
                        <Popconfirm
                          title={t('skills.uninstallConfirmTitle', { defaultValue: '确认要卸载该技能吗？' })}
                          description={t('skills.uninstallConfirmContent', { name: s.name, defaultValue: '卸载后该私有技能将被物理清理，操作不可逆。' })}
                          onConfirm={(e) => handleDeletePrivateSkill(e, s.name)}
                          onCancel={(e) => e?.stopPropagation()}
                          okText={t('common.confirm', { defaultValue: '确认' })}
                          cancelText={t('common.cancel', { defaultValue: '取消' })}
                          okButtonProps={{ danger: true, loading: isDeleting }}
                          placement="left"
                        >
                          <Button
                            size="small"
                            type="text"
                            danger
                            icon={<Trash2 size={13} />}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              width: 28,
                              height: 28,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: '6px',
                              background: isDarkMode ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.08)',
                              color: '#ef4444'
                            }}
                          />
                        </Popconfirm>
                      )}
                    </div>
                  </div>
                </Tooltip>
              );
            })
          )}
        </div>

        {/* 页脚提示 */}
        <div
          style={{
            padding: '12px 20px',
            background: shell.footerBg,
            borderTop: `1px solid ${shell.footerBorder}`,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#0d9488', animation: 'v3-heartbeat 1.5s infinite' }} />
          <div style={{ fontSize: 10.5, color: shell.textMuted, fontWeight: 500 }}>
            {t('chat.skillsDrawerFooterHint', { defaultValue: '点击卡片快捷插入 @ 标签到输入框，或悬停查看依赖环境说明。' })}
          </div>
        </div>
      </Drawer>
    </>
  );
}
