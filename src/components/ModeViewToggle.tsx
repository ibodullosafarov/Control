import React, { useState } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { ThemeId } from '../types';
import { THEMES } from '../styles/themes';

export type ModeView = 'grid' | 'list';

/** Shared grid/list preference for pickers and libraries. Defaults to grid. */

/** Shared grid/list preference for pickers and libraries. Defaults to grid. */
export function useModeViewPref(storageKey = 'control-mode-view'): [ModeView, (v: ModeView) => void] {
  const LEGACY_KEY = 'focus-mode-view';
  const [view, setView] = useState<ModeView>(() => {
    try {
      // Pre-rename key fallback (one-time read; writes go to the new key).
      const raw = localStorage.getItem(storageKey) || (storageKey === 'control-mode-view' ? localStorage.getItem(LEGACY_KEY) : null);
      return raw === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const set = (v: ModeView) => {
    setView(v);
    try {
      localStorage.setItem(storageKey, v);
    } catch {
      /* private mode etc. — preference just won't persist */
    }
  };
  return [view, set];
}

interface ModeViewToggleProps {
  view: ModeView;
  onChange: (v: ModeView) => void;
  theme: ThemeId;
}

/** Small segmented grid/list switcher matching the app's pill language. */
export const ModeViewToggle: React.FC<ModeViewToggleProps> = ({ view, onChange, theme }) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;
  const btn = (active: boolean) =>
    `p-1.5 rounded-lg transition-all cursor-pointer ${
      active
        ? isDark
          ? 'bg-white/15 text-white shadow-sm'
          : 'bg-black/10 text-zinc-900 shadow-sm'
        : 'text-zinc-500 hover:text-zinc-300'
    }`;
  return (
    <div
      className="flex items-center gap-0.5 p-0.5 rounded-xl liquid-glass border"
      style={{ color: currentTheme.textSecondary }}
      title="Toggle grid / list view"
    >
      <button onClick={() => onChange('grid')} className={btn(view === 'grid')} title="Grid view">
        <LayoutGrid className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => onChange('list')} className={btn(view === 'list')} title="List view">
        <List className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
