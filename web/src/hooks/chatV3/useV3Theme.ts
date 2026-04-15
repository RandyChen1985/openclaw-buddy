import { useCallback, useMemo, useState } from 'react';
import storage from '../../utils/storage';

export type V3ThemeMode = 'preset' | 'custom';

export type V3ThemePresetId =
  | 'enterprise'
  | 'slate'
  | 'slateV2'
  | 'ocean'
  | 'grape'
  | 'mint'
  | 'amber'
  | 'highContrast';

export type V3ThemeTokens = Partial<Record<
  | '--v3-primary'
  | '--v3-primary-strong'
  | '--v3-surface'
  | '--v3-surface-muted'
  | '--v3-border'
  | '--v3-text'
  | '--v3-text-muted'
  | '--v3-user-bubble'
  | '--v3-user-bubble-shadow'
  | '--v3-user-text'
  | '--v3-user-text-muted'
  | '--v3-user-surface'
  | '--v3-user-border'
  | '--v3-link'
  | '--v3-link-user',
  string
>>;

export interface V3ThemePreset {
  id: V3ThemePresetId;
  name: string;
  description: string;
  /**
   * 仅作为预览用的小色块（不会强制覆盖 tokens）。
   */
  swatches: { primary: string; surface: string; userBubble: string };
}

const LS_KEYS = {
  mode: 'v3_theme_mode',
  preset: 'v3_theme_preset',
  custom: 'v3_theme_custom_tokens'
} as const;

const PRESETS: V3ThemePreset[] = [
  {
    id: 'enterprise',
    name: '企业蓝紫',
    description: '克制、清爽、默认推荐',
    swatches: { primary: '#4f46e5', surface: '#ffffff', userBubble: '#4b5bdc' }
  },
  {
    id: 'slate',
    name: '沉稳灰蓝',
    description: '更低饱和，更像企业控制台',
    swatches: { primary: '#334155', surface: '#ffffff', userBubble: '#475569' }
  },
  {
    id: 'slateV2',
    name: '沉稳灰蓝V2',
    description: '在沉稳灰蓝基础上整体提亮，更轻盈',
    swatches: { primary: '#475569', surface: '#ffffff', userBubble: '#64748b' }
  },
  {
    id: 'ocean',
    name: '海盐蓝',
    description: '更清透的蓝系，适合长对话',
    swatches: { primary: '#2563eb', surface: '#ffffff', userBubble: '#1d4ed8' }
  },
  {
    id: 'grape',
    name: '葡萄紫',
    description: '更偏紫但仍克制',
    swatches: { primary: '#6d28d9', surface: '#ffffff', userBubble: '#5b21b6' }
  },
  {
    id: 'mint',
    name: '薄荷青',
    description: '更清新的青绿点缀，克制不跳脱',
    swatches: { primary: '#0f766e', surface: '#ffffff', userBubble: '#0f766e' }
  },
  {
    id: 'amber',
    name: '琥珀金',
    description: '偏暖的企业风，适合运营台/数据台',
    swatches: { primary: '#b45309', surface: '#ffffff', userBubble: '#b45309' }
  },
  {
    id: 'highContrast',
    name: '高对比（可读性）',
    description: '对比度优先，适合大屏/弱视场景',
    swatches: { primary: '#111827', surface: '#ffffff', userBubble: '#111827' }
  }
];

function safeParseJSON<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function isValidPresetId(v: any): v is V3ThemePresetId {
  return PRESETS.some(p => p.id === v);
}

/**
 * v3 主题管理：
 * - 支持多套内置预设
 * - 支持用户自定义调色盘（本地持久化）
 *
 * 输出：
 * - `rootAttrs`：用于挂到 `.chat-v3-root`（data 属性 + 可选 inline CSS vars）
 * - `presets`：预设列表（供 UI 渲染）
 */
export function useV3Theme() {
  const [mode, setModeState] = useState<V3ThemeMode>(() => {
    const v = storage.getItem(LS_KEYS.mode);
    return (v === 'custom' || v === 'preset') ? v : 'preset';
  });

  const [presetId, setPresetIdState] = useState<V3ThemePresetId>(() => {
    const v = storage.getItem(LS_KEYS.preset);
    return isValidPresetId(v) ? v : 'slateV2';
  });

  const [customTokens, setCustomTokensState] = useState<V3ThemeTokens>(() => {
    const parsed = safeParseJSON<V3ThemeTokens>(storage.getItem(LS_KEYS.custom));
    return parsed && typeof parsed === 'object' ? parsed : {};
  });

  /**
   * 设置主题模式并持久化。
   */
  const setMode = useCallback((next: V3ThemeMode) => {
    setModeState(next);
    storage.setItem(LS_KEYS.mode, next);
  }, []);

  /**
   * 选择预设主题并持久化。
   */
  const setPresetId = useCallback((next: V3ThemePresetId) => {
    setPresetIdState(next);
    storage.setItem(LS_KEYS.preset, next);
  }, []);

  /**
   * 更新自定义 tokens（会覆盖同名变量），并持久化。
   */
  const setCustomTokens = useCallback((updater: (prev: V3ThemeTokens) => V3ThemeTokens) => {
    setCustomTokensState(prev => {
      const next = updater(prev);
      storage.setItem(LS_KEYS.custom, JSON.stringify(next));
      return next;
    });
  }, []);

  /**
   * 重置自定义 tokens。
   */
  const resetCustomTokens = useCallback(() => {
    setCustomTokensState({});
    storage.removeItem(LS_KEYS.custom);
  }, []);

  const rootAttrs = useMemo(() => {
    const dataTheme = mode === 'preset' ? presetId : 'custom';
    const styleVars = mode === 'custom' ? (customTokens as any) : undefined;
    return {
      'data-v3-theme': dataTheme,
      styleVars
    };
  }, [customTokens, mode, presetId]);

  return useMemo(() => {
    return {
      mode,
      presetId,
      customTokens,
      presets: PRESETS,
      setMode,
      setPresetId,
      setCustomTokens,
      resetCustomTokens,
      rootAttrs
    };
  }, [customTokens, mode, presetId, resetCustomTokens, rootAttrs, setCustomTokens, setMode, setPresetId]);
}

