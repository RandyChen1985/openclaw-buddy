import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type V3DockLayout,
  type V3DockPanelId,
  type V3DockDropTarget,
  loadDockLayout,
  saveDockLayout,
  syncDockLayoutWithVisible,
  moveDockPanel,
  setColumnWidth,
} from './v3RightDockLayout';

export function useV3RightDock(visiblePanels: V3DockPanelId[]) {
  const visibleKey = visiblePanels.join(',');

  const [layout, setLayout] = useState<V3DockLayout>(() =>
    syncDockLayoutWithVisible(loadDockLayout(), visiblePanels),
  );

  useEffect(() => {
    setLayout(prev => syncDockLayoutWithVisible(prev, visiblePanels));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey]);

  useEffect(() => {
    if (layout.columns.length > 0) {
      saveDockLayout(layout);
    }
  }, [layout]);

  const movePanel = useCallback((panelId: V3DockPanelId, target: V3DockDropTarget) => {
    setLayout(prev => moveDockPanel(prev, panelId, target));
  }, []);

  const resizeColumn = useCallback((columnId: string, width: number) => {
    setLayout(prev => setColumnWidth(prev, columnId, width));
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(syncDockLayoutWithVisible(null, visiblePanels));
  }, [visiblePanels]);

  return useMemo(
    () => ({ layout, movePanel, resizeColumn, resetLayout }),
    [layout, movePanel, resizeColumn, resetLayout],
  );
}
