import React from 'react';
import { Dropdown, Button, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { Languages, ChevronDown } from 'lucide-react';

interface LanguageSwitcherProps {
  isMobile?: boolean;
  style?: React.CSSProperties;
  color?: string;
}

const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ isMobile, style, color = '#64748b' }) => {
  const { i18n } = useTranslation();

  const languageMenuItems = [
    { key: 'zh', label: '简体中文' },
    { key: 'en', label: 'English' }
  ];

  const getNormalizedLang = () => {
    const lang = i18n?.language || 'zh';
    return lang.startsWith('zh') ? 'zh' : 'en';
  };

  return (
    <Dropdown 
      menu={{ 
        items: languageMenuItems, 
        onClick: ({ key }) => i18n.changeLanguage(key),
        selectedKeys: [getNormalizedLang()]
      }} 
      trigger={['click']}
      placement="bottomRight"
    >
      <Button type="text" style={{ color: color, display: 'flex', alignItems: 'center', height: 32, padding: '0 8px', ...style }}>
        <Space size={4}>
          <Languages size={16} />
          {!isMobile && (getNormalizedLang() === 'zh' ? '中文' : 'EN')}
          <ChevronDown size={12} />
        </Space>
      </Button>
    </Dropdown>
  );
};

export default LanguageSwitcher;
