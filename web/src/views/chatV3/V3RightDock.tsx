import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Columns2, GripVertical, Rows3, X } from 'lucide-react';
import {
  V3_DOCK_MIME,
  V3_DOCK_PANEL_ORDER,
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
  onCloseAll: () => void;
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
  onCloseAll,
  renderPanel,
}: V3RightDockProps) {
  const { layout, movePanel, resizeColumn, toggleStackedColumns, dockIsStackedMode } =
    useV3RightDock(visiblePanels);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [isDockDragging, setIsDockDragging] = useState(false);
  const draggingPanelRef = useRef<V3DockPanelId | null>(null);
  const resizingColRef = useRef<{ columnId: string; startX: number; startW: number } | null>(null);
  /** dragOver 极高频；合并到每帧最多一次 setState，避免整 Dock（终端/工作区）反复重绘卡顿 */
  const dragOverRafRef = useRef<number | null>(null);
  const pendingDragOverKeyRef = useRef<string | null | undefined>(undefined);

  const flushDragOverKey = useCallback(() => {
    dragOverRafRef.current = null;
    const next = pendingDragOverKeyRef.current;
    if (next === undefined) return;
    pendingDragOverKeyRef.current = undefined;
    setDragOverKey(prev => (prev === next ? prev : next));
  }, []);

  const scheduleDragOverKey = useCallback((next: string | null) => {
    pendingDragOverKeyRef.current = next;
    if (dragOverRafRef.current != null) return;
    dragOverRafRef.current = requestAnimationFrame(flushDragOverKey);
  }, [flushDragOverKey]);

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
    if (dragOverRafRef.current != null) {
      cancelAnimationFrame(dragOverRafRef.current);
      dragOverRafRef.current = null;
    }
    pendingDragOverKeyRef.current = undefined;
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

      let lastClientX = e.clientX;
      let rafId: number | null = null;

      const updateWidth = () => {
        rafId = null;
        if (!resizingColRef.current) return;
        const delta = resizingColRef.current.startX - lastClientX;
        resizeColumn(resizingColRef.current.columnId, resizingColRef.current.startW + delta);
      };

      const onMove = (ev: MouseEvent) => {
        lastClientX = ev.clientX;
        if (rafId === null) {
          rafId = requestAnimationFrame(updateWidth);
        }
      };
      const onUp = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        // 松开时补一次同步计算，避免取消 rAF 时尚未执行的那一帧丢失最终列宽
        updateWidth();
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

  useEffect(
    () => () => {
      if (dragOverRafRef.current != null) cancelAnimationFrame(dragOverRafRef.current);
    },
    [],
  );

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
          scheduleDragOverKey(key);
        }}
        onDragLeave={e => {
          const rel = e.relatedTarget as Node | null;
          if (rel && e.currentTarget.contains(rel)) return;
          scheduleDragOverKey(null);
        }}
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

  const showLayoutToggle = visiblePanels.length > 1;
  const openPanelsOrdered = V3_DOCK_PANEL_ORDER.filter(id => visiblePanels.includes(id));
  const openPanelNamesJoin = openPanelsOrdered.map(id => panelDefaultTitle(t, id)).join('、');

  return (
    <div
      className={`v3-right-dock-wrap${dockExpanded ? ' v3-right-dock-wrap--expanded' : ''}`}
      data-app-dark={isDarkMode ? 'true' : undefined}
    >
      {showLayoutToggle && (
        <div className="v3-dock-layout-toggle-bar">
          <div
            className="v3-dock-open-panels"
            aria-label={t('chat.dockOpenPanelsAria', {
              count: visiblePanels.length,
              names: openPanelNamesJoin,
              defaultValue: `右侧 Dock 已打开 ${visiblePanels.length} 个面板：${openPanelNamesJoin}`,
            })}
          >
            <span className="v3-dock-open-panels-meta">
              {t('chat.dockOpenPanelsMeta', {
                count: visiblePanels.length,
                defaultValue: `已打开 ${visiblePanels.length} 个`,
              })}
            </span>
            <div className="v3-dock-open-panel-chips" role="list">
              {openPanelsOrdered.map(id => (
                <span key={id} className="v3-dock-open-panel-chip" role="listitem">
                  {panelDefaultTitle(t, id)}
                </span>
              ))}
            </div>
          </div>
          <div className="v3-dock-layout-actions">
            <button
              type="button"
              className="v3-dock-layout-toggle-btn"
              onClick={toggleStackedColumns}
              aria-label={
                dockIsStackedMode
                  ? t('chat.dockLayoutSpreadColumns', { defaultValue: '多列并排' })
                  : t('chat.dockLayoutStackOneColumn', { defaultValue: '单列堆叠' })
              }
              title={
                dockIsStackedMode
                  ? t('chat.dockLayoutSpreadColumns', { defaultValue: '多列并排' })
                  : t('chat.dockLayoutStackOneColumn', { defaultValue: '单列堆叠' })
              }
            >
              {dockIsStackedMode ? <Columns2 size={16} strokeWidth={2} /> : <Rows3 size={16} strokeWidth={2} />}
            </button>
            <button
              type="button"
              className="v3-dock-close-all-btn"
              onClick={onCloseAll}
              aria-label={t('chat.dockCloseAllPanels', { defaultValue: '关闭所有右侧面板' })}
              title={t('chat.dockCloseAllPanels', { defaultValue: '关闭所有右侧面板' })}
            >
              <X size={13} strokeWidth={2.2} />
              <span>{t('common.close', { defaultValue: '关闭' })}</span>
            </button>
          </div>
        </div>
      )}
      <div
        className={`v3-right-dock${isDockDragging ? ' v3-right-dock--dragging' : ''}${soloColumn ? ' v3-right-dock--solo-column' : ''}${multiCol ? ' v3-right-dock--multi-col' : ''}`}
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
                  scheduleDragOverKey(`new-${colIndex}`);
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
                scheduleDragOverKey(`col-${col.id}`);
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
                      scheduleDragOverKey(slotKey);
                    }}
                    onDragLeave={e => {
                      const rel = e.relatedTarget as Node | null;
                      if (rel && e.currentTarget.contains(rel)) return;
                      scheduleDragOverKey(null);
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
    </div>
  );
}
