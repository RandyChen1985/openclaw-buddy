import React, { createContext, useContext } from 'react';
import { Tooltip as AntdTooltip, type TooltipProps } from 'antd';

/**
 * 全站 Tooltip 开关：移动端默认禁用（避免遮挡视线）。
 * - Provider 在 App 根部注入
 * - 业务侧统一用 AppTooltip 替代 antd Tooltip
 */
const TooltipDisabledContext = createContext<boolean>(false);

export const TooltipDisabledProvider: React.FC<{ disabled: boolean; children: React.ReactNode }> = ({ disabled, children }) => {
  return (
    <TooltipDisabledContext.Provider value={disabled}>
      {children}
    </TooltipDisabledContext.Provider>
  );
};

export const useTooltipDisabled = () => useContext(TooltipDisabledContext);

const AppTooltip: React.FC<TooltipProps> = (props) => {
  const disabled = useTooltipDisabled();
  if (disabled) {
    return <>{props.children}</>;
  }
  return <AntdTooltip {...props} />;
};

export default AppTooltip;

