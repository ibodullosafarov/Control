import React, { useEffect, useRef, useState } from 'react';
import { THEMES } from '../styles/themes';
import type { ThemeId } from '../types';

const VALID_THEMES = new Set<string>([
  'moder', 'soft_paper', 'lavender', 'matcha', 'sunset', 'abyss', 'paper',
  'serika', 'carbon', 'nord', 'emerald', 'dracula', 'mocha',
]);

/**
 * Standalone quick-capture window (opened with ?capture=1 from the global
 * shortcut or the menu-bar item). Deliberately tiny and dependency-free:
 * type, save, done. Attribution to the active task/mode happens in the
 * main process at save time. Themed via ?theme=<id> from the main window.
 */
export const QuickCapture: React.FC = () => {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const themeParam = new URLSearchParams(window.location.search).get('theme');
  const themeId: ThemeId =
    themeParam && VALID_THEMES.has(themeParam) ? (themeParam as ThemeId) : 'serika';
  const t = THEMES[themeId] || THEMES.serika;

  useEffect(() => {
    areaRef.current?.focus();
  }, []);

  const save = async () => {
    const content = text.trim();
    if (!content || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await window.controlAPI?.saveQuickNote(content);
      if (res?.success) {
        window.close();
        return;
      }
      setError(res?.error || 'Could not save the note.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="flex flex-col h-screen p-3 gap-2"
      style={{
        backgroundColor: t.bgPrimary,
        color: t.textPrimary,
        colorScheme: t.isDark ? 'dark' : 'light',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <div className="flex items-center justify-between">
        <span
          className="font-mono text-[10px] font-bold tracking-[0.18em] uppercase"
          style={{ color: t.textMuted }}
        >
          Quick Note
        </span>
        <span className="font-mono text-[10px]" style={{ color: t.textMuted }}>
          Esc to dismiss
        </span>
      </div>
      <textarea
        ref={areaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') window.close();
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void save();
        }}
        placeholder="Capture it before it evaporates…"
        className="flex-1 resize-none rounded-xl p-3 text-sm outline-none"
        style={{
          backgroundColor: t.bgSecondary,
          border: `1px solid ${t.border}`,
          color: t.textPrimary,
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      />
      {error && (
        <span className="text-[11px] font-semibold" style={{ color: t.danger }}>
          {error}
        </span>
      )}
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <span className="font-mono text-[10px] flex-1" style={{ color: t.textMuted }}>
          Saves to your current task &amp; mode
        </span>
        <button
          onClick={() => void save()}
          disabled={!text.trim() || saving}
          className="px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-40"
          style={{ backgroundColor: t.accent, color: t.accentText }}
        >
          {saving ? 'Saving…' : 'Save ⌘↵'}
        </button>
      </div>
    </div>
  );
};
