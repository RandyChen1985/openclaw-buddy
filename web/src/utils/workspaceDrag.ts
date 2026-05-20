/** 工作区文件树拖放 MIME（FileExplorer ↔ 文件夹移动 / 输入框插入路径） */
export const OPENCLAW_FILES_MIME = 'application/x-openclaw-files';

export interface WorkspaceDragItem {
  path: string;
  name: string;
  is_dir: boolean;
  size?: number;
}

export function parseWorkspaceDragItems(dataTransfer: DataTransfer): WorkspaceDragItem[] | null {
  const raw = dataTransfer.getData(OPENCLAW_FILES_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const paths = parsed.filter((p): p is string => typeof p === 'string' && p.length > 0);
      if (paths.length === 0) return null;
      return paths.map(pathToDragItem);
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { v?: number }).v === 2 &&
      Array.isArray((parsed as { items?: unknown }).items)
    ) {
      const items = (parsed as { items: unknown[] }).items
        .map(normalizeDragItem)
        .filter((x): x is WorkspaceDragItem => x !== null);
      return items.length > 0 ? items : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function parseWorkspaceDragPaths(dataTransfer: DataTransfer): string[] | null {
  const items = parseWorkspaceDragItems(dataTransfer);
  return items ? items.map(i => i.path) : null;
}

export function serializeWorkspaceDragItems(items: WorkspaceDragItem[]): string {
  return JSON.stringify({ v: 2, items });
}

export function isWorkspaceFileDragEvent(e: { dataTransfer: DataTransfer }): boolean {
  return Array.from(e.dataTransfer.types || []).includes(OPENCLAW_FILES_MIME);
}

/** 插入输入框时的路径文本（含空格的路径加引号） */
export function formatPathsForInput(paths: string[]): string {
  return paths.map(p => (/\s/.test(p) ? `"${p}"` : p)).join('\n');
}

function pathToDragItem(path: string): WorkspaceDragItem {
  const name = path.split(/[/\\]/).filter(Boolean).pop() || path;
  return { path, name, is_dir: false };
}

function normalizeDragItem(raw: unknown): WorkspaceDragItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.path !== 'string' || !o.path) return null;
  const name =
    typeof o.name === 'string' && o.name
      ? o.name
      : o.path.split(/[/\\]/).filter(Boolean).pop() || o.path;
  return {
    path: o.path,
    name,
    is_dir: Boolean(o.is_dir),
    size: typeof o.size === 'number' ? o.size : 0,
  };
}
