import React, { useMemo, useState } from 'react';
import { Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { Zap, MessageSquare } from 'lucide-react';
import ChatClassic from './ChatClassic';
import ChatV3Final from './ChatV3';

interface OnlineChatProps {
  botsModels: any;
  loadingBots: boolean;
  onRefreshBots: () => void;
  isMobile?: boolean;
  onRestartGateway?: () => Promise<void>;
  isRunning?: boolean;
  onNavigateToDashboard?: () => void;
  isDarkMode?: boolean;
  /** 普通用户：允许访问的 bot id 列表；为空表示无权限；未传则表示不限制（admin/superadmin） */
  allowedBotIDs?: string[] | null;
  /** 当前登录用户名（可选）。用于把 username 写入 buddy:direct 会话 key */
  usernameForSessionKey?: string | null;
  /** 当前登录用户名（可选）。用于经典（HTTP）模式生成 s-{ts}-{username} */
  usernameForSessionId?: string | null;
  /** 普通用户：只加载 key 中包含 username 的会话 */
  filterV3SessionsByUsername?: boolean;
}

const chatBlockedPlaceholder = <div style={{ flex: 1, minHeight: 0 }} aria-hidden />;

const OnlineChat: React.FC<OnlineChatProps> = ({ isMobile, isDarkMode = false, usernameForSessionId, ...props }) => {
  const { t } = useTranslation();
  const allowedBotIDs = props.allowedBotIDs;
  const isBotRestricted = Array.isArray(allowedBotIDs);
  const hasAnyBot = !isBotRestricted || (allowedBotIDs?.length || 0) > 0;

  const filteredBotsModels = useMemo(() => {
    if (!isBotRestricted) return props.botsModels;
    const src = props.botsModels;
    const bots = src?.data?.bots;
    if (!Array.isArray(bots)) return src;
    const allow = new Set(allowedBotIDs || []);
    const filtered = bots.filter((b: any) => allow.has(b?.id));
    return {
      ...src,
      data: {
        ...(src?.data || {}),
        bots: filtered,
      },
    };
  }, [isBotRestricted, allowedBotIDs, props.botsModels]);

  const childProps = useMemo(() => ({ ...props, botsModels: filteredBotsModels }), [props, filteredBotsModels]);

  const { singleEmbedPane, initialChatTab } = useMemo(() => {
    const qp = new URLSearchParams(window.location.search);
    const isEmbed = qp.get('embed') === 'true';
    const raw = (qp.get('embedLayout') || '').toLowerCase();
    const single =
      isEmbed && (raw === 'v3' || raw === 'classic') ? (raw as 'v3' | 'classic') : null;
    const tab: 'v3' | 'classic' = qp.get('chatTab') === 'classic' ? 'classic' : 'v3';
    return { singleEmbedPane: single, initialChatTab: tab };
  }, []);

  const [activeTab, setActiveTab] = useState<'v3' | 'classic'>(initialChatTab);

  if (singleEmbedPane === 'v3') {
    return (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: isDarkMode ? '#0f172a' : '#f8fafc',
          overflow: 'hidden',
        }}
      >
        {hasAnyBot ? (
          <ChatV3Final {...childProps} isMobile={isMobile} isDarkMode={isDarkMode} />
        ) : (
          chatBlockedPlaceholder
        )}
      </div>
    );
  }

  if (singleEmbedPane === 'classic') {
    return (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: isDarkMode ? '#0f172a' : '#f8fafc',
          overflow: 'hidden',
        }}
      >
        {hasAnyBot ? (
          <ChatClassic {...childProps} isMobile={isMobile} isDarkMode={isDarkMode} usernameForSessionId={usernameForSessionId} />
        ) : (
          chatBlockedPlaceholder
        )}
      </div>
    );
  }

  const items = [
    {
      key: 'v3',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={16} color="#eab308" fill="#eab308" />
          {t('chat.v3Mode', { defaultValue: 'V3 模式 (RPC)' })}
        </span>
      ),
      children: hasAnyBot ? (
        <ChatV3Final {...childProps} isMobile={isMobile} isDarkMode={isDarkMode} />
      ) : (
        chatBlockedPlaceholder
      ),
    },
    {
      key: 'classic',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MessageSquare size={16} />
          {t('chat.classicMode', { defaultValue: '经典模式 (HTTP)' })}
        </span>
      ),
      children: hasAnyBot ? (
        <ChatClassic {...childProps} isMobile={isMobile} isDarkMode={isDarkMode} usernameForSessionId={usernameForSessionId} />
      ) : (
        chatBlockedPlaceholder
      ),
    },
  ];

  return (
    <div style={{ 
      height: '100%', 
      width: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      background: isDarkMode ? '#0f172a' : '#f8fafc',
      overflow: 'hidden'
    }}>
      <Tabs
        destroyInactiveTabPane
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'v3' | 'classic')}
        items={items}
        tabBarGutter={isMobile ? 12 : undefined}
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
        tabBarStyle={{
          margin: 0,
          marginBottom: 0,
          padding: isMobile ? '0 12px' : '0 20px',
          background: isDarkMode ? '#1e293b' : '#fff',
          borderBottom: isDarkMode ? '1px solid #334155' : '1px solid #f1f5f9',
        }}
        className={`chat-tabs${isDarkMode ? ' chat-tabs--dark' : ''}`}
      />
      <style>{`
        /* Ant Design Tabs 默认给 .ant-tabs-top 的 nav 加了 margin-bottom: 16px，与内容区之间会出现一条缝 */
        .chat-tabs.ant-tabs-top > .ant-tabs-nav,
        .chat-tabs.ant-tabs-top > div > .ant-tabs-nav {
          margin-bottom: 0 !important;
        }
        .chat-tabs .ant-tabs-content-holder {
          margin-top: 0;
        }
        .chat-tabs .ant-tabs-content {
          height: 100%;
        }
        .chat-tabs .ant-tabs-tabpane-active {
          height: 100%;
          display: flex !important;
          flex-direction: column;
        }
        .chat-tabs .ant-tabs-nav::before {
          border-bottom: none !important;
        }
        .chat-tabs--dark .ant-tabs-tab {
          color: #94a3b8 !important;
        }
        .chat-tabs--dark .ant-tabs-tab.ant-tabs-tab-active .ant-tabs-tab-btn {
          color: #f1f5f9 !important;
        }
      `}</style>
    </div>
  );
};

export default OnlineChat;
