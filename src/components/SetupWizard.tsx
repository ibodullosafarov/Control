import React, { useState, useRef, useEffect } from 'react';
import { ThemeId } from '../types';
import { THEMES } from '../styles/themes';
import appIcon from '../assets/icon.png';

interface SetupWizardProps {
  theme: ThemeId;
  onComplete: (name: string) => void;
}

/**
 * First-run setup wizard. Shown once on fresh installs (setupCompleted=false)
 * before the main interface — asks for the name used across greetings,
 * the opening experience, and session summaries.
 */
export const SetupWizard: React.FC<SetupWizardProps> = ({ theme, onComplete }) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    console.log('[Setup] First-run wizard displayed');
  }, []);

  const trimmed = name.trim().slice(0, 40);
  const handleDone = () => {
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }
    onComplete(trimmed);
  };

  return (
    <div
      data-theme-mode={isDark ? 'dark' : 'light'}
      className="flex items-center justify-center h-screen overflow-hidden font-semibold transition-colors duration-300 relative"
      style={{ backgroundColor: currentTheme.bgPrimary, color: currentTheme.textPrimary }}
    >
      {/* Background Ambient Aura Glow Lights */}
      <div
        className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full pointer-events-none ambient-orb-1 opacity-60"
        style={{
          background: isDark
            ? 'radial-gradient(circle, rgba(56, 189, 248, 0.15) 0%, rgba(56, 189, 248, 0) 70%)'
            : 'radial-gradient(circle, rgba(56, 189, 248, 0.18) 0%, rgba(56, 189, 248, 0) 70%)',
        }}
      />
      <div
        className="absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full pointer-events-none ambient-orb-2 opacity-60"
        style={{
          background: isDark
            ? 'radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, rgba(99, 102, 241, 0) 70%)'
            : 'radial-gradient(circle, rgba(99, 102, 241, 0.18) 0%, rgba(99, 102, 241, 0) 70%)',
        }}
      />

      <div className="relative z-10 w-full max-w-md px-6">
        <div
          className="p-8 rounded-3xl liquid-glass-elevated border shadow-2xl space-y-6"
          style={{ borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)' }}
        >
          <div className="flex flex-col items-center text-center space-y-3">
            <img
              src={appIcon}
              alt="Control"
              className="w-14 h-14 rounded-2xl object-cover shadow-lg"
            />
            <div className="space-y-1">
              <h1
                className="text-lg font-bold tracking-tight"
                style={{ color: currentTheme.textPrimary }}
              >
                Welcome to Control
              </h1>
              <p className="text-xs font-medium" style={{ color: currentTheme.textMuted }}>
                Your personal study & focus system. One quick thing before we start —
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="setup-name"
              className="block text-[11px] font-mono uppercase tracking-wider font-bold text-sky-500"
            >
              What should we call you?
            </label>
            <input
              id="setup-name"
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDone()}
              placeholder="Your name"
              maxLength={40}
              className="w-full px-4 py-3 rounded-xl liquid-glass-input border text-sm font-semibold outline-none"
              style={{ color: currentTheme.textPrimary }}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[11px] font-medium" style={{ color: currentTheme.textMuted }}>
              Used in your greetings and session summaries. You can change it anytime in
              Settings.
            </p>
          </div>

          <button
            onClick={handleDone}
            disabled={!trimmed}
            className="w-full px-4 py-3 rounded-xl text-sm font-bold text-white cursor-pointer disabled:opacity-40 transition-all active:scale-[0.98] hover:brightness-110"
            style={{ backgroundColor: '#007aff' }}
          >
            Start Focusing →
          </button>
        </div>

        <p
          className="mt-4 text-center text-[11px] font-medium"
          style={{ color: currentTheme.textMuted }}
        >
          Everything lives locally — sessions, tasks, and your Obsidian vault.
        </p>
      </div>
    </div>
  );
};

export default SetupWizard;
