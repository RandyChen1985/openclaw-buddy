export type V3DockPanelId = 'debug' | 'terminal' | 'explorer' | 'canvas';

export const V3_DOCK_PANEL_ORDER: V3DockPanelId[] = ['debug', 'terminal', 'explorer', 'canvas'];

export const V3_DOCK_MIME = 'application/x-v3-dock-panel';

export interface V3DockColumn {
  id: string;
  panelIds: V3DockPanelId[];
}

export interface V3DockLayout {
  columns: V3DockColumn[];
  /** 列宽（px）；未设置时用默认宽度均分 */
  columnWidths: Record<string, number>;
}

const STORAGE_KEY = 'v3_right_dock_layout_v1';
const DEFAULT_COL_WIDTH = 400;
const MIN_COL_WIDTH = 280;
const MAX_COL_WIDTH = 800;

export function genDockColumnId(): string {
  return `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function loadDockLayout(): V3DockLayout | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as V3DockLayout;
    if (!parsed?.columns?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDockLayout(layout: V3DockLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* ignore quota */
  }
}

/** 每个可见面板默认占一列（与图二多列布局一致） */
export function defaultDockLayout(visible: V3DockPanelId[]): V3DockLayout {
  const columns = visible.map(panelId => ({
    id: genDockColumnId(),
    panelIds: [panelId],
  }));
  const columnWidths: Record<string, number> = {};
  columns.forEach(c => {
    columnWidths[c.id] = DEFAULT_COL_WIDTH;
  });
  return { columns, columnWidths };
}

/** 单列纵向堆叠：一列内按固定顺序排列所有可见面板 */
export function stackedSingleColumnLayout(visible: V3DockPanelId[]): V3DockLayout {
  const orderedVisible = V3_DOCK_PANEL_ORDER.filter(id => visible.includes(id));
  if (orderedVisible.length === 0) {
    return { columns: [], columnWidths: {} };
  }
  const colId = genDockColumnId();
  return {
    columns: [{ id: colId, panelIds: [...orderedVisible] }],
    columnWidths: { [colId]: DEFAULT_COL_WIDTH },
  };
}

/**
 * 是否为「单列且含全部可见面板」（与多列/分列区分）。
 * 用于在单列堆叠 ↔ 多列并排之间切换。
 */
export function isRoughlyStackedLayout(layout: V3DockLayout, visible: V3DockPanelId[]): boolean {
  if (visible.length <= 1) return false;
  if (layout.columns.length !== 1) return false;
  const pids = layout.columns[0].panelIds;
  if (pids.length !== visible.length) return false;
  const vset = new Set(visible);
  return pids.every(id => vset.has(id));
}

function cloneLayout(layout: V3DockLayout): V3DockLayout {
  return {
    columns: layout.columns.map(c => ({ id: c.id, panelIds: [...c.panelIds] })),
    columnWidths: { ...layout.columnWidths },
  };
}

/** 从布局中移除面板，并删掉空列 */
function removePanelFromLayout(layout: V3DockLayout, panelId: V3DockPanelId): V3DockLayout {
  const next = cloneLayout(layout);
  next.columns = next.columns
    .map(c => ({ ...c, panelIds: c.panelIds.filter(id => id !== panelId) }))
    .filter(c => c.panelIds.length > 0);
  const validIds = new Set(next.columns.map(c => c.id));
  Object.keys(next.columnWidths).forEach(id => {
    if (!validIds.has(id)) delete next.columnWidths[id];
  });
  return next;
}

/** 打开/关闭面板时与布局同步：关闭的移除，新开的追加到最右新列 */
export function syncDockLayoutWithVisible(layout: V3DockLayout | null, visible: V3DockPanelId[]): V3DockLayout {
  const orderedVisible = V3_DOCK_PANEL_ORDER.filter(id => visible.includes(id));
  if (orderedVisible.length === 0) {
    return { columns: [], columnWidths: {} };
  }

  let base = layout?.columns?.length ? cloneLayout(layout) : defaultDockLayout(orderedVisible);

  // 移除不可见面板
  for (const id of V3_DOCK_PANEL_ORDER) {
    if (!visible.includes(id)) {
      base = removePanelFromLayout(base, id);
    }
  }

  // 追加尚未在布局中的面板
  const placed = new Set(base.columns.flatMap(c => c.panelIds));
  for (const panelId of orderedVisible) {
    if (placed.has(panelId)) continue;
    const colId = genDockColumnId();
    base.columns.push({ id: colId, panelIds: [panelId] });
    base.columnWidths[colId] = DEFAULT_COL_WIDTH;
  }

  if (base.columns.length === 0) {
    return defaultDockLayout(orderedVisible);
  }

  return base;
}

export type V3DockDropTarget =
  | { type: 'new-column'; columnIndex: number }
  | { type: 'stack'; columnId: string; afterPanelId?: V3DockPanelId };

/** 将面板移动到目标列或新建列 */
export function moveDockPanel(layout: V3DockLayout, panelId: V3DockPanelId, target: V3DockDropTarget): V3DockLayout {
  let next = removePanelFromLayout(layout, panelId);
  if (target.type === 'new-column') {
    const colId = genDockColumnId();
    const col: V3DockColumn = { id: colId, panelIds: [panelId] };
    const idx = Math.max(0, Math.min(target.columnIndex, next.columns.length));
    next.columns.splice(idx, 0, col);
    next.columnWidths[colId] = next.columnWidths[colId] ?? DEFAULT_COL_WIDTH;
    return next;
  }

  const col = next.columns.find(c => c.id === target.columnId);
  if (!col) {
    const colId = genDockColumnId();
    next.columns.push({ id: colId, panelIds: [panelId] });
    next.columnWidths[colId] = DEFAULT_COL_WIDTH;
    return next;
  }

  if (target.afterPanelId) {
    const i = col.panelIds.indexOf(target.afterPanelId);
    if (i >= 0) col.panelIds.splice(i + 1, 0, panelId);
    else col.panelIds.push(panelId);
  } else {
    col.panelIds.push(panelId);
  }
  return next;
}

export function getColumnWidth(layout: V3DockLayout, columnId: string): number {
  const w = layout.columnWidths[columnId];
  if (typeof w === 'number' && w >= MIN_COL_WIDTH) {
    return Math.min(MAX_COL_WIDTH, w);
  }
  return DEFAULT_COL_WIDTH;
}

export function setColumnWidth(layout: V3DockLayout, columnId: string, width: number): V3DockLayout {
  const next = cloneLayout(layout);
  next.columnWidths[columnId] = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, width));
  return next;
}

function parsePanelId(raw: string): V3DockPanelId | null {
  if (raw === 'debug' || raw === 'terminal' || raw === 'explorer' || raw === 'canvas') return raw;
  return null;
}

/** 浏览器在 dragover 阶段通常读不到自定义 MIME，drop 时再读；可配合 draggingRef */
export function isDockDragEvent(e: { dataTransfer: DataTransfer }, draggingId?: V3DockPanelId | null): boolean {
  if (draggingId) return true;
  const types = Array.from(e.dataTransfer.types || []);
  return types.includes(V3_DOCK_MIME);
}

/** 是否为右侧 Dock 面板拖放（非文件上传），用于聊天区等拒绝接收 */
export function isDockPanelDragEvent(e: { dataTransfer: DataTransfer }): boolean {
  const types = Array.from(e.dataTransfer.types || []);
  if (types.includes(V3_DOCK_MIME)) return true;
  if (types.includes('Files')) return false;
  if (!types.includes('text/plain')) return false;
  
  // dragenter/dragover 阶段部分浏览器读不到 getData，Dock 拖动用 effectAllowed=move 且无 Files
  if (e.dataTransfer.effectAllowed === 'move') return true;
  
  try {
    const plain = e.dataTransfer.getData('text/plain');
    if (plain && parsePanelId(plain)) return true;
  } catch {
    // 忽略安全沙箱下禁止读取 getData 抛出的异常
  }
  
  return false;
}

export function readDraggedPanelId(
  e: { dataTransfer: DataTransfer },
  draggingRef?: V3DockPanelId | null,
): V3DockPanelId | null {
  const fromMime = parsePanelId(e.dataTransfer.getData(V3_DOCK_MIME));
  if (fromMime) return fromMime;
  const fromText = parsePanelId(e.dataTransfer.getData('text/plain'));
  if (fromText) return fromText;
  return draggingRef ?? null;
}

export function panelTitleKey(panelId: V3DockPanelId): string {
  switch (panelId) {
    case 'debug':
      return 'chat.debugLogs';
    case 'terminal':
      return 'common.terminal';
    case 'explorer':
      return 'bots.workspace';
    case 'canvas':
      return 'chat.canvas';
    default:
      return 'common.panel';
  }
}
