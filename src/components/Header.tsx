import React from 'react';
import {
  CheckSquare, Timer, Shield, Calendar, Sliders, BarChart3, Settings,
  Moon, Sun, Power, Search, StickyNote
} from 'lucide-react';
import { ThemeId, ActiveSessionState } from '../types';
import { THEMES } from '../styles/themes';
import appIconLight from '../assets/icon-light.png';
import appIconDark from '../assets/icon-dark.png';

export type NavTab = 'tasks' | 'launcher' | 'timer' | 'modes' | 'planner' | 'blocker' | 'history' | 'settings' | 'notes';

interface HeaderProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  activeSession: ActiveSessionState | null;
  theme: ThemeId;
  onToggleTheme: () => void;
  onRequestLeave: () => void;
  onOpenCommandPalette: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  activeSession,
  theme,
  onToggleTheme,
  onRequestLeave,
  onOpenCommandPalette,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;
  const appIcon = isDark ? appIconDark : appIconLight;

  return (
    <header
      className="relative z-40 w-full flex items-center justify-between px-6 pt-3 pb-2 select-none"
      style={{
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* Left: Window Traffic Lights Spacer + Brand Monogram + Command Palette Search Pill */}
      <div
        className="flex items-center space-x-2.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* macOS traffic light spacer */}
        <div className="w-16" />

        <button
          onClick={() => onSelectTab('tasks')}
          className="flex items-center space-x-2.5 px-3 py-1.5 rounded-full liquid-glass border transition-all active:scale-95 cursor-pointer group"
          title="Control Studio"
        >
          <img
            src={appIcon}
            alt="Control"
            className="w-4 h-4 rounded-[4px] object-cover group-hover:scale-110 transition-transform shadow-sm"
          />
          <span 
            className="font-mono text-xs font-bold tracking-widest uppercase transition-colors"
            style={{ color: currentTheme.textPrimary }}
          >
            CONTROL
          </span>
        </button>

        {/* Omni Spotlight / Command Palette Button (Cmd+K) */}
        <button
          onClick={onOpenCommandPalette}
          className="flex items-center space-x-2 px-3 py-1.5 rounded-full liquid-glass border transition-all hover:scale-[1.02] active:scale-95 cursor-pointer shadow-sm"
          style={{ color: currentTheme.textSecondary }}
          title="Open Command Palette (⌘K)"
        >
          <Search className="w-3.5 h-3.5 text-sky-500" />
          <span className="text-xs font-semibold hidden md:inline">Command Search</span>
          <kbd 
            className="text-[10px] font-mono px-1.5 py-0.2 rounded-md font-bold"
            style={{ 
              backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
              color: currentTheme.textPrimary 
            }}
          >
            ⌘K
          </kbd>
        </button>

        {/* Live Active Session Chip in Island */}
        {activeSession && (
          <button
            onClick={() => onSelectTab('timer')}
            className="flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all hover:scale-105 bg-sky-500/15 border border-sky-400/40 text-sky-400 hover:bg-sky-500/25 cursor-pointer shadow-[0_0_15px_rgba(56,189,248,0.25)] group"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-400"></span>
            </span>
            <span className="truncate max-w-[120px]">{activeSession.modeName}</span>
            <span className="text-[10px] font-mono opacity-80 px-1 py-0.2 bg-sky-400/20 rounded">LIVE</span>
          </button>
        )}
      </div>

      {/* Center: Floating Liquid Frosted Glass Dynamic Navigation Dock */}
      <nav
        className="flex items-center p-1 rounded-full liquid-glass-dock shadow-2xl space-x-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Tab 1: Tasks & Studio (Primary) */}
        <button
          onClick={() => onSelectTab('tasks')}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 cursor-pointer ${
            activeTab === 'tasks' || activeTab === 'launcher'
              ? isDark
                ? 'bg-white/15 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_4px_12px_rgba(0,0,0,0.3)] border border-white/15'
                : 'bg-white text-zinc-900 shadow-md border border-black/8 font-bold'
              : isDark
              ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent'
              : 'text-zinc-600 hover:text-zinc-900 hover:bg-black/5 border border-transparent'
          }`}
          title="Tasks & Control Hub [1]"
        >
          <CheckSquare className="w-3.5 h-3.5 text-sky-500" />
          <span>Tasks</span>
        </button>

        {/* Tab 2: Timer */}
        <button
          onClick={() => onSelectTab('timer')}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 cursor-pointer ${
            activeTab === 'timer'
              ? isDark
                ? 'bg-white/15 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_4px_12px_rgba(0,0,0,0.3)] border border-white/15'
                : 'bg-white text-zinc-900 shadow-md border border-black/8 font-bold'
              : isDark
              ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent'
              : 'text-zinc-600 hover:text-zinc-900 hover:bg-black/5 border border-transparent'
          }`}
          title="Control Timer [2]"
        >
          <Timer className="w-3.5 h-3.5 text-emerald-500" />
          <span>Timer</span>
        </button>

        {/* Tab 3: Distraction Shield */}
        <button
          onClick={() => onSelectTab('blocker')}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 cursor-pointer ${
            activeTab === 'blocker'
              ? isDark
                ? 'bg-white/15 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_4px_12px_rgba(0,0,0,0.3)] border border-white/15'
                : 'bg-white text-zinc-900 shadow-md border border-black/8 font-bold'
              : isDark
              ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent'
              : 'text-zinc-600 hover:text-zinc-900 hover:bg-black/5 border border-transparent'
          }`}
          title="Distraction Shield [3]"
        >
          <Shield className="w-3.5 h-3.5 text-amber-500" />
          <span>Shield</span>
        </button>

        {/* Tab 4: Day Planner */}
        <button
          onClick={() => onSelectTab('planner')}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 cursor-pointer ${
            activeTab === 'planner'
              ? isDark
                ? 'bg-white/15 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_4px_12px_rgba(0,0,0,0.3)] border border-white/15'
                : 'bg-white text-zinc-900 shadow-md border border-black/8 font-bold'
              : isDark
              ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent'
              : 'text-zinc-600 hover:text-zinc-900 hover:bg-black/5 border border-transparent'
          }`}
          title="Day Planner [4]"
        >
          <Calendar className="w-3.5 h-3.5 text-violet-500" />
          <span>Planner</span>
        </button>

        {/* Tab 5: Custom Modes */}
        <button
          onClick={() => onSelectTab('modes')}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 cursor-pointer ${
            activeTab === 'modes'
              ? isDark
                ? 'bg-white/15 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_4px_12px_rgba(0,0,0,0.3)] border border-white/15'
                : 'bg-white text-zinc-900 shadow-md border border-black/8 font-bold'
              : isDark
              ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent'
              : 'text-zinc-600 hover:text-zinc-900 hover:bg-black/5 border border-transparent'
          }`}
          title="Custom Study Modes [5]"
        >
          <Sliders className="w-3.5 h-3.5 text-pink-500" />
          <span>Modes</span>
        </button>

        {/* Tab 6: History & Stats */}
        <button
          onClick={() => onSelectTab('history')}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 cursor-pointer ${
            activeTab === 'history'
              ? isDark
                ? 'bg-white/15 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_4px_12px_rgba(0,0,0,0.3)] border border-white/15'
                : 'bg-white text-zinc-900 shadow-md border border-black/8 font-bold'
              : isDark
              ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent'
              : 'text-zinc-600 hover:text-zinc-900 hover:bg-black/5 border border-transparent'
          }`}
          title="Control Analytics [6]"
        >
          <BarChart3 className="w-3.5 h-3.5 text-cyan-500" />
          <span>Stats</span>
        </button>

        {/* Tab: Notes */}
        <button
          onClick={() => onSelectTab('notes')}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 cursor-pointer ${
            activeTab === 'notes'
              ? isDark
                ? 'bg-white/15 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_4px_12px_rgba(0,0,0,0.3)] border border-white/15'
                : 'bg-white text-zinc-900 shadow-md border border-black/8 font-bold'
              : isDark
              ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent'
              : 'text-zinc-600 hover:text-zinc-900 hover:bg-black/5 border border-transparent'
          }`}
          title="Notes [7]"
        >
          <StickyNote className="w-3.5 h-3.5 text-amber-500" />
          <span>Notes</span>
        </button>
      </nav>

      {/* Right: Theme Toggle, Settings & Exit */}
      <div
        className="flex items-center space-x-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Theme Toggle (Light / Dark) with Smooth Spin */}
        <button
          onClick={onToggleTheme}
          className="p-2 rounded-full liquid-glass border transition-all hover:scale-105 active:scale-95 cursor-pointer group"
          style={{ color: currentTheme.textSecondary }}
          title={isDark ? 'Switch to Modern Light Theme' : 'Switch to Obsidian Dark Theme'}
        >
          {isDark ? (
            <Sun className="w-3.5 h-3.5 text-amber-400 group-hover:rotate-45 transition-transform duration-300" />
          ) : (
            <Moon className="w-3.5 h-3.5 text-indigo-500 group-hover:-rotate-12 transition-transform duration-300" />
          )}
        </button>

        {/* Settings */}
        <button
          onClick={() => onSelectTab('settings')}
          className="p-2 rounded-full liquid-glass border transition-all hover:scale-105 active:scale-95 cursor-pointer"
          style={{
            color: activeTab === 'settings' ? currentTheme.accent : currentTheme.textSecondary,
            backgroundColor: activeTab === 'settings' ? (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)') : undefined,
          }}
          title="Settings [8]"
        >
          <Settings className="w-3.5 h-3.5 hover:rotate-90 transition-transform duration-500" />
        </button>

        {/* Exit App Button */}
        <button
          onClick={onRequestLeave}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-rose-500/10 border border-rose-500/25 text-rose-500 hover:bg-rose-500/20 hover:border-rose-500/40 text-xs font-semibold transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-sm"
          title="Exit Control"
        >
          <Power className="w-3.5 h-3.5" />
          <span>Exit</span>
        </button>
      </div>
    </header>
  );
};
