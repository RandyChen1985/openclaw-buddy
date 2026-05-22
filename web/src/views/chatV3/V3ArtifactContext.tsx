import React, { createContext, useContext, useState, useCallback } from 'react';

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
  registerArtifact: (artifact: Omit<Artifact, 'version'>) => void;
  clearArtifacts: () => void;
}

const ArtifactContext = createContext<ArtifactContextType | undefined>(undefined);

export const ArtifactProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [canvasVisible, setCanvasVisible] = useState(false);
  const [artifactsHistory, setArtifactsHistory] = useState<Record<string, Artifact[]>>({});

  const registerArtifact = useCallback((art: Omit<Artifact, 'version'>) => {
    setArtifactsHistory(prev => {
      const list = prev[art.title] || [];
      
      // 1. 判断是否是同一个消息正在进行的流式输出 chunk 更新
      const existingMsgIndex = list.findIndex(item => item.messageId === art.messageId);
      
      let updatedList: Artifact[];
      let currentVersion: number;

      if (existingMsgIndex >= 0) {
        // 如果是流式 chunk，直接更新代码，但版本号保持不变！
        currentVersion = list[existingMsgIndex].version;
        const updatedArt: Artifact = { ...art, version: currentVersion };
        
        updatedList = [...list];
        updatedList[existingMsgIndex] = updatedArt;
      } else {
        // 如果是一个全新的消息（可能是大模型针对之前的方案做出的修正版），版本号递增！
        currentVersion = list.length + 1;
        const newArt: Artifact = { ...art, version: currentVersion };
        updatedList = [...list, newArt];
      }

      // 提取当前正在更新的这版 Artifact 并设置为 active
      const finalActive = updatedList.find(item => item.messageId === art.messageId) || updatedList[updatedList.length - 1];
      setActiveArtifact(finalActive);
      setCanvasVisible(true);

      return {
        ...prev,
        [art.title]: updatedList
      };
    });
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
