import React, { useState, useEffect, useRef } from 'react';
import {
  Search, CheckSquare, Timer, Shield, Calendar, Sliders, BarChart3, Settings,
  Moon, Sun, Play, Plus, Volume2, Sparkles, X, ArrowRight, Users, StickyNote
} from 'lucide-react';
import { StudyMode, TaskItem, ThemeId } from '../types';
import { THEMES } from '../styles/themes';
import { NavTab } from './Header';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTab: (tab: NavTab) => void;
  modes: StudyMode[];
  tasks: TaskItem[];
  theme: ThemeId;
  onChangeTheme: (themeId: ThemeId) => void;
  onStartSession: (mode: StudyMode, taskIds: string[]) => void;
  onAddTask: (title: string) => TaskItem;
}

interface PaletteItem {
  id: string;
  category: 'Modes' | 'Navigation' | 'Themes' | 'Tasks' | 'Actions';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  action: () => void;
  badge?: string;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onSelectTab,
  modes,
  tasks,
  theme,
  onChangeTheme,
  onStartSession,
  onAddTask,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build all searchable commands
  const allItems: PaletteItem[] = [
    // 1. Navigation
    {
      id: 'nav-tasks',
      category: 'Navigation',
      title: 'Go to Tasks & Control Studio',
      subtitle: 'Primary task queue & control launchpad [1]',
      icon: <CheckSquare className="w-4 h-4 text-sky-500" />,
      action: () => { onSelectTab('tasks'); onClose(); },
      badge: '⌘1',
    },
    {
      id: 'nav-timer',
      category: 'Navigation',
      title: 'Go to Control Timer',
      subtitle: 'Active session countdown & controls [2]',
      icon: <Timer className="w-4 h-4 text-emerald-500" />,
      action: () => { onSelectTab('timer'); onClose(); },
      badge: '⌘2',
    },
    {
      id: 'nav-shield',
      category: 'Navigation',
      title: 'Go to Distraction Shield',
      subtitle: 'macOS DNS blocker configuration [3]',
      icon: <Shield className="w-4 h-4 text-amber-500" />,
      action: () => { onSelectTab('blocker'); onClose(); },
      badge: '⌘3',
    },
    {
      id: 'nav-planner',
      category: 'Navigation',
      title: 'Go to Day Planner',
      subtitle: 'Deterministic schedule optimizer [4]',
      icon: <Calendar className="w-4 h-4 text-violet-500" />,
      action: () => { onSelectTab('planner'); onClose(); },
      badge: '⌘4',
    },
    {
      id: 'nav-modes',
      category: 'Navigation',
      title: 'Go to Study Modes Manager',
      subtitle: 'Customize durations, cycles & blocklists [5]',
      icon: <Sliders className="w-4 h-4 text-pink-500" />,
      action: () => { onSelectTab('modes'); onClose(); },
      badge: '⌘5',
    },
    {
      id: 'nav-history',
      category: 'Navigation',
      title: 'Go to Analytics & History',
      subtitle: 'Lifetime deep work statistics & streaks [6]',
      icon: <BarChart3 className="w-4 h-4 text-cyan-500" />,
      action: () => { onSelectTab('history'); onClose(); },
      badge: '⌘6',
    },
    {
      id: 'nav-settings',
      category: 'Navigation',
      title: 'Go to Preferences & Appearance',
      subtitle: 'Liquid glass themes, audio cues & backup [9]',
      icon: <Settings className="w-4 h-4 text-zinc-400" />,
      action: () => { onSelectTab('settings'); onClose(); },
      badge: '⌘9',
    },
    {
      id: 'nav-rooms',
      category: 'Navigation',
      title: 'Go to Control Rooms',
      subtitle: 'Study together over local Wi-Fi [7]',
      icon: <Users className="w-4 h-4 text-orange-500" />,
      action: () => { onSelectTab('rooms'); onClose(); },
      badge: '⌘7',
    },
    {
      id: 'nav-notes',
      category: 'Navigation',
      title: 'Go to Notes',
      subtitle: 'Quick captures filed by task & mode [8]',
      icon: <StickyNote className="w-4 h-4 text-amber-500" />,
      action: () => { onSelectTab('notes'); onClose(); },
      badge: '⌘8',
    },

    // 2. Study Modes Quick Launch
    ...modes.map((m) => ({
      id: `mode-${m.id}`,
      category: 'Modes' as const,
      title: `Start ${m.name}`,
      subtitle: `${m.workDuration}m Control · ${m.breakDuration}m Rest`,
      icon: <Play className="w-4 h-4 text-emerald-500 fill-current" />,
      action: () => {
        const uncompleted = tasks.filter((t) => !t.completed);
        const taskIds = uncompleted[0] ? [uncompleted[0].id] : [];
        onStartSession(m, taskIds);
        onClose();
      },
      badge: 'Launch',
    })),

    // 3. Themes
    ...Object.values(THEMES).map((t) => ({
      id: `theme-${t.id}`,
      category: 'Themes' as const,
      title: `Switch Theme: ${t.name}`,
      subtitle: `${t.isDark ? 'Dark / Cyber' : 'Light / Frosted'} Liquid Glass Palette`,
      icon: t.isDark ? <Moon className="w-4 h-4 text-sky-400" /> : <Sun className="w-4 h-4 text-amber-500" />,
      action: () => {
        onChangeTheme(t.id);
        onClose();
      },
      badge: theme === t.id ? 'Active' : 'Theme',
    })),

    // 5. Existing Active Tasks
    ...tasks.filter((t) => !t.completed).map((t) => ({
      id: `task-${t.id}`,
      category: 'Tasks' as const,
      title: `Control on: ${t.title}`,
      subtitle: 'Launch with current default control mode',
      icon: <CheckSquare className="w-4 h-4 text-sky-500" />,
      action: () => {
        onStartSession(modes[0], [t.id]);
        onClose();
      },
      badge: 'Task',
    })),
  ];

  // Filter based on query
  const filtered = allItems.filter((item) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      (item.subtitle && item.subtitle.toLowerCase().includes(q))
    );
  });

  // Handle Quick Add if query doesn't match exactly
  const hasExactMatch = filtered.some((f) => f.title.toLowerCase() === query.trim().toLowerCase());
  const canQuickCreate = query.trim().length > 0 && !hasExactMatch;

  // Keyboard navigation inside palette
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filtered.length + (canQuickCreate ? 1 : 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + (filtered.length + (canQuickCreate ? 1 : 0))) % (filtered.length + (canQuickCreate ? 1 : 0)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (canQuickCreate && selectedIndex === 0) {
        const newTask = onAddTask(query.trim());
        onStartSession(modes[0], [newTask.id]);
        onClose();
      } else {
        const idx = canQuickCreate ? selectedIndex - 1 : selectedIndex;
        if (filtered[idx]) {
          filtered[idx].action();
        }
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 select-none">
      {/* Backdrop */}
      <div 
        onClick={onClose}
        className="absolute inset-0 bg-transparent transition-opacity duration-200"
      />

      {/* Palette Card */}
      <div
        className="relative w-full max-w-2xl rounded-3xl border shadow-2xl z-10 overflow-hidden flex flex-col animate-modal-in max-h-[75vh]"
        style={{
          backgroundColor: isDark ? '#0e101a' : '#ffffff',
          borderColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.12)',
        }}
      >
        {/* Search Input Bar */}
        <div 
          className="flex items-center px-5 py-4 border-b space-x-3"
          style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
        >
          <Search className="w-5 h-5 text-sky-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command, task, theme, soundscape, or study mode..."
            className="flex-1 bg-transparent text-base font-semibold outline-none placeholder-zinc-500"
            style={{ color: currentTheme.textPrimary }}
          />
          <kbd 
            className="text-[10px] font-mono px-2 py-1 rounded-lg liquid-glass border font-bold"
            style={{ color: currentTheme.textMuted }}
          >
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {/* Quick Create Task Action if typing */}
          {canQuickCreate && (
            <div
              onClick={() => {
                const newTask = onAddTask(query.trim());
                onStartSession(modes[0], [newTask.id]);
                onClose();
              }}
              className={`p-3 rounded-2xl flex items-center justify-between cursor-pointer transition-all ${
                selectedIndex === 0
                  ? isDark
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40 shadow-sm'
                    : 'bg-sky-50 text-sky-900 border border-sky-300 shadow-sm'
                  : 'hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-xl bg-sky-500 text-white shadow-md">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <span 
                    className="text-sm font-bold block"
                    style={{ color: currentTheme.textPrimary }}
                  >
                    Create & Control: "{query.trim()}"
                  </span>
                  <span 
                    className="text-xs"
                    style={{ color: currentTheme.textSecondary }}
                  >
                    Add new task and start control session immediately
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-500 font-bold">
                ↵ Enter
              </span>
            </div>
          )}

          {filtered.map((item, index) => {
            const actualIndex = canQuickCreate ? index + 1 : index;
            const isSelected = selectedIndex === actualIndex;

            return (
              <div
                key={item.id}
                onClick={item.action}
                onMouseEnter={() => setSelectedIndex(actualIndex)}
                className={`p-3 rounded-2xl flex items-center justify-between cursor-pointer transition-all ${
                  isSelected
                    ? isDark
                      ? 'bg-white/15 border border-white/20 shadow-md'
                      : 'bg-black/8 border border-black/10 shadow-sm'
                    : 'border border-transparent hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                <div className="flex items-center space-x-3.5 min-w-0">
                  <div 
                    className="p-2 rounded-xl liquid-glass shrink-0"
                    style={{ color: currentTheme.textPrimary }}
                  >
                    {item.icon}
                  </div>
                  <div className="min-w-0">
                    <span 
                      className="text-sm font-bold block truncate"
                      style={{ color: currentTheme.textPrimary }}
                    >
                      {item.title}
                    </span>
                    {item.subtitle && (
                      <span 
                        className="text-xs block truncate"
                        style={{ color: currentTheme.textSecondary }}
                      >
                        {item.subtitle}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-2 shrink-0 ml-3">
                  {item.badge && (
                    <span 
                      className="text-[10px] font-mono px-2 py-0.5 rounded-full liquid-glass border font-semibold"
                      style={{ color: currentTheme.textSecondary }}
                    >
                      {item.badge}
                    </span>
                  )}
                  {isSelected && (
                    <ArrowRight className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  )}
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && !canQuickCreate && (
            <div 
              className="py-12 text-center text-xs font-mono"
              style={{ color: currentTheme.textMuted }}
            >
              No matching commands or tasks found. Try typing a task name to create it.
            </div>
          )}
        </div>

        {/* Footer Shortcut Bar */}
        <div 
          className="px-5 py-2.5 border-t flex items-center justify-between text-[11px] font-mono"
          style={{ 
            borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
            color: currentTheme.textMuted 
          }}
        >
          <div className="flex items-center space-x-3">
            <span>↑↓ Navigate</span>
            <span>·</span>
            <span>↵ Select</span>
            <span>·</span>
            <span>ESC Close</span>
          </div>
          <span>Control Spotlight</span>
        </div>
      </div>
    </div>
  );
};
