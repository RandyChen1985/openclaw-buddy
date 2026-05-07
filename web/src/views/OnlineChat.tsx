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
}

const OnlineChat: React.FC<OnlineChatProps> = ({ isMobile, isDarkMode = false, ...props }) => {
  const { t } = useTranslation();

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
        <ChatV3Final {...props} isMobile={isMobile} isDarkMode={isDarkMode} />
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
        <ChatClassic {...props} isMobile={isMobile} isDarkMode={isDarkMode} />
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
      children: <ChatV3Final {...props} isMobile={isMobile} isDarkMode={isDarkMode} />,
    },
    {
      key: 'classic',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MessageSquare size={16} />
          {t('chat.classicMode', { defaultValue: '经典模式 (HTTP)' })}
        </span>
      ),
      children: <ChatClassic {...props} isMobile={isMobile} isDarkMode={isDarkMode} />,
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
