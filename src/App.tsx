import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ControlAppData,
  StudyMode,
  ModeFolder,
  Note,
  NoteFolder,
  ControlSession,
  ThemeId,
  UserSettings,
  DayPlan,
  ActiveSessionState,
  TaskItem,
  PurposeSessionRequest,
  CompanionCommand,
} from './types';
import { INITIAL_APP_DATA } from './services/defaultData';
import { storage } from './services/storage';
import { THEMES } from './styles/themes';
import { Header, NavTab } from './components/Header';
import { TasksView } from './components/TasksView';
import { ActiveSessionView } from './components/ActiveSessionView';
import { SessionCompletionView } from './components/SessionCompletionView';
import { ModesManager } from './components/ModesManager';
import { PlannerView } from './components/PlannerView';
import { NotesView } from './components/NotesView';
import { BlockerControl } from './components/BlockerControl';
import { HistoryView } from './components/HistoryView';
import { SettingsView } from './components/SettingsView';
import { LeaveLockModal } from './components/LeaveLockModal';
import { CommandPalette } from './components/CommandPalette';
import { SetupWizard } from './components/SetupWizard';
import { blockerClient } from './services/blockerClient';
import { obsidianService, mergeImportedTasks } from './services/obsidian';
import { plannerMd } from './services/plannerMarkdown';
import { allocateSessionMinutes } from './services/progress';
import { stripDateSuffix } from './services/taskTitles';
import { clampCycles, resolveSessionCycles, sessionWallMinutes, sessionWallMinutesFull, LONG_SESSION_CONFIRM_WALL_MINS } from './services/sessionFlow';
import { computeOccurrences, dueActions, getAutoExecSettings } from './services/autoExecPolicy';
import { applyMutationsToData, googleSync, useGoogleSyncStatus } from './services/googleSync';

export const App: React.FC = () => {
  const [data, setData] = useState<ControlAppData>(INITIAL_APP_DATA);
  const [isLoaded, setIsLoaded] = useState(false);
  // Default to tasks powerhouse view
  const [activeTab, setActiveTab] = useState<NavTab>('tasks');
  const [theme, setTheme] = useState<ThemeId>('serika');

  // Active Session state & Completed Session state
  const [activeSession, setActiveSession] = useState<ActiveSessionState | null>(null);
  const [completedSessionSummary, setCompletedSessionSummary] = useState<ControlSession | null>(null);
  const [selectedLauncherModeId, setSelectedLauncherModeId] = useState<string>('mode-deep-work');
  const activeSessionRef = useRef<ActiveSessionState | null>(null);
  const purposeRequestInFlightRef = useRef<string | null>(null);

  // 30-Second Lock-in Leave Modal state
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState<boolean>(false);

  // Command Palette state
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);

  // Initial Load from Storage / IPC
  useEffect(() => {
    const load = async () => {
      const stored = await storage.loadData();
      console.log(
        stored.settings.setupCompleted === false
          ? '[Setup] First-run wizard will be shown'
          : '[Setup] First-run wizard skipped (existing user data)'
      );
      setData(stored);
      plannerMd.setVaultPath(stored.settings.obsidian?.vaultPath || '');
      const activeTheme = stored.settings.theme || 'serika';
      setTheme(activeTheme);
      setSelectedLauncherModeId(
        stored.modes.some((m) => m.id === stored.settings.defaultModeId)
          ? stored.settings.defaultModeId
          : stored.modes[0]?.id || 'mode-deep-work'
      );

      // Check if there is an active session from persistence
      if (stored.activeSession) {
        const active = stored.activeSession;
        const now = Date.now();
        // B-04: freeze elapsed while paused — a paused session must not be
        // aged out by wall time between pauseStartedAt and relaunch.
        const effectiveNow = active.isPaused && active.pauseStartedAt
          ? active.pauseStartedAt
          : now;
        const elapsed = active.phaseStartTime <= 0
          ? 0
          : Math.floor((effectiveNow - active.phaseStartTime - active.totalPauseSecondsThisPhase * 1000) / 1000);

        if (elapsed < active.phaseDurationSeconds) {
          setActiveSession(active);
          setActiveTab('timer');
          // S-07: re-arm blocking after restart (blockers are RAM-only).
          const m = stored.modes.find((x) => x.id === active.modeId);
          if (m && active.phase === 'work' && stored.settings.blockingEnabled !== false) {
            blockerClient.startBlocking(active.blocklist, active.blockingStrategy).catch(() => {});
            if ((active.blockedApps || []).length > 0) blockerClient.startAppBlocking(active.blockedApps || []).catch(() => {});
          }
        } else {
          // S-07: expired-on-restart is real work, not silent loss — record it.
          const acc = active.accumulatedWorkSeconds || 0;
          const sessions = [...stored.sessions];
          if (acc >= 60) {
            sessions.unshift({
              id: active.id,
              modeId: active.modeId,
              modeName: active.modeName,
              modeIcon: active.modeIcon,
              isChillMode: !!active.isChillMode,
              startTime: active.startedAt,
              endTime: new Date().toISOString(),
              plannedWorkMinutes: active.totalCycles * active.workDurationMins,
              actualWorkMinutes: Math.max(1, Math.round(acc / 60)),
              plannedCycles: active.totalCycles,
              completedCycles: active.completedCyclesCount || 0,
              status: 'cancelled',
              countTowardStats: active.countTowardStats,
              tasksTotal: active.taskIds.length,
              tasksCompleted: (active.completedTaskIds || []).length,
              taskIds: [...active.taskIds],
              finishedEarly: true,
              skipReason: 'app-restarted',
            });
          }
          const updated = { ...stored, activeSession: null, sessions };
          setData(updated);
          storage.saveData(updated);
        }
      }

      setIsLoaded(true);
    };
    load();
  }, []);

  // Sync theme mode globally to documentElement for full DOM CSS theme awareness
  const currentTheme = THEMES[theme] || THEMES.serika;
  useEffect(() => {
    const mode = currentTheme.isDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme-mode', mode);
    document.body.style.backgroundColor = currentTheme.bgPrimary;
    document.body.style.color = currentTheme.textPrimary;
    // Mirror the light/dark choice onto the Dock icon's brand mark.
    window.controlAPI?.setDockIconAppearance(currentTheme.isDark);
  }, [currentTheme]);

  // Accessibility: reduced motion + legibility-optimized typography
  useEffect(() => {
    const reduced = !!dataRef.current.settings.reducedMotion;
    const dyslexic = !!dataRef.current.settings.dyslexicFont;
    document.documentElement.dataset.reducedMotion = reduced ? 'true' : 'false';
    document.documentElement.dataset.typography = dyslexic ? 'dyslexic' : 'normal';
  }, [data.settings.reducedMotion, data.settings.dyslexicFont]);

  // Listen to IPC trigger for 30s Leave Lock Modal from window close or Cmd+Q
  useEffect(() => {
    if (window.controlAPI?.onTriggerLeaveModal) {
      const cleanup = window.controlAPI.onTriggerLeaveModal(() => {
        setIsLeaveModalOpen(true);
      });
      return cleanup;
    }
  }, []);

  const dataRef = useRef<ControlAppData>(INITIAL_APP_DATA);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Save changes to storage safely without stale closures
  const updateAndPersistData = useCallback(
    (updater: ControlAppData | ((prev: ControlAppData) => ControlAppData)) => {
      setData((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        dataRef.current = next;
        storage.saveData(next);
        return next;
      });
    },
    []
  );

  const persistData = (updated: ControlAppData) => {
    updateAndPersistData(updated);
  };

  // ── Google Calendar two-way sync ─────────────────────────────────────────
  const googleStatus = useGoogleSyncStatus();

  // ── Automatic time tracking + distraction autopsy (main → renderer) ─────
  // Samples and kill events arrive here; the renderer owns caps/retention and
  // attaches the active session's mode to distraction events.
  useEffect(() => {
    const api = window.controlAPI;
    if (!api?.onActivitySample || !api?.onDistractionBlocked) return;
    const stopSamples = api.onActivitySample((sample) => {
      if (!sample || typeof sample.t !== 'number' || !sample.app) return;
      updateAndPersistData((prev) => ({
        ...prev,
        activitySamples: [...(prev.activitySamples || []), { t: sample.t, app: sample.app }].slice(-3000),
      }));
    });
    const stopDistractions = api.onDistractionBlocked((event) => {
      if (!event || typeof event.t !== 'number' || !event.name) return;
      const active = activeSessionRef.current;
      updateAndPersistData((prev) => ({
        ...prev,
        distractions: [
          ...(prev.distractions || []),
          {
            t: event.t,
            kind: event.kind,
            name: event.name,
            ...(active ? { modeId: active.modeId, modeName: active.modeName } : {}),
          },
        ].slice(-1000),
      }));
    });
    return () => {
      stopSamples();
      stopDistractions();
    };
  }, [updateAndPersistData]);

  // Enable/disable the main-process activity poller from settings.
  useEffect(() => {
    if (!isLoaded) return;
    window.controlAPI?.setActivityTrackingEnabled(
      data.settings.activityTracking?.enabled === true
    ).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, data.settings.activityTracking?.enabled]);

  // ── Quick notes captured from anywhere (global shortcut / menu bar) ──
  // The main process appends to the file store; fold the same note objects
  // into renderer state (deduped) so the next save keeps them.
  useEffect(() => {
    const api = window.controlAPI;
    if (!api?.onNotesChanged) return;
    return api.onNotesChanged((notes) => {
      if (!Array.isArray(notes) || notes.length === 0) return;
      updateAndPersistData((prev) => {
        const existing = new Set((prev.notes || []).map((n) => n.id));
        const fresh = notes.filter((n) => n && n.id && !existing.has(n.id));
        if (fresh.length === 0) return prev;
        return { ...prev, notes: [...(prev.notes || []), ...fresh] };
      });
    });
  }, [updateAndPersistData]);

  // ── Companion commands (notes from Relay) ─────────────────────────────
  // Control remains the source of truth: Relay only asks for a change and
  // Control applies it to the same store the UI and widgets use.
  useEffect(() => {
    const api = window.controlAPI;
    if (!api?.onCompanionCommand) return;
    return api.onCompanionCommand((command: CompanionCommand) => {
      if (!command || !command.note) return;
      if (command.action === 'note.upsert') {
        const content = (command.note.content || '').slice(0, 20000);
        if (!content.trim()) return;
        const now = new Date().toISOString();
        updateAndPersistData((prev) => {
          const notes = prev.notes || [];
          const index = command.note?.id ? notes.findIndex((n) => n.id === command.note!.id) : -1;
          if (index >= 0) {
            const existing = notes[index];
            const updated: Note = {
              ...existing,
              content,
              updatedAt: now,
              ...(command.note?.folderId !== undefined
                ? { folderId: command.note.folderId || undefined }
                : {}),
            };
            const nextNotes = [...notes];
            nextNotes[index] = updated;
            return { ...prev, notes: nextNotes };
          }
          const note: Note = {
            id: command.note?.id || `note-relay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            content,
            createdAt: now,
            updatedAt: now,
            ...(command.note?.folderId ? { folderId: command.note.folderId } : {}),
          };
          return { ...prev, notes: [...notes, note].slice(-2000) };
        });
      } else if (command.action === 'note.delete' && command.note.id) {
        updateAndPersistData((prev) => ({
          ...prev,
          notes: (prev.notes || []).filter((note) => note.id !== command.note!.id),
        }));
      }
      api.acknowledgeCompanionCommand(command.id).catch(() => undefined);
    });
  }, [updateAndPersistData]);

  useEffect(() => {
    const api = window.controlAPI?.googleCalendar;
    if (!api) return;

    const stopInit = googleSync.init();

    // Main process asks the renderer to fold remote changes into app data.
    // The sync engine only advances its sync token after this resolves.
    const stopApply = googleSync.registerApplyHandler(async (mutations) => {
      try {
        const next = applyMutationsToData(dataRef.current, mutations);
        dataRef.current = next;
        setData(next);
        const saved = await storage.saveData(next);
        const applied = (mutations.upserts?.length || 0) + (mutations.removals?.length || 0);
        if (saved) return { success: true, applied };
        return { success: false, error: 'Could not save incoming calendar changes.' };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    const handleOnline = () => {
      api.notifyOnline().catch(() => undefined);
    };
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('online', handleOnline);
      stopApply();
      stopInit();
    };
  }, []);

  // Mirror connection flags into settings.googleCalendar so backups carry them.
  // lastSyncedAt is deliberately NOT mirrored: every sync updates it, which
  // would re-save on every status push and schedule syncs in a loop.
  useEffect(() => {
    if (!googleStatus.available || !googleStatus.connected) {
      const cur = dataRef.current.settings.googleCalendar;
      if (cur.connected) {
        updateAndPersistData((prev) => ({
          ...prev,
          settings: {
            ...prev.settings,
            googleCalendar: { ...prev.settings.googleCalendar, connected: false },
          },
        }));
      }
      return;
    }
    const cur = dataRef.current.settings.googleCalendar;
    const nextEmail = googleStatus.userEmail ?? cur.userEmail;
    if (cur.connected && (cur.userEmail ?? undefined) === (nextEmail ?? undefined)) return;
    updateAndPersistData((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        googleCalendar: {
          ...prev.settings.googleCalendar,
          connected: true,
          ...(nextEmail ? { userEmail: nextEmail } : {}),
        },
      },
    }));
  }, [googleStatus, updateAndPersistData]);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  // Debounced so rapid changes (reorder bursts, StrictMode double-invoke)
  // coalesce into one export. Always reads the latest state at fire time.
  const syncTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
  }, []);
  const handleObsidianSynced = useCallback(() => {
    updateAndPersistData((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        obsidian: prev.settings.obsidian
          ? { ...prev.settings.obsidian, lastSyncedAt: new Date().toISOString() }
          : prev.settings.obsidian,
      },
    }));
  }, [updateAndPersistData]);

  const syncToObsidianIfEnabled = useCallback(
    (_tasksToSync?: TaskItem[]) => {
      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      syncTimerRef.current = window.setTimeout(() => {
        syncTimerRef.current = null;
        const cfg = dataRef.current.settings.obsidian;
        if (!cfg?.enabled || !cfg.autoSync || !cfg.vaultPath) return;
        obsidianService
          .syncTasks(dataRef.current.tasks, dataRef.current.modes, cfg)
          .then((res) => {
            if (res.success) {
              updateAndPersistData((prev) => ({
                ...prev,
                settings: {
                  ...prev.settings,
                  obsidian: prev.settings.obsidian
                    ? { ...prev.settings.obsidian, lastSyncedAt: new Date().toISOString() }
                    : prev.settings.obsidian,
                },
              }));
            }
          })
          .catch((err) => {
            console.warn('Auto-sync to Obsidian notice:', err);
          });
      }, 900);
    },
    [updateAndPersistData]
  );

  // Two-way import: whenever a note under Control/Tasks changes on disk,
  // read everything back and reconcile. The file wins; the app never
  // re-exports here (the files are already the newer state).
  const handleObsidianTasksChanged = useCallback(async () => {
    const cfg = dataRef.current.settings.obsidian;
    if (!cfg?.enabled || !cfg.vaultPath) return;
    if (obsidianService.isSyncing()) return;
    try {
      const res = await obsidianService.readTasks(cfg);
      if (!res.success) return;
      const merged = mergeImportedTasks(
        dataRef.current.tasks,
        res.tasks,
        obsidianService.getLastExportedIds(),
        dataRef.current.modes
      );
      if (merged.changed) {
        updateAndPersistData((prev) => ({ ...prev, tasks: merged.tasks }));
        // Hand-made notes without an id get one written by a single export.
        if (merged.needsIdBackfill) syncToObsidianIfEnabled();
      }
    } catch (err) {
      console.warn('Obsidian tasks import failed:', err);
    }
  }, [updateAndPersistData, syncToObsidianIfEnabled]);

  useEffect(() => {
    if (!window.controlAPI?.onTasksFileChanged) return;
    return window.controlAPI.onTasksFileChanged(() => {
      void handleObsidianTasksChanged();
    });
  }, [handleObsidianTasksChanged]);

  // Reconcile once after boot so edits made while the app was closed land too.
  useEffect(() => {
    if (!isLoaded) return;
    void handleObsidianTasksChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  // Task Handlers
  const handleAddTask = (title: string, modeId?: string, cycles?: number): TaskItem => {
    const newTask: TaskItem = {
      id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title: title.trim(),
      completed: false,
      order: dataRef.current.tasks.length,
      modeId: modeId,
      ...(cycles !== undefined ? { cycles: clampCycles(cycles, 1) } : {}),
      createdAt: new Date().toISOString(),
    };
    updateAndPersistData((prev) => {
      const updatedTasks = [...prev.tasks, newTask];
      syncToObsidianIfEnabled(updatedTasks);
      return { ...prev, tasks: updatedTasks };
    });
    return newTask;
  };

  const handleAddQueueTask = useCallback((title: string): TaskItem => {
    const newTask: TaskItem = {
      id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title: title.trim(),
      completed: false,
      order: dataRef.current.tasks.length,
      modeId: activeSessionRef.current?.modeId,
      createdAt: new Date().toISOString(),
    };

    updateAndPersistData((prev) => {
      const updatedTasks = [...prev.tasks, newTask];
      let updatedActive = prev.activeSession || activeSessionRef.current;
      if (updatedActive) {
        const nextTaskIds = updatedActive.taskIds.includes(newTask.id)
          ? updatedActive.taskIds
          : [...updatedActive.taskIds, newTask.id];
        const nextActiveId = updatedActive.activeTaskId || newTask.id;
        updatedActive = {
          ...updatedActive,
          taskIds: nextTaskIds,
          activeTaskId: nextActiveId,
        };
        setActiveSession(updatedActive);
        activeSessionRef.current = updatedActive;
      }
      syncToObsidianIfEnabled(updatedTasks);
      return {
        ...prev,
        tasks: updatedTasks,
        activeSession: updatedActive,
      };
    });

    return newTask;
  }, [syncToObsidianIfEnabled, updateAndPersistData]);

  const handleAddExistingTaskToQueue = useCallback((taskId: string) => {
    updateAndPersistData((prev) => {
      const active = prev.activeSession || activeSessionRef.current;
      if (!active || active.taskIds.includes(taskId)) return prev;

      const nextTaskIds = [...active.taskIds, taskId];
      const nextActiveId = active.activeTaskId || taskId;
      const updatedActive = {
        ...active,
        taskIds: nextTaskIds,
        activeTaskId: nextActiveId,
      };
      setActiveSession(updatedActive);
      activeSessionRef.current = updatedActive;
      return {
        ...prev,
        activeSession: updatedActive,
      };
    });
  }, [updateAndPersistData]);

  const handleUpdateTask = (task: TaskItem) => {
    updateAndPersistData((prev) => {
      const updatedTasks = prev.tasks.map((t) => (t.id === task.id ? task : t));
      syncToObsidianIfEnabled(updatedTasks);
      return { ...prev, tasks: updatedTasks };
    });
  };

  const handleDeleteTask = (taskId: string) => {
    updateAndPersistData((prev) => {
      const updatedTasks = prev.tasks.filter((t) => t.id !== taskId);
      syncToObsidianIfEnabled(updatedTasks);
      return { ...prev, tasks: updatedTasks };
    });
  };

  const handleReorderTasks = (reordered: TaskItem[]) => {
    updateAndPersistData((prev) => {
      syncToObsidianIfEnabled(reordered);
      return { ...prev, tasks: reordered };
    });
  };

  const handleClearCompletedTasks = () => {
    updateAndPersistData((prev) => {
      const updatedTasks = prev.tasks.filter((t) => !t.completed);
      syncToObsidianIfEnabled(updatedTasks);
      return { ...prev, tasks: updatedTasks };
    });
  };

  // Start Control Session
  // Returns whether any blocking list was actually engaged, plus the first
  // failure when enforcement was requested but failed. Callers surface the
  // error loudly: a running timer must never silently pretend to block.
  const activateModeRestrictions = async (
    mode: StudyMode,
    blockingOverride?: boolean,
    globalBlockingEnabled?: boolean
  ): Promise<{ enforced: boolean; error?: string }> => {
    // B-08: global kill-switch honored — Settings blockingEnabled off means
    // no enforcement even when the mode requests it.
    const globallyDisabled = globalBlockingEnabled === false;
    const shouldBlock =
      !globallyDisabled &&
      (blockingOverride ?? (!mode.isChillMode && mode.blockingStrategy !== 'none'));
    const webBlocks = shouldBlock ? mode.blocklist : [];
    const appBlocks = shouldBlock ? (mode.blockedApps || []) : [];

    // This starts enforcement before the timer gets a start timestamp. The
    // ActiveSessionView keeps it synchronized during breaks and afterwards.
    const [webRes, appRes] = await Promise.allSettled([
      webBlocks.length > 0
        ? blockerClient.startBlocking(webBlocks, mode.blockingStrategy)
        : blockerClient.stopBlocking(),
      appBlocks.length > 0
        ? blockerClient.startAppBlocking(appBlocks)
        : blockerClient.stopAppBlocking(),
    ]);
    const errOf = (
      r: PromiseSettledResult<{ success: boolean; error?: string }>
    ): string | undefined =>
      r.status === 'rejected'
        ? r.reason instanceof Error
          ? r.reason.message
          : String(r.reason)
        : !r.value.success
          ? r.value.error || 'Blocking call failed.'
          : undefined;
    const webErr = errOf(webRes);
    const appErr = errOf(appRes);
    return {
      enforced: (webBlocks.length > 0 && !webErr) || (appBlocks.length > 0 && !appErr),
      error: webErr || appErr || undefined,
    };
  };

  const handleStartSession = async (
    mode: StudyMode,
    selectedTaskIds: string[] = [],
    overrides?: {
      workMins?: number;
      breakMins?: number;
      cycles?: number;
      taskTitle?: string;
      blockingOverride?: boolean;
      /** Auto-run/plan starts are pre-approved — skip the long-session confirm. */
      silent?: boolean;
      /** Planner block that launched this run; marked done when its cycle ends. */
      sourceBlock?: { id: string; date: string };
    }
  ): Promise<boolean> => {
    if (activeSessionRef.current) return false;

    const workMins = overrides?.workMins && overrides.workMins > 0 ? overrides.workMins : mode.workDuration;
    const breakMins = overrides?.breakMins ?? mode.breakDuration;
    const initialSecs = workMins * 60;

    const requestedTask = overrides?.taskTitle?.trim();
    const newTask = requestedTask ? {
      id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title: requestedTask,
      completed: false,
      order: dataRef.current.tasks.length,
      modeId: mode.id,
      createdAt: new Date().toISOString(),
    } satisfies TaskItem : null;
    const taskIds = newTask ? [newTask.id, ...selectedTaskIds] : selectedTaskIds;
    // Cycles: explicit per-session override wins, then the strongest per-task
    // choice among the attached tasks, then the mode fallback (for tasks and
    // flows that predate per-task cycles). B-07: with no explicit override,
    // the queue is 1:1 — a longer task queue extends the run so no queued
    // task is silently ignored.
    let totalCycles = resolveSessionCycles({
      tasks: dataRef.current.tasks,
      taskIds,
      modeCycles: mode.cycles,
      overrideCycles: overrides?.cycles,
    });
    if (overrides?.cycles === undefined && taskIds.length > totalCycles) {
      // B-07/B-20: the queue is 1:1 so nothing queued is silently ignored —
      // but calendar-mirrored tasks (`task-cal-*`) are planner events, not
      // chosen work: planning a day must not lengthen the next timer.
      const countable = taskIds.filter((id) => {
        const t = dataRef.current.tasks.find((task) => task.id === id);
        return !t || t.source !== 'calendar';
      });
      if (countable.length > totalCycles) {
        totalCycles = Math.min(12, Math.max(1, countable.length));
      }
    }
    // S-03/S-08: unified long-session consent on ALL start paths (was only
    // one-click task starts). Uses long-break-aware wall time.
    const wallPreview = sessionWallMinutesFull(workMins, breakMins, totalCycles, mode.longBreakDuration, mode.longBreakInterval);
    if (!overrides?.silent && wallPreview > LONG_SESSION_CONFIRM_WALL_MINS) {
      const hours = Math.floor(wallPreview / 60);
      const mins = wallPreview % 60;
      const wallStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      const titles = taskIds.map((id) => dataRef.current.tasks.find((t) => t.id === id)?.title).filter(Boolean).slice(0, 3).join(', ');
      if (!confirm(`Start ${totalCycles} control block${totalCycles === 1 ? '' : 's'} in ${mode.name} (~${wallStr} wall time with breaks${titles ? `: ${titles}` : ''})?\n\nSource: ${overrides?.workMins !== undefined ? 'planner block' : 'manual queue'} · ${workMins}m work / ${breakMins}m break.`)) {
        return false;
      }
    }

    // Snapshot how far along each attached task already is (it may have been
    // paused/quit after earlier cycles). The timer shows "cycle x of z" by
    // adding these offsets to this session's own cycle counter.
    const taskCycleOffsets: Record<string, number> = {};
    for (const id of taskIds) {
      const t = dataRef.current.tasks.find((x) => x.id === id);
      const done = t?.cyclesCompleted || 0;
      if (done > 0) taskCycleOffsets[id] = done;
    }

    const newSessionState: ActiveSessionState = {
      id: `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      modeId: mode.id,
      modeName: mode.name,
      modeIcon: mode.icon,
      modeColor: mode.color,
      isChillMode: mode.isChillMode,
      workDurationMins: workMins,
      breakDurationMins: breakMins,
      totalCycles,
      currentCycle: 1,
      phase: mode.isChillMode ? 'chill' : 'work',
      // The timestamp is filled after Control has activated this Mode's
      // restrictions, keeping the timer and enforcement in one start action.
      phaseStartTime: 0,
      phaseDurationSeconds: initialSecs,
      accumulatedWorkSeconds: 0,
      completedCyclesCount: 0,
      isPaused: false,
      pauseStartedAt: null,
      totalPauseSecondsThisPhase: 0,
      totalPauseSecondsAllPhases: 0,
      taskIds,
      activeTaskId: taskIds[0] || null,
      completedTaskIds: [],
      blocklist: mode.blocklist,
      blockedApps: mode.blockedApps || [],
      blockingStrategy: mode.blockingStrategy,
      blockingOverride: overrides?.blockingOverride,
      countTowardStats: mode.countTowardStats,
      allowBreakWebsites: mode.allowBreakWebsites !== false,
      startedAt: new Date().toISOString(),
      longBreakDurationMins: mode.longBreakDuration || 0,
      longBreakInterval: mode.longBreakInterval || 0,
      taskDwellSeconds: {},
      taskCycleOffsets,
      sourceBlockId: overrides?.sourceBlock?.id,
      sourceBlockDate: overrides?.sourceBlock?.date,
    };

    const blocking = await activateModeRestrictions(mode, overrides?.blockingOverride, dataRef.current.settings.blockingEnabled);
    lastBlockingOutcome.current = blocking;
    if (blocking.error) {
      // The session still starts (existing behavior), but a failed blocker
      // must never look active: say so loudly instead of failing silently.
      await window.controlAPI?.sendNotification(
        'Blocking failed to start',
        `${blocking.error} The timer is running WITHOUT blocking.`
      );
    }
    const startedSession = { ...newSessionState, phaseStartTime: Date.now() };
    activeSessionRef.current = startedSession;
    setActiveSession(startedSession);
    setCompletedSessionSummary(null);
    setActiveTab('timer');

    updateAndPersistData((prev) => ({
      ...prev,
      tasks: newTask ? [...prev.tasks, newTask] : prev.tasks,
      activeSession: startedSession,
    }));
    if (newTask) syncToObsidianIfEnabled();
    return true;
  };

  // Purpose hands Control an exact Mode ID. No duration, blocklist, or mode
  // profile crosses the app boundary, so Modes stay the single source of truth.
  // control:// URLs may carry a mode *name* instead — resolve that too.
  const startPurposeSession = useCallback(async (request: PurposeSessionRequest) => {
    if (purposeRequestInFlightRef.current === request.id || activeSessionRef.current) return;

    const wanted = request.modeId.trim();
    const mode =
      data.modes.find((candidate) => candidate.id === wanted) ||
      data.modes.find((candidate) => candidate.name.toLowerCase() === wanted.toLowerCase());
    if (!mode) {
      await window.controlAPI?.acknowledgePurposeSessionRequest(request.id);
      window.controlAPI?.sendNotification(
        'Purpose could not start a session',
        'The selected Control Mode no longer exists.'
      );
      return;
    }

    purposeRequestInFlightRef.current = request.id;
    try {
      const started = await handleStartSession(mode, [], { taskTitle: request.purpose });
      if (started) {
        await window.controlAPI?.acknowledgePurposeSessionRequest(request.id);
      }
    } finally {
      purposeRequestInFlightRef.current = null;
    }
  }, [data]);

  useEffect(() => {
    if (!isLoaded || !window.controlAPI?.getPurposeSessionRequest) return;
    const checkForPurposeSession = () => {
      window.controlAPI?.getPurposeSessionRequest
        ?.()
        .then((request) => {
          if (request) void startPurposeSession(request);
        })
        .catch(() => undefined);
    };
    checkForPurposeSession();
    return window.controlAPI.onPurposeSessionRequested?.(checkForPurposeSession);
  }, [isLoaded, startPurposeSession]);

  // ── Automatic study-day execution (main-process scheduler) ───────────────
  // The main process owns timers/notifications and asks us to start/end
  // sessions. We stay authoritative: an active manual session always wins,
  // and the existing session engine does the actual work (no second engine).
  const autoExecRef = useRef<{ blockId: string; date: string } | null>(null);
  const [autoExecFinishSignal, setAutoExecFinishSignal] = useState(0);
  // Outcome of the most recent session start's blocking attempt. Read by the
  // auto-execution start handler right after starting (starts are serialized
  // by the active-session guard, so this cannot race).
  const lastBlockingOutcome = useRef<{ enforced: boolean; error?: string } | null>(null);
  const startSessionRef = useRef(handleStartSession);
  startSessionRef.current = handleStartSession;

  useEffect(() => {
    const api = window.controlAPI;
    if (!api?.onAutoExecStart || !api?.onAutoExecEnd) return;

    const stopStart = api.onAutoExecStart(async (req) => {
      try {
        const data = dataRef.current;
        const block = data.plans[req.date]?.blocks.find((b) => b.id === req.blockId);
        if (!block) return { success: true, started: false, reason: 'event-deleted' };
        if (block.status === 'completed') return { success: true, started: false, reason: 'event-completed' };
        if (activeSessionRef.current) return { success: true, started: false, reason: 'session-active' };
        const mode = data.modes.find((m) => m.id === block.modeId);
        if (!mode) return { success: true, started: false, reason: 'mode-missing' };
        // Pre-approved by the schedule → silent start (no long-session prompt),
        // linked to the block's task so cycles credit it and "cycle x of z"
        // keeps counting across sittings. Blocking arms via the normal path.
        const started = await startSessionRef.current(
          mode,
          block.taskId ? [block.taskId] : [],
          {
            workMins: block.workDuration,
            breakMins: block.breakDuration,
            cycles: block.cycleIndex != null ? 1 : block.cycles,
            blockingOverride: block.controlMode,
            silent: true,
            sourceBlock: { id: block.id, date: block.date },
          }
        );
        if (!started) return { success: true, started: false, reason: 'session-active' };
        autoExecRef.current = { blockId: block.id, date: block.date };
        const blocking = lastBlockingOutcome.current;
        lastBlockingOutcome.current = null;
        return {
          success: true,
          started: true,
          blockingEnforced: blocking?.enforced,
          blockingError: blocking?.error,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    const stopEnd = api.onAutoExecEnd(async (req) => {
      try {
        const auto = autoExecRef.current;
        const active = activeSessionRef.current;
        if (!auto || auto.blockId !== req.blockId || !active) {
          // Session already ended, differs, or was never auto-started:
          // never touch another session's blockers.
          return { success: true, ended: false, reason: 'session-differs' };
        }
        // Mark the planner block completed through the normal save pipeline
        // (`status` is not a mirrored sync field — no spurious Google push).
        updateAndPersistData((prev) => {
          const plan = prev.plans[req.date];
          if (!plan) return prev;
          return {
            ...prev,
            plans: {
              ...prev.plans,
              [req.date]: {
                ...plan,
                blocks: plan.blocks.map((b) =>
                  b.id === req.blockId ? { ...b, status: 'completed' as const } : b
                ),
              },
            },
          };
        });
        autoExecRef.current = null;
        setAutoExecFinishSignal((n) => n + 1);
        return { success: true, ended: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    return () => {
      stopStart();
      stopEnd();
    };
  }, [updateAndPersistData]);

  // ── Renderer-side scheduler fallback (browser/dev without the main-process
  // scheduler) ─────────────────────────────────────────────────────────────
  // Electron owns auto-execution through `onAutoExecStart/End`. When that IPC
  // is absent, this watchdog preserves the same promise: a planned block
  // starts its timer AND arms blocking the moment its time arrives, and ends
  // when the block ends. It reuses the exact policy module + guards.
  const fallbackStartedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Electron preload exposes this; a plain browser never does.
    if (typeof window.controlAPI?.onAutoExecStart === 'function') return; // main process owns it
    const tick = async () => {
      const data = dataRef.current;
      if (!getAutoExecSettings(data).enabled) return;
      const now = Date.now();
      let occs;
      try {
        occs = computeOccurrences(data, now);
      } catch {
        return;
      }
      // End: the auto-started block reached its scheduled end.
      const auto = autoExecRef.current;
      if (auto) {
        const occ = occs.find((o) => o.blockId === auto.blockId && o.date === auto.date);
        if (occ && now >= occ.endAtMs) {
          updateAndPersistData((prev) => {
            const plan = prev.plans[auto.date];
            if (!plan) return prev;
            return {
              ...prev,
              plans: {
                ...prev.plans,
                [auto.date]: {
                  ...plan,
                  blocks: plan.blocks.map((b) =>
                    b.id === auto.blockId ? { ...b, status: 'completed' as const } : b
                  ),
                },
              },
            };
          });
          autoExecRef.current = null;
          setAutoExecFinishSignal((n) => n + 1);
          return;
        }
      }
      if (activeSessionRef.current || autoExecRef.current) return;
      for (const occ of occs) {
        if (fallbackStartedRef.current.has(occ.key)) continue;
        if (!dueActions(occ, undefined, now).includes('start')) continue;
        fallbackStartedRef.current.add(occ.key);
        const block = data.plans?.[occ.date]?.blocks.find((b) => b.id === occ.blockId);
        if (!block || block.status === 'completed') continue;
        const mode = data.modes.find((m) => m.id === block.modeId);
        if (!mode) continue;
        const started = await startSessionRef.current(mode, block.taskId ? [block.taskId] : [], {
          workMins: block.workDuration,
          breakMins: block.breakDuration,
          cycles: block.cycleIndex != null ? 1 : block.cycles,
          blockingOverride: block.controlMode,
          silent: true,
          sourceBlock: { id: block.id, date: block.date },
        });
        if (started) autoExecRef.current = { blockId: block.id, date: block.date };
        break; // one start per tick, same as the main-process policy
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 30 * 1000);
    return () => window.clearInterval(id);
  }, [updateAndPersistData]);

  // Update live active session state
  const handleUpdateSessionState = useCallback((updated: ActiveSessionState) => {
    setActiveSession(updated);
    activeSessionRef.current = updated;
    updateAndPersistData((prev) => ({
      ...prev,
      activeSession: updated,
    }));
  }, [updateAndPersistData]);

  // Credit a finished control cycle THE MOMENT it ends (not at session end):
  // tasks resume across sittings, so a cycle done must survive a later
  // cancel/quit. When this cycle completes the block that launched the run
  // (1-cycle planner events, or the final cycle of a multi-cycle block),
  // the block flips to done in the day planner too.
  const handleCycleCompleted = useCallback((taskId: string | null) => {
    const active = activeSessionRef.current;
    const coversWholeBlock =
      !!active && active.completedCyclesCount + 1 >= active.totalCycles;
    updateAndPersistData((prev) => {
      let tasks = prev.tasks;
      if (taskId) {
        tasks = tasks.map((t) => {
          if (t.id !== taskId) return t;
          const total = typeof t.cycles === 'number' && Number.isFinite(t.cycles) ? t.cycles : 0;
          const done = (t.cyclesCompleted || 0) + 1;
          return { ...t, cyclesCompleted: total > 0 ? Math.min(total, done) : done };
        });
      }
      if (coversWholeBlock && active?.sourceBlockId && active.sourceBlockDate) {
        const plan = prev.plans[active.sourceBlockDate];
        if (plan) {
          return {
            ...prev,
            tasks,
            plans: {
              ...prev.plans,
              [active.sourceBlockDate]: {
                ...plan,
                blocks: plan.blocks.map((b) =>
                  b.id === active.sourceBlockId ? { ...b, status: 'completed' as const } : b
                ),
              },
            },
          };
        }
      }
      return { ...prev, tasks };
    });
  }, [updateAndPersistData]);

  // Finish session normally
  const handleFinishSession = useCallback((sessionSummary: ControlSession) => {
    const dwell = activeSessionRef.current?.taskDwellSeconds;
    updateAndPersistData((prev) => ({
      ...prev,
      sessions: [sessionSummary, ...prev.sessions],
      tasks: sessionSummary.countTowardStats
        ? allocateSessionMinutes(sessionSummary, prev.tasks, dwell)
        : prev.tasks,
      activeSession: null,
    }));
    setActiveSession(null);
    activeSessionRef.current = null;
    setCompletedSessionSummary(sessionSummary);
  }, [updateAndPersistData]);

  // Cancel session — B-05: never silently drop real work. Sessions with
  // ≥60s of accumulated control are recorded as cancelled so History/Stats
  // agree with the timer; shorter ones are discarded as noise.
  const handleCancelSession = useCallback(() => {
    blockerClient.stopBlocking();
    blockerClient.stopAppBlocking();
    const active = activeSessionRef.current;
    setActiveSession(null);
    activeSessionRef.current = null;
    updateAndPersistData((prev) => {
      if (!active) return { ...prev, activeSession: null };
      const accSecs = (active.accumulatedWorkSeconds || 0);
      if (accSecs >= 60) {
        const actualMins = Math.max(1, Math.round(accSecs / 60));
        const cancelled: ControlSession = {
          id: active.id,
          modeId: active.modeId,
          modeName: active.modeName,
          modeIcon: active.modeIcon,
          isChillMode: !!active.isChillMode,
          startTime: active.startedAt,
          endTime: new Date().toISOString(),
          plannedWorkMinutes: active.totalCycles * active.workDurationMins,
          actualWorkMinutes: actualMins,
          plannedCycles: active.totalCycles,
          completedCycles: active.completedCyclesCount || 0,
          status: 'cancelled',
          countTowardStats: active.countTowardStats,
          tasksTotal: active.taskIds.length,
          tasksCompleted: (active.completedTaskIds || []).length,
          // B-19: carry attached task ids for minute attribution.
          taskIds: [...active.taskIds],
          finishedEarly: (active.completedCyclesCount || 0) < active.totalCycles,
          skippedPhases: (active as unknown as { skippedPhases?: number }).skippedPhases || 0,
        };
        return { ...prev, activeSession: null, sessions: [...prev.sessions, cancelled] };
      }
      // S-17: explain the discard instead of silent loss.
      window.controlAPI?.sendNotification?.('Session discarded', 'Under 60s of control is not saved — keep going to log it.');
      return { ...prev, activeSession: null };
    });
    setCompletedSessionSummary(null);
    setActiveTab('tasks');
  }, [updateAndPersistData]);

  // Immediate exit app (no time restriction)
  const handleConfirmLeave = async () => {
    try {
      handleCancelSession();
      await blockerClient.stopBlocking();
      await blockerClient.stopAppBlocking();
      if (window.controlAPI?.confirmQuit) {
        await window.controlAPI.confirmQuit();
      } else {
        setIsLeaveModalOpen(false);
      }
    } catch (err) {
      console.warn('Leave/exit failed:', err);
      if (window.controlAPI?.confirmQuit) {
        await window.controlAPI.confirmQuit();
      }
    }
  };

  const handleMinimizeToTray = async () => {
    try {
      if (window.controlAPI?.minimizeToTray) {
        await window.controlAPI.minimizeToTray();
      }
    } catch (err) {
      console.warn('Minimize to tray failed:', err);
    }
  };

  const handleSaveModes = (updatedModes: StudyMode[]) => {
    updateAndPersistData((prev) => ({ ...prev, modes: updatedModes }));
  };

  const handleSaveModeFolders = (modeFolders: ModeFolder[]) => {
    updateAndPersistData((prev) => ({ ...prev, modeFolders }));
  };

  const handleSaveModesAndFolders = (updatedModes: StudyMode[], modeFolders: ModeFolder[]) => {
    updateAndPersistData((prev) => ({ ...prev, modes: updatedModes, modeFolders }));
  };

  const handleSaveNotes = (notes: Note[]) => {
    updateAndPersistData((prev) => ({ ...prev, notes }));
  };

  const handleSaveNoteFolders = (noteFolders: NoteFolder[]) => {
    updateAndPersistData((prev) => ({ ...prev, noteFolders }));
  };

  const handleSaveNotesAndFolders = (notes: Note[], noteFolders: NoteFolder[]) => {
    updateAndPersistData((prev) => ({ ...prev, notes, noteFolders }));
  };

  const handleSavePlan = (date: string, plan: DayPlan) => {
    // Mirror planner blocks to tasks so events appear in the Tasks view.
    // Functional update: rapid successive saves (drag + modal + template)
    // must never operate on a stale task list and duplicate mirrors.
    updateAndPersistData((prev) => {
      const nextBlocks = plan.blocks || [];
      const nextById = new Map(nextBlocks.map((b) => [b.id, b]));
      const cleanOf = (s: string) => stripDateSuffix(s || '').trim().toLowerCase();

      let tasks = [...prev.tasks];

      // Remove mirrored tasks for blocks that no longer exist on THIS date.
      // A calendar task is only considered removed from the calendar if it belonged
      // to this date originally and is not in nextById.
      // S-13: completed mirrors and adopted manual tasks (!t.id.startsWith('task-cal-'))
      // are kept as manual tasks (user tasks and completion must not vanish).
      const prevDateBlockIds = new Set((prev.plans[date]?.blocks || []).map((b) => b.id));
      tasks = tasks.flatMap((t) => {
        if (t.source === 'calendar' && t.sourceId && prevDateBlockIds.has(t.sourceId) && !nextById.has(t.sourceId)) {
          if (t.completed || !t.id.startsWith('task-cal-')) {
            return [{ ...t, source: 'manual' as const, sourceId: undefined }];
          }
          return [];
        }
        return [t];
      });

      // Upsert mirrored tasks for blocks that exist.
      // Cycle blocks (`b.taskId` set) are already one cycle of an EXISTING
      // task — mirroring them would spawn one dummy task per cycle.
      for (const b of nextBlocks) {
        if (b.taskId) continue;
        const existingTask = tasks.find((t) => t.source === 'calendar' && t.sourceId === b.id);
        if (existingTask) {
          const mode = prev.modes.find((m) => m.id === b.modeId);
          const display = (b.modeName || mode?.name || 'Planned block').trim();
          if (
            existingTask.title !== display ||
            (existingTask.modeId || undefined) !== (b.modeId || undefined)
          ) {
            tasks = tasks.map((t) =>
              t.id === existingTask.id
                ? { ...t, title: display, modeId: b.modeId || undefined }
                : t
            );
          }
        } else {
          const mode = prev.modes.find((m) => m.id === b.modeId);
          const display = (b.modeName || mode?.name || 'Planned block').trim();
          // Adopt: the block was scheduled from an existing manual task with
          // the same (display) title — link that task instead of adding a
          // second task-cal-* copy that looks like a duplicate.
          const manualMatch = tasks.find(
            (t) =>
              t.source !== 'calendar' &&
              !t.completed &&
              cleanOf(t.title) === cleanOf(display) &&
              cleanOf(display).length > 0
          );
          if (manualMatch) {
            tasks = tasks.map((t) =>
              t.id === manualMatch.id
                ? { ...t, source: 'calendar' as const, sourceId: b.id, modeId: t.modeId || b.modeId || undefined }
                : t
            );
          } else {
            const newTask: TaskItem = {
              id: `task-cal-${b.id}`,
              title: display,
              completed: b.status === 'completed',
              order: tasks.length,
              // A block planned without a mode becomes a task with no mode.
              modeId: b.modeId || undefined,
              createdAt: b.createdAt || new Date().toISOString(),
              source: 'calendar',
              sourceId: b.id,
            };
            // Guard against a stale double-save inserting the same id twice.
            if (!tasks.some((t) => t.id === newTask.id)) {
              tasks = [...tasks, newTask];
            }
          }
        }
      }

      // Heal leftovers from the old double-create bug: an uncompleted manual
      // task with the same display title as a calendar mirror, holding no
      // recorded progress, is the orphaned extra copy — drop it.
      const mirrorTitles = new Set(
        tasks
          .filter((t) => t.source === 'calendar' && t.sourceId)
          .map((t) => cleanOf(t.title))
      );
      tasks = tasks.filter((t) => {
        if (t.source === 'calendar' || t.completed || !mirrorTitles.has(cleanOf(t.title))) return true;
        const hasProgress =
          (t.controlMinutes || 0) > 0 || t.review != null || t.targetCount != null || t.estimateMinutes != null;
        return hasProgress;
      });

      // Preserve completed state for existing mirrored tasks based on block status
      tasks = tasks.map((t) => {
        if (t.source === 'calendar' && t.sourceId && nextById.has(t.sourceId)) {
          const b = nextById.get(t.sourceId)!;
          if (t.completed !== (b.status === 'completed')) {
            return {
              ...t,
              completed: b.status === 'completed',
              completedAt: b.status === 'completed' ? t.completedAt || new Date().toISOString() : undefined,
            };
          }
        }
        return t;
      });

      const updated = {
        ...prev,
        plans: {
          ...prev.plans,
          [date]: plan,
        },
        tasks,
      };
      syncToObsidianIfEnabled(tasks);
      return updated;
    });
  };

  const handleSaveSettings = (settings: UserSettings) => {
    updateAndPersistData((prev) => ({ ...prev, settings }));
    setTheme(settings.theme);
    plannerMd.setVaultPath(settings.obsidian?.vaultPath || '');
  };

  const handleDeleteSession = (sessionId: string) => {
    updateAndPersistData((prev) => ({
      ...prev,
      sessions: prev.sessions.filter((s) => s.id !== sessionId),
    }));
  };

  const handleClearAllSessions = () => {
    updateAndPersistData((prev) => ({ ...prev, sessions: [] }));
  };

  const handleExportBackup = () => {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `control-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBackup = (imported: ControlAppData) => {
    persistData(imported);
    if (imported.settings?.theme) {
      setTheme(imported.settings.theme);
    }
  };

  // Global Keyboard Shortcuts (Cmd+K for Command Palette & Cmd+1-7 for Tabs)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle Command Palette with Cmd+K / Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        const num = parseInt(e.key, 10);
        const tabMap: Record<number, NavTab> = {
          1: 'tasks',
          2: 'timer',
          3: 'blocker',
          4: 'planner',
          5: 'modes',
          6: 'history',
          7: 'notes',
          8: 'settings',
        };
        if (tabMap[num]) {
          e.preventDefault();
          setActiveTab(tabMap[num]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!isLoaded) {
    return (
      <div
        className="flex items-center justify-center h-screen font-semibold text-sm"
        style={{ backgroundColor: currentTheme.bgPrimary, color: currentTheme.accent }}
      >
        <div className="flex items-center space-x-3 px-6 py-4 rounded-3xl border shadow-lg bg-black/40">
          <span className="w-3 h-3 rounded-full bg-sky-500 animate-ping" />
          <span>Starting Control...</span>
        </div>
      </div>
    );
  }

  // First-run setup: fresh installs have no name yet — ask before entering.
  if (data.settings.setupCompleted === false) {
    return (
      <SetupWizard
        theme={theme}
        onComplete={(name) => {
          handleSaveSettings({ ...data.settings, userName: name, setupCompleted: true });
        }}
      />
    );
  }

  return (
    <div
      data-theme-mode={currentTheme.isDark ? 'dark' : 'light'}
      className="flex flex-col h-screen overflow-hidden font-semibold transition-colors duration-300 relative"
      style={{
        backgroundColor: currentTheme.bgPrimary,
        color: currentTheme.textPrimary,
      }}
    >
      {/* Background Ambient Aura Glow Lights */}
      <div 
        className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full pointer-events-none ambient-orb-1 opacity-60"
        style={{ 
          background: currentTheme.isDark 
            ? 'radial-gradient(circle, rgba(56, 189, 248, 0.15) 0%, rgba(56, 189, 248, 0) 70%)' 
            : 'radial-gradient(circle, rgba(56, 189, 248, 0.18) 0%, rgba(56, 189, 248, 0) 70%)' 
        }}
      />
      <div 
        className="absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full pointer-events-none ambient-orb-2 opacity-60"
        style={{ 
          background: currentTheme.isDark 
            ? 'radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, rgba(99, 102, 241, 0) 70%)' 
            : 'radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, rgba(99, 102, 241, 0) 70%)' 
        }}
      />

      {/* Floating Liquid Glass Navigation Dynamic Island */}
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        activeSession={activeSession}
        theme={theme}
        onToggleTheme={() => {
          const nextTheme: ThemeId = currentTheme.isDark ? 'moder' : 'serika';
          setTheme(nextTheme);
          handleSaveSettings({ ...data.settings, theme: nextTheme });
        }}
        onRequestLeave={() => setIsLeaveModalOpen(true)}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
      />

      {/* Main Content Workspace */}
      <main className="flex-1 flex flex-col overflow-hidden relative z-10">
        {/* Tab 1: Tasks & Control Studio (The Main View!) */}
        {(activeTab === 'tasks' || activeTab === 'launcher') && (
          <TasksView
            tasks={data.tasks}
            modes={data.modes}
            modeFolders={data.modeFolders}
            sessions={data.sessions}
            dailyGoalMinutes={data.settings.dailyGoalMinutes}
            onAddTask={handleAddTask}
            onUpdateTask={handleUpdateTask}
            onDeleteTask={handleDeleteTask}
            onReorderTasks={handleReorderTasks}
            onClearCompletedTasks={handleClearCompletedTasks}
            onStartControlWithTask={(task, modeOverride) => {
              const mode =
                modeOverride ||
                (task.modeId ? data.modes.find((m) => m.id === task.modeId) : null) ||
                data.modes.find((m) => m.id === selectedLauncherModeId) ||
                data.modes[0];
              // B-17: one click on a task with per-task cycles silently
              // resolves to a multi-hour session (per-task choice wins).
              // Above an hour of wall time, ask first.
              const previewCycles = resolveSessionCycles({
                tasks: data.tasks,
                taskIds: [task.id],
                modeCycles: mode.cycles,
              });
              const wall = sessionWallMinutes(mode.workDuration, mode.breakDuration, previewCycles);
              if (wall > LONG_SESSION_CONFIRM_WALL_MINS) {
                const hours = Math.floor(wall / 60);
                const mins = wall % 60;
                const wallStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                const done = task.cyclesCompleted || 0;
                const msg =
                  done > 0 && task.cycles
                    ? `"${task.title}" — ${done}/${task.cycles} cycles done, ${previewCycles} left (~${wallStr} wall time with breaks).\n\nContinue where you left off?`
                    : `"${task.title}" is set to ${previewCycles} control blocks (~${wallStr} wall time with breaks).\n\nStart a ${wallStr} session?`;
                if (!confirm(msg)) {
                  return;
                }
              }
              handleStartSession(mode, [task.id]);
            }}
            onStartStandaloneSession={(mode, taskIds, cycles) => {
              handleStartSession(mode, taskIds, cycles !== undefined ? { cycles } : undefined);
            }}
            onOpenBlocker={() => setActiveTab('blocker')}
            onOpenModes={() => setActiveTab('modes')}
            onOpenPlanner={() => setActiveTab('planner')}
            userName={data.settings.userName}
            theme={theme}
            obsidianConfig={data.settings.obsidian}
            onObsidianSynced={handleObsidianSynced}
          />
        )}

        {/* Tab 2: Control Timer (Active Session View / Session Completion Summary) */}
        {activeTab === 'timer' && (
          completedSessionSummary ? (
            <SessionCompletionView
              session={completedSessionSummary}
              onReturnToLauncher={() => {
                setCompletedSessionSummary(null);
                setActiveTab('tasks');
              }}
              onViewHistory={() => {
                setCompletedSessionSummary(null);
                setActiveTab('history');
              }}
              onViewTasks={() => {
                setCompletedSessionSummary(null);
                setActiveTab('tasks');
              }}
              theme={theme}
            />
          ) : activeSession ? (
            <ActiveSessionView
              sessionState={activeSession}
              allTasks={data.tasks}
              modes={data.modes}
              onSwitchModeForRemaining={(modeId) => {
                const m = data.modes.find((x) => x.id === modeId);
                if (!m || !activeSessionRef.current) return;
                if (!confirm(`Switch remaining cycles to ${m.name} (${m.workDuration}m/${m.breakDuration}m)? Current cycle keeps its timer.`)) return;
                handleUpdateSessionState({
                  ...activeSessionRef.current,
                  modeId: m.id,
                  modeName: m.name,
                  modeIcon: m.icon,
                  modeColor: m.color,
                  isChillMode: !!m.isChillMode,
                  workDurationMins: m.workDuration,
                  breakDurationMins: m.breakDuration,
                  longBreakDurationMins: m.longBreakDuration || 0,
                  longBreakInterval: m.longBreakInterval || 0,
                  blocklist: m.blocklist,
                  blockedApps: m.blockedApps || [],
                  blockingStrategy: m.blockingStrategy,
                  countTowardStats: m.countTowardStats,
                  allowBreakWebsites: m.allowBreakWebsites !== false,
                });
              }}
              onUpdateSessionState={handleUpdateSessionState}
              onUpdateTask={handleUpdateTask}
              onCycleCompleted={handleCycleCompleted}
              onAddTask={handleAddTask}
              onAddQueueTask={handleAddQueueTask}
              onAddExistingTaskToQueue={handleAddExistingTaskToQueue}
              onFinishSession={handleFinishSession}
              onCancelSession={handleCancelSession}
              onRequestLeave={() => setIsLeaveModalOpen(true)}
              theme={theme}
              settings={data.settings}
              externalFinishSignal={autoExecFinishSignal}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-5 text-center motion-blur-in">
              <div className="p-6 rounded-3xl liquid-glass-elevated border space-y-4 max-w-sm">
                <span className="w-3 h-3 rounded-full bg-sky-500 mx-auto block shadow-[0_0_12px_rgba(56,189,248,0.8)]" />
                <h2 
                  className="text-xl font-bold"
                  style={{ color: currentTheme.textPrimary }}
                >
                  No Active Control Session
                </h2>
                <p 
                  className="text-xs font-medium"
                  style={{ color: currentTheme.textSecondary }}
                >
                  Select a task from your Tasks Hub or choose a study mode to start controlling.
                </p>
                <button
                  onClick={() => setActiveTab('tasks')}
                  className="w-full py-3 px-6 rounded-2xl text-xs font-bold transition-all active:scale-95 shadow-md cursor-pointer"
                  style={{
                    backgroundColor: currentTheme.accent,
                    color: currentTheme.accentText,
                  }}
                >
                  Open Tasks & Control Hub [1]
                </button>
              </div>
            </div>
          )
        )}

        {/* Tab 3: Distraction Blocker Control Center */}
        {activeTab === 'blocker' && (
          <BlockerControl
            onBackToTasks={() => setActiveTab('tasks')}
            theme={theme}
          />
        )}

        {/* Tab 4: Day Planner & Smart Calendar */}
        {activeTab === 'planner' && (
          <PlannerView
            modes={data.modes}
            modeFolders={data.modeFolders}
            sessions={data.sessions}
            plans={data.plans}
            tasks={data.tasks}
            onSavePlan={handleSavePlan}
            onStartBlockInTimer={(mode, block) => {
              // A block that IS one cycle of a task starts that task's next
              // cycle: linked so it credits task progress and shows
              // "cycle x of z", and marked done when the cycle finishes.
              handleStartSession(mode, block.taskId ? [block.taskId] : [], {
                workMins: block.workDuration,
                breakMins: block.breakDuration,
                cycles: block.cycleIndex != null ? 1 : block.cycles,
                // Per-session Control preference from schedule templates.
                // Undefined = follow the mode's own blocking rules.
                blockingOverride: block.controlMode,
                sourceBlock: { id: block.id, date: block.date },
              });
            }}
            onBackToLauncher={() => setActiveTab('tasks')}
            onOpenSettings={() => setActiveTab('settings')}
            calendarConfig={data.settings.googleCalendar}
            obsidianConfig={data.settings.obsidian}
            onObsidianSynced={handleObsidianSynced}
            onUpdateCalendarConfig={(calCfg) =>
              handleSaveSettings({
                ...data.settings,
                googleCalendar: calCfg,
              })
            }
            theme={theme}
            dailyGoalMinutes={data.settings.dailyGoalMinutes}
          />
        )}

        {/* Tab 5: Custom Study Modes Manager */}
        {activeTab === 'modes' && (
          <ModesManager
            modes={data.modes}
            modeFolders={data.modeFolders || []}
            onSaveModes={handleSaveModes}
            onSaveFolders={handleSaveModeFolders}
            onSaveModesAndFolders={handleSaveModesAndFolders}
            onSelectMode={(id) => {
              setSelectedLauncherModeId(id);
              setActiveTab('tasks');
            }}
            onBackToLauncher={() => setActiveTab('tasks')}
            theme={theme}
          />
        )}

        {/* Tab 6: Control History & Analytics */}
        {activeTab === 'history' && (
          <HistoryView
            sessions={data.sessions}
            modes={data.modes}
            dailyGoalMinutes={data.settings.dailyGoalMinutes}
            activitySamples={data.activitySamples}
            activityTrackingEnabled={data.settings.activityTracking?.enabled === true}
            distractions={data.distractions}
            onSaveModes={handleSaveModes}
            onDeleteSession={handleDeleteSession}
            onClearAllSessions={handleClearAllSessions}
            onBackToTasks={() => setActiveTab('tasks')}
            theme={theme}
          />
        )}

        {/* Tab 7: Settings & Appearance */}
        {activeTab === 'settings' && (
          <SettingsView
            settings={data.settings}
            modes={data.modes}
            tasks={data.tasks}
            onSaveSettings={handleSaveSettings}
            onExportBackup={handleExportBackup}
            onImportBackup={handleImportBackup}
            onBackToTasks={() => setActiveTab('tasks')}
            theme={theme}
            onChangeTheme={setTheme}
          />
        )}

        {/* Notes */}
        {activeTab === 'notes' && (
          <NotesView
            notes={data.notes || []}
            noteFolders={data.noteFolders || []}
            modes={data.modes}
            obsidianConfig={data.settings.obsidian}
            onSaveNotes={handleSaveNotes}
            onSaveFolders={handleSaveNoteFolders}
            onSaveNotesAndFolders={handleSaveNotesAndFolders}
            onBackToTasks={() => setActiveTab('tasks')}
            theme={theme}
          />
        )}
      </main>

      {/* Omni Spotlight Command Palette (Cmd+K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectTab={setActiveTab}
        modes={data.modes}
        tasks={data.tasks}
        theme={theme}
        onChangeTheme={(newTheme) => {
          setTheme(newTheme);
          handleSaveSettings({ ...data.settings, theme: newTheme });
        }}
        onStartSession={handleStartSession}
        onAddTask={handleAddTask}
      />

      {/* Instant Control Exit / Reflection Modal */}
      <LeaveLockModal
        isOpen={isLeaveModalOpen}
        onClose={() => setIsLeaveModalOpen(false)}
        onConfirmLeave={handleConfirmLeave}
        onMinimizeToTray={handleMinimizeToTray}
        theme={theme}
        activeSessionName={activeSession?.modeName}
      />
    </div>
  );
};

export default App;
