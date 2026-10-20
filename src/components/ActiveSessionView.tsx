import React, { useState, useEffect, useCallback } from 'react';
import { 
  Play, Pause, SkipForward, CheckCircle2, Volume2, VolumeX, Shield, ShieldOff, 
  Coffee, ArrowLeft, Maximize2, Minimize2, Check, Sparkles, ChevronDown, ChevronUp, AppWindow
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { SessionPhase, ThemeId, ControlSession, UserSettings, TaskItem, ActiveSessionState } from '../types';
import { THEMES } from '../styles/themes';
import { sound } from '../services/sound';
import { blockerClient } from '../services/blockerClient';
import { resolveWorkCompletion, isLongBreakCycle } from '../services/sessionFlow';

interface ActiveSessionViewProps {
  sessionState: ActiveSessionState;
  allTasks: TaskItem[];
  modes?: Array<{ id: string; name: string; workDuration: number; breakDuration: number; longBreakDuration: number; longBreakInterval: number; blocklist: string[]; blockedApps: string[]; blockingStrategy: ActiveSessionState['blockingStrategy'] }>;
  onSwitchModeForRemaining?: (modeId: string) => void;
  onUpdateSessionState: (updated: ActiveSessionState) => void;
  onUpdateTask: (task: TaskItem) => void;
  /**
   * Called exactly once whenever a work cycle finishes (natural end or
   * skip). `taskId` is the task assigned to that cycle slot, so the app can
   * credit task.cyclesCompleted and mark the planner block for this cycle
   * done — progress survives pauses, cancels and restarts.
   */
  onCycleCompleted?: (taskId: string | null) => void;
  onAddTask: (title: string, modeId?: string) => TaskItem;
  onAddQueueTask?: (title: string) => TaskItem;
  onAddExistingTaskToQueue?: (taskId: string) => void;
  onFinishSession: (sessionSummary: ControlSession) => void;
  onCancelSession: () => void;
  onRequestLeave: () => void;
  theme: ThemeId;
  settings: UserSettings;
  /**
   * Incremented by the app when the auto-execution scheduler asks this exact
   * session to end (scheduled end time). Triggers the normal completion path.
   */
  externalFinishSignal?: number;
}

export const ActiveSessionView: React.FC<ActiveSessionViewProps> = ({
  sessionState,
  allTasks,
  modes,
  onSwitchModeForRemaining,
  onUpdateSessionState,
  onUpdateTask,
  onCycleCompleted,
  onAddTask,
  onAddQueueTask,
  onAddExistingTaskToQueue,
  onFinishSession,
  onCancelSession,
  onRequestLeave,
  theme,
  settings,
  externalFinishSignal,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;

  const [isMuted, setIsMuted] = useState<boolean>(!settings.soundEnabled);
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);
  const [showTaskList, setShowTaskList] = useState<boolean>(false);
  const [showExistingSelector, setShowExistingSelector] = useState<boolean>(false);
  const [quickTaskInput, setQuickTaskInput] = useState<string>('');
  const [blockerActive, setBlockerActive] = useState<boolean>(false);

  // Derive current seconds left accurately from timestamps
  const calculateSecondsLeft = useCallback(() => {
    if (sessionState.isPaused && sessionState.pauseStartedAt) {
      const elapsedBeforePause = Math.floor(
        (sessionState.pauseStartedAt - sessionState.phaseStartTime - sessionState.totalPauseSecondsThisPhase * 1000) / 1000
      );
      return Math.max(0, sessionState.phaseDurationSeconds - Math.max(0, elapsedBeforePause));
    }

    const elapsed = Math.floor(
      (Date.now() - sessionState.phaseStartTime - sessionState.totalPauseSecondsThisPhase * 1000) / 1000
    );
    return Math.max(0, sessionState.phaseDurationSeconds - Math.max(0, elapsed));
  }, [sessionState]);

  const [secondsLeft, setSecondsLeft] = useState<number>(calculateSecondsLeft());

  // Re-sync displayed countdown immediately on phase/pause changes
  // (otherwise it shows the old phase's 00:00 until the next 1s tick).
  useEffect(() => {
    setSecondsLeft(calculateSecondsLeft());
  }, [calculateSecondsLeft, sessionState.phase, sessionState.phaseStartTime, sessionState.phaseDurationSeconds, sessionState.isPaused]);

  // Audio helper
  const playSound = useCallback((type: 'work' | 'break' | 'complete' | 'tick') => {
    if (isMuted) return;
    const vol = settings.soundVolume || 0.7;
    if (type === 'work') sound.playChime(vol);
    else if (type === 'break') sound.playBowl(vol);
    else if (type === 'complete') sound.playComplete(vol);
    else if (type === 'tick') sound.playTick(vol * 0.4);
  }, [isMuted, settings.soundVolume]);

  // Tasks in this session
  const sessionTasks = sessionState.taskIds
    .map((id) => allTasks.find((t) => t.id === id))
    .filter((t): t is TaskItem => !!t);

  const completedSessionTasks = sessionTasks.filter((t) => t.completed || sessionState.completedTaskIds.includes(t.id));
  const remainingSessionTasks = sessionTasks.filter((t) => !t.completed && !sessionState.completedTaskIds.includes(t.id));

  // Current active task: prefer explicit activeTaskId if still remaining, otherwise first remaining
  const currentTask =
    (sessionState.activeTaskId ? remainingSessionTasks.find((t) => t.id === sessionState.activeTaskId) : null) ||
    remainingSessionTasks[0] ||
    null;

  // Backlog tasks (uncompleted tasks from allTasks not currently queued in this session)
  const backlogTasks = allTasks.filter(
    (t) => !t.completed && !sessionState.taskIds.includes(t.id) && !sessionState.completedTaskIds.includes(t.id)
  );

  // Blocker synchronization (generation-guarded: stale stop/start pairs are dropped)
  const blockerGenRef = React.useRef(0);
  useEffect(() => {
    const gen = ++blockerGenRef.current;
    const handleBlocker = async () => {
      // Per-session override (schedule templates) wins over mode rules.
      // `false` suppresses enforcement for the whole session; `true` enforces
      // when the mode actually has something to enforce.
      const modeWantsBlock =
        !sessionState.isChillMode && sessionState.blockingStrategy !== 'none';
      const shouldEnforce = sessionState.blockingOverride ?? modeWantsBlock;
      const hasWebBlocks =
        shouldEnforce && sessionState.blocklist.length > 0;
      const hasAppBlocks =
        shouldEnforce && (sessionState.blockedApps || []).length > 0;

      if (
        !shouldEnforce ||
        sessionState.isChillMode ||
        sessionState.blockingStrategy === 'none' ||
        (!hasWebBlocks && !hasAppBlocks)
      ) {
        await blockerClient.stopBlocking();
        await blockerClient.stopAppBlocking();
        setBlockerActive(false);
        return;
      }

      if (sessionState.phase === 'work') {
        const res = await blockerClient.startBlocking(sessionState.blocklist, sessionState.blockingStrategy);
        if (gen !== blockerGenRef.current) return;
        if (hasAppBlocks) {
          await blockerClient.startAppBlocking(sessionState.blockedApps || []);
        } else {
          await blockerClient.stopAppBlocking();
        }
        if (gen !== blockerGenRef.current) return;
        setBlockerActive(res.success);
      } else if (sessionState.allowBreakWebsites === false && shouldEnforce && (hasWebBlocks || hasAppBlocks)) {
        // B-08: modes that lock breaks keep Shield armed through rest.
        setBlockerActive(true);
      } else {
        await blockerClient.stopBlocking();
        await blockerClient.stopAppBlocking();
        setBlockerActive(false);
      }
    };

    void handleBlocker().catch(() => undefined);

    return () => {
      blockerGenRef.current++;
      void blockerClient.stopBlocking().catch(() => undefined);
      void blockerClient.stopAppBlocking().catch(() => undefined);
    };
  }, [sessionState.phase, sessionState.blocklist, sessionState.blockingStrategy, sessionState.isChillMode, sessionState.blockedApps, sessionState.blockingOverride]);

  const accumulatedWorkSecondsRef = React.useRef<number>(sessionState.accumulatedWorkSeconds || 0);

  // Keep the latest session state in a ref so background syncs never use stale data
  const sessionStateRef = React.useRef(sessionState);
  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  // Cleanup tray & title only when active session completely unmounts
  useEffect(() => {
    return () => {
      if (window.controlAPI?.updateTraySession) {
        window.controlAPI.updateTraySession({
          isActive: false,
          timeRemainingStr: '',
          isPaused: false,
        });
      }
      document.title = 'Control — Personal Study System';
    };
  }, []);

  // Menu bar tray & title update on tick (without tearing down title on every second!)
  useEffect(() => {
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    const timeStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    if (window.controlAPI?.updateTraySession) {
      window.controlAPI.updateTraySession({
        isActive: true,
        timeRemainingStr: timeStr,
        currentTaskTitle: currentTask?.title,
        remainingTasksCount: remainingSessionTasks.length,
        isPaused: sessionState.isPaused,
        modeName: sessionState.modeName,
      });
    }

    document.title = `${sessionState.isPaused ? '⏸ ' : ''}${timeStr} — ${currentTask ? currentTask.title : sessionState.modeName}`;
  }, [secondsLeft, currentTask?.title, remainingSessionTasks.length, sessionState.isPaused, sessionState.modeName]);

  // Complete session summary
  // D1 fix: caller passes the final completed-cycle count so a full run
  // records totalCycles (not totalCycles-1) and finishedEarly=false.
  const completeSession = useCallback(
    (status: 'completed' | 'cancelled', completedCyclesOverride?: number) => {
      blockerClient.stopBlocking();
      blockerClient.stopAppBlocking();

      // B-05: honest yearbook — sub-minute work records 0, never a free minute.
      const rawMins = Math.round(accumulatedWorkSecondsRef.current / 60);
      const actualMins = accumulatedWorkSecondsRef.current < 30 ? 0 : Math.max(1, rawMins);
      const plannedMins = sessionState.isChillMode
        ? sessionState.workDurationMins
        : sessionState.totalCycles * sessionState.workDurationMins;
      const wallSecs = sessionState.startedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(sessionState.startedAt)) / 1000)) : accumulatedWorkSecondsRef.current;
      const skipped = (sessionState as unknown as { skippedPhases?: number }).skippedPhases || 0;
      // D1: use override when completing the final work phase; D3: cumulative pause.
      const finalCompletedCycles = completedCyclesOverride ?? sessionState.completedCyclesCount;
      const totalPauseAll = (sessionState.totalPauseSecondsAllPhases ?? 0) + sessionState.totalPauseSecondsThisPhase;

      const summary: ControlSession = {
        id: sessionState.id,
        modeId: sessionState.modeId,
        modeName: sessionState.modeName,
        modeIcon: sessionState.modeIcon,
        isChillMode: sessionState.isChillMode,
        startTime: sessionState.startedAt,
        endTime: new Date().toISOString(),
        plannedWorkMinutes: plannedMins,
        actualWorkMinutes: actualMins,
        plannedCycles: sessionState.totalCycles,
        completedCycles: finalCompletedCycles,
        status,
        countTowardStats: sessionState.countTowardStats,
        tasksTotal: sessionTasks.length,
        tasksCompleted: completedSessionTasks.length,
        taskTitles: sessionTasks.map((t) => t.title),
        completedTaskTitles: completedSessionTasks.map((t) => t.title),
        // B-19: carry attached task ids so minute attribution also
        // credits session tasks completed outside the timer UI.
        taskIds: sessionTasks.map((t) => t.id),
        wallMinutes: Math.round(wallSecs / 60),
        pauseMinutes: Math.round(totalPauseAll / 60),
        skippedPhases: skipped,
        finishedEarly: finalCompletedCycles < sessionState.totalCycles,
      };

      onFinishSession(summary);
    },
    [sessionState, sessionTasks, completedSessionTasks, onFinishSession]
  );

  // ── Overall task progress: "cycle x of z" across sittings ──────────────
  // A resumed task session only holds the REMAINING cycles, so the visible
  // position adds the pre-session offset (snapshot of task.cyclesCompleted).
  const progressTask = sessionTasks.length === 1 ? sessionTasks[0] : null;
  const progressOffset = progressTask ? sessionState.taskCycleOffsets?.[progressTask.id] || 0 : 0;
  const overallCurrent = progressOffset + sessionState.currentCycle;
  const overallTotal =
    progressTask && typeof progressTask.cycles === 'number' && progressTask.cycles > 0
      ? Math.max(progressTask.cycles, overallCurrent)
      : sessionState.totalCycles;
  const cyclesPart = sessionState.isChillMode ? 'Chill Mode' : `Cycle ${overallCurrent} / ${overallTotal}`;

  // ── Cycle-boundary leave lock ──────────────────────────────────────────
  // Pausing is always allowed, but a task may not be LEFT mid-cycle: Finish
  // and Exit unlock the moment the current cycle ends (break phase or end
  // of session). Skipping the phase [N] ends the cycle early, so it also
  // unlocks leaving. Scheduled auto-run ends bypass this on purpose.
  const cycleInFlight = !sessionState.isChillMode && sessionState.phase === 'work';
  const cycleLockReason = cycleInFlight
    ? `Finish the current cycle first — Cycle ${overallCurrent} of ${overallTotal} is still running`
    : undefined;
  const [leaveBlockedFlash, setLeaveBlockedFlash] = useState<boolean>(false);
  const leaveFlashTimerRef = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (leaveFlashTimerRef.current) window.clearTimeout(leaveFlashTimerRef.current);
  }, []);
  const showLeaveBlocked = useCallback(() => {
    setLeaveBlockedFlash(true);
    if (leaveFlashTimerRef.current) window.clearTimeout(leaveFlashTimerRef.current);
    leaveFlashTimerRef.current = window.setTimeout(() => setLeaveBlockedFlash(false), 3200);
  }, []);
  const attemptLeave = useCallback(() => {
    if (!cycleInFlight) {
      onRequestLeave();
      return;
    }
    showLeaveBlocked();
  }, [cycleInFlight, onRequestLeave, showLeaveBlocked]);
  // Finish-early guard shared by the button, the [F] key and the tray.
  const attemptFinish = useCallback(() => {
    if (cycleInFlight) {
      showLeaveBlocked();
      return;
    }
    completeSession('completed');
  }, [cycleInFlight, completeSession, showLeaveBlocked]);

  // External completion (auto-execution scheduler reached the block's end).
  // Guarded by a monotonic counter so StrictMode double-effects and unrelated
  // re-renders can never complete the session twice.
  const finishSignalSeen = React.useRef(0);
  useEffect(() => {
    if ((externalFinishSignal || 0) > finishSignalSeen.current) {
      finishSignalSeen.current = externalFinishSignal || 0;
      completeSession('completed');
    }
  }, [externalFinishSignal, completeSession]);

  // Complete current task without stopping the timer!
  // S-02: when a target count exists and progress is partial, confirm.
  const handleCompleteCurrentTask = useCallback(() => {
    if (!currentTask) return;
    if (currentTask.targetCount != null && (currentTask.doneCount || 0) < currentTask.targetCount) {
      const done = currentTask.doneCount || 0;
      const label = currentTask.targetCountLabel || 'items';
      if (!confirm(`"${currentTask.title}": ${done}/${currentTask.targetCount} ${label} done. Mark complete anyway? (Cancel to keep it open and log progress.)`)) {
        const raw = prompt(`How many ${label} have you finished? (0–${currentTask.targetCount})`, String(done));
        if (raw !== null) {
          const n = Math.max(0, Math.min(currentTask.targetCount, parseInt(raw, 10) || 0));
          onUpdateTask({ ...currentTask, doneCount: n });
        }
        return;
      }
    }

    const updatedTask: TaskItem = {
      ...currentTask,
      completed: true,
      completedAt: new Date().toISOString(),
      sessionId: sessionState.id,
    };
    onUpdateTask(updatedTask);

    const updatedCompletedIds = Array.from(new Set([...sessionState.completedTaskIds, currentTask.id]));
    const nextRemaining = sessionTasks.filter((t) => t.id !== currentTask.id && !updatedCompletedIds.includes(t.id));
    const nextActiveId = nextRemaining[0]?.id || null;

    onUpdateSessionState({
      ...sessionState,
      completedTaskIds: updatedCompletedIds,
      activeTaskId: nextActiveId,
      accumulatedWorkSeconds: accumulatedWorkSecondsRef.current,
    });

    playSound('tick');
  }, [currentTask, sessionState, sessionTasks, onUpdateTask, onUpdateSessionState, playSound]);

  // Phase transition
  // D4 fix: pending skip count consumed atomically inside the transition so
  // the spread can never clobber it; transitioning guard stops double-fires.
  const pendingSkipsRef = React.useRef(0);
  const transitioningRef = React.useRef(false);
  const skipTimerRef = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (skipTimerRef.current) window.clearTimeout(skipTimerRef.current);
  }, []);
  const handleSkipPhase = useCallback(() => {
    if (transitioningRef.current) return;
    pendingSkipsRef.current += 1;
    // Apply optimistically so UI reflects it even if transition is delayed.
    const prev = (sessionStateRef.current as unknown as { skippedPhases?: number }).skippedPhases || 0;
    onUpdateSessionState({ ...sessionStateRef.current, ...( { skippedPhases: prev + 1 } as object), accumulatedWorkSeconds: accumulatedWorkSecondsRef.current });
    if (skipTimerRef.current) window.clearTimeout(skipTimerRef.current);
      skipTimerRef.current = window.setTimeout(() => handlePhaseCompleteRef.current(), 0);
  }, [onUpdateSessionState]);
  const handlePhaseCompleteRef = React.useRef(() => {});
  const handlePhaseComplete = useCallback(() => {
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    try {
    if (sessionState.isChillMode) {
      playSound('complete');
      confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
      completeSession('completed', sessionState.totalCycles);
      return;
    }

    if (sessionState.phase === 'work') {
      const nextCompletedCycles = sessionState.completedCyclesCount + 1;
      // Consume pending manual skips exactly once.
      const pending = pendingSkipsRef.current;
      pendingSkipsRef.current = 0;
      const baseSkipped = (sessionState as unknown as { skippedPhases?: number }).skippedPhases || 0;

      // Credit the finished cycle NOW, not at session end: tasks resume
      // across sittings, so a cycle done must survive a later cancel/quit.
      const cycleTaskId =
        sessionState.taskIds[sessionState.currentCycle - 1] || sessionState.activeTaskId || null;
      onCycleCompleted?.(cycleTaskId);

      if (resolveWorkCompletion(sessionState.completedCyclesCount, sessionState.totalCycles) === 'complete') {
        playSound('complete');
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.5 } });
        if (window.controlAPI?.sendNotification) {
          window.controlAPI.sendNotification(
            '🎯 Control Session Completed!',
            `Great job! You completed all ${sessionState.totalCycles} cycles of ${sessionState.modeName}.`
          );
        }
        completeSession('completed', nextCompletedCycles);
        return;
      }

      const breakSecs = isLongBreakCycle(
        sessionState.completedCyclesCount + 1,
        sessionState.totalCycles,
        sessionState.longBreakInterval || 0,
        sessionState.longBreakDurationMins || 0,
        sessionState.breakDurationMins
      ) * 60;
      const isLong = (sessionState.longBreakInterval || 0) > 0 && (sessionState.longBreakDurationMins || 0) > 0 && ((sessionState.completedCyclesCount + 1) % (sessionState.longBreakInterval || 1) === 0);
      playSound('break');

      if (window.controlAPI?.sendNotification) {
        // Overall position across sittings: offset + this session's cycles.
        const doneTask = cycleTaskId ? allTasks.find((t) => t.id === cycleTaskId) : null;
        const doneBefore = (doneTask && sessionState.taskCycleOffsets?.[cycleTaskId || '']) || 0;
        const doneOverall = doneBefore + nextCompletedCycles;
        const doneTotal =
          doneTask && typeof doneTask.cycles === 'number' && doneTask.cycles > 0
            ? Math.max(doneTask.cycles, doneOverall)
            : sessionState.totalCycles;
        window.controlAPI.sendNotification(
          isLong ? '☕ Time for a Long Break' : '☕ Time for a Break',
          `Cycle ${doneOverall} of ${doneTotal} done. Take a ${Math.round(breakSecs / 60)}m ${isLong ? 'long ' : ''}break.`
        );
      }

      onUpdateSessionState({
        ...sessionState,
        ...({ skippedPhases: baseSkipped + pending } as object),
        phase: isLong ? 'long_break' : 'short_break',
        completedCyclesCount: nextCompletedCycles,
        accumulatedWorkSeconds: accumulatedWorkSecondsRef.current,
        phaseStartTime: Date.now(),
        phaseDurationSeconds: breakSecs,
        totalPauseSecondsThisPhase: 0,
        totalPauseSecondsAllPhases: (sessionState.totalPauseSecondsAllPhases ?? 0) + sessionState.totalPauseSecondsThisPhase,
        transitioning: false,
        isPaused: !settings.autoStartBreaks,
        pauseStartedAt: !settings.autoStartBreaks ? Date.now() : null,
      });
    } else {
      const nextCycle = sessionState.currentCycle + 1;
      const workSecs = sessionState.workDurationMins * 60;
      playSound('work');

      const cycleTaskId = sessionState.taskIds[nextCycle - 1];
      const isCycleTaskDone = cycleTaskId && (
        sessionState.completedTaskIds.includes(cycleTaskId) ||
        allTasks.find((t) => t.id === cycleTaskId)?.completed
      );
      const nextActiveId = (!isCycleTaskDone && cycleTaskId)
        ? cycleTaskId
        : (remainingSessionTasks.find((t) => t.id !== cycleTaskId)?.id || sessionState.activeTaskId);

      if (window.controlAPI?.sendNotification) {
        const upcomingTask = cycleTaskId ? allTasks.find((t) => t.id === cycleTaskId) : null;
        const upcomingBefore = (upcomingTask && sessionState.taskCycleOffsets?.[cycleTaskId || '']) || 0;
        const upcomingOverall = upcomingBefore + nextCycle;
        const upcomingTotal =
          upcomingTask && typeof upcomingTask.cycles === 'number' && upcomingTask.cycles > 0
            ? Math.max(upcomingTask.cycles, upcomingOverall)
            : sessionState.totalCycles;
        window.controlAPI.sendNotification(
          '🎯 Break Ended',
          `Starting cycle ${upcomingOverall} of ${upcomingTotal} for ${sessionState.modeName}.`
        );
      }

      const pending = pendingSkipsRef.current;
      pendingSkipsRef.current = 0;
      const baseSkipped = (sessionState as unknown as { skippedPhases?: number }).skippedPhases || 0;
      onUpdateSessionState({
        ...sessionState,
        ...({ skippedPhases: baseSkipped + pending } as object),
        phase: 'work',
        currentCycle: nextCycle,
        activeTaskId: nextActiveId,
        accumulatedWorkSeconds: accumulatedWorkSecondsRef.current,
        phaseStartTime: Date.now(),
        phaseDurationSeconds: workSecs,
        totalPauseSecondsThisPhase: 0,
        totalPauseSecondsAllPhases: (sessionState.totalPauseSecondsAllPhases ?? 0) + sessionState.totalPauseSecondsThisPhase,
        transitioning: false,
        isPaused: !settings.autoStartWork,
        pauseStartedAt: !settings.autoStartWork ? Date.now() : null,
      });
    }
    } finally {
      transitioningRef.current = false;
    }
  }, [sessionState, allTasks, remainingSessionTasks, settings.autoStartBreaks, settings.autoStartWork, playSound, completeSession, onUpdateSessionState, onCycleCompleted]);
  useEffect(() => { handlePhaseCompleteRef.current = handlePhaseComplete; }, [handlePhaseComplete]);

  // D5 fix: wall-clock accrual (no tick-count drift) + single atomic persist
  // covering both work counter and dwell. D2: chill accrues like work.
  const lastTickRef = React.useRef<number>(Date.now());
  useEffect(() => { lastTickRef.current = Date.now(); }, [sessionState.phase, sessionState.phaseStartTime, sessionState.isPaused]);
  // Tick interval
  useEffect(() => {
    if (sessionState.isPaused) return;
    lastTickRef.current = Date.now();

    const interval = setInterval(() => {
      const now = Date.now();
      const delta = Math.max(0, Math.floor((now - lastTickRef.current) / 1000));
      lastTickRef.current = now;
      const remaining = calculateSecondsLeft();
      setSecondsLeft(remaining);

      if ((sessionState.phase === 'work' || sessionState.phase === 'chill') && delta > 0) {
        accumulatedWorkSecondsRef.current += delta;

        // Persist the live counter into session state periodically so the
        // accumulated control time survives tab switches / view remounts.
        const latest = sessionStateRef.current;
        const prevPersisted = latest.accumulatedWorkSeconds || 0;
        if (accumulatedWorkSecondsRef.current - prevPersisted >= 5) {
          // Merge dwell atomically to avoid last-writer-wins with a second timer.
          const dwell = { ...(latest.taskDwellSeconds || {}) };
          if (sessionState.phase === 'work' && currentTask) {
            dwell[currentTask.id] = (dwell[currentTask.id] || 0) + (accumulatedWorkSecondsRef.current - prevPersisted);
          }
          onUpdateSessionState({
            ...latest,
            accumulatedWorkSeconds: accumulatedWorkSecondsRef.current,
            ...(sessionState.phase === 'work' && currentTask ? { taskDwellSeconds: dwell } : {}),
          });
        } else if (sessionState.phase === 'work' && currentTask) {
          // Dwell flushed on next persist; nothing to write yet.
        }
      }

      if (remaining <= 0) {
        clearInterval(interval);
        handlePhaseComplete();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [sessionState.isPaused, sessionState.phase, calculateSecondsLeft, handlePhaseComplete, onUpdateSessionState, currentTask?.id]);

  // Dwell is merged atomically in the main tick above (no second timer).

  // Toggle Pause
  const togglePause = useCallback(() => {
    if (sessionState.isPaused) {
      const pauseDuration = sessionState.pauseStartedAt
        ? Math.floor((Date.now() - sessionState.pauseStartedAt) / 1000)
        : 0;
      onUpdateSessionState({
        ...sessionState,
        isPaused: false,
        pauseStartedAt: null,
        accumulatedWorkSeconds: accumulatedWorkSecondsRef.current,
        totalPauseSecondsThisPhase: sessionState.totalPauseSecondsThisPhase + pauseDuration,
        totalPauseSecondsAllPhases: (sessionState.totalPauseSecondsAllPhases ?? 0) + pauseDuration,
      });
    } else {
      onUpdateSessionState({
        ...sessionState,
        isPaused: true,
        pauseStartedAt: Date.now(),
        accumulatedWorkSeconds: accumulatedWorkSecondsRef.current,
      });
    }
    playSound('tick');
  }, [sessionState, onUpdateSessionState, playSound]);

  // Listen to Tray Actions
  useEffect(() => {
    if (!window.controlAPI?.onTrayAction) return;

    const cleanup = window.controlAPI.onTrayAction((action: string) => {
      if (action === 'togglePause') {
        togglePause();
      } else if (action === 'nextTask') {
        handleCompleteCurrentTask();
      } else if (action === 'endSession') {
        // Cycle-boundary lock applies to the tray too.
        attemptFinish();
      }
    });

    return cleanup;
  }, [togglePause, handleCompleteCurrentTask, attemptFinish]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePause();
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleSkipPhase();
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        attemptFinish();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        attemptLeave();
      } else if (e.key.toLowerCase() === 'm') {
        setIsMuted((m) => !m);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePause, handleSkipPhase, attemptFinish, attemptLeave]);

  // Add quick task mid-session
  const handleAddQuickTask = (e: React.FormEvent) => {
    e.preventDefault();
    const title = quickTaskInput.trim();
    if (!title) return;
    if (onAddQueueTask) {
      const created = onAddQueueTask(title);
      if (created && created.id) {
        onUpdateSessionState({
          ...sessionState,
          accumulatedWorkSeconds: accumulatedWorkSecondsRef.current,
          taskIds: sessionState.taskIds.includes(created.id)
            ? sessionState.taskIds
            : [...sessionState.taskIds, created.id],
          activeTaskId: sessionState.activeTaskId || created.id,
        });
      }
    } else {
      const created = onAddTask(title);
      onUpdateSessionState({
        ...sessionState,
        accumulatedWorkSeconds: accumulatedWorkSecondsRef.current,
        taskIds: [...sessionState.taskIds, created.id],
        activeTaskId: sessionState.activeTaskId || created.id,
      });
    }
    setQuickTaskInput('');
  };

  const handleAddExistingTask = (taskId: string) => {
    if (onAddExistingTaskToQueue) {
      onAddExistingTaskToQueue(taskId);
    }
    onUpdateSessionState({
      ...sessionState,
      accumulatedWorkSeconds: accumulatedWorkSecondsRef.current,
      taskIds: sessionState.taskIds.includes(taskId) ? sessionState.taskIds : [...sessionState.taskIds, taskId],
      activeTaskId: sessionState.activeTaskId || taskId,
    });
    setShowExistingSelector(false);
  };

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const progressRatio =
    sessionState.phaseDurationSeconds > 0
      ? (sessionState.phaseDurationSeconds - secondsLeft) / sessionState.phaseDurationSeconds
      : 0;

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullScreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullScreen(false);
    }
  };

  return (
    <div className="relative flex-1 flex flex-col justify-between items-center px-6 py-6 max-w-5xl mx-auto w-full select-none motion-blur-in overflow-hidden">
      {/* Ambient background glow orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-sky-500/10 blur-3xl pointer-events-none ambient-orb-1" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none ambient-orb-2" />

      {/* 1. Top Bar Controls */}
      <div className="w-full flex items-center justify-between z-10">
        <div className="flex items-center space-x-2">
          <button
            onClick={attemptLeave}
            title={cycleLockReason}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-full liquid-glass text-xs font-semibold transition-all active:scale-95 ${cycleInFlight ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            style={{ color: cycleInFlight ? currentTheme.textMuted : currentTheme.textSecondary }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Exit Session [Esc]</span>
          </button>
          {leaveBlockedFlash && (
            <span
              className="px-3 py-1.5 rounded-full text-[11px] font-bold border animate-pulse"
              style={{
                backgroundColor: 'rgba(244, 63, 94, 0.15)',
                borderColor: 'rgba(244, 63, 94, 0.45)',
                color: '#f43f5e',
              }}
            >
              {cycleLockReason}
            </span>
          )}
        </div>

        {/* Center Mode Name & Cycle Counter */}
        <div className="flex items-center space-x-2.5 px-4 py-1.5 rounded-full liquid-glass-dock">
          <span className="w-2 h-2 rounded-full bg-sky-500 shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
          <span 
            className="font-bold text-xs tracking-wider uppercase"
            style={{ color: currentTheme.textPrimary }}
          >
            {sessionState.modeName}
          </span>
          <span 
            className="text-xs font-mono"
            style={{ color: currentTheme.textSecondary }}
          >
            · {cyclesPart}
          </span>
        </div>

        {/* Right Aux Controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-2 rounded-full liquid-glass transition-colors cursor-pointer"
            style={{ color: currentTheme.textSecondary }}
            title={isMuted ? 'Unmute Cues [M]' : 'Mute Cues [M]'}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button
            onClick={toggleFullScreen}
            className="p-2 rounded-full liquid-glass transition-colors cursor-pointer"
            style={{ color: currentTheme.textSecondary }}
            title="Toggle Fullscreen"
          >
            {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 2. Hero Center Area (Giant Liquid Glass Timer + Active Task Spotlight) */}
      <div className="flex flex-col items-center justify-center my-auto w-full max-w-2xl text-center space-y-6 z-10">
        {/* Phase Pill */}
        <div
          className="inline-flex items-center space-x-2 px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-widest liquid-glass border"
          style={{
            borderColor:
              sessionState.phase === 'work'
                ? 'rgba(56, 189, 248, 0.4)'
                : sessionState.phase === 'chill'
                ? 'rgba(244, 63, 94, 0.4)'
                : 'rgba(52, 211, 153, 0.4)',
            color:
              sessionState.phase === 'work'
                ? '#0ea5e9'
                : sessionState.phase === 'chill'
                ? '#f43f5e'
                : '#10b981',
          }}
        >
          <span
            className={`w-2 h-2 rounded-full ${!sessionState.isPaused ? 'animate-ping' : ''}`}
            style={{
              backgroundColor:
                sessionState.phase === 'work'
                  ? '#0ea5e9'
                  : sessionState.phase === 'chill'
                  ? '#f43f5e'
                  : '#10b981',
            }}
          />
          <span>
            {sessionState.isPaused
              ? 'PAUSED'
              : sessionState.phase === 'work'
              ? 'CONTROL PERIOD'
              : sessionState.phase === 'chill' || sessionState.isChillMode
              ? 'CHILL MODE'
              : 'REST BREAK'}
          </span>
        </div>

        {/* Priority 1: Giant Crisp Rubik Semibold Timer Display */}
        <div className={`relative flex flex-col items-center transition-transform duration-500 ${!sessionState.isPaused ? 'timer-halo-pulse' : ''}`}>
          <span
            className="font-mono text-8xl sm:text-9xl font-bold tracking-tighter tabular-nums select-all cursor-default"
            style={{
              textShadow: !sessionState.isPaused
                ? isDark
                  ? '0 0 50px rgba(56, 189, 248, 0.25)'
                  : '0 0 40px rgba(56, 189, 248, 0.15)'
                : 'none',
              color: sessionState.isPaused ? currentTheme.textMuted : currentTheme.textPrimary,
            }}
          >
            {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </span>

          {/* Smooth Liquid Glass Progress Bar */}
          <div 
            className="w-72 sm:w-96 h-1.5 rounded-full overflow-hidden mt-6 shadow-inner"
            style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-300 ease-linear shadow-[0_0_12px_rgba(56,189,248,0.8)]"
              style={{
                width: `${Math.min(100, Math.max(0, progressRatio * 100))}%`,
                backgroundColor: sessionState.phase === 'work' ? currentTheme.accent : currentTheme.success,
              }}
            />
          </div>
        </div>

        {/* Priority 2: CURRENT ACTIVE TASK SPOTLIGHT */}
        <div className="w-full max-w-xl p-5 rounded-3xl liquid-glass-elevated space-y-3 shadow-2xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-widest text-sky-500 font-bold flex items-center space-x-1.5">
              <Sparkles className="w-3.5 h-3.5 text-sky-500" />
              <span>
                {sessionState.isChillMode
                  ? 'CURRENT CONTROL TARGET'
                  : `CYCLE ${overallCurrent} OF ${overallTotal} TARGET`}
              </span>
            </span>
            <span 
              className="text-[11px] font-mono"
              style={{ color: currentTheme.textMuted }}
            >
              {remainingSessionTasks.length} remaining in queue
            </span>
          </div>

          {currentTask ? (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <span
                className="text-xl font-bold text-left tracking-tight flex-1"
                style={{ color: currentTheme.textPrimary }}
              >
                {currentTask.title}
              </span>

              {/* Complete Task Button */}
              <button
                onClick={handleCompleteCurrentTask}
                className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/30 text-xs font-bold transition-all active:scale-95 cursor-pointer shrink-0 shadow-[0_0_15px_rgba(52,211,153,0.2)]"
                title="Mark task done (Timer continues smoothly)"
              >
                <Check className="w-4 h-4" />
                <span>Mark Done</span>
              </button>
            </div>
          ) : (
            <div className="text-emerald-500 text-sm font-semibold flex items-center justify-center space-x-2 py-1">
              <CheckCircle2 className="w-4 h-4" />
              <span>All queue tasks completed! Excellent work!</span>
            </div>
          )}
          {currentTask?.targetCount != null && (
            <div className="text-[11px] font-mono" style={{ color: currentTheme.textSecondary }}>
              Progress: {currentTask.doneCount || 0}/{currentTask.targetCount} {currentTask.targetCountLabel || 'items'}
              <button
                className="ml-2 text-sky-500 hover:underline cursor-pointer"
                onClick={() => {
                  const raw = prompt(`How many ${currentTask.targetCountLabel || 'items'} done? (0–${currentTask.targetCount})`, String(currentTask.doneCount || 0));
                  if (raw !== null) {
                    const n = Math.max(0, Math.min(currentTask.targetCount || 0, parseInt(raw, 10) || 0));
                    onUpdateTask({ ...currentTask, doneCount: n });
                  }
                }}
              >
                Log progress
              </button>
            </div>
          )}
          {modes && modes.length > 0 && (
            <div className="text-[11px] font-mono flex items-center gap-2" style={{ color: currentTheme.textSecondary }}>
              <span>Mode locked ({sessionState.modeName}) — applies to remaining cycles:</span>
              <select
                className="px-2 py-1 rounded-lg text-xs cursor-pointer"
                value={sessionState.modeId}
                onChange={(e) => onSwitchModeForRemaining?.(e.target.value)}
                title="Switch mode for remaining cycles (current cycle keeps its timer)"
              >
                {modes.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.workDuration}/{m.breakDuration})</option>
                ))}
              </select>
            </div>
          )}

          {/* Expandable Tasks Queue Toggle */}
          <div 
            className="pt-2 border-t flex items-center justify-between text-xs"
            style={{ 
              borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
              color: currentTheme.textSecondary 
            }}
          >
            <span>
              {completedSessionTasks.length} of {sessionTasks.length} completed
            </span>
            <button
              onClick={() => setShowTaskList(!showTaskList)}
              className="text-sky-500 hover:underline flex items-center space-x-1 cursor-pointer"
            >
              <span>{showTaskList ? 'Hide Queue' : 'View Full Queue'}</span>
              {showTaskList ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Expandable Task List */}
          {showTaskList && (
            <div className="pt-2 space-y-2 text-left">
              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                {sessionTasks.map((t) => {
                  const isDone = t.completed || sessionState.completedTaskIds.includes(t.id);
                  const isCurrent = t.id === currentTask?.id;
                  const cycleIdx = sessionState.taskIds.indexOf(t.id);
                  const cycleTag = cycleIdx !== -1 && cycleIdx < sessionState.totalCycles ? `Cycle ${cycleIdx + 1}` : 'Queue';

                  return (
                    <div
                      key={t.id}
                      onClick={() => {
                        if (!isDone && t.id !== sessionState.activeTaskId) {
                          onUpdateSessionState({ ...sessionState, activeTaskId: t.id });
                        }
                      }}
                      className={`flex items-center justify-between py-1.5 px-3 rounded-xl text-xs transition-all cursor-pointer ${
                        isDone
                          ? 'line-through opacity-50'
                          : isCurrent
                          ? 'bg-sky-500/15 text-sky-500 font-bold border border-sky-500/30'
                          : 'liquid-glass hover:border-white/20'
                      }`}
                      style={{ color: isDone ? currentTheme.textMuted : currentTheme.textPrimary }}
                      title={!isDone ? 'Click to make this the active target' : undefined}
                    >
                      <div className="flex items-center space-x-2 flex-1 min-w-0 mr-2">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-neutral-400 shrink-0 font-semibold">
                          {cycleTag}
                        </span>
                        <span className="truncate flex-1">{t.title}</span>
                      </div>
                      {isDone && <Check className="w-3.5 h-3.5 text-emerald-500 ml-2 shrink-0" />}
                      {isCurrent && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-500 uppercase ml-2 shrink-0 font-bold">
                          ACTIVE
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Quick Add Form */}
              <form onSubmit={handleAddQuickTask} className="flex items-center space-x-2 pt-2">
                <input
                  type="text"
                  value={quickTaskInput}
                  onChange={(e) => setQuickTaskInput(e.target.value)}
                  placeholder="+ Add extra task to this session..."
                  className="flex-1 px-3 py-1.5 rounded-xl liquid-glass-input text-xs outline-none"
                  style={{ color: currentTheme.textPrimary }}
                />
                <button
                  type="submit"
                  disabled={!quickTaskInput.trim()}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-30 cursor-pointer"
                  style={{
                    backgroundColor: currentTheme.accent,
                    color: currentTheme.accentText,
                  }}
                >
                  Add
                </button>
              </form>

              {/* Add from backlog */}
              {backlogTasks.length > 0 && (
                <div className="pt-2">
                  {!showExistingSelector ? (
                    <button
                      type="button"
                      onClick={() => setShowExistingSelector(true)}
                      className="text-[11px] font-mono text-sky-400 hover:underline flex items-center space-x-1 cursor-pointer"
                    >
                      <span>+ Add from backlog ({backlogTasks.length} available)</span>
                    </button>
                  ) : (
                    <div className="space-y-1.5 p-2.5 rounded-xl border border-white/10 bg-black/40">
                      <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400 mb-1">
                        <span>SELECT BACKLOG TASK</span>
                        <button
                          type="button"
                          onClick={() => setShowExistingSelector(false)}
                          className="hover:text-white cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                      <div className="max-h-28 overflow-y-auto space-y-1">
                        {backlogTasks.map((bt) => (
                          <button
                            key={bt.id}
                            type="button"
                            onClick={() => handleAddExistingTask(bt.id)}
                            className="w-full text-left px-2 py-1 rounded text-xs hover:bg-white/10 truncate block text-neutral-200 cursor-pointer transition-colors"
                          >
                            + {bt.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Priority 3: Distraction Shield Status Badge */}
        <div className="flex flex-col items-center space-y-2">
          {blockerActive ? (
            <div className="inline-flex items-center space-x-2 px-4 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold shadow-[0_0_12px_rgba(52,211,153,0.2)]">
              <Shield className="w-3.5 h-3.5" />
              <span>Distraction Shield Active ({sessionState.blocklist.length} domains protected)</span>
            </div>
          ) : sessionState.isChillMode ? (
            <div className="inline-flex items-center space-x-2 px-4 py-1.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-500 text-xs font-semibold">
              <Coffee className="w-3.5 h-3.5" />
              <span>Chill Mode — No Restrictions</span>
            </div>
          ) : sessionState.phase !== 'work' ? (
            <div
              className="inline-flex items-center space-x-2 px-4 py-1.5 rounded-full liquid-glass text-xs font-semibold"
              style={{ color: currentTheme.textSecondary }}
            >
              <Coffee className="w-3.5 h-3.5" />
              <span>{sessionState.allowBreakWebsites === false ? 'Break Time — Shield still armed' : 'Break Time — Distractions temporarily unlocked'}</span>
            </div>
          ) : (
            <div 
              className="inline-flex items-center space-x-1.5 text-xs font-medium"
              style={{ color: currentTheme.textMuted }}
            >
              <ShieldOff className="w-3.5 h-3.5" />
              <span>Shield Inactive</span>
            </div>
          )}

          {blockerActive && (sessionState.blockedApps || []).length > 0 && (
            <div className="inline-flex items-center space-x-2 px-4 py-1.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 text-[11px] font-semibold">
              <AppWindow className="w-3.5 h-3.5" />
              <span>App Lockdown Active ({(sessionState.blockedApps || []).length} apps force-quit)</span>
            </div>
          )}
        </div>
      </div>

      {/* 3. Bottom Controls */}
      <div className="w-full flex flex-col items-center space-y-4 z-10">
        <div className="flex items-center space-x-3">
          <button
            onClick={togglePause}
            className="flex items-center space-x-2 px-8 py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 shadow-xl cursor-pointer"
            style={{
              backgroundColor: currentTheme.accent,
              color: currentTheme.accentText,
            }}
          >
            {sessionState.isPaused ? (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Resume [Space]</span>
              </>
            ) : (
              <>
                <Pause className="w-4 h-4 fill-current" />
                <span>Pause [Space]</span>
              </>
            )}
          </button>

          {!sessionState.isChillMode && (
            <button
              onClick={handleSkipPhase}
              className="p-3 rounded-2xl liquid-glass transition-colors cursor-pointer"
              style={{ color: currentTheme.textSecondary }}
              title="Next Phase [N]"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={attemptFinish}
            className={`flex items-center space-x-2 px-5 py-3 rounded-2xl liquid-glass border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 text-xs font-bold transition-all ${cycleInFlight ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            title={cycleLockReason || 'Finish Session Early [F]'}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Finish [F]</span>
          </button>
        </div>

        {/* Minimal Monospace Shortcut Hints */}
        <div 
          className="flex items-center space-x-3 text-[11px] font-mono"
          style={{ color: currentTheme.textMuted }}
        >
          <span>[Space] Pause</span>
          <span>·</span>
          <span>[N] Next</span>
          <span>·</span>
          <span>[F] Complete</span>
          <span>·</span>
          <span>[Esc] Exit</span>
        </div>
      </div>
    </div>
  );
};
