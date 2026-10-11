import React, { useState, useEffect } from 'react';
import confetti from 'canvas-confetti';
import { 
  Plus, Check, Trash2, ArrowUp, ArrowDown, Play, CheckCircle2, Circle, 
  ShieldCheck, Shield, ChevronRight, Zap, X, Sparkles, Layers, Calendar,
  FolderSync
} from 'lucide-react';
import { TaskItem, StudyMode, ThemeId, ObsidianConfig } from '../types';
import { THEMES } from '../styles/themes';
import { DEFAULT_BLOCKLIST } from '../services/defaultData';
import { DynamicIcon } from './DynamicIcon';
import { obsidianService } from '../services/obsidian';
import { stripDateSuffix, preserveDateSuffix } from '../services/taskTitles';

interface TasksViewProps {
  tasks: TaskItem[];
  modes: StudyMode[];
  obsidianConfig?: ObsidianConfig;
  onAddTask: (title: string, modeId?: string) => TaskItem;
  onUpdateTask: (task: TaskItem) => void;
  onDeleteTask: (taskId: string) => void;
  onReorderTasks: (reordered: TaskItem[]) => void;
  onClearCompletedTasks: () => void;
  onStartFocusWithTask: (task: TaskItem, modeOverride?: StudyMode) => void;
  onStartStandaloneSession: (mode: StudyMode, selectedTaskIds: string[]) => void;
  onOpenBlocker: () => void;
  onOpenModes: () => void;
  onOpenPlanner?: () => void;
  userName?: string;
  theme: ThemeId;
  onObsidianSynced?: (at: string) => void;
}

export const TasksView: React.FC<TasksViewProps> = ({
  tasks,
  modes,
  onAddTask,
  onUpdateTask,
  onDeleteTask,
  onReorderTasks,
  onClearCompletedTasks,
  onStartFocusWithTask,
  onStartStandaloneSession,
  onOpenBlocker,
  onOpenModes,
  onOpenPlanner,
  userName,
  theme,
  obsidianConfig,
  onObsidianSynced,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;

  const [isSyncingObsidian, setIsSyncingObsidian] = useState(false);
  const [obsidianFeedback, setObsidianFeedback] = useState<string | null>(null);

  const handleManualSyncObsidian = async () => {
    if (!obsidianConfig || !obsidianConfig.vaultPath) return;
    setIsSyncingObsidian(true);
    setObsidianFeedback(null);
    try {
      const res = await obsidianService.syncTasks(tasks, modes, obsidianConfig);
      if (res.success) {
        onObsidianSynced?.(new Date().toISOString());
        setObsidianFeedback(`Synced ${res.syncedCount} tasks`);
        setTimeout(() => setObsidianFeedback(null), 3000);
      } else {
        setObsidianFeedback('Sync failed');
        setTimeout(() => setObsidianFeedback(null), 3000);
      }
    } catch {
      setObsidianFeedback('Sync failed');
      setTimeout(() => setObsidianFeedback(null), 3000);
    } finally {
      setIsSyncingObsidian(false);
    }
  };

  const [newTitle, setNewTitle] = useState('');
  const [selectedModeId, setSelectedModeId] = useState<string>(modes[0]?.id || 'mode-deep-work');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');

  // Mode Selection Modal state for adding task
  const [isModeModalOpen, setIsModeModalOpen] = useState(false);
  const [pendingTaskTitle, setPendingTaskTitle] = useState('');
  const [modalSelectedModeId, setModalSelectedModeId] = useState<string>(modes[0]?.id || 'mode-deep-work');

  // Mode change modal for existing task
  const [taskForModeChange, setTaskForModeChange] = useState<TaskItem | null>(null);

  const selectedMode = modes.find((m) => m.id === selectedModeId) || modes[0];
  const cycleCount = selectedMode.isChillMode ? 1 : Math.max(1, selectedMode.cycles);

  // queuedTaskIds: fixed-slot array of length cycleCount, where slot idx is Cycle idx+1
  const [queuedTaskIds, setQueuedTaskIds] = useState<string[]>(() => Array(cycleCount).fill(''));

  // Maintain fixed slot array when cycleCount or tasks change
  useEffect(() => {
    setQueuedTaskIds((prev) => {
      const next: string[] = [];
      for (let i = 0; i < cycleCount; i++) {
        const id = prev[i];
        if (id && tasks.some((t) => t.id === id && !t.completed)) {
          next.push(id);
        } else {
          next.push('');
        }
      }
      return next;
    });
  }, [cycleCount, tasks]);

  const toggleTaskInQueue = (taskId: string) => {
    setQueuedTaskIds((prev) => {
      const next = [...prev];
      while (next.length < cycleCount) next.push('');
      const existingIdx = next.indexOf(taskId);
      if (existingIdx !== -1) {
        next[existingIdx] = '';
        return next;
      }
      // Find first empty cycle slot
      const emptyIdx = next.findIndex((id) => !id);
      if (emptyIdx !== -1) {
        next[emptyIdx] = taskId;
      } else {
        // If all slots are full, replace the last cycle
        next[next.length - 1] = taskId;
      }
      return next;
    });
  };

  const assignTaskToCycle = (taskId: string, cycleIndex: number) => {
    setQueuedTaskIds((prev) => {
      const next = [...prev];
      while (next.length < cycleCount) next.push('');
      // If already assigned to another cycle, clear it from there
      for (let i = 0; i < next.length; i++) {
        if (next[i] === taskId) {
          next[i] = '';
        }
      }
      next[cycleIndex] = taskId;
      return next;
    });
  };

  const removeTaskFromCycle = (cycleIndex: number) => {
    setQueuedTaskIds((prev) => {
      const next = [...prev];
      while (next.length < cycleCount) next.push('');
      next[cycleIndex] = '';
      return next;
    });
  };

  const autoFillQueue = () => {
    const uncompletedList = tasks.filter((t) => !t.completed);
    const next: string[] = [];
    for (let i = 0; i < cycleCount; i++) {
      next.push(uncompletedList[i]?.id || '');
    }
    setQueuedTaskIds(next);
  };

  const clearQueue = () => {
    setQueuedTaskIds(Array(cycleCount).fill(''));
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setPendingTaskTitle(newTitle.trim());
    setModalSelectedModeId(selectedModeId);
    setIsModeModalOpen(true);
  };

  const handleConfirmAdd = (action: 'start' | 'queue') => {
    if (!pendingTaskTitle.trim()) return;
    const chosenMode = modes.find((m) => m.id === modalSelectedModeId) || selectedMode;
    const newTask = onAddTask(pendingTaskTitle.trim(), modalSelectedModeId);
    setNewTitle('');
    setPendingTaskTitle('');
    setIsModeModalOpen(false);

    if (action === 'start') {
      onStartFocusWithTask(newTask, chosenMode);
    }
  };

  // Keyboard navigation inside the Mode Selection Modal
  useEffect(() => {
    if (!isModeModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsModeModalOpen(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          handleConfirmAdd('queue');
        } else {
          handleConfirmAdd('start');
        }
      } else if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1;
        if (modes[idx]) {
          setModalSelectedModeId(modes[idx].id);
        }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        const curIdx = modes.findIndex((m) => m.id === modalSelectedModeId);
        const nextIdx = (curIdx + 1) % modes.length;
        setModalSelectedModeId(modes[nextIdx].id);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const curIdx = modes.findIndex((m) => m.id === modalSelectedModeId);
        const prevIdx = (curIdx - 1 + modes.length) % modes.length;
        setModalSelectedModeId(modes[prevIdx].id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModeModalOpen, modalSelectedModeId, modes, pendingTaskTitle]);

  const handleToggle = (task: TaskItem) => {
    const isNowCompleted = !task.completed;
    if (isNowCompleted) {
      confetti({
        particleCount: 24,
        spread: 50,
        origin: { y: 0.75 },
        colors: ['#38bdf8', '#34d399', '#facc15', '#a855f7'],
        ticks: 120,
        gravity: 1.2,
      });
    }
    onUpdateTask({
      ...task,
      completed: isNowCompleted,
      completedAt: isNowCompleted ? new Date().toISOString() : undefined,
    });
  };

  const handleSaveEdit = (task: TaskItem) => {
    if (!editTitle.trim()) return;
    onUpdateTask({
      ...task,
      // The input shows the clean title; re-attach the note's date suffix so
      // the edit updates the same Obsidian note instead of renaming it.
      title: preserveDateSuffix(task.title, editTitle.trim()),
    });
    setEditingTaskId(null);
  };

  // Split tasks
  const uncompleted = tasks.filter((t) => !t.completed);
  const completed = tasks.filter((t) => t.completed);

  const inProgressTask = uncompleted[0] || null;
  const upNextTasks = uncompleted.slice(1);

  // Move uncompleted tasks up/down
  const moveUncompleted = (idx: number, direction: 'up' | 'down') => {
    const list = [...uncompleted];
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;

    const temp = list[idx];
    list[idx] = list[targetIdx];
    list[targetIdx] = temp;

    onReorderTasks([...list, ...completed]);
  };

  const completionPercentage = tasks.length > 0 ? Math.round((completed.length / tasks.length) * 100) : 0;

  // ── Time-based greeting ─────────────────────────────────────────────────────
  const getGreeting = () => {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return 'Good Morning';
    if (h >= 12 && h < 17) return 'Good Afternoon';
    if (h >= 17 && h < 22) return 'Good Evening';
    return 'Night Owl Mode';
  };
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-full overflow-hidden select-none tab-fade-in">
      {/* =========================================================================
          LEFT / MAIN CORE: TASKS POWERHOUSE STUDIO
          ========================================================================= */}
      <div className="flex-1 flex flex-col p-6 sm:p-8 overflow-y-auto max-w-4xl mx-auto w-full space-y-6">
        {/* ── Greeting Hero + Flow Strip ──────────────────────────────────────── */}
        <div 
          className="pb-4 border-b space-y-3"
          style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
        >
          {/* Top row: Greeting + progress */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div className="space-y-1">
              <h1 
                className="text-2xl font-bold tracking-tight"
                style={{ color: currentTheme.textPrimary }}
              >
                {getGreeting()}, {(userName || 'IBODULLO').replace(/[^a-zA-Z]+$/i, '').split(' ')[0] || 'Ibodullo'}.
              </h1>
              <p 
                className="text-xs font-medium flex items-center space-x-2"
                style={{ color: currentTheme.textSecondary }}
              >
                <span>{dateStr}</span>
                <span className="opacity-40">·</span>
                <span>Write your tasks, plan the day, then block distractions</span>
              </p>
            </div>

            <div className="flex items-center space-x-2.5">
              {obsidianConfig?.enabled && (
                <button
                  onClick={handleManualSyncObsidian}
                  disabled={isSyncingObsidian}
                  className="px-3 py-1.5 rounded-full liquid-glass border text-xs font-semibold flex items-center space-x-1.5 text-purple-400 hover:bg-purple-500/15 transition-all cursor-pointer"
                  title={`Sync tasks to Obsidian (${obsidianConfig.vaultPath})`}
                >
                  <FolderSync className={`w-3.5 h-3.5 ${isSyncingObsidian ? 'animate-spin' : ''}`} />
                  <span>{obsidianFeedback || (isSyncingObsidian ? 'Syncing...' : 'Sync Obsidian')}</span>
                </button>
              )}

              <div 
                className="px-3.5 py-1.5 rounded-full liquid-glass text-xs font-semibold flex items-center space-x-2"
                style={{ color: currentTheme.textSecondary }}
              >
                <span className="text-emerald-500 font-bold">{completed.length}</span>
                <span className="opacity-40">/</span>
                <span>{tasks.length} Done ({completionPercentage}%)</span>
              </div>

              {completed.length > 0 && (
                <button
                  onClick={onClearCompletedTasks}
                  className="text-xs font-semibold hover:text-rose-500 transition-colors flex items-center space-x-1 cursor-pointer"
                  style={{ color: currentTheme.textMuted }}
                  title="Clear completed tasks"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
              )}
            </div>
          </div>

          {/* Flow strip: Tasks → Planner → Shield */}
          <div className="flex flex-wrap items-center gap-2">
            <span 
              className="px-3 py-1.5 rounded-full text-xs font-bold flex items-center space-x-1.5 border"
              style={{
                backgroundColor: 'rgba(56,189,248,0.15)',
                borderColor: 'rgba(56,189,248,0.35)',
                color: '#38bdf8',
              }}
            >
              <Sparkles className="w-3 h-3" />
              <span>1 Write Tasks</span>
            </span>
            <span className="text-[11px] font-mono" style={{ color: currentTheme.textMuted }}>→</span>
            <button
              onClick={onOpenPlanner}
              className="px-3 py-1.5 rounded-full text-xs font-semibold flex items-center space-x-1.5 border transition-all hover:bg-violet-500/15 cursor-pointer"
              style={{
                borderColor: 'rgba(139,92,246,0.35)',
                color: '#8b5cf6',
              }}
            >
              <Calendar className="w-3 h-3" />
              <span>2 Plan My Day</span>
            </button>
            <span className="text-[11px] font-mono" style={{ color: currentTheme.textMuted }}>→</span>
            <button
              onClick={onOpenBlocker}
              className="px-3 py-1.5 rounded-full text-xs font-semibold flex items-center space-x-1.5 border transition-all hover:bg-emerald-500/15 cursor-pointer"
              style={{
                borderColor: 'rgba(16,185,129,0.35)',
                color: '#10b981',
              }}
            >
              <ShieldCheck className="w-3 h-3" />
              <span>3 Arm Shield</span>
            </button>
          </div>
        </div>

        {/* Liquid Glass Task Creation Bar */}
        <form onSubmit={handleCreate} className="relative flex items-center">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="+ Type a task and press Enter to select mode..."
            className="w-full pl-4 pr-64 py-3.5 rounded-2xl liquid-glass-input text-sm outline-none shadow-lg font-medium"
            style={{ color: currentTheme.textPrimary }}
          />

          {/* Quick mode cycle pill in input bar */}
          <div className="absolute right-28 flex items-center">
            <button
              type="button"
              onClick={() => {
                const nextIdx = (modes.findIndex((m) => m.id === selectedModeId) + 1) % modes.length;
                setSelectedModeId(modes[nextIdx].id);
              }}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold liquid-glass border hover:scale-[1.02] transition-all cursor-pointer"
              style={{
                borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
                color: selectedMode.color || currentTheme.textPrimary,
              }}
              title="Click to cycle default mode (or press Enter when adding task to choose mode)"
            >
              <DynamicIcon name={selectedMode.icon} className="w-3 h-3" />
              <span className="hidden sm:inline font-bold">{selectedMode.name}</span>
              <span className="opacity-70 font-mono text-[11px]">{selectedMode.workDuration}m</span>
            </button>
          </div>

          <button
            type="submit"
            disabled={!newTitle.trim()}
            className="absolute right-2 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-30 disabled:pointer-events-none cursor-pointer shadow-md flex items-center space-x-1.5"
            style={{
              backgroundColor: currentTheme.accent,
              color: currentTheme.accentText,
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Task</span>
          </button>
        </form>

        {/* Filter Switcher */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              filter === 'all'
                ? isDark
                  ? 'bg-white/20 text-white border border-white/20'
                  : 'bg-black/10 text-zinc-900 border border-black/10'
                : 'border border-transparent'
            }`}
            style={{
              color: filter === 'all' ? undefined : currentTheme.textSecondary,
            }}
          >
            All Tasks ({tasks.length})
          </button>
          <button
            onClick={() => setFilter('pending')}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              filter === 'pending'
                ? isDark
                  ? 'bg-white/20 text-white border border-white/20'
                  : 'bg-black/10 text-zinc-900 border border-black/10'
                : 'border border-transparent'
            }`}
            style={{
              color: filter === 'pending' ? undefined : currentTheme.textSecondary,
            }}
          >
            To Focus ({uncompleted.length})
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              filter === 'completed'
                ? isDark
                  ? 'bg-white/20 text-white border border-white/20'
                  : 'bg-black/10 text-zinc-900 border border-black/10'
                : 'border border-transparent'
            }`}
            style={{
              color: filter === 'completed' ? undefined : currentTheme.textSecondary,
            }}
          >
            Completed ({completed.length})
          </button>
        </div>

        {/* SECTION 1: HERO ACTIVE TARGET CARD */}
        {inProgressTask && (filter === 'all' || filter === 'pending') && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-widest text-sky-500 font-bold flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping" />
                <span>ACTIVE FOCUS TARGET</span>
              </span>
              <span 
                className="text-[11px] font-mono"
                style={{ color: currentTheme.textMuted }}
              >
                Next in session queue
              </span>
            </div>

            <div 
              className="p-5 rounded-3xl liquid-glass-elevated border border-sky-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group transition-all"
              style={{
                background: isDark
                  ? 'linear-gradient(135deg, rgba(56,189,248,0.1) 0%, rgba(0,0,0,0.4) 100%)'
                  : 'linear-gradient(135deg, rgba(56,189,248,0.12) 0%, rgba(255,255,255,0.9) 100%)',
              }}
            >
              {/* Task Title & Checkbox */}
              <div className="flex items-center space-x-3.5 flex-1 min-w-0">
                <button
                  onClick={() => handleToggle(inProgressTask)}
                  className="w-6 h-6 rounded-full border flex items-center justify-center transition-colors cursor-pointer shrink-0"
                  style={{ borderColor: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)' }}
                  title="Mark as completed"
                >
                  <Circle className="w-4 h-4 text-transparent hover:text-emerald-500" />
                </button>

                {editingTaskId === inProgressTask.id ? (
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => handleSaveEdit(inProgressTask)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit(inProgressTask)}
                    autoFocus
                    className="flex-1 bg-transparent text-lg font-bold outline-none border-b border-sky-500"
                    style={{ color: currentTheme.textPrimary }}
                  />
                ) : (
                  <div className="flex-1 min-w-0">
                    <h2
                      onDoubleClick={() => {
                        setEditingTaskId(inProgressTask.id);
                        setEditTitle(stripDateSuffix(inProgressTask.title));
                      }}
                      className="text-lg font-bold truncate cursor-pointer hover:text-sky-500 transition-colors"
                      style={{ color: currentTheme.textPrimary }}
                      title="Double click to edit title"
                    >
                      {stripDateSuffix(inProgressTask.title)}
                    </h2>
                    {(() => {
                      const heroTaskMode = inProgressTask.modeId
                        ? modes.find((m) => m.id === inProgressTask.modeId) || selectedMode
                        : selectedMode;
                      return (
                        <div 
                          className="flex items-center space-x-2 mt-1 text-xs"
                          style={{ color: currentTheme.textSecondary }}
                        >
                          <span className="font-mono text-[11px] text-sky-500 font-semibold">Ready to focus</span>
                          <span>·</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTaskForModeChange(inProgressTask);
                            }}
                            className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono border transition-all hover:scale-105 cursor-pointer shadow-sm"
                            style={{
                              backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                              borderColor: heroTaskMode.color || currentTheme.accent,
                              color: heroTaskMode.color || currentTheme.textPrimary,
                            }}
                            title="Click to switch mode for this task"
                          >
                            <DynamicIcon name={heroTaskMode.icon} className="w-3 h-3" />
                            <span className="font-bold">{heroTaskMode.name}</span>
                            <span className="opacity-70">({heroTaskMode.workDuration}m)</span>
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Start Focus CTA */}
              <div className="flex items-center space-x-2 shrink-0">
                {(() => {
                  const isQueued = queuedTaskIds.includes(inProgressTask.id);
                  const cycleIndex = queuedTaskIds.indexOf(inProgressTask.id);
                  return (
                    <button
                      type="button"
                      onClick={() => toggleTaskInQueue(inProgressTask.id)}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center space-x-1.5 ${
                        isQueued
                          ? 'border border-sky-400/50 bg-sky-500/20 text-sky-400 shadow-sm font-bold'
                          : 'border border-white/10 hover:bg-white/10 text-neutral-400'
                      }`}
                      title={isQueued ? `Assigned to Cycle ${cycleIndex + 1} (click to remove)` : 'Queue for session'}
                    >
                      <span>{isQueued ? `Cycle ${cycleIndex + 1} ✓` : '+ Queue'}</span>
                    </button>
                  );
                })()}

                <button
                  onClick={() => {
                    const heroMode = inProgressTask.modeId
                      ? modes.find((m) => m.id === inProgressTask.modeId) || selectedMode
                      : selectedMode;
                    const filledQueue = queuedTaskIds.filter(Boolean);
                    const tasksToStart = filledQueue.length > 0
                      ? (filledQueue.includes(inProgressTask.id) ? filledQueue : [inProgressTask.id, ...filledQueue])
                      : [inProgressTask.id];
                    onStartStandaloneSession(heroMode, tasksToStart);
                  }}
                  className="flex items-center space-x-2 px-5 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95 shadow-md cursor-pointer"
                  style={{
                    backgroundColor: currentTheme.accent,
                    color: currentTheme.accentText,
                  }}
                  title="Start Focus Session on this task"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>START FOCUS</span>
                </button>

                <button
                  onClick={() => onDeleteTask(inProgressTask.id)}
                  className="p-2 rounded-lg hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                  style={{ color: currentTheme.textMuted }}
                  title="Delete Task"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 2: QUEUED TASKS (UP NEXT) */}
        {(filter === 'all' || filter === 'pending') && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span 
                className="text-xs font-mono uppercase tracking-widest font-semibold"
                style={{ color: currentTheme.textSecondary }}
              >
                QUEUE & UP NEXT ({upNextTasks.length})
              </span>
            </div>

            <div className="space-y-2">
              {upNextTasks.map((task, idx) => (
                <div
                  key={task.id}
                  className="p-3.5 rounded-2xl liquid-glass-card flex items-center justify-between transition-all"
                >
                  <div className="flex items-center space-x-3 flex-1 min-w-0">
                    <button
                      onClick={() => handleToggle(task)}
                      className="w-5 h-5 rounded-full border flex items-center justify-center transition-colors cursor-pointer shrink-0"
                      style={{ borderColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)' }}
                      title="Mark Done"
                    >
                      <Circle className="w-3.5 h-3.5 text-transparent hover:text-emerald-500" />
                    </button>

                    {editingTaskId === task.id ? (
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={() => handleSaveEdit(task)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit(task)}
                        autoFocus
                        className="flex-1 bg-transparent text-sm font-semibold outline-none border-b border-sky-500"
                        style={{ color: currentTheme.textPrimary }}
                      />
                    ) : (
                      <div className="flex items-center space-x-2 flex-1 min-w-0">
                        <span
                          onDoubleClick={() => {
                            setEditingTaskId(task.id);
                            setEditTitle(stripDateSuffix(task.title));
                          }}
                          className="text-sm font-semibold truncate cursor-pointer hover:opacity-80"
                          style={{ color: currentTheme.textPrimary }}
                          title="Double click to edit"
                        >
                          {stripDateSuffix(task.title)}
                        </span>

                        {task.modeId && (() => {
                          const tMode = modes.find((m) => m.id === task.modeId);
                          if (!tMode) return null;
                          return (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setTaskForModeChange(task);
                              }}
                              className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-[10px] font-mono border transition-all hover:scale-105 cursor-pointer shrink-0"
                              style={{
                                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                                borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
                                color: tMode.color || currentTheme.accent,
                              }}
                              title="Assigned mode (click to switch)"
                            >
                              <DynamicIcon name={tMode.icon} className="w-2.5 h-2.5" />
                              <span>{tMode.name}</span>
                              <span className="opacity-60">· {tMode.workDuration}m</span>
                            </button>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  {/* Actions: Reorder, Fast Focus, Delete */}
                  <div className="flex items-center space-x-1 pl-3 shrink-0">
                    {(() => {
                      const isQueued = queuedTaskIds.includes(task.id);
                      const cycleIndex = queuedTaskIds.indexOf(task.id);
                      return (
                        <button
                          type="button"
                          onClick={() => toggleTaskInQueue(task.id)}
                          className={`px-2 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center space-x-1 ${
                            isQueued
                              ? 'border border-sky-400/50 bg-sky-500/20 text-sky-400 font-bold'
                              : 'hover:bg-white/10 text-neutral-400'
                          }`}
                          title={isQueued ? `Assigned to Cycle ${cycleIndex + 1} (click to remove)` : 'Queue for session'}
                        >
                          <span>{isQueued ? `C${cycleIndex + 1} ✓` : '+ Queue'}</span>
                        </button>
                      );
                    })()}

                    <button
                      onClick={() => {
                        const targetMode = task.modeId ? modes.find((m) => m.id === task.modeId) || selectedMode : selectedMode;
                        const filledQueue = queuedTaskIds.filter(Boolean);
                        const tasksToStart = filledQueue.length > 0
                          ? (filledQueue.includes(task.id) ? filledQueue : [task.id, ...filledQueue])
                          : [task.id];
                        onStartStandaloneSession(targetMode, tasksToStart);
                      }}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center space-x-1"
                      style={{
                        backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                        color: currentTheme.textPrimary,
                      }}
                      title="Focus on this task next"
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      <span>Focus</span>
                    </button>

                    <button
                      onClick={() => moveUncompleted(idx + 1, 'up')}
                      className="p-1.5 rounded-lg transition-colors cursor-pointer"
                      style={{ color: currentTheme.textMuted }}
                      title="Promote Up"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => moveUncompleted(idx + 1, 'down')}
                      disabled={idx === upNextTasks.length - 1}
                      className="p-1.5 rounded-lg disabled:opacity-20 transition-colors cursor-pointer"
                      style={{ color: currentTheme.textMuted }}
                      title="Move Down"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => onDeleteTask(task.id)}
                      className="p-1.5 rounded-lg hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                      style={{ color: currentTheme.textMuted }}
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              {upNextTasks.length === 0 && !inProgressTask && (
                <div 
                  className="p-8 rounded-3xl liquid-glass text-center text-xs font-mono"
                  style={{ color: currentTheme.textMuted }}
                >
                  No tasks queued for today. Add a new task above to get started!
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 3: COMPLETED TASKS */}
        {completed.length > 0 && (filter === 'all' || filter === 'completed') && (
          <div className="space-y-3 pt-2">
            <span className="text-xs font-mono uppercase tracking-widest text-emerald-500 font-semibold flex items-center space-x-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>COMPLETED TODAY ({completed.length})</span>
            </span>

            <div className="space-y-1.5">
              {completed.map((task) => (
                <div
                  key={task.id}
                  className="p-3 rounded-2xl liquid-glass flex items-center justify-between opacity-60 hover:opacity-100 transition-opacity"
                >
                  <div className="flex items-center space-x-3 flex-1 min-w-0">
                    <button
                      onClick={() => handleToggle(task)}
                      className="text-emerald-500 hover:opacity-50 transition-opacity cursor-pointer shrink-0"
                      title="Reopen task"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                    <span 
                      className="text-sm font-semibold line-through truncate flex-1"
                      style={{ color: currentTheme.textMuted }}
                    >
                      {stripDateSuffix(task.title)}
                    </span>
                  </div>

                  <button
                    onClick={() => onDeleteTask(task.id)}
                    className="p-1.5 hover:text-rose-500 transition-colors cursor-pointer"
                    style={{ color: currentTheme.textMuted }}
                    title="Delete record"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* =========================================================================
          RIGHT COLUMN: LIQUID GLASS TIMER PREVIEW & DISTRACTION SHIELD WIDGET
          ========================================================================= */}
      <div 
        className="w-full lg:w-96 p-6 sm:p-8 border-t lg:border-t-0 lg:border-l flex flex-col justify-between space-y-6 overflow-y-auto"
        style={{
          borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
          backgroundColor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.5)',
        }}
      >
        <div className="space-y-6">
          {/* Quick Mode Picker */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span 
                className="text-xs font-mono uppercase tracking-wider font-semibold"
                style={{ color: currentTheme.textSecondary }}
              >
                STUDY MODE
              </span>
              <button
                onClick={onOpenModes}
                className="text-[11px] font-mono text-sky-500 hover:underline flex items-center space-x-1 cursor-pointer"
              >
                <span>Edit Modes</span>
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {modes.slice(0, 4).map((m) => {
                const isSelected = m.id === selectedModeId;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedModeId(m.id)}
                    className={`p-3 rounded-2xl liquid-glass-card text-left transition-all cursor-pointer ${
                      isSelected
                        ? isDark
                          ? 'border-sky-400/60 bg-sky-500/15 shadow-[0_0_15px_rgba(56,189,248,0.2)]'
                          : 'border-sky-500/60 bg-sky-50 shadow-sm'
                        : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span 
                        className="text-xs font-bold truncate"
                        style={{ color: currentTheme.textPrimary }}
                      >
                        {m.name}
                      </span>
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: m.color || '#38bdf8' }} />
                    </div>
                    <span 
                      className="text-[11px] font-mono block"
                      style={{ color: currentTheme.textSecondary }}
                    >
                      {m.workDuration}m {m.cycles > 1 ? `× ${m.cycles}` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Liquid Glass Timer Dial Preview */}
          <div className="p-6 rounded-3xl liquid-glass-elevated text-center space-y-4 shadow-xl relative overflow-hidden">
            {/* Ambient Backlight */}
            <div className="absolute -top-12 -left-12 w-32 h-32 rounded-full bg-sky-500/15 blur-2xl pointer-events-none" />
            <div className="absolute -bottom-12 -right-12 w-32 h-32 rounded-full bg-emerald-500/15 blur-2xl pointer-events-none" />

            <div className="space-y-1">
              <span 
                className="text-[11px] font-mono uppercase tracking-widest font-semibold block"
                style={{ color: currentTheme.textSecondary }}
              >
                {selectedMode.name}
              </span>
              <div 
                className="font-mono text-5xl font-bold tracking-tighter"
                style={{ color: currentTheme.textPrimary }}
              >
                {String(selectedMode.workDuration).padStart(2, '0')}:00
              </div>
              <span 
                className="text-xs font-medium block"
                style={{ color: currentTheme.textSecondary }}
              >
                {selectedMode.isChillMode ? 'Open Chill Period' : `${selectedMode.cycles} Cycles · ${selectedMode.breakDuration}m Rest`}
              </span>
            </div>

            {/* Cycle Task Slots for the Session */}
            <div className="pt-2 pb-1 space-y-2 text-left">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-sky-400">
                  Cycle Tasks ({queuedTaskIds.filter(Boolean).length}/{cycleCount})
                </span>
                <div className="flex items-center space-x-2 text-[10px] font-mono">
                  {uncompleted.length > 0 && (
                    <button
                      type="button"
                      onClick={autoFillQueue}
                      className="text-sky-400 hover:underline cursor-pointer"
                      title="Fill cycle slots with top tasks"
                    >
                      Auto-fill
                    </button>
                  )}
                  {queuedTaskIds.some(Boolean) && (
                    <button
                      type="button"
                      onClick={() => setQueuedTaskIds([])}
                      className="text-rose-400 hover:underline cursor-pointer"
                      title="Clear queue"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {Array.from({ length: cycleCount }).map((_, idx) => {
                  const taskId = queuedTaskIds[idx];
                  const task = tasks.find((t) => t.id === taskId);
                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between py-1.5 px-2.5 rounded-xl text-xs liquid-glass border border-white/5"
                    >
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 font-bold shrink-0 mr-2">
                        C{idx + 1}
                      </span>
                      {task ? (
                        <div className="flex items-center justify-between flex-1 min-w-0">
                          <span className="truncate font-semibold text-xs" style={{ color: currentTheme.textPrimary }}>
                            {stripDateSuffix(task.title)}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeTaskFromCycle(idx)}
                            className="text-neutral-400 hover:text-rose-400 p-0.5 ml-2 cursor-pointer shrink-0"
                            title="Remove from this cycle"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <select
                          className="w-full bg-transparent text-xs outline-none cursor-pointer text-neutral-400"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              assignTaskToCycle(e.target.value, idx);
                            }
                          }}
                        >
                          <option value="" disabled className="bg-neutral-900 text-neutral-400">
                            + Select task for Cycle {idx + 1}...
                          </option>
                          {uncompleted
                            .filter((t) => !queuedTaskIds.includes(t.id))
                            .map((t) => (
                              <option key={t.id} value={t.id} className="bg-neutral-900 text-neutral-200">
                                {t.title}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Launch Primary Action */}
            <button
              onClick={() => {
                const filledQueue = queuedTaskIds.filter(Boolean);
                const targetTaskIds = filledQueue.length > 0
                  ? filledQueue
                  : (inProgressTask ? [inProgressTask.id] : []);
                onStartStandaloneSession(selectedMode, targetTaskIds);
              }}
              className="w-full py-3.5 px-4 rounded-2xl font-bold text-sm transition-all active:scale-95 shadow-xl flex items-center justify-center space-x-2 cursor-pointer"
              style={{
                backgroundColor: currentTheme.accent,
                color: currentTheme.accentText,
              }}
            >
              <Zap className="w-4 h-4 fill-current" />
              <span>
                {queuedTaskIds.filter(Boolean).length > 1
                  ? `START FOCUS SESSION (${queuedTaskIds.filter(Boolean).length} TASKS)`
                  : 'START FOCUS SESSION'}
              </span>
            </button>
          </div>

          {/* DISTRACTION SHIELD & BLOCKLIST WIDGET */}
          <div className="p-5 rounded-3xl liquid-glass space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span 
                  className="text-xs font-mono uppercase tracking-wider font-bold"
                  style={{ color: currentTheme.textPrimary }}
                >
                  DISTRACTION SHIELD
                </span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 border border-emerald-500/30">
                SHIELD ARMED
              </span>
            </div>

            <p 
              className="text-xs font-medium"
              style={{ color: currentTheme.textSecondary }}
            >
              Distractions are automatically blocked when your timer starts.
            </p>

            {/* Blocked Sites Cloud */}
            <div className="flex flex-wrap gap-1.5">
              {(selectedMode.blocklist.length > 0 ? selectedMode.blocklist : DEFAULT_BLOCKLIST).slice(0, 7).map((d) => (
                <span
                  key={d}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-mono liquid-glass"
                  style={{ color: currentTheme.textPrimary }}
                >
                  {d.replace('www.', '')}
                </span>
              ))}
              <span 
                className="px-2 py-1 rounded-lg text-[10px] font-mono"
                style={{ color: currentTheme.textMuted }}
              >
                + more
              </span>
            </div>

            <button
              onClick={onOpenBlocker}
              className="w-full py-2 rounded-xl text-xs font-semibold liquid-glass border transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
              style={{ color: currentTheme.textPrimary }}
            >
              <Shield className="w-3.5 h-3.5 text-sky-500" />
              <span>Open Shield Settings</span>
            </button>
          </div>
        </div>

        {/* Bottom Keyboard Hint */}
        <div 
          className="pt-2 text-[11px] font-mono text-center"
          style={{ color: currentTheme.textMuted }}
        >
          Press <kbd className="px-1.5 py-0.5 liquid-glass rounded font-bold">Space</kbd> in timer to pause
        </div>
      </div>

      {/* =========================================================================
          MODE SELECTION MODAL ON TASK CREATION (Triggered on Enter)
          ========================================================================= */}
      {isModeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
          {/* Backdrop */}
          <div 
            onClick={() => setIsModeModalOpen(false)} 
            className="absolute inset-0 bg-black/70 transition-opacity animate-in fade-in duration-200" 
          />

          {/* Modal Container */}
          <div
            className="relative w-full max-w-xl p-6 sm:p-7 rounded-3xl border shadow-2xl z-10 space-y-5 animate-modal-in"
            style={{
              backgroundColor: isDark ? '#0f111c' : '#ffffff',
              borderColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.12)',
            }}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-500 animate-pulse shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
                  <span 
                    className="text-xs font-mono font-bold uppercase tracking-wider text-sky-500"
                  >
                    SELECT FOCUS MODE
                  </span>
                </div>
                <h2 
                  className="text-lg font-bold"
                  style={{ color: currentTheme.textPrimary }}
                >
                  Choose How to Accomplish This Task
                </h2>
              </div>
              <button
                onClick={() => setIsModeModalOpen(false)}
                className="p-1.5 rounded-xl hover:opacity-70 transition-opacity cursor-pointer"
                style={{ color: currentTheme.textSecondary }}
                title="Cancel (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Task Title Pill */}
            <div 
              className="px-4 py-3 rounded-2xl liquid-glass border flex items-center space-x-2.5"
              style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
            >
              <Sparkles className="w-4 h-4 text-sky-500 shrink-0" />
              <span 
                className="text-sm font-semibold truncate flex-1"
                style={{ color: currentTheme.textPrimary }}
              >
                {pendingTaskTitle}
              </span>
            </div>

            {/* Modes Cards Grid */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono" style={{ color: currentTheme.textSecondary }}>
                <span>AVAILABLE STUDY MODES</span>
                <span>Press keys [1 - {Math.min(9, modes.length)}] or arrows</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[300px] overflow-y-auto pr-1">
                {modes.map((m, idx) => {
                  const isSelected = m.id === modalSelectedModeId;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setModalSelectedModeId(m.id)}
                      className={`p-3.5 rounded-2xl text-left transition-all cursor-pointer border relative group ${
                        isSelected
                          ? isDark
                            ? 'bg-sky-500/15 border-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.25)] ring-1 ring-sky-400/50'
                            : 'bg-sky-50 border-sky-500 shadow-md ring-1 ring-sky-500/40'
                          : 'liquid-glass border hover:scale-[1.01]'
                      }`}
                      style={{
                        borderColor: isSelected
                          ? undefined
                          : isDark
                          ? 'rgba(255,255,255,0.08)'
                          : 'rgba(0,0,0,0.06)',
                      }}
                    >
                      {/* Top Row: Icon, Name, Key Badge */}
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center space-x-2">
                          <span 
                            className="p-1 rounded-lg"
                            style={{ 
                              backgroundColor: `${m.color || '#38bdf8'}20`, 
                              color: m.color || '#38bdf8' 
                            }}
                          >
                            <DynamicIcon name={m.icon} className="w-3.5 h-3.5" />
                          </span>
                          <span 
                            className="text-xs font-bold truncate"
                            style={{ color: isSelected ? undefined : currentTheme.textPrimary }}
                          >
                            {m.name}
                          </span>
                        </div>

                        <div className="flex items-center space-x-1.5">
                          {idx < 9 && (
                            <kbd 
                              className="text-[10px] font-mono px-1.5 py-0.2 rounded liquid-glass opacity-70"
                              style={{ color: currentTheme.textSecondary }}
                            >
                              {idx + 1}
                            </kbd>
                          )}
                          <span 
                            className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                              isSelected ? 'border-sky-500 bg-sky-500 text-white' : 'border-zinc-500/40'
                            }`}
                          >
                            {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                          </span>
                        </div>
                      </div>

                      {/* Mode Details */}
                      <div className="flex items-center space-x-2 text-[11px] font-mono opacity-80" style={{ color: currentTheme.textSecondary }}>
                        <span>{m.workDuration}m Focus</span>
                        <span>·</span>
                        <span>{m.isChillMode ? 'Chill' : `${m.breakDuration}m Rest`}</span>
                        {!m.isChillMode && (
                          <>
                            <span>·</span>
                            <span>{m.cycles} {m.cycles === 1 ? 'cycle' : 'cycles'}</span>
                          </>
                        )}
                      </div>

                      <p 
                        className="text-[11px] mt-1 line-clamp-1 opacity-70"
                        style={{ color: currentTheme.textSecondary }}
                      >
                        {m.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Modal Bottom Actions */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t"
              style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
            >
              <div className="text-[11px] font-mono" style={{ color: currentTheme.textSecondary }}>
                <span>Press </span>
                <kbd className="px-1.5 py-0.5 liquid-glass rounded font-bold">Enter</kbd>
                <span> to start immediately</span>
              </div>

              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => handleConfirmAdd('queue')}
                  className="flex-1 sm:flex-initial px-4 py-2.5 rounded-2xl liquid-glass border text-xs font-semibold hover:opacity-85 transition-all cursor-pointer flex items-center justify-center space-x-1.5"
                  style={{ color: currentTheme.textPrimary }}
                  title="Add to queue with this mode (Shift+Enter)"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add to Queue</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleConfirmAdd('start')}
                  className="flex-1 sm:flex-initial px-5 py-2.5 rounded-2xl text-xs font-bold transition-all active:scale-95 shadow-lg cursor-pointer flex items-center justify-center space-x-1.5"
                  style={{
                    backgroundColor: currentTheme.accent,
                    color: currentTheme.accentText,
                  }}
                  title="Start focus session now (Enter)"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Start Focus Now</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TASK MODE REASSIGNMENT MODAL (Triggered when clicking a task's mode badge)
          ========================================================================= */}
      {taskForModeChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
          <div 
            onClick={() => setTaskForModeChange(null)} 
            className="absolute inset-0 bg-black/70 transition-opacity animate-in fade-in duration-200" 
          />

          <div
            className="relative w-full max-w-md p-6 rounded-3xl border shadow-2xl z-10 space-y-4 animate-modal-in"
            style={{
              backgroundColor: isDark ? '#0f111c' : '#ffffff',
              borderColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.12)',
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-sky-500">
                  CHANGE STUDY MODE
                </span>
                <h3 className="text-sm font-bold truncate max-w-[280px]" style={{ color: currentTheme.textPrimary }}>
                  {taskForModeChange.title}
                </h3>
              </div>
              <button
                onClick={() => setTaskForModeChange(null)}
                className="p-1 hover:opacity-70 cursor-pointer"
                style={{ color: currentTheme.textSecondary }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {modes.map((m) => {
                const isSelected = (taskForModeChange.modeId || selectedModeId) === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      onUpdateTask({ ...taskForModeChange, modeId: m.id });
                      setTaskForModeChange(null);
                    }}
                    className={`w-full p-3 rounded-2xl flex items-center justify-between text-left transition-all cursor-pointer border ${
                      isSelected
                        ? isDark
                          ? 'bg-sky-500/15 border-sky-400 text-sky-400'
                          : 'bg-sky-50 border-sky-500 text-sky-900'
                        : 'liquid-glass border hover:scale-[1.01]'
                    }`}
                    style={{
                      borderColor: isSelected ? undefined : isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                    }}
                  >
                    <div className="flex items-center space-x-2.5">
                      <span
                        className="p-1.5 rounded-xl"
                        style={{ backgroundColor: `${m.color || '#38bdf8'}20`, color: m.color || '#38bdf8' }}
                      >
                        <DynamicIcon name={m.icon} className="w-4 h-4" />
                      </span>
                      <div>
                        <span className="text-xs font-bold block" style={{ color: currentTheme.textPrimary }}>
                          {m.name}
                        </span>
                        <span className="text-[11px] font-mono opacity-70" style={{ color: currentTheme.textSecondary }}>
                          {m.workDuration}m Focus · {m.cycles} {m.cycles === 1 ? 'cycle' : 'cycles'}
                        </span>
                      </div>
                    </div>

                    {isSelected && (
                      <span className="w-5 h-5 rounded-full bg-sky-500 text-white flex items-center justify-center">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
