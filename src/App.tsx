import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FocusAppData,
  StudyMode,
  FocusSession,
  ThemeId,
  UserSettings,
  DayPlan,
  ActiveSessionState,
  TaskItem,
  PurposeSessionRequest,
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
import { BlockerControl } from './components/BlockerControl';
import { HistoryView } from './components/HistoryView';
import { SettingsView } from './components/SettingsView';
import { LeaveLockModal } from './components/LeaveLockModal';
import { CommandPalette } from './components/CommandPalette';
import { AmbientSoundControl } from './components/AmbientSoundControl';
import { SetupWizard } from './components/SetupWizard';
import { blockerClient } from './services/blockerClient';
import { ambientAudio, AmbientSoundType } from './services/ambientAudio';
import { obsidianService, mergeImportedTasks } from './services/obsidian';
import { plannerMd } from './services/plannerMarkdown';
import { applyMutationsToData, googleSync, useGoogleSyncStatus } from './services/googleSync';

export const App: React.FC = () => {
  const [data, setData] = useState<FocusAppData>(INITIAL_APP_DATA);
  const [isLoaded, setIsLoaded] = useState(false);
  // Default to tasks powerhouse view
  const [activeTab, setActiveTab] = useState<NavTab>('tasks');
  const [theme, setTheme] = useState<ThemeId>('serika');

  // Active Session state & Completed Session state
  const [activeSession, setActiveSession] = useState<ActiveSessionState | null>(null);
  const [completedSessionSummary, setCompletedSessionSummary] = useState<FocusSession | null>(null);
  const [selectedLauncherModeId, setSelectedLauncherModeId] = useState<string>('mode-deep-work');
  const activeSessionRef = useRef<ActiveSessionState | null>(null);
  const purposeRequestInFlightRef = useRef<string | null>(null);

  // 30-Second Lock-in Leave Modal state
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState<boolean>(false);

  // Command Palette & Ambient Sound States
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
  const [isSoundControlOpen, setIsSoundControlOpen] = useState<boolean>(false);
  const [currentSound, setCurrentSound] = useState<AmbientSoundType | null>(null);

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
        stored.settings.defaultModeId || stored.modes[0]?.id || 'mode-deep-work'
      );

      // Check if there is an active session from persistence
      if (stored.activeSession) {
        const active = stored.activeSession;
        const now = Date.now();
        const elapsed = Math.floor((now - active.phaseStartTime - active.totalPauseSecondsThisPhase * 1000) / 1000);

        if (elapsed < active.phaseDurationSeconds) {
          setActiveSession(active);
          setActiveTab('timer');
        } else {
          const updated = { ...stored, activeSession: null };
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
    if (window.focusAPI?.onTriggerLeaveModal) {
      const cleanup = window.focusAPI.onTriggerLeaveModal(() => {
        setIsLeaveModalOpen(true);
      });
      return cleanup;
    }
  }, []);

  const dataRef = useRef<FocusAppData>(INITIAL_APP_DATA);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Save changes to storage safely without stale closures
  const updateAndPersistData = useCallback(
    (updater: FocusAppData | ((prev: FocusAppData) => FocusAppData)) => {
      setData((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        dataRef.current = next;
        storage.saveData(next);
        return next;
      });
    },
    []
  );

  const persistData = (updated: FocusAppData) => {
    updateAndPersistData(updated);
  };

  // ── Google Calendar two-way sync ─────────────────────────────────────────
  const googleStatus = useGoogleSyncStatus();

  useEffect(() => {
    const api = window.focusAPI?.googleCalendar;
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
    if (!window.focusAPI?.onTasksFileChanged) return;
    return window.focusAPI.onTasksFileChanged(() => {
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
  const handleAddTask = (title: string, modeId?: string): TaskItem => {
    const newTask: TaskItem = {
      id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title: title.trim(),
      completed: false,
      order: dataRef.current.tasks.length,
      modeId: modeId,
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

  // Ambient Audio Controls
  const handleToggleSound = (type: AmbientSoundType) => {
    if (currentSound === type) {
      ambientAudio.stop();
      setCurrentSound(null);
    } else {
      ambientAudio.play(type);
      setCurrentSound(type);
    }
  };

  const handleStopSound = () => {
    ambientAudio.stop();
    setCurrentSound(null);
  };

  // Start Focus Session
  // Returns whether any blocking list was actually engaged, plus the first
  // failure when enforcement was requested but failed. Callers surface the
  // error loudly: a running timer must never silently pretend to block.
  const activateModeRestrictions = async (
    mode: StudyMode,
    blockingOverride?: boolean
  ): Promise<{ enforced: boolean; error?: string }> => {
    const shouldBlock =
      blockingOverride ?? (!mode.isChillMode && mode.blockingStrategy !== 'none');
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
    overrides?: { workMins?: number; breakMins?: number; cycles?: number; taskTitle?: string; blockingOverride?: boolean }
  ): Promise<boolean> => {
    if (activeSessionRef.current) return false;

    const workMins = overrides?.workMins ?? mode.workDuration;
    const breakMins = overrides?.breakMins ?? mode.breakDuration;
    const totalCycles = overrides?.cycles ?? mode.cycles;
    const initialSecs = (mode.isChillMode ? workMins : workMins) * 60;

    const requestedTask = overrides?.taskTitle?.trim();
    const newTask = requestedTask ? {
      id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title: requestedTask,
      completed: false,
      order: data.tasks.length,
      modeId: mode.id,
      createdAt: new Date().toISOString(),
    } satisfies TaskItem : null;
    const taskIds = newTask ? [newTask.id, ...selectedTaskIds] : selectedTaskIds;

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
      taskIds,
      activeTaskId: taskIds[0] || null,
      completedTaskIds: [],
      blocklist: mode.blocklist,
      blockedApps: mode.blockedApps || [],
      blockingStrategy: mode.blockingStrategy,
      blockingOverride: overrides?.blockingOverride,
      countTowardStats: mode.countTowardStats,
      startedAt: new Date().toISOString(),
    };

    const blocking = await activateModeRestrictions(mode, overrides?.blockingOverride);
    lastBlockingOutcome.current = blocking;
    if (blocking.error) {
      // The session still starts (existing behavior), but a failed blocker
      // must never look active: say so loudly instead of failing silently.
      await window.focusAPI?.sendNotification(
        'Blocking failed to start',
        `${blocking.error} The timer is running WITHOUT blocking.`
      );
    }
    const startedSession = { ...newSessionState, phaseStartTime: Date.now() };
    activeSessionRef.current = startedSession;
    setActiveSession(startedSession);
    setCompletedSessionSummary(null);
    setActiveTab('timer');

    persistData({
      ...data,
      tasks: newTask ? [...data.tasks, newTask] : data.tasks,
      activeSession: startedSession,
    });
    if (newTask) syncToObsidianIfEnabled();
    return true;
  };

  // Purpose hands Control an exact Mode ID. No duration, blocklist, or mode
  // profile crosses the app boundary, so Modes stay the single source of truth.
  const startPurposeSession = useCallback(async (request: PurposeSessionRequest) => {
    if (purposeRequestInFlightRef.current === request.id || activeSessionRef.current) return;

    const mode = data.modes.find((candidate) => candidate.id === request.modeId);
    if (!mode) {
      await window.focusAPI?.acknowledgePurposeSessionRequest(request.id);
      window.focusAPI?.sendNotification(
        'Purpose could not start a session',
        'The selected Control Mode no longer exists.'
      );
      return;
    }

    purposeRequestInFlightRef.current = request.id;
    try {
      const started = await handleStartSession(mode, [], { taskTitle: request.purpose });
      if (started) {
        await window.focusAPI?.acknowledgePurposeSessionRequest(request.id);
      }
    } finally {
      purposeRequestInFlightRef.current = null;
    }
  }, [data]);

  useEffect(() => {
    if (!isLoaded || !window.focusAPI?.getPurposeSessionRequest) return;
    const checkForPurposeSession = () => {
      window.focusAPI?.getPurposeSessionRequest?.().then((request) => {
        if (request) void startPurposeSession(request);
      });
    };
    checkForPurposeSession();
    return window.focusAPI.onPurposeSessionRequested?.(checkForPurposeSession);
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
    const api = window.focusAPI;
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
        const started = await startSessionRef.current(mode, [], {
          workMins: block.workDuration,
          breakMins: block.breakDuration,
          cycles: block.cycles,
          blockingOverride: block.focusMode,
        });
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

  // Update live active session state
  const handleUpdateSessionState = useCallback((updated: ActiveSessionState) => {
    setActiveSession(updated);
    activeSessionRef.current = updated;
    updateAndPersistData((prev) => ({
      ...prev,
      activeSession: updated,
    }));
  }, [updateAndPersistData]);

  // Finish session normally
  const handleFinishSession = useCallback((sessionSummary: FocusSession) => {
    updateAndPersistData((prev) => ({
      ...prev,
      sessions: [sessionSummary, ...prev.sessions],
      activeSession: null,
    }));
    setActiveSession(null);
    activeSessionRef.current = null;
    setCompletedSessionSummary(sessionSummary);
  }, [updateAndPersistData]);

  // Cancel session
  const handleCancelSession = useCallback(() => {
    blockerClient.stopBlocking();
    blockerClient.stopAppBlocking();
    setActiveSession(null);
    activeSessionRef.current = null;
    updateAndPersistData((prev) => ({
      ...prev,
      activeSession: null,
    }));
    setCompletedSessionSummary(null);
    setActiveTab('tasks');
  }, [updateAndPersistData]);

  // Immediate exit app (no time restriction)
  const handleConfirmLeave = async () => {
    await blockerClient.stopBlocking();
    await blockerClient.stopAppBlocking();
    ambientAudio.stop();
    if (window.focusAPI?.confirmQuit) {
      await window.focusAPI.confirmQuit();
    } else {
      setIsLeaveModalOpen(false);
      handleCancelSession();
    }
  };

  const handleMinimizeToTray = async () => {
    if (window.focusAPI?.minimizeToTray) {
      await window.focusAPI.minimizeToTray();
    }
  };

  const handleSaveModes = (updatedModes: StudyMode[]) => {
    const updated = { ...data, modes: updatedModes };
    persistData(updated);
  };

  const handleSavePlan = (date: string, plan: DayPlan) => {
    // Mirror planner blocks to tasks so events appear in the Tasks view.
    const existingPlan = data.plans[date];
    const prevBlocks = existingPlan?.blocks || [];
    const nextBlocks = plan.blocks || [];
    const prevById = new Map(prevBlocks.map((b) => [b.id, b]));
    const nextById = new Map(nextBlocks.map((b) => [b.id, b]));

    let tasks = [...data.tasks];

    // Remove mirrored tasks for blocks that no longer exist
    tasks = tasks.filter((t) => {
      if (t.source === 'calendar' && t.sourceId) {
        return nextById.has(t.sourceId);
      }
      return true;
    });

    // Upsert mirrored tasks for blocks that exist
    for (const b of nextBlocks) {
      const existingTask = tasks.find((t) => t.source === 'calendar' && t.sourceId === b.id);
      if (existingTask) {
        const mode = data.modes.find((m) => m.id === b.modeId);
        const display = (b.modeName || mode?.name || 'Focus block').trim();
        if (existingTask.title !== display) {
          tasks = tasks.map((t) => (t.id === existingTask.id ? { ...t, title: display } : t));
        }
      } else {
        const mode = data.modes.find((m) => m.id === b.modeId);
        const display = (b.modeName || mode?.name || 'Focus block').trim();
        const newTask: TaskItem = {
          id: `task-cal-${b.id}`,
          title: display,
          completed: b.status === 'completed',
          order: tasks.length,
          modeId: b.modeId,
          createdAt: b.createdAt || new Date().toISOString(),
          source: 'calendar',
          sourceId: b.id,
        };
        tasks = [...tasks, newTask];
      }
    }

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
      ...data,
      plans: {
        ...data.plans,
        [date]: plan,
      },
      tasks,
    };
    persistData(updated);
    syncToObsidianIfEnabled(tasks);
  };

  const handleSaveSettings = (settings: UserSettings) => {
    const updated = { ...data, settings };
    persistData(updated);
    setTheme(settings.theme);
    plannerMd.setVaultPath(settings.obsidian?.vaultPath || '');
  };

  const handleDeleteSession = (sessionId: string) => {
    const updatedSessions = data.sessions.filter((s) => s.id !== sessionId);
    persistData({ ...data, sessions: updatedSessions });
  };

  const handleClearAllSessions = () => {
    persistData({ ...data, sessions: [] });
  };

  const handleExportBackup = () => {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `focus-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBackup = (imported: FocusAppData) => {
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
          7: 'settings',
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
        currentSound={currentSound}
        onOpenSoundControl={() => setIsSoundControlOpen(true)}
      />

      {/* Main Content Workspace */}
      <main className="flex-1 flex flex-col overflow-hidden relative z-10">
        {/* Tab 1: Tasks & Focus Studio (The Main View!) */}
        {(activeTab === 'tasks' || activeTab === 'launcher') && (
          <TasksView
            tasks={data.tasks}
            modes={data.modes}
            onAddTask={handleAddTask}
            onUpdateTask={handleUpdateTask}
            onDeleteTask={handleDeleteTask}
            onReorderTasks={handleReorderTasks}
            onClearCompletedTasks={handleClearCompletedTasks}
            onStartFocusWithTask={(task, modeOverride) => {
              const mode =
                modeOverride ||
                (task.modeId ? data.modes.find((m) => m.id === task.modeId) : null) ||
                data.modes.find((m) => m.id === selectedLauncherModeId) ||
                data.modes[0];
              handleStartSession(mode, [task.id]);
            }}
            onStartStandaloneSession={(mode, taskIds) => {
              handleStartSession(mode, taskIds);
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

        {/* Tab 2: Focus Timer (Active Session View / Session Completion Summary) */}
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
              onUpdateSessionState={handleUpdateSessionState}
              onUpdateTask={handleUpdateTask}
              onAddTask={handleAddTask}
              onAddQueueTask={handleAddQueueTask}
              onAddExistingTaskToQueue={handleAddExistingTaskToQueue}
              onFinishSession={handleFinishSession}
              onCancelSession={handleCancelSession}
              onRequestLeave={() => setIsLeaveModalOpen(true)}
              theme={theme}
              settings={data.settings}
              currentSound={currentSound}
              onOpenSoundControl={() => setIsSoundControlOpen(true)}
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
                  No Active Focus Session
                </h2>
                <p 
                  className="text-xs font-medium"
                  style={{ color: currentTheme.textSecondary }}
                >
                  Select a task from your Tasks Hub or choose a study mode to start focusing.
                </p>
                <button
                  onClick={() => setActiveTab('tasks')}
                  className="w-full py-3 px-6 rounded-2xl text-xs font-bold transition-all active:scale-95 shadow-md cursor-pointer"
                  style={{
                    backgroundColor: currentTheme.accent,
                    color: currentTheme.accentText,
                  }}
                >
                  Open Tasks & Focus Hub [1]
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
            plans={data.plans}
            tasks={data.tasks}
            onSavePlan={handleSavePlan}
            onStartBlockInTimer={(mode, block) => {
              handleStartSession(mode, [], {
                workMins: block.workDuration,
                breakMins: block.breakDuration,
                cycles: block.cycles,
                // Per-session Focus preference from schedule templates.
                // Undefined = follow the mode's own blocking rules.
                blockingOverride: block.focusMode,
              });
            }}
            onBackToLauncher={() => setActiveTab('tasks')}
            onOpenSettings={() => setActiveTab('settings')}
            onAddTask={handleAddTask}
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
          />
        )}

        {/* Tab 5: Custom Study Modes Manager */}
        {activeTab === 'modes' && (
          <ModesManager
            modes={data.modes}
            onSaveModes={handleSaveModes}
            onSelectMode={(id) => {
              setSelectedLauncherModeId(id);
              setActiveTab('tasks');
            }}
            onBackToLauncher={() => setActiveTab('tasks')}
            theme={theme}
          />
        )}

        {/* Tab 6: Focus History & Analytics */}
        {activeTab === 'history' && (
          <HistoryView
            sessions={data.sessions}
            modes={data.modes}
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
        currentSound={currentSound}
        onToggleSound={handleToggleSound}
      />

      {/* Zen Ambient Soundscapes Control Popover */}
      <AmbientSoundControl
        isOpen={isSoundControlOpen}
        onClose={() => setIsSoundControlOpen(false)}
        currentSound={currentSound}
        onSelectSound={handleToggleSound}
        onStopSound={handleStopSound}
        theme={theme}
      />

      {/* Instant Focus Exit / Reflection Modal */}
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
