import React, { useState } from 'react';
import { Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import {Zap, MessageSquare } from 'lucide-react';
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
}

const OnlineChat: React.FC<OnlineChatProps> = ({ isMobile, ...props }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('v3');

  const items = [
    {
      key: 'v3',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={16} color="#eab308" fill="#eab308" />
          {t('chat.v3Mode', { defaultValue: 'V3 模式 (RPC)' })}
        </span>
      ),
      children: <ChatV3Final {...props} isMobile={isMobile} />,
    },
    {
      key: 'classic',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MessageSquare size={16} />
          {t('chat.classicMode', { defaultValue: '经典模式 (HTTP)' })}
        </span>
      ),
      children: <ChatClassic {...props} isMobile={isMobile} />,
    },
  ];

  return (
    <div style={{ 
      height: '100%', 
      width: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      background: '#f8fafc',
      overflow: 'hidden'
    }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={items}
        tabBarGutter={isMobile ? 12 : undefined}
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
        tabBarStyle={{ 
          margin: 0, 
          padding: isMobile ? '0 12px' : '0 20px', 
          background: '#fff', 
          borderBottom: '1px solid #f1f5f9' 
        }}
        className="chat-tabs"
      />
      <style>{`
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
      `}</style>
    </div>
  );
};

export default OnlineChat;
