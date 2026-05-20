import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import {
  V3_DOCK_MIME,
  type V3DockPanelId,
  getColumnWidth,
  isDockDragEvent,
  readDraggedPanelId,
} from './v3RightDockLayout';
import { useV3RightDock } from './useV3RightDock';
import './v3RightDock.css';

export interface V3RightDockProps {
  visiblePanels: V3DockPanelId[];
  isMobile: boolean;
  isDarkMode?: boolean;
  dockExpanded?: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
  isDraggingResize: boolean;
  onResizeActiveChange: (active: boolean) => void;
  renderPanel: (panelId: V3DockPanelId, columnWidth: number) => React.ReactNode;
}

function panelDefaultTitle(t: V3RightDockProps['t'], panelId: V3DockPanelId): string {
  switch (panelId) {
    case 'debug':
      return t('chat.debugLogs', { defaultValue: 'WS 推送日志' });
    case 'terminal':
      return t('common.terminal', { defaultValue: '运维终端' });
    case 'explorer':
      return t('bots.workspace', { defaultValue: '工作区' });
    default:
      return panelId;
  }
}

export function V3RightDock({
  visiblePanels,
  isMobile,
  isDarkMode = false,
  dockExpanded = false,
  t,
  isDraggingResize,
  onResizeActiveChange,
  renderPanel,
}: V3RightDockProps) {
  const { layout, movePanel, resizeColumn } = useV3RightDock(visiblePanels);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [isDockDragging, setIsDockDragging] = useState(false);
  const draggingPanelRef = useRef<V3DockPanelId | null>(null);
  const resizingColRef = useRef<{ columnId: string; startX: number; startW: number } | null>(null);

  const allowDrop = useCallback((e: React.DragEvent) => {
    if (!isDockDragEvent(e, draggingPanelRef.current)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const readDropPanel = useCallback((e: React.DragEvent) => {
    return readDraggedPanelId(e, draggingPanelRef.current);
  }, []);

  const endPanelDrag = useCallback(() => {
    draggingPanelRef.current = null;
    setIsDockDragging(false);
    setDragOverKey(null);
  }, []);

  const finishDrop = useCallback(
    (e: React.DragEvent, action: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      action();
      endPanelDrag();
    },
    [endPanelDrag],
  );

  const handleDropOnColumn = useCallback(
    (e: React.DragEvent, columnId: string, afterPanelId?: V3DockPanelId) => {
      const panelId = readDropPanel(e);
      if (!panelId) {
        endPanelDrag();
        return;
      }
      finishDrop(e, () => movePanel(panelId, { type: 'stack', columnId, afterPanelId }));
    },
    [finishDrop, movePanel, readDropPanel, endPanelDrag],
  );

  const handleDropNewColumn = useCallback(
    (e: React.DragEvent, columnIndex: number) => {
      const panelId = readDropPanel(e);
      if (!panelId) {
        endPanelDrag();
        return;
      }
      finishDrop(e, () => movePanel(panelId, { type: 'new-column', columnIndex }));
    },
    [finishDrop, movePanel, readDropPanel, endPanelDrag],
  );

  const startColumnResize = useCallback(
    (columnId: string, e: React.MouseEvent) => {
      e.preventDefault();
      const startW = getColumnWidth(layout, columnId);
      resizingColRef.current = { columnId, startX: e.clientX, startW };
      onResizeActiveChange(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        if (!resizingColRef.current) return;
        const delta = resizingColRef.current.startX - ev.clientX;
        resizeColumn(resizingColRef.current.columnId, resizingColRef.current.startW + delta);
      };
      const onUp = () => {
        resizingColRef.current = null;
        onResizeActiveChange(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.dispatchEvent(new Event('resize'));
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [layout, onResizeActiveChange, resizeColumn],
  );

  const startPanelDrag = useCallback((panelId: V3DockPanelId, e: React.DragEvent) => {
    draggingPanelRef.current = panelId;
    setIsDockDragging(true);
    e.dataTransfer.setData(V3_DOCK_MIME, panelId);
    e.dataTransfer.setData('text/plain', panelId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  /** dragEnd 在部分浏览器/嵌套面板上不稳定，用全局事件兜底，避免拖拽态残留 */
  useEffect(() => {
    if (!isDockDragging) return;
    const reset = () => endPanelDrag();
    window.addEventListener('dragend', reset, true);
    window.addEventListener('drop', reset, true);
    return () => {
      window.removeEventListener('dragend', reset, true);
      window.removeEventListener('drop', reset, true);
    };
  }, [isDockDragging, endPanelDrag]);

  if (isMobile || visiblePanels.length === 0 || layout.columns.length === 0) {
    return null;
  }

  const renderNewColumnZone = (columnIndex: number) => {
    const key = `new-${columnIndex}`;
    const active = dragOverKey === key;
    return (
      <div
        key={key}
        className={`v3-dock-new-column-zone${active ? ' v3-dock-new-column-zone--active' : ''}`}
        onDragEnter={allowDrop}
        onDragOver={e => {
          allowDrop(e);
          setDragOverKey(key);
        }}
        onDragLeave={() => setDragOverKey(k => (k === key ? null : k))}
        onDrop={e => handleDropNewColumn(e, columnIndex)}
        title={t('chat.dockNewColumn', { defaultValue: '拖到此处拆成独立列' })}
      >
        <div className="v3-dock-new-column-zone-inner" />
        {isDockDragging && <span className="v3-dock-new-column-hint">‖</span>}
      </div>
    );
  };

  const soloColumn = layout.columns.length <= 1;
  const multiCol = layout.columns.length > 1;

  const columnStyle = (columnId: string): React.CSSProperties => {
    if (multiCol || dockExpanded) {
      const total = layout.columns.reduce((s, c) => s + getColumnWidth(layout, c.id), 0);
      const w = getColumnWidth(layout, columnId);
      const grow = total > 0 ? w / total : 1;
      return { flex: `${grow} 1 0`, minWidth: 220, width: 'auto', maxWidth: 'none' };
    }
    return { flex: '1 1 0', minWidth: 0, width: '100%' };
  };

  return (
    <div
      className={`v3-right-dock${isDockDragging ? ' v3-right-dock--dragging' : ''}${dockExpanded ? ' v3-right-dock--expanded' : ''}${soloColumn ? ' v3-right-dock--solo-column' : ''}${multiCol ? ' v3-right-dock--multi-col' : ''}`}
      data-app-dark={isDarkMode ? 'true' : undefined}
      onDragEnd={endPanelDrag}
      onDragEnter={allowDrop}
      onDragOver={allowDrop}
    >
      {isDockDragging && !soloColumn && renderNewColumnZone(0)}

      {layout.columns.map((col, colIndex) => {
        const colWidth = getColumnWidth(layout, col.id);
        return (
          <React.Fragment key={col.id}>
            {colIndex > 0 && (
              <div
                className={`v3-dock-column-resize${isDraggingResize ? ' is-active' : ''}`}
                onDragEnter={allowDrop}
                onDragOver={e => {
                  allowDrop(e);
                  setDragOverKey(`new-${colIndex}`);
                }}
                onDrop={e => handleDropNewColumn(e, colIndex)}
                onMouseDown={e => startColumnResize(col.id, e)}
                title={t('chat.dockNewColumn', { defaultValue: '拖到此处拆成独立列' })}
              />
            )}
            <div
              className="v3-dock-column"
              style={columnStyle(col.id)}
              onDragEnter={allowDrop}
              onDragOver={e => {
                allowDrop(e);
                setDragOverKey(`col-${col.id}`);
              }}
              onDrop={e => handleDropOnColumn(e, col.id)}
            >
              {col.panelIds.map(panelId => {
                const slotKey = `${col.id}:${panelId}`;
                const isDragOver = dragOverKey === slotKey;
                const isSelfDragging = draggingPanelRef.current === panelId;
                return (
                  <div
                    key={panelId}
                    className={`v3-dock-panel-slot${isDragOver ? ' v3-dock-panel-slot--drag-over' : ''}${isSelfDragging ? ' v3-dock-panel-slot--source' : ''}`}
                    onDragEnter={allowDrop}
                    onDragOver={e => {
                      allowDrop(e);
                      setDragOverKey(slotKey);
                    }}
                    onDragLeave={e => {
                      const rel = e.relatedTarget as Node | null;
                      if (rel && e.currentTarget.contains(rel)) return;
                      setDragOverKey(k => (k === slotKey ? null : k));
                    }}
                    onDrop={e => {
                      const dragged = readDropPanel(e);
                      if (!dragged || dragged === panelId) {
                        handleDropOnColumn(e, col.id);
                        return;
                      }
                      handleDropOnColumn(e, col.id, panelId);
                    }}
                  >
                    <div
                      className="v3-dock-drag-bar"
                      draggable
                      onDragStart={e => startPanelDrag(panelId, e)}
                      onDragEnd={endPanelDrag}
                      title={t('chat.dockDragHint', {
                        defaultValue: '拖动手柄：放到另一面板区域=同列堆叠；放到列间竖条=独立列',
                      })}
                    >
                      <GripVertical size={14} />
                      <span>{panelDefaultTitle(t, panelId)}</span>
                    </div>
                    <div className="v3-dock-panel-body">{renderPanel(panelId, colWidth)}</div>
                    {isDockDragging && draggingPanelRef.current !== panelId && isDragOver && (
                      <div className="v3-dock-drop-hint" aria-hidden>
                        {t('chat.dockStackBelow', { defaultValue: '松手堆叠到此处' })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {isDockDragging && !soloColumn && renderNewColumnZone(colIndex + 1)}
          </React.Fragment>
        );
      })}
    </div>
  );
}
