import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

export interface Artifact {
  id: string;          // 唯一ID (由 messageId + 索引组合)
  title: string;       // 文件名或图表名 (如 index.html, diagram.mermaid)
  type: 'html' | 'mermaid' | 'svg';
  code: string;        // 实时代码内容
  messageId: string;   // 关联的消息ID
  version: number;     // 版本号 (从 1 开始)
}

interface ArtifactContextType {
  activeArtifact: Artifact | null;
  setActiveArtifact: (artifact: Artifact | null) => void;
  canvasVisible: boolean;
  setCanvasVisible: (visible: boolean) => void;
  artifactsHistory: Record<string, Artifact[]>; // filename -> versions
  registerArtifact: (artifact: Omit<Artifact, 'version'>, autoOpen?: boolean) => void;
  clearArtifacts: () => void;
}

const ArtifactContext = createContext<ArtifactContextType | undefined>(undefined);

export const ArtifactProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [canvasVisible, setCanvasVisible] = useState(false);
  const [artifactsHistory, setArtifactsHistory] = useState<Record<string, Artifact[]>>({});

  // 💡 使用 ref 实时映射最新的 artifactsHistory，规避 useCallback 里的引用闭包刷新和依赖渲染地狱
  const artifactsHistoryRef = useRef(artifactsHistory);
  useEffect(() => {
    artifactsHistoryRef.current = artifactsHistory;
  }, [artifactsHistory]);

  // 💡 使用 ref 实时映射最新的 activeArtifact 与 canvasVisible 状态，彻底规避并绕开 useCallback 空依赖闭包锁定及 React 批量更新下的 Bail-out 拦截
  const activeArtifactRef = useRef(activeArtifact);
  const canvasVisibleRef = useRef(canvasVisible);

  useEffect(() => {
    activeArtifactRef.current = activeArtifact;
  }, [activeArtifact]);

  useEffect(() => {
    canvasVisibleRef.current = canvasVisible;
  }, [canvasVisible]);

  const registerArtifact = useCallback((art: Omit<Artifact, 'version'>, autoOpen: boolean = false) => {
    console.log('[ArtifactDebug] registerArtifact called with:', art.title, 'autoOpen:', autoOpen);
    
    // 1. 同步提交 history 数据状态变更（保持 pure data updater 属性，零副作用）
    setArtifactsHistory(prev => {
      const list = prev[art.title] || [];
      const existingMsgIndex = list.findIndex(item => item.messageId === art.messageId);
      
      let updatedList: Artifact[];
      let currentVersion: number;

      if (existingMsgIndex >= 0) {
        currentVersion = list[existingMsgIndex].version;
        const updatedArt: Artifact = { ...art, version: currentVersion };
        updatedList = [...list];
        updatedList[existingMsgIndex] = updatedArt;
      } else {
        currentVersion = list.length + 1;
        const newArt: Artifact = { ...art, version: currentVersion };
        updatedList = [...list, newArt];
      }

      return {
        ...prev,
        [art.title]: updatedList
      };
    });

    // 2. 💡 核心修复：从最新的 ref 中计算 version，并实施双轨 Ref 状态判断，绕过 React 内部对相同属性值对象更新的合并 Bail-out 拦截
    const existingList = artifactsHistoryRef.current[art.title] || [];
    const matched = existingList.find(item => item.messageId === art.messageId);
    const version = matched ? matched.version : (existingList.length + 1);
    
    const finalActive: Artifact = { ...art, version };
    
    console.log('[ArtifactDebug] Sync UI Trigger. version:', version, 'autoOpen:', autoOpen);
    
    const currentActive = activeArtifactRef.current;
    const currentVisible = canvasVisibleRef.current;

    // 💡 只有当当前的 activeArtifact 内容实质不同（ID 或代码改变）时才触发更新，避免引发无意义的 React 对比跳过
    const isSameArtifact = currentActive && 
                           currentActive.id === finalActive.id && 
                           currentActive.code === finalActive.code;

    // 💡 极限兜底：如果是重新打开画布（autoOpen 且当前不可见），我们需要强行更新引用以确保子组件如 iframe/mermaid 能被干净地重新渲染
    const forceReset = autoOpen && !currentVisible;

    if (!isSameArtifact || forceReset) {
      console.log('[ArtifactDebug] Set active artifact to:', finalActive, 'forceReset:', forceReset);
      setActiveArtifact({ ...finalActive }); // 强行分配全新引用以激活 React 组件重绘生命周期
    } else {
      console.log('[ArtifactDebug] Active artifact remains identical (Bailout avoided)');
    }

    // 💡 只有当需要打开（autoOpen 为 true）且当前不可见时，才进行 setCanvasVisible(true)
    if (autoOpen && !currentVisible) {
      console.log('[ArtifactDebug] Sync Canvas Visible Trigger: true');
      setCanvasVisible(true);
    } else if (autoOpen && currentVisible) {
      console.log('[ArtifactDebug] Canvas is already visible');
    }
  }, []);

  const clearArtifacts = useCallback(() => {
    setActiveArtifact(null);
    setCanvasVisible(false);
    setArtifactsHistory({});
  }, []);

  return (
    <ArtifactContext.Provider value={{
      activeArtifact,
      setActiveArtifact,
      canvasVisible,
      setCanvasVisible,
      artifactsHistory,
      registerArtifact,
      clearArtifacts
    }}>
      {children}
    </ArtifactContext.Provider>
  );
};

export const useArtifact = () => {
  const context = useContext(ArtifactContext);
  if (!context) {
    throw new Error('useArtifact must be used within an ArtifactProvider');
  }
  return context;
};
