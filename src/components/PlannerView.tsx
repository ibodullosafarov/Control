import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { 
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, Play, Trash2, 
  Clock, CheckCircle2, ArrowLeft, RefreshCw, Sparkles, X, Edit3,
  CalendarCheck, ListPlus, Flame, MoveRight, PanelLeft, Check, FolderSync,
  Layers, Target, FileText
} from 'lucide-react';
import { StudyMode, ModeFolder, ControlSession, ThemeId, ScheduleBlock, DayPlan, GoogleCalendarConfig, TaskItem, ObsidianConfig } from '../types';
import { THEMES } from '../styles/themes';
import { DynamicIcon } from './DynamicIcon';
import { obsidianService } from '../services/obsidian';
import { plannerMd } from '../services/plannerMarkdown';
import { buildDayScheduleSection } from '../services/scheduleTemplates';
import { stripDateSuffix } from '../services/taskTitles';
import {
  DRAG_THRESHOLD_PX,
  applyMoveToList,
  createRange,
  hhmmToMinutes,
  layoutOverlappingBlocks,
  makeCopy,
  minutesToHHMM,
  minutesToY,
  moveRange,
  nextSharedHorizon,
  resizeRange,
  resizeStartRange,
  snapMinutes,
  toLocalDateStr,
} from '../services/calendarGrid';
import { useGoogleSyncStatus } from '../services/googleSync';
import { clampCycles, fitCyclesToDuration, sessionWallMinutes } from '../services/sessionFlow';
import { DayPlanMarkdownView } from './DayPlanMarkdownView';
import { groupModesByFolder } from '../services/modeFolders';
import { ModeViewToggle, useModeViewPref } from './ModeViewToggle';

interface PlannerViewProps {
  modes: StudyMode[];
  modeFolders?: ModeFolder[];
  sessions?: ControlSession[];
  plans: Record<string, DayPlan>;
  tasks?: TaskItem[];
  obsidianConfig?: ObsidianConfig;
  onSavePlan: (date: string, plan: DayPlan) => void;
  onStartBlockInTimer: (mode: StudyMode, block: ScheduleBlock) => void;
  onBackToLauncher: () => void;
  onOpenSettings?: () => void;
  calendarConfig: GoogleCalendarConfig;
  onUpdateCalendarConfig: (config: GoogleCalendarConfig) => void;
  theme: ThemeId;
  onObsidianSynced?: (at: string) => void;
  dailyGoalMinutes?: number;
}

/** Fields mirrored to Google Calendar — used to detect real block edits. */
function calendarFieldsUnchanged(a: ScheduleBlock, b: ScheduleBlock): boolean {
  return (
    (a.modeName || '') === (b.modeName || '') &&
    a.date === b.date &&
    a.startTime === b.startTime &&
    a.endTime === b.endTime &&
    !!a.allDay === !!b.allDay &&
    (a.description || '') === (b.description || '') &&
    (a.location || '') === (b.location || '')
  );
}

// Format 24h HH:mm to Apple-style 12h "9 AM" or "9:30 AM"
function formatTime12h(timeStr: string): string {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr || '0', 10);
  const period = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${displayH} ${period}` : `${displayH}:${String(m).padStart(2, '0')} ${period}`;
}

function formatTimeRange12h(startTime: string, endTime: string): string {
  return `${formatTime12h(startTime)} – ${formatTime12h(endTime)}`;
}

export const PlannerView: React.FC<PlannerViewProps> = ({
  modes,
  modeFolders,
  sessions,
  plans,
  tasks = [],
  obsidianConfig,
  onSavePlan,
  onStartBlockInTimer,
  onBackToLauncher,
  onOpenSettings,
  calendarConfig,
  onUpdateCalendarConfig,
  theme,
  onObsidianSynced,
  dailyGoalMinutes = 120,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;

  // Folder-grouped mode ordering shared by the checklist and block selector.
  const folderNameById = new Map((modeFolders || []).map((f) => [f.id, f.name]));
  const showFolderLabels = (modeFolders?.length || 0) > 0;
  const modeListEntries: Array<{ label: string | null; mode: StudyMode }> = (() => {
    const entries: Array<{ label: string | null; mode: StudyMode }> = [];
    let prev: string | null = null;
    for (const m of groupModesByFolder(modes, modeFolders || []).flatMap((g) => g.modes)) {
      const label = showFolderLabels
        ? (m.folderId ? folderNameById.get(m.folderId) || 'Ungrouped' : 'Ungrouped')
        : '';
      const show = showFolderLabels && label !== prev;
      prev = label;
      entries.push({ label: show ? label : null, mode: m });
    }
    return entries;
  })();
  const [blockModeView, setBlockModeView] = useModeViewPref();

  // Calendar layers: planned blocks, Google-synced events, recorded sessions.
  const [showPlanLayer, setShowPlanLayer] = useState(true);
  const [showGoogleLayer, setShowGoogleLayer] = useState(true);
  const [showRecordedLayer, setShowRecordedLayer] = useState(true);
  const passesLayers = (b: ScheduleBlock) => {
    if (b.googleCalendarEventId) return showGoogleLayer;
    return showPlanLayer;
  };

  // Grid time limits: 06:00 AM to 23:00 PM (18 hours)
  const START_HOUR = 6;
  const END_HOUR = 23;
  // Vertical zoom: pixels per hour slot. Cmd/Ctrl + scroll (or a trackpad
  // pinch) over the grid scales this value, growing the time ruler on the left
  // and every event card with it.
  const HOUR_HEIGHT_MIN = 36;
  const HOUR_HEIGHT_MAX = 220;
  const HOUR_HEIGHT_DEFAULT = 68;
  const [hourHeight, setHourHeight] = useState<number>(HOUR_HEIGHT_DEFAULT);
  const hourHeightRef = useRef<number>(HOUR_HEIGHT_DEFAULT);
  hourHeightRef.current = hourHeight;
  const pendingScrollTopRef = useRef<number | null>(null);
  const smoothRestoreRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (smoothRestoreRef.current) window.clearTimeout(smoothRestoreRef.current);
  }, []);
  // While a zoom gesture is in flight, geometry transitions are suppressed so
  // the ruler, cards and current-time line track the cursor 1:1 instead of
  // easing behind it and only settling once the gesture ends.
  const [isZooming, setIsZooming] = useState(false);
  const TOTAL_HOURS = END_HOUR - START_HOUR;
  // Horizontal breathing room for overlapping event columns (Apple Calendar
  // packs them tightly). Day view has more room than the narrow week columns.
  const DAY_EVENT_GAP_PX = 3;
  const WEEK_EVENT_GAP_PX = 2;
  // Readable minimum card height for *isolated* short events. It is only a
  // floor: a card is never allowed to grow past the next event that shares its
  // horizontal space, so packed short events stay inside their real slot.
  const DAY_MIN_EVENT_HEIGHT = 24;
  const WEEK_MIN_EVENT_HEIGHT = 20;

  // Live clock. It drives the red current-time line AND the definition of
  // "today", so an app left open across midnight (or woken from sleep) shows
  // the real date instead of the day it happened to be opened.
  const [now, setNow] = useState<Date>(new Date());

  // "Today" is always re-derived from the live clock — never frozen at mount.
  const todayStr = toLocalDateStr(now);
  const [selectedDate, setSelectedDate] = useState<string>(() => toLocalDateStr(new Date()));

  // When the calendar day rolls over, follow it forward if the user was still
  // parked on the previous "today" (never yank them off a day they navigated to).
  const prevTodayRef = useRef(todayStr);
  useEffect(() => {
    const prev = prevTodayRef.current;
    if (prev !== todayStr) {
      prevTodayRef.current = todayStr;
      setSelectedDate((cur) => (cur === prev ? todayStr : cur));
    }
  }, [todayStr]);

  // View switch: 'day', 'week', or 'plan' (Markdown day plan)
  const [calendarView, setCalendarView] = useState<'day' | 'week' | 'plan'>('day');

  // Sidebar visibility toggle
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);

  // Control Modes checklist filter (Apple Calendar sidebar style)
  const [enabledModeIds, setEnabledModeIds] = useState<Set<string>>(
    () => new Set(modes.map((m) => m.id))
  );

  // Keep enabledModeIds in sync if modes list changes
  useEffect(() => {
    setEnabledModeIds((prev) => {
      const next = new Set(prev);
      modes.forEach((m) => {
        if (!prev.has(m.id)) next.add(m.id);
      });
      return next;
    });
  }, [modes]);

  const toggleModeFilter = (modeId: string) => {
    setEnabledModeIds((prev) => {
      const next = new Set(prev);
      if (next.has(modeId)) {
        if (next.size > 1) next.delete(modeId);
      } else {
        next.add(modeId);
      }
      return next;
    });
  };

  // Tick the clock for the Apple red current-time marker. Also refresh
  // immediately on focus/wake so the marker and "today" snap back to reality
  // without waiting for the next interval.
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = setInterval(tick, 30000);
    const refresh = () => setNow(new Date());
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const existingPlan = plans[selectedDate];
  const [blocks, setBlocks] = useState<ScheduleBlock[]>(existingPlan?.blocks || []);
  const [syncFeedback, setSyncFeedback] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Google Calendar sync chip (status lives in the main process)
  const googleStatus = useGoogleSyncStatus();
  const showGoogleChip =
    googleStatus.available && (googleStatus.connected || googleStatus.phase === 'connecting');
  const googleChip: { label: string; color: string; spin: boolean } | null = !showGoogleChip
    ? null
    : googleStatus.syncing || googleStatus.phase === 'connecting'
      ? { label: 'Syncing…', color: '#38bdf8', spin: true }
      : googleStatus.phase === 'auth_required'
        ? { label: 'Reconnect', color: '#f59e0b', spin: false }
        : googleStatus.phase === 'offline'
          ? { label: 'Offline', color: '#94a3b8', spin: false }
          : googleStatus.phase === 'error' || googleStatus.pendingOps > 0
            ? { label: 'Sync issue', color: '#f87171', spin: false }
            : { label: 'Synced', color: '#34d399', spin: false };
  const [isObsidianSyncing, setIsObsidianSyncing] = useState<boolean>(false);

  // Mini Month Calendar state (for left sidebar)
  const [miniCalendarMonth, setMiniCalendarMonth] = useState<Date>(() => new Date(selectedDate + 'T00:00:00'));

  // Modal states for Add / Edit Control Block (Apple event inspector sheet)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [blockTitle, setBlockTitle] = useState('');
  const [blockDate, setBlockDate] = useState(selectedDate);
  const [blockStartTime, setBlockStartTime] = useState('09:00');
  const [blockEndTime, setBlockEndTime] = useState('10:00');
  const [blockModeId, setBlockModeId] = useState<string>('');
  const [blockCycles, setBlockCycles] = useState<number>(1);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');

  // Schedule-cycles modal: split one task into per-cycle planner blocks, each
  // individually movable, each linked back to the task.
  const [cycleModalTask, setCycleModalTask] = useState<TaskItem | null>(null);
  const [cycleModalModeId, setCycleModalModeId] = useState<string>(modes[0]?.id || 'mode-deep-work');
  const [cycleModalCount, setCycleModalCount] = useState<number>(1);
  const [cycleModalGap, setCycleModalGap] = useState<number>(7);
  const [cycleModalStart, setCycleModalStart] = useState<string>('09:00');
  // Free duration used when the task is scheduled with no mode.
  const [cycleModalDuration, setCycleModalDuration] = useState<number>(60);

  // Auto-scroll calendar grid to 8:00 AM or current time on mount
  const gridScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (gridScrollRef.current) {
      const currentH = new Date().getHours();
      const targetH = Math.max(START_HOUR, Math.min(END_HOUR - 4, currentH - 1));
      const scrollPos = (targetH - START_HOUR) * hourHeightRef.current;
      gridScrollRef.current.scrollTop = scrollPos;
    }
  }, [calendarView]);

  // Zoom the time grid with Cmd/Ctrl + scroll (macOS trackpad pinch also
  // arrives as wheel + ctrlKey). The time under the pointer stays anchored.
  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el) return;

    const handleZoomWheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();

      const oldHeight = hourHeightRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const nextHeight = Math.max(
        HOUR_HEIGHT_MIN,
        Math.min(HOUR_HEIGHT_MAX, Math.round(oldHeight * factor)),
      );
      if (nextHeight === oldHeight) return;

      const rect = el.getBoundingClientRect();
      const pointerY = e.clientY - rect.top;
      // Disable smooth scrolling while zooming so the anchor stays exact, and
      // silence geometry transitions so nothing eases behind the cursor. Both
      // are restored shortly after the gesture stops.
      setIsZooming(true);
      el.style.scrollBehavior = 'auto';
      if (smoothRestoreRef.current !== null) window.clearTimeout(smoothRestoreRef.current);
      smoothRestoreRef.current = window.setTimeout(() => {
        el.style.scrollBehavior = '';
        smoothRestoreRef.current = null;
        setIsZooming(false);
      }, 200);
      // Absolute minute value currently sitting under the pointer.
      const minutes = START_HOUR * 60 + ((el.scrollTop + pointerY) / oldHeight) * 60;
      // Where that same minute lands after the resize — scroll so it stays put.
      const nextContentY = ((minutes - START_HOUR * 60) / 60) * nextHeight;
      pendingScrollTopRef.current = nextContentY - pointerY;

      hourHeightRef.current = nextHeight;
      setHourHeight(nextHeight);
    };

    el.addEventListener('wheel', handleZoomWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleZoomWheel);
  }, []);

  // Apply the anchored scroll position in the same frame the zoomed layout is
  // committed (before paint) so there is no one-frame jump.
  useLayoutEffect(() => {
    if (pendingScrollTopRef.current !== null && gridScrollRef.current) {
      gridScrollRef.current.scrollTop = pendingScrollTopRef.current;
      pendingScrollTopRef.current = null;
    }
  }, [hourHeight]);

  // Sync state when selectedDate changes
  useEffect(() => {
    const p = plans[selectedDate];
    setBlocks(p?.blocks || []);
    setMiniCalendarMonth(new Date(selectedDate + 'T00:00:00'));
  }, [selectedDate, plans]);

  // Persist blocks for a specific date to DayPlan.
  // Blocks whose calendar-relevant content changed get a fresh updatedAt —
  // the Google Calendar sync engine uses it to decide when a historical
  // (pre-connect) event was explicitly edited by the user.
  const persistBlocksForDate = (date: string, updatedBlocks: ScheduleBlock[]) => {
    const plan = plans[date];
    const prevBlocks = plan?.blocks || (date === selectedDate ? blocks : []);
    const prevById = new Map(prevBlocks.map((b) => [b.id, b]));
    const nowIso = new Date().toISOString();
    const stampedBlocks = updatedBlocks.map((b) => {
      const prev = prevById.get(b.id);
      if (prev && calendarFieldsUnchanged(prev, b)) return b;
      return {
        ...b,
        createdAt: prev?.createdAt ?? b.createdAt ?? nowIso,
        updatedAt: nowIso,
      };
    });
    const updatedPlan: DayPlan = {
      date,
      goals: plan?.goals || [],
      timeWindows: plan?.timeWindows || [],
      blocks: stampedBlocks,
      isApproved: true,
      updatedAt: nowIso,
    };
    if (date === selectedDate) {
      setBlocks(stampedBlocks);
    }
    onSavePlan(date, updatedPlan);
  };

  // ── Drag & drop (move / resize / create / Alt-copy) ──────────────────────
  // Pointer-based: press-and-hold slightly, then drag. A plain click (no
  // movement) keeps its existing behavior (open the editor). Commits go
  // through persistBlocksForDate, so timestamps and Google sync behave like
  // manual edits; cross-day moves keep the block id, so sync mappings survive.
  interface DragPreviewState {
    mode: 'move' | 'resize' | 'resize-start' | 'create';
    blockId?: string;
    date: string;
    start: number; // minutes since midnight
    end: number;
    title: string;
    altCopy: boolean;
  }
  interface DragSession {
    mode: 'move' | 'resize' | 'resize-start' | 'create';
    block: ScheduleBlock | null;
    origDate: string;
    origStart: number;
    origEnd: number;
    anchorStart: number; // snapped minutes at pointerdown (create mode)
    grabOffset: number; // pointer minutes minus block top at grab (move mode)
    startX: number;
    startY: number;
    active: boolean;
  }
  const dragRef = useRef<DragSession | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const suppressClickUntil = useRef(0);
  const dayEventsRef = useRef<HTMLDivElement | null>(null);
  const weekEventsRef = useRef<HTMLDivElement | null>(null);
  // Cleanup for the exact listeners installed at dragstart (they close over
  // that render). Runs on drop/cancel and on unmount mid-drag.
  const dragCleanupRef = useRef<() => void>(() => {});
  useEffect(() => {
    return () => {
      dragRef.current = null;
      dragCleanupRef.current();
    };
  }, []);
  // Fresh-state mirrors: window listeners installed at dragstart close over
  // one render, so commits read through refs instead of stale closures.
  const plansRef = useRef(plans);
  plansRef.current = plans;
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;
  const persistRef = useRef(persistBlocksForDate);
  persistRef.current = persistBlocksForDate;

  const suppressClick = () => {
    suppressClickUntil.current = Date.now() + 350;
  };
  const isClickSuppressed = () => Date.now() < suppressClickUntil.current;

  const minutesFromClientY = (clientY: number): number | null => {
    const el = calendarView === 'week' ? weekEventsRef.current : dayEventsRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return START_HOUR * 60 + ((clientY - rect.top) / hourHeightRef.current) * 60;
  };

  const dateFromClientX = (clientX: number): string | null => {
    if (calendarView !== 'week') return selectedDateRef.current;
    const el = weekEventsRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const idx = Math.max(0, Math.min(6, Math.floor(((clientX - rect.left) / rect.width) * 7)));
    return weekDaysInfo[idx]?.dateStr ?? null;
  };

  const detachDragListeners = () => {
    dragCleanupRef.current();
    dragCleanupRef.current = () => {};
  };

  // R-04: the calendar event is exactly the wall length the timer will run.
  //  • Single-cycle blocks: work = wall, no trailing break (unchanged).
  //  • Multi-cycle blocks: a resize snaps to the nearest whole number of mode
  //    cycles and the event is re-laid to that exact wall, so a block can
  //    never claim a length the session will not actually run.
  const syncTimerWall = (b: ScheduleBlock, startTime: string, endTime: string): ScheduleBlock => {
    // Free-form plan block (no mode) or a template's timer-off block: the event
    // is just a time range — never derive a timer shape from it.
    if (b.timerEnabled === false || !b.modeId) return { ...b, startTime, endTime };
    const [sH, sM] = startTime.split(':').map(Number);
    const [eH, eM] = endTime.split(':').map(Number);
    if ((b.cycles || 1) <= 1) {
      const wall = Math.max(15, (eH * 60 + eM) - (sH * 60 + sM));
      return { ...b, startTime, endTime, workDuration: wall, breakDuration: 0 };
    }
    const mode = modes.find((m) => m.id === b.modeId);
    const w = Math.max(1, b.workDuration || mode?.workDuration || 25);
    const brk = Math.max(0, b.breakDuration ?? mode?.breakDuration ?? 5);
    const dur = Math.max(0, (eH * 60 + eM) - (sH * 60 + sM));
    const cycles = fitCyclesToDuration(dur, w, brk);
    const wall = sessionWallMinutes(w, brk, cycles);
    const startMins = sH * 60 + sM;
    return {
      ...b,
      startTime,
      endTime: minutesToHHMM(Math.min(24 * 60 - 1, startMins + wall)),
      cycles,
      workDuration: w,
      breakDuration: brk,
    };
  };

  const commitMove = (
    block: ScheduleBlock,
    toDate: string,
    start: number,
    end: number,
    altCopy: boolean
  ) => {
    const startTime = minutesToHHMM(start);
    const endTime = minutesToHHMM(end);
    const persist = persistRef.current;
    const currentPlans = plansRef.current;
    const selDate = selectedDateRef.current;
    if (altCopy) {
      const copy = makeCopy(
        block,
        toDate,
        startTime,
        endTime,
        () => `block-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
      );
      const target = currentPlans[toDate]?.blocks || (toDate === selDate ? blocksRef.current : []);
      persist(toDate, [...target, syncTimerWall(copy, copy.startTime, copy.endTime)]);
      return;
    }
    if (toDate === block.date) {
      const list = currentPlans[block.date]?.blocks || [];
      if (!list.some((b) => b.id === block.id)) return;
      persist(block.date, list.map((b) => (b.id === block.id ? syncTimerWall(b, startTime, endTime) : b)));
    } else {
      const src = currentPlans[block.date]?.blocks || [];
      if (!src.some((b) => b.id === block.id)) return;
      persist(block.date, src.filter((b) => b.id !== block.id));
      const target = currentPlans[toDate]?.blocks || [];
      persist(toDate, [...target, syncTimerWall({ ...block, date: toDate }, startTime, endTime)]);
    }
  };

  const commitResize = (block: ScheduleBlock, end: number) => {
    const currentPlans = plansRef.current;
    const list = currentPlans[block.date]?.blocks || [];
    if (!list.some((b) => b.id === block.id)) return;
    persistRef.current(
      block.date,
      list.map((b) => (b.id === block.id ? syncTimerWall(b, b.startTime, minutesToHHMM(end)) : b))
    );
  };

  const commitResizeStart = (block: ScheduleBlock, start: number) => {
    const currentPlans = plansRef.current;
    const list = currentPlans[block.date]?.blocks || [];
    if (!list.some((b) => b.id === block.id)) return;
    persistRef.current(
      block.date,
      list.map((b) => (b.id === block.id ? syncTimerWall(b, minutesToHHMM(start), b.endTime) : b))
    );
  };

  const openRangeModal = (date: string, start: number, end: number) => {
    setEditingBlockId(null);
    setBlockTitle('');
    setBlockDate(date);
    setBlockStartTime(minutesToHHMM(start));
    setBlockEndTime(minutesToHHMM(end));
    // Planning never forces a mode: a fresh block is a plain time block unless
    // the user deliberately picks a mode tile below.
    setBlockModeId('');
    setBlockCycles(1);
    setSelectedTaskId('');
    setIsEditModalOpen(true);
  };

  const handleDragMove = (e: PointerEvent) => {
    const s = dragRef.current;
    if (!s) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      s.active = true;
      document.body.style.userSelect = 'none';
    }
    const raw = minutesFromClientY(e.clientY);
    if (raw === null) return;
    const snapped = snapMinutes(raw);
    if (s.mode === 'move' && s.block) {
      const date = dateFromClientX(e.clientX) || s.origDate;
      const moved = moveRange(s.origStart, s.origEnd, snapped - s.grabOffset - s.origStart);
      const altCopy = e.altKey;
      document.body.style.cursor = altCopy ? 'copy' : 'grabbing';
      setDragPreview({
        mode: 'move',
        blockId: s.block.id,
        date,
        start: moved.start,
        end: moved.end,
        title: s.block.modeName,
        altCopy,
      });
    } else if (s.mode === 'resize' && s.block) {
      document.body.style.cursor = 'ns-resize';
      setDragPreview({
        mode: 'resize',
        blockId: s.block.id,
        date: s.origDate,
        start: s.origStart,
        end: resizeRange(s.origStart, snapped),
        title: s.block.modeName,
        altCopy: false,
      });
    } else if (s.mode === 'resize-start' && s.block) {
      document.body.style.cursor = 'ns-resize';
      setDragPreview({
        mode: 'resize-start',
        blockId: s.block.id,
        date: s.origDate,
        start: resizeStartRange(s.origEnd, snapped),
        end: s.origEnd,
        title: s.block.modeName,
        altCopy: false,
      });
    } else if (s.mode === 'create') {
      document.body.style.cursor = 'crosshair';
      const date = dateFromClientX(e.clientX) || s.origDate;
      const r = createRange(s.anchorStart, snapped);
      setDragPreview({ mode: 'create', date, start: r.start, end: r.end, title: '', altCopy: false });
    }
  };

  const handleDragEnd = (e: PointerEvent) => {
    const s = dragRef.current;
    dragRef.current = null;
    detachDragListeners();
    setDragPreview(null);
    if (!s || !s.active) return; // plain click — existing onClick handles it
    suppressClick();
    if (s.mode === 'create') {
      const raw = minutesFromClientY(e.clientY);
      if (raw === null) return;
      const r = createRange(s.anchorStart, snapMinutes(raw));
      const date = dateFromClientX(e.clientX) || s.origDate;
      openRangeModal(date, r.start, r.end);
      return;
    }
    if (!s.block) return;
    const raw = minutesFromClientY(e.clientY);
    if (raw === null) return;
    const snapped = snapMinutes(raw);
    if (s.mode === 'move') {
      const date = dateFromClientX(e.clientX) || s.origDate;
      const moved = moveRange(s.origStart, s.origEnd, snapped - s.grabOffset - s.origStart);
      commitMove(s.block, date, moved.start, moved.end, e.altKey);
    } else if (s.mode === 'resize-start') {
      commitResizeStart(s.block, resizeStartRange(s.origEnd, snapped));
    } else {
      commitResize(s.block, resizeRange(s.origStart, snapped));
    }
  };

  const handleDragCancel = () => {
    dragRef.current = null;
    detachDragListeners();
    setDragPreview(null);
    suppressClick();
  };

  const handleDragKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && dragRef.current) {
      e.stopPropagation();
      handleDragCancel();
    }
  };

  const beginDrag = (
    e: React.PointerEvent,
    session: Omit<DragSession, 'startX' | 'startY' | 'active' | 'grabOffset' | 'anchorStart'> & {
      grabOffset?: number;
      anchorStart?: number;
    }
  ) => {
    if (e.pointerType === 'touch') return; // touch keeps native scroll
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = {
      ...session,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      grabOffset: session.grabOffset ?? 0,
      anchorStart: session.anchorStart ?? 0,
    };
    window.addEventListener('pointermove', handleDragMove);
    window.addEventListener('pointerup', handleDragEnd);
    window.addEventListener('pointercancel', handleDragCancel);
    window.addEventListener('keydown', handleDragKey, true);
    dragCleanupRef.current = () => {
      window.removeEventListener('pointermove', handleDragMove);
      window.removeEventListener('pointerup', handleDragEnd);
      window.removeEventListener('pointercancel', handleDragCancel);
      window.removeEventListener('keydown', handleDragKey, true);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  };

  const startCardDrag = (e: React.PointerEvent, block: ScheduleBlock, mode: 'move' | 'resize' | 'resize-start') => {
    const raw = minutesFromClientY(e.clientY);
    beginDrag(e, {
      mode,
      block,
      origDate: block.date,
      origStart: hhmmToMinutes(block.startTime),
      origEnd: hhmmToMinutes(block.endTime),
      grabOffset: mode === 'move' && raw !== null ? raw - hhmmToMinutes(block.startTime) : 0,
    });
  };

  const startCreateDrag = (e: React.PointerEvent, date: string) => {
    const raw = minutesFromClientY(e.clientY);
    if (raw === null) return;
    beginDrag(e, {
      mode: 'create',
      block: null,
      origDate: date,
      origStart: 0,
      origEnd: 0,
      anchorStart: snapMinutes(raw),
    });
  };

  // Date Navigation Helpers (local calendar dates — never UTC serialization,
  // which shifts the day for UTC± timezones)
  const handlePrevDay = () => {
    if (calendarView === 'day') {
      const d = new Date(selectedDate + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      setSelectedDate(toLocalDateStr(d));
    } else {
      const d = new Date(selectedDate + 'T00:00:00');
      d.setDate(d.getDate() - 7);
      setSelectedDate(toLocalDateStr(d));
    }
  };

  const handleNextDay = () => {
    if (calendarView === 'day') {
      const d = new Date(selectedDate + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      setSelectedDate(toLocalDateStr(d));
    } else {
      const d = new Date(selectedDate + 'T00:00:00');
      d.setDate(d.getDate() + 7);
      setSelectedDate(toLocalDateStr(d));
    }
  };

  const handleToday = () => {
    setSelectedDate(todayStr);
  };

  // Apple-formatted date representations
  const selectedDateObj = useMemo(() => new Date(selectedDate + 'T00:00:00'), [selectedDate]);
  
  const formattedDayOfWeek = useMemo(() => {
    return selectedDateObj.toLocaleDateString('en-US', { weekday: 'long' });
  }, [selectedDateObj]);

  const formattedMonthDay = useMemo(() => {
    return selectedDateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }, [selectedDateObj]);

  const formattedYear = useMemo(() => {
    return selectedDateObj.getFullYear();
  }, [selectedDateObj]);

  const monthShort = useMemo(() => {
    return selectedDateObj.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  }, [selectedDateObj]);

  const dayNumber = useMemo(() => {
    return selectedDateObj.getDate();
  }, [selectedDateObj]);

  const isSelectedToday = selectedDate === todayStr;

  // Calculate 7 days for the active week view (Monday to Sunday)
  const weekDaysInfo = useMemo(() => {
    const d = new Date(selectedDate + 'T00:00:00');
    const day = d.getDay();
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diffToMonday);

    const labels = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    return Array.from({ length: 7 }, (_, i) => {
      const cur = new Date(monday);
      cur.setDate(monday.getDate() + i);
      const curDateStr = toLocalDateStr(cur);
      return {
        dateStr: curDateStr,
        dayName: labels[i],
        dayNum: cur.getDate(),
        isToday: curDateStr === todayStr,
        isSelected: curDateStr === selectedDate,
      };
    });
  }, [selectedDate, todayStr]);

  // Calculate position of the live current-time indicator line (Apple Red).
  // Uses minutesToY — the exact same coordinate system as event cards and the
  // drag ghost — so the line always agrees with event edges.
  const currentAbsMinutes = now.getHours() * 60 + now.getMinutes();
  const showCurrentTimeLine = now.getHours() >= START_HOUR && now.getHours() < END_HOUR;
  const currentTimeLineTop = minutesToY(currentAbsMinutes, START_HOUR, hourHeight);

  // Open Add Block pre-filled with clicked hour & date
  const handleSlotClick = (hour: number, minute: number = 0, targetDate: string = selectedDate) => {
    if (isClickSuppressed()) return; // a drag just ended here
    openRangeModal(targetDate, hour * 60 + minute, Math.min(END_HOUR, hour + 1) * 60 + minute);
  };

  // Open Edit existing block
  const handleEditBlock = (block: ScheduleBlock, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isClickSuppressed()) return; // a drag just ended here
    setEditingBlockId(block.id);
    setBlockTitle(block.modeName || '');
    setBlockDate(block.date || selectedDate);
    setBlockStartTime(block.startTime);
    setBlockEndTime(block.endTime);
    setBlockModeId(block.modeId);
    setBlockCycles(block.cycles || 1);
    setSelectedTaskId('');
    setIsEditModalOpen(true);
  };

  // Save new or edited block
  // Duration glossary (B-06/B-10, R-04): the calendar event is the WALL
  // interval [start,end). Stored work/break/cycles describe the timer that
  // runs inside it, and BOTH are derived here from one source of truth so the
  // plan can never claim a length the session will not run:
  //  • cycle blocks (linked to a task) are fixed at 1 honest cycle.
  //  • multi-cycle blocks adopt the mode's shape: end = start + wall(cycles).
  //  • single-cycle blocks are honest: work = wall, no trailing break.
  const handleSaveModalBlock = () => {
    const chosenMode = modes.find((m) => m.id === blockModeId);
    const noMode = !chosenMode;
    const finalTitle = blockTitle.trim() || chosenMode?.name || 'Planned block';
    const targetDate = blockDate || selectedDate;
    const datePlan = plans[targetDate];
    const targetDateBlocks = datePlan?.blocks || (targetDate === selectedDate ? blocks : []);
    const editingBlock = editingBlockId ? targetDateBlocks.find((b) => b.id === editingBlockId) : null;
    const isCycleBlock = !!editingBlock?.taskId;

    const cycles = isCycleBlock ? 1 : noMode ? 1 : clampCycles(blockCycles, 1);
    const isChill = !!chosenMode?.isChillMode;
    const multi = !noMode && cycles > 1 && !isChill;
    // The calendar event is the WALL interval [start,end). With no mode it is
    // just that range (no timer). With a mode, a single cycle is honest
    // (work = exactly the planned length, so the timer matches the estimate);
    // multi-cycle blocks adopt the mode's shape so plan and timer agree.
    const singleWall = Math.max(1, hhmmToMinutes(blockEndTime) - hhmmToMinutes(blockStartTime));
    const workDuration = noMode ? 0 : multi ? chosenMode!.workDuration : singleWall;
    const breakDuration = noMode ? 0 : multi ? chosenMode!.breakDuration : 0;
    const wall = multi ? sessionWallMinutes(workDuration, breakDuration, cycles) : singleWall;
    const effectiveEnd = multi
      ? minutesToHHMM(Math.min(24 * 60 - 1, hhmmToMinutes(blockStartTime) + wall))
      : blockEndTime;

    // Preserve a template's timer-off rest block when its mode is unchanged;
    // switching a free block to a mode turns the timer back on.
    const editingHadMode = !!editingBlock?.modeId;
    const timerEnabled = noMode
      ? false
      : editingHadMode
        ? editingBlock?.timerEnabled
        : undefined;

    const modeFields = {
      modeId: chosenMode?.id || '',
      modeName: finalTitle,
      modeIcon: chosenMode?.icon || '',
      modeColor: chosenMode?.color || '',
      workDuration,
      breakDuration,
      cycles,
      timerEnabled,
    };

    if (editingBlockId) {
      // Update existing block — keep its task linkage when it is a cycle block.
      const updated = targetDateBlocks.map((b) => {
        if (b.id !== editingBlockId) return b;
        return {
          ...b,
          date: targetDate,
          startTime: blockStartTime,
          endTime: effectiveEnd,
          ...modeFields,
        };
      });
      persistBlocksForDate(targetDate, updated);
    } else {
      // Create new block
      const newBlock: ScheduleBlock = {
        id: `block-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        date: targetDate,
        startTime: blockStartTime,
        endTime: effectiveEnd,
        status: 'approved',
        ...modeFields,
      };
      persistBlocksForDate(targetDate, [...targetDateBlocks, newBlock]);
      // No extra onAddTask call here: persist → onSavePlan already mirrors
      // the block into the task queue (task-cal-*). Calling onAddTask too
      // created a second manual task with the same title (the duplication bug).
    }

    setIsEditModalOpen(false);
  };

  // ── Block-editor cycle↔duration helpers (R-04) ─────────────────────────
  // Editing cycles moves the end time to exactly that many mode cycles;
  // editing the times snaps the cycle count to the nearest whole fit. The
  // event always equals wall = cycles*work + (cycles-1)*break (single-cycle
  // blocks: work = wall), so the plan and the timer cannot disagree.
  const editorMode = modes.find((m) => m.id === blockModeId);
  const editorIsChill = !!editorMode?.isChillMode;

  const editorEndForCycles = (startTime: string, cycles: number): string => {
    const w = Math.max(1, editorMode?.workDuration ?? 25);
    const b = Math.max(0, editorMode?.breakDuration ?? 5);
    return minutesToHHMM(
      Math.min(24 * 60 - 1, hhmmToMinutes(startTime) + sessionWallMinutes(w, b, Math.max(1, cycles)))
    );
  };

  const editorCyclesForRange = (startTime: string, endTime: string): number => {
    const w = Math.max(1, editorMode?.workDuration ?? 25);
    const b = Math.max(0, editorMode?.breakDuration ?? 5);
    return fitCyclesToDuration(Math.max(0, hhmmToMinutes(endTime) - hhmmToMinutes(startTime)), w, b);
  };

  const handleEditorCyclesStep = (delta: number) => {
    const next = clampCycles(blockCycles + delta, 1);
    setBlockCycles(next);
    if (next > 1 && !editorIsChill) setBlockEndTime(editorEndForCycles(blockStartTime, next));
  };

  const handleEditorStartChange = (value: string) => {
    setBlockStartTime(value);
    if (editorMode && blockCycles > 1 && !editorIsChill) setBlockEndTime(editorEndForCycles(value, blockCycles));
  };

  const handleEditorEndChange = (value: string) => {
    if (editorMode && blockCycles > 1 && !editorIsChill) {
      const next = editorCyclesForRange(blockStartTime, value);
      setBlockCycles(next);
      setBlockEndTime(editorEndForCycles(blockStartTime, next));
    } else {
      setBlockEndTime(value);
    }
  };

  const handleEditorModeChange = (modeId: string) => {
    setBlockModeId(modeId);
    const m = modes.find((x) => x.id === modeId);
    if (m && !m.isChillMode && blockCycles > 1) {
      const w = Math.max(1, m.workDuration);
      const b = Math.max(0, m.breakDuration);
      setBlockEndTime(
        minutesToHHMM(Math.min(24 * 60 - 1, hhmmToMinutes(blockStartTime) + sessionWallMinutes(w, b, blockCycles)))
      );
    }
  };

  const handleDeleteBlock = (block: ScheduleBlock, e: React.MouseEvent) => {
    e.stopPropagation();
    // S-13: confirm downstream effects instead of silent delete.
    const bits: string[] = [];
    if (block.googleCalendarEventId) bits.push('linked Google event');
    if (block.timerEnabled !== false) bits.push('scheduled auto-run');
    if (block.taskId) bits.push('its link to the task cycle');
    else bits.push('mirrored task');
    if (!confirm(`Delete "${block.modeName}" (${block.startTime}–${block.endTime})?\n\nThis also removes: ${bits.join(', ')}. Completed mirrored tasks are kept.`)) return;
    const targetDate = block.date || selectedDate;
    const datePlan = plans[targetDate];
    const targetDateBlocks = datePlan?.blocks || (targetDate === selectedDate ? blocks : []);
    const updated = targetDateBlocks.filter((b) => b.id !== block.id);
    persistBlocksForDate(targetDate, updated);
    if (editingBlockId === block.id) setIsEditModalOpen(false);
  };

  /**
   * Persist template-generated sessions as ordinary Day Planner events.
   *
   * Goes through `persistBlocksForDate` (fresh timestamps for new ids) and
   * `onSavePlan`, so Google Calendar sync picks the sessions up exactly like
   * hand-created events — no parallel sync path. Afterwards the schedule is
   * recorded in the Obsidian daily note (best-effort: the events are already
   * safe even if the note update fails).
   */
  const handleGenerateSchedule = async (
    date: string,
    newBlocks: ScheduleBlock[],
    meta: { templateName: string; templateTitle: string; mode?: 'add' | 'replace' }
  ): Promise<string | null> => {
    try {
      const datePlan = plans[date];
      const existing = datePlan?.blocks || (date === selectedDate ? blocks : []);
      const replacing = meta.mode === 'replace';
      // One persist call either way: validation already passed, so a partial
      // schedule can never be left behind.
      persistBlocksForDate(date, replacing ? newBlocks : [...existing, ...newBlocks]);

      const base = replacing
        ? `Replaced ${existing.length} event${existing.length === 1 ? '' : 's'} with ${newBlocks.length} session${newBlocks.length === 1 ? '' : 's'} from “${meta.templateTitle}” for ${date}.`
        : `Generated ${newBlocks.length} session${newBlocks.length === 1 ? '' : 's'} from “${meta.templateTitle}” for ${date}.`;
      if (!obsidianConfig?.vaultPath) {
        setSyncFeedback({
          message: `${base} Connect an Obsidian vault to also record it in a daily note.`,
          type: 'info',
        });
        return null;
      }
      const section = buildDayScheduleSection(
        meta.templateTitle,
        date,
        newBlocks.map((b) => ({
          startTime: b.startTime,
          endTime: b.endTime,
          title: stripDateSuffix(b.modeName),
          detail: b.description,
        }))
      );
      const res = await plannerMd.updateDaySchedule(date, section);
      if (res.success) {
        setSyncFeedback({ message: `${base} Daily note updated.`, type: 'success' });
      } else {
        setSyncFeedback({
          message: `${base} Daily note not updated: ${res.error || 'unknown error'}.`,
          type: 'error',
        });
      }
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  // Cycle blocks already placed (any day), per task. Used to know how many of
  // a task's cycles still need a slot (and which cycle number to label the
  // next block with). The selected day uses the live local `blocks`; other
  // days come from persisted plans.
  const cyclePlacementBlocks = useMemo(() => {
    const out: ScheduleBlock[] = [];
    for (const [date, plan] of Object.entries(plans)) {
      if (date === selectedDate) continue;
      for (const b of plan.blocks || []) {
        if (b.taskId && b.cycleIndex != null) out.push(b);
      }
    }
    for (const b of blocks) {
      if (b.taskId && b.cycleIndex != null) out.push(b);
    }
    return out;
  }, [plans, selectedDate, blocks]);

  const placedCyclesByTask = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const b of cyclePlacementBlocks) {
      const arr = map.get(b.taskId as string) || [];
      arr.push(b.cycleIndex as number);
      map.set(b.taskId as string, arr);
    }
    return map;
  }, [cyclePlacementBlocks]);

  const taskCyclePlan = (task: TaskItem) => {
    const total = typeof task.cycles === 'number' && task.cycles > 1 ? Math.floor(task.cycles) : 1;
    const done = Math.max(0, task.cyclesCompleted || 0);
    const placed = placedCyclesByTask.get(task.id) || [];
    const base = Math.max(done, placed.length ? Math.max(...placed) : 0);
    return {
      total,
      done,
      placedCount: placed.length,
      /** Cycle number the next scheduled block should carry. */
      nextIndex: Math.min(total, base + 1),
      /** Cycles still without a block today. */
      remaining: Math.max(0, total - base),
    };
  };

  // Tasks already living on the calendar (source === 'calendar') must not be
  // scheduled again — scheduling them a second time created a second block
  // plus a second mirrored task. A manual task whose cycles are all already
  // placed today is also excluded.
  const unscheduledTasks = useMemo(
    () =>
      (tasks || []).filter((t) => {
        if (t.completed || t.source === 'calendar') return false;
        const total = typeof t.cycles === 'number' && t.cycles > 1 ? Math.floor(t.cycles) : 1;
        const placed = (placedCyclesByTask.get(t.id) || []).length;
        return placed < total;
      }),
    [tasks, placedCyclesByTask]
  );

  // Quick schedule: opens the cycle picker pre-filled for this task (name,
  // mode, remaining cycles) so each cycle becomes its own movable block.
  const handleScheduleTask = (task: TaskItem) => {
    if (task.source === 'calendar') {
      setSyncFeedback({ message: 'That task is already on the calendar.', type: 'info' });
      return;
    }
    const taskMode = task.modeId ? modes.find((m) => m.id === task.modeId) : undefined;
    // "Estimated time" of the task: its estimate, else the mode's wall, else 45.
    const estimate = task.estimateMinutes && task.estimateMinutes > 0 ? task.estimateMinutes : undefined;
    const duration = estimate ?? taskMode?.workDuration ?? 45;
    const plan = taskCyclePlan(task);

    // Find first free slot after 09:00 as the suggested first cycle start.
    let candidateStartMins = 9 * 60;
    const sorted = [...blocks].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (const b of sorted) {
      const [bStartH, bStartM] = b.startTime.split(':').map(Number);
      const [bEndH, bEndM] = b.endTime.split(':').map(Number);
      const bStart = bStartH * 60 + bStartM;
      const bEnd = bEndH * 60 + bEndM;
      if (candidateStartMins + duration <= bStart) break;
      if (candidateStartMins < bEnd) candidateStartMins = bEnd + 10;
    }
    if (candidateStartMins > 24 * 60 - duration) candidateStartMins = 9 * 60;

    setCycleModalTask(task);
    // A task with no mode (or one pointing at a deleted mode) schedules as a
    // free-form block by default; picking a mode opts into cycles + timer.
    setCycleModalModeId(taskMode?.id || '');
    setCycleModalCount(Math.max(1, plan.remaining));
    setCycleModalGap(Math.max(0, taskMode?.breakDuration ?? 7));
    setCycleModalDuration(duration);
    setCycleModalStart(minutesToHHMM(candidateStartMins));
  };

  // Confirm the cycle picker: creates ONE movable block per cycle, all linked
  // to the task (taskId) so starting any of them credits the task, shows
  // "cycle x of z", and marks exactly that cycle done in the planner.
  //
  // With no mode selected the task is scheduled as a single free-form block:
  // just a time range that starts no timer and blocks nothing.
  const handleConfirmScheduleCycles = () => {
    const task = cycleModalTask;
    if (!task) return;
    const taskMode = modes.find((m) => m.id === cycleModalModeId);

    if (!taskMode) {
      const start = hhmmToMinutes(cycleModalStart);
      const dur = Math.max(1, Math.min(24 * 60, Math.round(cycleModalDuration) || 60));
      const end = Math.min(24 * 60 - 1, start + dur);
      if (end <= start || start >= 24 * 60) {
        setSyncFeedback({
          message: 'That time does not fit before midnight — pick an earlier start or a shorter duration.',
          type: 'error',
        });
        return;
      }
      const block: ScheduleBlock = {
        id: `block-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        date: selectedDate,
        startTime: minutesToHHMM(start),
        endTime: minutesToHHMM(end),
        modeId: '',
        modeName: stripDateSuffix(task.title),
        modeIcon: '',
        modeColor: '',
        workDuration: 0,
        breakDuration: 0,
        cycles: 1,
        status: 'approved',
        timerEnabled: false,
        taskId: task.id,
        taskTitle: task.title,
      };
      persistBlocksForDate(selectedDate, [...blocks, block]);
      setSyncFeedback({
        message: `Scheduled "${stripDateSuffix(task.title)}" — just planned time, no mode. Drag it to reposition.`,
        type: 'success',
      });
      setCycleModalTask(null);
      return;
    }

    const plan = taskCyclePlan(task);
    const count = Math.max(1, Math.min(12, cycleModalCount));
    const work = Math.max(1, taskMode.workDuration);
    const gap = Math.max(0, cycleModalGap);
    let cursor = hhmmToMinutes(cycleModalStart);

    const newBlocks: ScheduleBlock[] = [];
    for (let i = 0; i < count; i++) {
      const idx = plan.nextIndex + i;
      if (idx > plan.total) break;
      const endMins = cursor + work;
      if (endMins > 24 * 60) break;
      newBlocks.push({
        id: `block-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        date: selectedDate,
        startTime: minutesToHHMM(cursor),
        endTime: minutesToHHMM(endMins),
        modeId: taskMode.id,
        modeName:
          plan.total > 1
            ? `${stripDateSuffix(task.title)} · Cycle ${idx}/${plan.total}`
            : stripDateSuffix(task.title),
        modeIcon: taskMode.icon,
        modeColor: taskMode.color,
        // One honest cycle per block: the event spans exactly the work block.
        workDuration: work,
        breakDuration: 0,
        cycles: 1,
        status: 'approved',
        taskId: task.id,
        taskTitle: task.title,
        cycleIndex: idx,
        cyclesTotal: plan.total,
      });
      cursor = endMins + gap;
    }

    if (newBlocks.length === 0) {
      setSyncFeedback({
        message: 'No room left today for those cycles — pick an earlier start or fewer cycles.',
        type: 'error',
      });
      return;
    }

    persistBlocksForDate(selectedDate, [...blocks, ...newBlocks]);
    setSyncFeedback({
      message: `Scheduled ${newBlocks.length} cycle${newBlocks.length === 1 ? '' : 's'} for "${stripDateSuffix(task.title)}" — drag each to its own time. Blocking starts automatically when a cycle's time arrives.`,
      type: 'success',
    });
    setCycleModalTask(null);
  };

  // Sync to Obsidian handler
  const handleSyncToObsidian = async () => {
    if (!obsidianConfig || !obsidianConfig.vaultPath) {
      setSyncFeedback({
        message: 'Obsidian sync folder is not set. Configure it in Preferences (⌘,).',
        type: 'info',
      });
      return;
    }
    setIsObsidianSyncing(true);
    try {
      const res = await obsidianService.syncTasks(tasks, modes, obsidianConfig);
      if (res.success) {
        onObsidianSynced?.(new Date().toISOString());
        setSyncFeedback({
          message: `Synced ${res.syncedCount} tasks to Obsidian vault!`,
          type: 'success',
        });
      } else {
        setSyncFeedback({
          message: res.error || 'Failed to sync with Obsidian.',
          type: 'error',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSyncFeedback({ message: msg, type: 'error' });
    } finally {
      setIsObsidianSyncing(false);
    }
  };

  // Total WALL minutes scheduled for today (calendar intervals) plus the
  // implied CONTROL-WORK minutes (cycles × work). Wall includes breaks/gaps;
  // work counts only control. Both are shown so the plan is honest (B-06).
  const totalWallMinutesScheduled = useMemo(() => {
    return blocks.reduce((acc, b) => {
      const [sH, sM] = b.startTime.split(':').map(Number);
      const [eH, eM] = b.endTime.split(':').map(Number);
      return acc + Math.max(0, (eH * 60 + eM) - (sH * 60 + sM));
    }, 0);
  }, [blocks]);
  const totalControlMinutesScheduled = totalWallMinutesScheduled;
  const totalWorkMinutesScheduled = useMemo(() => {
    return blocks.reduce((acc, b) => acc + (b.cycles || 1) * (b.workDuration || 0), 0);
  }, [blocks]);

  // Daily goal: single source of truth from settings (B-06/B-13).
  const DAILY_GOAL_MINS = dailyGoalMinutes && dailyGoalMinutes > 0 ? dailyGoalMinutes : 120;
  const goalProgressPercent = Math.min(100, Math.round((totalWallMinutesScheduled / DAILY_GOAL_MINS) * 100));

  // Generate hour slots array: [6, 7, 8, ... 22]
  const hourSlots = Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i);

  // Mini Month Calendar computation for sidebar
  const miniCalendarDays = useMemo(() => {
    const year = miniCalendarMonth.getFullYear();
    const month = miniCalendarMonth.getMonth();

    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 is Sun
    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: { dateStr: string; dayNum: number; isCurrentMonth: boolean; isToday: boolean; isSelected: boolean; hasBlocks: boolean }[] = [];

    // Empty lead cells
    for (let i = 0; i < firstDayIndex; i++) {
      cells.push({
        dateStr: '',
        dayNum: 0,
        isCurrentMonth: false,
        isToday: false,
        isSelected: false,
        hasBlocks: false,
      });
    }

    // Days in current month
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayPlan = plans[dStr];
      const hasPlanBlocks = (dayPlan?.blocks?.length || 0) > 0;
      cells.push({
        dateStr: dStr,
        dayNum: d,
        isCurrentMonth: true,
        isToday: dStr === todayStr,
        isSelected: dStr === selectedDate,
        hasBlocks: hasPlanBlocks,
      });
    }

    return cells;
  }, [miniCalendarMonth, plans, todayStr, selectedDate]);

  // Mini Month Navigation
  const handlePrevMiniMonth = () => {
    setMiniCalendarMonth(new Date(miniCalendarMonth.getFullYear(), miniCalendarMonth.getMonth() - 1, 1));
  };
  const handleNextMiniMonth = () => {
    setMiniCalendarMonth(new Date(miniCalendarMonth.getFullYear(), miniCalendarMonth.getMonth() + 1, 1));
  };

  // Filter blocks by enabled mode checklist + visible layers. Mode-less
  // blocks have no checklist entry, so they are always visible.
  const visibleBlocks = useMemo(() => {
    return blocks.filter((b) => (!b.modeId || enabledModeIds.has(b.modeId)) && passesLayers(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, enabledModeIds, showPlanLayer, showGoogleLayer]);

  // Finished sessions mapped onto the grid (recorded layer).
  const recordedByDay = useMemo(() => {
    const map = new Map<string, { top: number; height: number; title: string; color: string }[]>();
    if (!showRecordedLayer) return map;
    for (const s of sessions || []) {
      if (s.status !== 'completed' || !s.startTime || !s.endTime) continue;
      const start = new Date(s.startTime);
      const end = new Date(s.endTime);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) continue;
      const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
      const startMins = start.getHours() * 60 + start.getMinutes();
      const mins = Math.max(10, Math.round((end.getTime() - start.getTime()) / 60000));
      const list = map.get(key) || [];
      list.push({
        top: minutesToY(startMins, START_HOUR, hourHeight),
        height: Math.max(8, (mins / 60) * hourHeight - 4),
        title: `${s.modeName} · ${s.actualWorkMinutes}m recorded`,
        color: modes.find((m) => m.id === s.modeId)?.color || currentTheme.accent,
      });
      map.set(key, list);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, hourHeight, showRecordedLayer]);

  // Side-by-side cascade lanes for overlapping grid events (day view).
  // All-day events render in their own strip (never in the grid): a 00:00–
  // 23:59 block would otherwise cover the whole day and force everything
  // into one cascade cluster.
  const gridBlocks = useMemo(() => visibleBlocks.filter((b) => !b.allDay), [visibleBlocks]);
  const allDayBlocks = useMemo(() => visibleBlocks.filter((b) => b.allDay), [visibleBlocks]);
  const dayLayout = useMemo(() => layoutOverlappingBlocks(gridBlocks), [gridBlocks]);
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden select-none motion-blur-in">
      {/* =========================================================================
          APPLE CALENDAR TOP TOOLBAR
          ========================================================================= */}
      <div 
        className="px-6 py-2.5 border-b flex items-center justify-between z-20 liquid-glass shrink-0"
        style={{ borderColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)' }}
      >
        {/* Left: Back button + Sidebar toggle + Date Controls */}
        <div className="flex items-center space-x-3">
          <button
            onClick={onBackToLauncher}
            className="p-1.5 rounded-xl liquid-glass border transition-all active:scale-95 cursor-pointer hover:bg-white/10"
            style={{ color: currentTheme.textSecondary }}
            title="Back to Tasks [1]"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className={`p-1.5 rounded-xl border transition-all active:scale-95 cursor-pointer ${
              isSidebarOpen ? 'bg-sky-500/15 text-sky-400 border-sky-500/30' : 'liquid-glass hover:bg-white/10'
            }`}
            style={{ color: isSidebarOpen ? undefined : currentTheme.textSecondary }}
            title="Toggle Calendar Sidebar (⌘⌥S)"
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          {/* Date Navigation (Apple style) */}
          <div className="flex items-center space-x-1 pl-1">
            <button
              onClick={handleToday}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer shadow-sm ${
                isSelectedToday
                  ? 'bg-[#ff3b30] text-white border-[#ff3b30] shadow-[0_0_12px_rgba(255,59,48,0.4)]'
                  : 'liquid-glass border hover:bg-white/10'
              }`}
              style={{ color: isSelectedToday ? '#ffffff' : currentTheme.textPrimary }}
            >
              Today
            </button>
            <div className="flex items-center space-x-0.5 liquid-glass rounded-xl border p-0.5">
              <button
                onClick={handlePrevDay}
                className="p-1.5 rounded-lg hover:bg-white/10 active:scale-95 cursor-pointer transition-all"
                style={{ color: currentTheme.textSecondary }}
                title="Previous"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleNextDay}
                className="p-1.5 rounded-lg hover:bg-white/10 active:scale-95 cursor-pointer transition-all"
                style={{ color: currentTheme.textSecondary }}
                title="Next"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Apple Calendar Date Headline & Icon Badge */}
          <div className="flex items-center space-x-2.5 pl-2">
            {/* Apple Calendar Iconic Date Tile */}
            <div 
              className="w-9 h-9 rounded-xl border flex flex-col items-center justify-center overflow-hidden shadow-sm shrink-0 cursor-pointer hover:scale-105 transition-transform"
              style={{
                backgroundColor: isDark ? '#1a1d26' : '#ffffff',
                borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
              }}
              onClick={handleToday}
              title="Click to jump to Today"
            >
              <div className="w-full bg-[#ff3b30] py-0.2 text-[8px] font-black text-center text-white uppercase tracking-wider">
                {monthShort}
              </div>
              <div 
                className="text-xs font-bold -mt-0.5"
                style={{ color: isSelectedToday ? '#ff3b30' : currentTheme.textPrimary }}
              >
                {dayNumber}
              </div>
            </div>

            <div>
              <div className="flex items-baseline space-x-1.5">
                <h1 
                  className="text-base sm:text-lg font-bold tracking-tight"
                  style={{ color: currentTheme.textPrimary }}
                >
                  {formattedDayOfWeek}
                </h1>
                <span 
                  className="text-xs font-medium opacity-65"
                  style={{ color: currentTheme.textSecondary }}
                >
                  {formattedMonthDay}, {formattedYear}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Center: Apple Segmented View Switcher: [ Day | Week | Plan ] */}
        <div className="hidden md:flex items-center p-1 rounded-xl liquid-glass border">
          <button
            onClick={() => setCalendarView('day')}
            className={`px-4 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              calendarView === 'day'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'hover:bg-white/5 opacity-70 hover:opacity-100'
            }`}
            style={{ color: calendarView === 'day' ? '#ffffff' : currentTheme.textPrimary }}
          >
            Day
          </button>
          <button
            onClick={() => setCalendarView('week')}
            className={`px-4 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              calendarView === 'week'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'hover:bg-white/5 opacity-70 hover:opacity-100'
            }`}
            style={{ color: calendarView === 'week' ? '#ffffff' : currentTheme.textPrimary }}
          >
            Week
          </button>
          <button
            onClick={() => setCalendarView('plan')}
            className={`px-4 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              calendarView === 'plan'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'hover:bg-white/5 opacity-70 hover:opacity-100'
            }`}
            style={{ color: calendarView === 'plan' ? '#ffffff' : currentTheme.textPrimary }}
          >
            Plan
          </button>
        </div>

        {/* Right: Actions (Google/Obsidian sync) */}
        <div className="flex items-center space-x-2">
          {/* Daily planned hours metric */}
          <div 
            className="px-3 py-1.5 rounded-full liquid-glass text-xs font-mono font-semibold hidden xl:flex items-center space-x-1.5"
            style={{ color: currentTheme.textSecondary }}
          >
            <Clock className="w-3.5 h-3.5 text-sky-400" />
            <span title={`Wall ${totalWallMinutesScheduled}m (control work ${totalWorkMinutesScheduled}m + breaks/gaps)`}>{Math.round(totalWallMinutesScheduled / 60 * 10) / 10}h wall · {Math.round(totalWorkMinutesScheduled / 60 * 10) / 10}h work</span>
            <span className="opacity-40">·</span>
            <span>{blocks.length} {blocks.length === 1 ? 'session' : 'sessions'}</span>
          </div>

          {/* Google Calendar sync status chip */}
          {googleChip && (
            <button
              onClick={onOpenSettings}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl liquid-glass border text-xs font-semibold transition-all hover:bg-white/10 active:scale-95 cursor-pointer"
              style={{ color: googleChip.color, borderColor: `${googleChip.color}44` }}
              title={
                googleStatus.connected
                  ? `Google Calendar · ${googleStatus.userEmail || 'connected'}${
                      googleStatus.lastSyncedAt
                        ? ` · last synced ${new Date(googleStatus.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                        : ''
                    }`
                  : 'Google Calendar sync'
              }
            >
              {googleChip.spin ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CalendarCheck className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">{googleChip.label}</span>
            </button>
          )}

          {/* Obsidian Sync Button (if enabled) */}
          {obsidianConfig?.enabled && (
            <button
              onClick={handleSyncToObsidian}
              disabled={isObsidianSyncing}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl liquid-glass border hover:bg-purple-500/15 text-xs font-semibold text-purple-400 transition-all active:scale-95 cursor-pointer"
              title="Sync Tasks to Obsidian Vault"
            >
              <FolderSync className={`w-3.5 h-3.5 ${isObsidianSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Obsidian</span>
            </button>
          )}

        </div>
      </div>

      {/* Sync Feedback Toast */}
      {syncFeedback && (
        <div className={`px-6 py-2 border-b text-xs font-semibold flex items-center justify-between transition-all ${
          syncFeedback.type === 'success'
            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
            : syncFeedback.type === 'error'
            ? 'bg-rose-500/15 border-rose-500/30 text-rose-400'
            : 'bg-sky-500/15 border-sky-500/30 text-sky-400'
        }`}>
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{syncFeedback.message}</span>
          </div>
          <button onClick={() => setSyncFeedback(null)} className="hover:opacity-70 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* =========================================================================
          MAIN CALENDAR BODY: APPLE SIDEBAR + TIMELINE (DAY / WEEK VIEW)
          ========================================================================= */}
      <div className="flex-1 flex overflow-hidden">
        {/* Apple Left Sidebar: Mini Month Calendar, Calendars checklist, Backlog */}
        {isSidebarOpen && (
          <div 
            className="w-72 border-r p-4 overflow-y-auto flex flex-col space-y-5 shrink-0 transition-all duration-300"
            style={{ 
              backgroundColor: isDark ? 'rgba(10, 12, 18, 0.45)' : 'rgba(255, 255, 255, 0.55)',
              borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)' 
            }}
          >
            {/* 1. Mini Month Calendar (Apple macOS style) */}
            <div className="p-3.5 rounded-2xl liquid-glass border space-y-2.5">
              <div className="flex items-center justify-between">
                <span 
                  className="text-xs font-bold tracking-tight"
                  style={{ color: currentTheme.textPrimary }}
                >
                  {miniCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </span>
                <div className="flex items-center space-x-1">
                  <button 
                    onClick={handlePrevMiniMonth}
                    className="p-1 rounded-lg hover:bg-white/10 active:scale-90 cursor-pointer"
                    style={{ color: currentTheme.textSecondary }}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button 
                    onClick={handleNextMiniMonth}
                    className="p-1 rounded-lg hover:bg-white/10 active:scale-90 cursor-pointer"
                    style={{ color: currentTheme.textSecondary }}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Weekday headers: S M T W T F S */}
              <div className="grid grid-cols-7 text-center text-[10px] font-mono font-bold opacity-60">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => (
                  <div key={idx}>{day}</div>
                ))}
              </div>

              {/* Days grid */}
              <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
                {miniCalendarDays.map((cell, idx) => {
                  if (!cell.isCurrentMonth) {
                    return <div key={idx} className="h-6" />;
                  }
                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedDate(cell.dateStr)}
                      className={`h-6 w-6 mx-auto rounded-full flex flex-col items-center justify-center relative transition-all cursor-pointer ${
                        cell.isToday
                          ? 'bg-[#ff3b30] text-white font-bold shadow-sm'
                          : cell.isSelected
                          ? 'bg-sky-500 text-white font-bold shadow-sm'
                          : 'hover:bg-white/10'
                      }`}
                      style={{
                        color: cell.isToday || cell.isSelected ? '#ffffff' : currentTheme.textPrimary,
                      }}
                    >
                      <span className="text-[11px] leading-none">{cell.dayNum}</span>
                      {cell.hasBlocks && !cell.isToday && !cell.isSelected && (
                        <span className="w-1 h-1 rounded-full bg-sky-400 absolute bottom-0.5" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Apple Activity Daily Control Goal Meter */}
            <div className="p-3.5 rounded-2xl liquid-glass border space-y-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="flex items-center space-x-1.5" style={{ color: currentTheme.textPrimary }}>
                  <Flame className="w-3.5 h-3.5 text-amber-500" />
                  <span>Daily Control Goal</span>
                </span>
                <span className="font-mono text-sky-400 text-[11px]">{goalProgressPercent}%</span>
              </div>
              
              <div className="w-full h-2 rounded-full bg-black/20 overflow-hidden">
                <div 
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${goalProgressPercent}%`,
                    background: 'linear-gradient(90deg, #38bdf8 0%, #10b981 100%)',
                  }}
                />
              </div>

              <div className="flex justify-between text-[10px] font-mono opacity-70" style={{ color: currentTheme.textSecondary }}>
                <span title={`Wall ${totalWallMinutesScheduled}m · work ${totalWorkMinutesScheduled}m`}>{Math.round(totalWallMinutesScheduled / 60 * 10) / 10}h wall · {Math.round(totalWorkMinutesScheduled / 60 * 10) / 10}h work</span>
                <span>{Math.round(DAILY_GOAL_MINS / 60 * 10) / 10}h target</span>
              </div>
            </div>

            {/* 3. Apple Calendar "CONTROL CALENDARS" Checklist Filter */}
            <div className="space-y-2">
              <span 
                className="text-[10px] font-mono uppercase tracking-wider font-bold block"
                style={{ color: currentTheme.textMuted }}
              >
                Control Calendars
              </span>

              <div className="space-y-1.5">
                {modeListEntries.map(({ label, mode }) => {
                  const isChecked = enabledModeIds.has(mode.id);
                  const modeColor = mode.color || currentTheme.accent;
                  return (
                    <React.Fragment key={mode.id}>
                      {label && (
                        <div
                          className="text-[10px] font-mono font-bold uppercase tracking-wider pt-1"
                          style={{ color: currentTheme.textMuted }}
                        >
                          {label}
                        </div>
                      )}
                    <div
                      key={mode.id}
                      onClick={() => toggleModeFilter(mode.id)}
                      className="px-2.5 py-1.5 rounded-xl hover:bg-white/5 flex items-center justify-between transition-colors cursor-pointer"
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <div 
                          className="w-3.5 h-3.5 rounded-md border flex items-center justify-center transition-all"
                          style={{
                            backgroundColor: isChecked ? modeColor : 'transparent',
                            borderColor: modeColor,
                          }}
                        >
                          {isChecked && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        <span 
                          className="text-xs font-semibold truncate"
                          style={{ color: isChecked ? currentTheme.textPrimary : currentTheme.textMuted }}
                        >
                          {mode.name}
                        </span>
                      </div>
                      <span 
                        className="text-[10px] font-mono opacity-60"
                        style={{ color: currentTheme.textSecondary }}
                      >
                        {mode.workDuration}m
                      </span>
                    </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            {/* 3b. Calendar Layers */}
            <div className="space-y-2">
              <span
                className="text-[10px] font-mono uppercase tracking-wider font-bold block"
                style={{ color: currentTheme.textMuted }}
              >
                Layers
              </span>

              <div className="space-y-1.5">
                {[
                  { label: 'Planned blocks', on: showPlanLayer, toggle: () => setShowPlanLayer((v) => !v) },
                  { label: 'Google synced', on: showGoogleLayer, toggle: () => setShowGoogleLayer((v) => !v) },
                  { label: 'Recorded sessions', on: showRecordedLayer, toggle: () => setShowRecordedLayer((v) => !v) },
                ].map((layer) => (
                  <div
                    key={layer.label}
                    onClick={layer.toggle}
                    className="px-2.5 py-1.5 rounded-xl hover:bg-white/5 flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <span
                      className="text-xs font-semibold"
                      style={{ color: layer.on ? currentTheme.textPrimary : currentTheme.textMuted }}
                    >
                      {layer.label}
                    </span>
                    <div
                      className="w-3.5 h-3.5 rounded-md border flex items-center justify-center transition-all"
                      style={{
                        backgroundColor: layer.on ? currentTheme.accent : 'transparent',
                        borderColor: layer.on ? currentTheme.accent : currentTheme.textMuted,
                      }}
                    >
                      {layer.on && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 4. Unscheduled Tasks Backlog */}
            <div className="space-y-2 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between">
                <span 
                  className="text-[10px] font-mono uppercase tracking-wider font-bold flex items-center space-x-1.5"
                  style={{ color: currentTheme.textMuted }}
                >
                  <CalendarCheck className="w-3.5 h-3.5 text-sky-400" />
                  <span>Tasks Backlog</span>
                </span>
                <span className="text-[10px] font-mono opacity-60">
                  {unscheduledTasks.length}
                </span>
              </div>

              <div className="space-y-2 overflow-y-auto flex-1 pr-1">
                {unscheduledTasks.map((t) => {
                  const tMode = modes.find((m) => m.id === t.modeId) || modes[0];
                  return (
                    <div 
                      key={t.id}
                      className="p-2.5 rounded-2xl liquid-glass-card border flex items-center justify-between group transition-all"
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        <span 
                          className="text-xs font-semibold truncate block"
                          style={{ color: currentTheme.textPrimary }}
                        >
                          {t.title}
                        </span>
                        <span 
                          className="text-[10px] font-mono block opacity-60"
                          style={{ color: tMode.color || currentTheme.accent }}
                        >
                          {tMode.name} · {tMode.workDuration}m
                          {(() => {
                            const plan = taskCyclePlan(t);
                            if (plan.total <= 1) return null;
                            return (
                              <span className="text-sky-400">
                                {' '}· {plan.remaining} {plan.remaining === 1 ? 'cycle' : 'cycles'} left
                                {plan.done > 0 ? ` (${plan.done}/${plan.total} done)` : ''}
                              </span>
                            );
                          })()}
                        </span>
                      </div>

                      <button
                        onClick={() => handleScheduleTask(t)}
                        className="p-1.5 rounded-xl bg-sky-500/15 text-sky-400 hover:bg-sky-500/25 text-[11px] font-bold transition-all active:scale-90 cursor-pointer shrink-0 opacity-80 group-hover:opacity-100"
                        title="Arrange this task's cycles in the day (one movable block per cycle)"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}

                {unscheduledTasks.length === 0 && (
                  <div 
                    className="text-center py-6 text-xs font-medium space-y-1"
                    style={{ color: currentTheme.textMuted }}
                  >
                    <Sparkles className="w-5 h-5 mx-auto text-emerald-400 opacity-60 mb-2" />
                    <span>All tasks scheduled!</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Center / Right: Calendar Grid (Day View OR Week View) */}
        <div 
          ref={gridScrollRef}
          className="flex-1 overflow-y-auto relative scroll-smooth flex flex-col"
          style={{
            backgroundColor: isDark ? 'rgba(6, 8, 14, 0.65)' : 'rgba(248, 250, 252, 0.65)',
          }}
        >
          {/* =========================================================================
              VIEW 1: DAY VIEW (Apple Calendar Hourly Timeline)
              ========================================================================= */}
          {calendarView === 'day' && (
            <>
              {/* All-day strip (Apple Calendar style — outside the timed grid) */}
              {allDayBlocks.length > 0 && (
                <div className="flex items-stretch gap-1.5 px-4 py-2 border-b"
                  style={{ borderColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)' }}
                >
                  <span
                    className="text-[10px] font-mono font-bold uppercase tracking-wider w-16 sm:w-20 pr-3 text-right shrink-0 self-center select-none"
                    style={{ color: currentTheme.textMuted }}
                  >
                    All-day
                  </span>
                  <div className="flex-1 flex flex-wrap gap-1.5 min-w-0">
                    {allDayBlocks.map((block) => {
                      const mode = modes.find((m) => m.id === block.modeId);
                      const blockColor = block.modeColor || mode?.color || currentTheme.accent;
                      return (
                        <button
                          key={block.id}
                          onClick={(e) => handleEditBlock(block, e)}
                          className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold truncate max-w-full hover:brightness-110 active:scale-95 cursor-pointer transition-all"
                          style={{
                            backgroundColor: isDark ? `${blockColor}22` : `${blockColor}15`,
                            borderColor: `${blockColor}45`,
                            color: currentTheme.textPrimary,
                          }}
                          title="All-day event — click to edit"
                        >
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: blockColor }} />
                          <span className="truncate">{stripDateSuffix(block.modeName)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            <div 
              className="relative w-full"
              style={{ height: `${TOTAL_HOURS * hourHeight}px` }}
            >
              {/* Horizontal Hour Rows */}
              {hourSlots.map((hour, idx) => {
                const timeLabel = formatTime12h(`${String(hour).padStart(2, '0')}:00`);
                return (
                  <div
                    key={hour}
                    className="absolute w-full flex items-start group"
                    style={{
                      top: `${idx * hourHeight}px`,
                      height: `${hourHeight}px`,
                    }}
                    onClick={() => handleSlotClick(hour, 0, selectedDate)}
                  >
                    {/* Left Apple Hour Label */}
                    <div 
                      className="w-16 sm:w-20 pr-3 text-right text-[11px] font-medium -mt-2.5 select-none shrink-0"
                      style={{ color: currentTheme.textMuted }}
                    >
                      {timeLabel}
                    </div>

                    {/* Grid Area with Hairline Borders */}
                    <div 
                      className="flex-1 h-full border-t relative cursor-pointer hover:bg-white/[0.02] transition-colors"
                      style={{ borderColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)' }}
                      onPointerDown={(e) => startCreateDrag(e, selectedDate)}
                    >
                      {/* Subtle 30-minute dashed separator */}
                      <div 
                        className="absolute w-full top-1/2 border-t border-dashed pointer-events-none"
                        style={{ borderColor: isDark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)' }}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Apple Red Current-Time Indicator Line */}
              {isSelectedToday && showCurrentTimeLine && (
                <div 
                  className={`absolute w-full flex items-center z-30 pointer-events-none ${isZooming ? '' : 'transition-all duration-1000 ease-linear'}`}
                  style={{ top: `${currentTimeLineTop}px` }}
                >
                  {/* Apple Red Bead Dot */}
                  <div className="w-16 sm:w-20 pr-2 flex justify-end items-center">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ff3b30] shadow-[0_0_8px_rgba(255,59,48,0.9)] animate-ping absolute" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ff3b30] relative z-10" />
                  </div>
                  {/* Razor-thin Apple Red Line */}
                  <div className="flex-1 h-[1.5px] bg-[#ff3b30] shadow-[0_0_6px_rgba(255,59,48,0.7)]" />
                </div>
              )}

              {/* Scheduled Event Cards (Day View) */}
              <div ref={dayEventsRef} className="absolute top-0 left-16 sm:left-20 right-4 bottom-0 pointer-events-none">
                {gridBlocks.map((block) => {
                  const [sH, sM] = block.startTime.split(':').map(Number);
                  const [eH, eM] = block.endTime.split(':').map(Number);

                  const startAbsMins = sH * 60 + (sM || 0);
                  const endAbsMins = eH * 60 + (eM || 0);
                  const effectiveEnd = endAbsMins < startAbsMins ? 24 * 60 : endAbsMins;
                  const durationMins = Math.max(20, effectiveEnd - startAbsMins);

                  const top = minutesToY(startAbsMins, START_HOUR, hourHeight);
                  // Height follows the real duration, with a readable floor for
                  // isolated short events — but the floor is capped at the next
                  // event sharing this card's horizontal space, so a short block
                  // can never grow into the one below it.
                  const naturalHeight = (durationMins / 60) * hourHeight - DAY_EVENT_GAP_PX;
                  const horizon = nextSharedHorizon(block.id, gridBlocks, dayLayout);
                  const horizonHeight = ((horizon - startAbsMins) / 60) * hourHeight - DAY_EVENT_GAP_PX;
                  const height = Math.max(2, Math.min(Math.max(DAY_MIN_EVENT_HEIGHT, naturalHeight), horizonHeight));

                  const mode = modes.find((m) => m.id === block.modeId);
                  const blockColor = block.modeColor || mode?.color || currentTheme.accent;
                  const place = dayLayout[block.id] || { left: 0, width: 1, lane: 0, span: 1, lanes: 1 };
                  const narrow = place.width < 1;
                  const compact = height < 52;
                  // Per-cycle progress for task-linked blocks: "cycle x of z"
                  // plus a done state once the task has credited that cycle.
                  const cycleTask = block.taskId ? (tasks || []).find((t) => t.id === block.taskId) : null;
                  const cycleDone =
                    block.status === 'completed' ||
                    (block.cycleIndex != null && (cycleTask?.cyclesCompleted || 0) >= (block.cycleIndex || 0));
                  // Apple-style expanding columns: left/width are fractions of the
                  // day column, so overlapped events sit side by side and spring
                  // back to full width once their neighbours have ended.
                  const cardLeft = `calc(${(place.left * 100).toFixed(4)}% + ${DAY_EVENT_GAP_PX}px)`;
                  const cardWidth = `calc(${(place.width * 100).toFixed(4)}% - ${DAY_EVENT_GAP_PX * 2}px)`;

                  return (
                    <div
                      key={block.id}
                      onClick={(e) => handleEditBlock(block, e)}
                      onPointerDown={(e) => startCardDrag(e, block, 'move')}
                      className={`absolute rounded-lg border ${compact ? 'px-1.5 py-0.5' : narrow ? 'p-1.5' : 'p-2.5'} pointer-events-auto transition-transform duration-200 hover:scale-[1.008] hover:z-20 cursor-grab active:cursor-grabbing shadow-lg group flex flex-col justify-between overflow-hidden`}
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        left: cardLeft,
                        width: cardWidth,
                        backgroundColor: isDark ? `${blockColor}22` : `${blockColor}15`,
                        borderColor: `${blockColor}45`,
                        boxShadow: `0 4px 16px -2px rgba(0,0,0,0.25), inset 3px 0 0 0 ${blockColor}`,
                        opacity: dragPreview?.blockId === block.id && dragPreview.mode !== 'create' ? 0.35 : cycleDone ? 0.6 : 1,
                      }}
                      title={cycleDone ? 'Cycle completed — click to edit' : 'Drag to move · Alt-drag to copy · edit on click'}
                    >
                      {compact ? (
                        <>
                          {/* Compact single line: time stays visible on short events */}
                          <div className="flex items-center gap-1.5 h-full min-w-0">
                            <span
                              className="text-[10px] font-mono font-semibold shrink-0"
                              style={{ color: currentTheme.textSecondary }}
                            >
                              {formatTime12h(block.startTime)}
                            </span>
                            <span
                              className="text-[11px] font-bold truncate tracking-tight"
                              style={{ color: currentTheme.textPrimary }}
                            >
                              {stripDateSuffix(block.modeName)}
                            </span>
                          </div>
                          {/* Hover actions overlay (no room in flow) */}
                          <div
                            className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 rounded-lg p-0.5 z-10"
                            style={{ backgroundColor: isDark ? 'rgba(6,8,14,0.75)' : 'rgba(255,255,255,0.88)' }}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (block.timerEnabled === false || !mode) return;
                                onStartBlockInTimer(mode, block);
                              }}
                              disabled={block.timerEnabled === false || !mode}
                              className={`p-1 rounded-lg transition-all shadow-sm ${
                                block.timerEnabled === false
                                  ? 'bg-white/5 text-current opacity-30 cursor-not-allowed'
                                  : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 active:scale-90 cursor-pointer'
                              }`}
                              title={
                                block.timerEnabled === false
                                  ? 'Timer is disabled for this session (template setting)'
                                  : 'Start Control Session Now'
                              }
                            >
                              <Play className="w-2.5 h-2.5 fill-current" />
                            </button>
                            <button
                              onClick={(e) => handleDeleteBlock(block, e)}
                              className="p-1 rounded-lg hover:bg-rose-500/20 text-rose-400 transition-all active:scale-90 cursor-pointer"
                              title="Delete Block"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </>
                      ) : (
                      /* Block Header */
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center space-x-1.5">
                            {block.modeIcon || mode ? (
                              <DynamicIcon name={block.modeIcon || mode!.icon} className="w-3.5 h-3.5" style={{ color: blockColor }} />
                            ) : (
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: blockColor }} />
                            )}
                            <span 
                              className="text-xs font-bold truncate tracking-tight"
                              style={{ color: currentTheme.textPrimary }}
                            >
                              {stripDateSuffix(block.modeName)}
                            </span>
                          </div>
                          <span 
                            className="text-[10px] font-mono block opacity-75 font-semibold mt-0.5"
                            style={{ color: currentTheme.textSecondary }}
                          >
                            {formatTimeRange12h(block.startTime, block.endTime)} ({durationMins}m)
                          </span>
                        </div>

                        {/* Hover Quick Action Buttons */}
                        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (block.timerEnabled === false || !mode) return;
                              onStartBlockInTimer(mode, block);
                            }}
                            disabled={block.timerEnabled === false || !mode}
                            className={`p-1.5 rounded-xl transition-all shadow-sm ${
                              block.timerEnabled === false
                                ? 'bg-white/5 text-current opacity-30 cursor-not-allowed'
                                : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 active:scale-90 cursor-pointer'
                            }`}
                            title={
                              block.timerEnabled === false
                                ? 'Timer is disabled for this session (template setting)'
                                : 'Start Control Session Now'
                            }
                          >
                            <Play className="w-3 h-3 fill-current" />
                          </button>
                          <button
                            onClick={(e) => handleDeleteBlock(block, e)}
                            className="p-1.5 rounded-xl hover:bg-rose-500/20 text-rose-400 transition-all active:scale-90 cursor-pointer"
                            title="Delete Block"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      )}

                      {/* Bottom Metadata: Cycles (hidden on narrow overlap columns) */}
                      {height > 52 && !narrow && (
                        <div className="flex items-center justify-between text-[10px] font-mono pt-1">
                          <span 
                            className="px-2 py-0.5 rounded-md font-semibold"
                            style={{
                              backgroundColor: blockColor + '25',
                              color: blockColor,
                            }}
                          >
                            {block.cycleIndex != null
                              ? `Cycle ${block.cycleIndex}${block.cyclesTotal ? `/${block.cyclesTotal}` : ''}${cycleDone ? ' ✓' : ''}`
                              : mode
                                ? `${mode.name} · ${block.cycles || 1} ${block.cycles === 1 ? 'cycle' : 'cycles'}`
                                : 'Planned time'}
                          </span>
                        </div>
                      )}

                      {/* Top-edge resize handle (drag to change start time) */}
                      {!compact && (
                        <div
                          onPointerDown={(e) => startCardDrag(e, block, 'resize-start')}
                          className="absolute top-0 left-0 right-0 h-2.5 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity flex items-start justify-center pt-0.5 z-10"
                          title="Drag to change start time"
                        >
                          <div className="w-8 h-1 rounded-full opacity-70" style={{ backgroundColor: blockColor }} />
                        </div>
                      )}

                      {/* Bottom-edge resize handle */}
                      <div
                        onPointerDown={(e) => startCardDrag(e, block, 'resize')}
                        className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-0.5 z-10"
                        title="Drag to resize"
                      >
                        <div className="w-10 h-1 rounded-full opacity-70" style={{ backgroundColor: blockColor }} />
                      </div>
                    </div>
                  );
                })}
                {/* Recorded sessions layer (finished control sessions) */}
                {(recordedByDay.get(selectedDate) || []).map((r, i) => (
                  <div
                    key={`rec-${r.top}-${i}`}
                    className="absolute pointer-events-auto"
                    style={{
                      top: `${r.top}px`,
                      height: `${r.height}px`,
                      right: 0,
                      width: '7px',
                      borderRadius: 4,
                      backgroundColor: r.color,
                      opacity: 0.8,
                      boxShadow: `0 0 8px ${r.color}`,
                      zIndex: 5,
                    }}
                    title={`${r.title} (recorded)`}
                  />
                ))}
                {/* Drag ghost (move / resize / create preview) */}
                {dragPreview && dragPreview.date === selectedDate && (
                  <div
                    className="absolute left-2 right-2 rounded-xl border-2 border-dashed pointer-events-none z-40 px-2.5 py-1 overflow-hidden"
                    style={{
                      top: `${minutesToY(dragPreview.start, START_HOUR, hourHeight)}px`,
                      height: `${Math.max(30, minutesToY(dragPreview.end, START_HOUR, hourHeight) - minutesToY(dragPreview.start, START_HOUR, hourHeight))}px`,
                      borderColor: currentTheme.accent,
                      backgroundColor: `${currentTheme.accent}2b`,
                    }}
                  >
                    <span className="text-[10px] font-mono font-bold block" style={{ color: currentTheme.textPrimary }}>
                      {formatTimeRange12h(minutesToHHMM(dragPreview.start), minutesToHHMM(dragPreview.end))}
                      {dragPreview.mode === 'create' ? ' · new event' : ''}
                      {dragPreview.altCopy ? ' · copy' : ''}
                    </span>
                    {dragPreview.mode !== 'create' && (
                      <span className="text-[11px] font-bold block truncate" style={{ color: currentTheme.textPrimary }}>
                        {stripDateSuffix(dragPreview.title)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            </>
          )}

          {/* =========================================================================
              VIEW 2: WEEK VIEW (Apple Calendar 7-Day Columns Layout)
              ========================================================================= */}
          {calendarView === 'week' && (
            <div className="flex-1 flex flex-col min-w-[700px]">
              {/* 7-Day Header Strip */}
              <div 
                className="flex border-b sticky top-0 z-30 liquid-glass backdrop-blur-md"
                style={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}
              >
                {/* Gutter spacer */}
                <div className="w-16 shrink-0" />

                {/* 7 Columns Header */}
                <div className="flex-1 grid grid-cols-7 divide-x" style={{ borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }}>
                  {weekDaysInfo.map((col) => (
                    <div 
                      key={col.dateStr}
                      onClick={() => {
                        setSelectedDate(col.dateStr);
                        setCalendarView('day');
                      }}
                      className={`p-2 text-center transition-colors cursor-pointer hover:bg-white/5 ${
                        col.isSelected ? 'bg-white/5' : ''
                      }`}
                    >
                      <span className="text-[10px] font-mono uppercase tracking-wider block opacity-70" style={{ color: currentTheme.textSecondary }}>
                        {col.dayName}
                      </span>
                      <span 
                        className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold mt-0.5 ${
                          col.isToday
                            ? 'bg-[#ff3b30] text-white shadow-sm'
                            : col.isSelected
                            ? 'bg-sky-500 text-white'
                            : ''
                        }`}
                        style={{ color: col.isToday || col.isSelected ? '#ffffff' : currentTheme.textPrimary }}
                      >
                        {col.dayNum}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* All-day strip (one cell per day; grid stays for timed events) */}
              {weekDaysInfo.some(
                (col) => (plans[col.dateStr]?.blocks || []).some((b) => b.allDay && (!b.modeId || enabledModeIds.has(b.modeId)) && passesLayers(b))
              ) && (
                <div className="flex border-b"
                  style={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}
                >
                  <div className="w-16 shrink-0" />
                  <div className="flex-1 grid grid-cols-7 divide-x" style={{ borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }}>
                    {weekDaysInfo.map((col) => {
                      const allDay = (plans[col.dateStr]?.blocks || []).filter(
                        (b) => b.allDay && (!b.modeId || enabledModeIds.has(b.modeId)) && passesLayers(b)
                      );
                      return (
                        <div key={col.dateStr} className="px-1 py-1 space-y-1 min-w-0">
                          {allDay.map((block) => {
                            const mode = modes.find((m) => m.id === block.modeId);
                            const blockColor = block.modeColor || mode?.color || currentTheme.accent;
                            return (
                              <button
                                key={block.id}
                                onClick={(e) => handleEditBlock(block, e)}
                                className="flex items-center space-x-1 w-full px-1.5 py-0.5 rounded-md border text-[10px] font-bold truncate hover:brightness-110 active:scale-95 cursor-pointer transition-all"
                                style={{
                                  backgroundColor: isDark ? `${blockColor}22` : `${blockColor}15`,
                                  borderColor: `${blockColor}45`,
                                  color: currentTheme.textPrimary,
                                }}
                                title="All-day event — click to edit"
                              >
                                <span className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: blockColor }} />
                                <span className="truncate">{stripDateSuffix(block.modeName)}</span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 7-Day Grid Body */}
              <div 
                className="relative w-full flex-1"
                style={{ height: `${TOTAL_HOURS * hourHeight}px` }}
              >
                {/* Horizontal Hour Rows across week */}
                {hourSlots.map((hour, idx) => {
                  const timeLabel = formatTime12h(`${String(hour).padStart(2, '0')}:00`);
                  return (
                    <div
                      key={hour}
                      className="absolute w-full flex items-start"
                      style={{
                        top: `${idx * hourHeight}px`,
                        height: `${hourHeight}px`,
                      }}
                    >
                      {/* Left Hour Label */}
                      <div 
                        className="w-16 pr-2 text-right text-[10px] font-medium -mt-2.5 select-none shrink-0"
                        style={{ color: currentTheme.textMuted }}
                      >
                        {timeLabel}
                      </div>

                      {/* 7 Column Horizontals */}
                      <div 
                        className="flex-1 h-full border-t grid grid-cols-7 divide-x"
                        style={{ 
                          borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
                        }}
                      >
                        {weekDaysInfo.map((col) => (
                          <div 
                            key={col.dateStr}
                            className="h-full relative cursor-pointer hover:bg-white/[0.02]"
                            onClick={() => handleSlotClick(hour, 0, col.dateStr)}
                            onPointerDown={(e) => startCreateDrag(e, col.dateStr)}
                          >
                            <div 
                              className="absolute w-full top-1/2 border-t border-dashed pointer-events-none"
                              style={{ borderColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Apple Red Line on Today's column in Week View */}
                {showCurrentTimeLine && (
                  <div 
                    className="absolute w-full flex items-center z-30 pointer-events-none"
                    style={{ top: `${currentTimeLineTop}px` }}
                  >
                    <div className="w-16 pr-2 flex justify-end items-center">
                      <span className="w-2 h-2 rounded-full bg-[#ff3b30]" />
                    </div>
                    <div className="flex-1 grid grid-cols-7">
                      {weekDaysInfo.map((col) => (
                        <div key={col.dateStr} className="relative">
                          {col.isToday && (
                            <div className="w-full h-[1.5px] bg-[#ff3b30] shadow-[0_0_6px_rgba(255,59,48,0.7)]" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Blocks for all 7 Days across week */}
                <div ref={weekEventsRef} className="absolute top-0 left-16 right-0 bottom-0 pointer-events-none grid grid-cols-7">
                  {weekDaysInfo.map((col) => {
                    const dayBlocks = (plans[col.dateStr]?.blocks || []).filter((b) => (!b.modeId || enabledModeIds.has(b.modeId)) && passesLayers(b));
                    const gridBlocks = dayBlocks.filter((b) => !b.allDay);
                    const colLayout = layoutOverlappingBlocks(gridBlocks);
                    return (
                      <div key={col.dateStr} className="relative h-full px-1">
                        {(recordedByDay.get(col.dateStr) || []).map((r, i) => (
                          <div
                            key={`rec-${r.top}-${i}`}
                            className="absolute pointer-events-auto"
                            style={{
                              top: `${r.top}px`,
                              height: `${r.height}px`,
                              right: 2,
                              width: '5px',
                              borderRadius: 3,
                              backgroundColor: r.color,
                              opacity: 0.8,
                              zIndex: 5,
                            }}
                            title={`${r.title} (recorded)`}
                          />
                        ))}
                        {gridBlocks.map((block) => {
                          const [sH, sM] = block.startTime.split(':').map(Number);
                          const [eH, eM] = block.endTime.split(':').map(Number);

                          const startAbsMins = sH * 60 + (sM || 0);
                          const endAbsMins = eH * 60 + (eM || 0);
                          const effectiveEnd = endAbsMins < startAbsMins ? 24 * 60 : endAbsMins;
                          const durationMins = Math.max(20, effectiveEnd - startAbsMins);

                          const top = minutesToY(startAbsMins, START_HOUR, hourHeight);
                          // Same rule as day view: real duration, readable floor,
                          // capped at the next event sharing this card's columns.
                          const naturalHeight = (durationMins / 60) * hourHeight - WEEK_EVENT_GAP_PX;
                          const horizon = nextSharedHorizon(block.id, gridBlocks, colLayout);
                          const horizonHeight = ((horizon - startAbsMins) / 60) * hourHeight - WEEK_EVENT_GAP_PX;
                          const height = Math.max(2, Math.min(Math.max(WEEK_MIN_EVENT_HEIGHT, naturalHeight), horizonHeight));

                          const mode = modes.find((m) => m.id === block.modeId);
                          const blockColor = block.modeColor || mode?.color || currentTheme.accent;
                          const place = colLayout[block.id] || { left: 0, width: 1, lane: 0, span: 1, lanes: 1 };
                          const compactWeek = height < 44;
                          const cycleTask = block.taskId ? (tasks || []).find((t) => t.id === block.taskId) : null;
                          const cycleDone =
                            block.status === 'completed' ||
                            (block.cycleIndex != null && (cycleTask?.cyclesCompleted || 0) >= (block.cycleIndex || 0));
                          const weekLeft = `calc(${(place.left * 100).toFixed(4)}% + ${WEEK_EVENT_GAP_PX}px)`;
                          const weekWidth = `calc(${(place.width * 100).toFixed(4)}% - ${WEEK_EVENT_GAP_PX * 2}px)`;

                          return (
                            <div
                              key={block.id}
                              onClick={(e) => handleEditBlock(block, e)}
                              onPointerDown={(e) => startCardDrag(e, block, 'move')}
                              className={`absolute rounded-lg border ${compactWeek ? 'px-1 py-0.5' : 'p-1.5'} pointer-events-auto transition-transform duration-200 hover:scale-[1.01] hover:z-20 cursor-grab active:cursor-grabbing shadow-md overflow-hidden group flex flex-col justify-between`}
                              style={{
                                top: `${top}px`,
                                height: `${height}px`,
                                left: weekLeft,
                                width: weekWidth,
                                backgroundColor: isDark ? `${blockColor}22` : `${blockColor}18`,
                                borderColor: `${blockColor}45`,
                                boxShadow: `inset 2px 0 0 0 ${blockColor}`,
                                opacity: dragPreview?.blockId === block.id && dragPreview.mode !== 'create' ? 0.35 : cycleDone ? 0.6 : 1,
                              }}
                              title={
                                block.cycleIndex != null
                                  ? `Cycle ${block.cycleIndex}${block.cyclesTotal ? `/${block.cyclesTotal}` : ''}${cycleDone ? ' — done' : ''} · drag to move · edit on click`
                                  : 'Drag to move · Alt-drag to copy · edit on click'
                              }
                            >
                              {compactWeek ? (
                                <div className="flex items-center gap-1 h-full min-w-0">
                                  <span
                                    className="text-[9px] font-mono font-semibold shrink-0 opacity-80"
                                    style={{ color: currentTheme.textSecondary }}
                                  >
                                    {formatTime12h(block.startTime)}
                                  </span>
                                  <span
                                    className="text-[10px] font-bold block truncate"
                                    style={{ color: currentTheme.textPrimary }}
                                  >
                                    {stripDateSuffix(block.modeName)}
                                  </span>
                                </div>
                              ) : (
                              <div className="min-w-0">
                                <span 
                                  className="text-[11px] font-bold block truncate"
                                  style={{ color: currentTheme.textPrimary }}
                                >
                                  {stripDateSuffix(block.modeName)}
                                </span>
                                <span 
                                  className="text-[9px] font-mono block opacity-70"
                                  style={{ color: currentTheme.textSecondary }}
                                >
                                  {formatTime12h(block.startTime)}
                                </span>
                              </div>
                              )}
                              {/* Top-edge resize handle (drag to change start time) */}
                              {!compactWeek && (
                                <div
                                  onPointerDown={(e) => startCardDrag(e, block, 'resize-start')}
                                  className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity flex items-start justify-center pt-px z-10"
                                  title="Drag to change start time"
                                >
                                  <div className="w-5 h-1 rounded-full opacity-70" style={{ backgroundColor: blockColor }} />
                                </div>
                              )}
                              {/* Bottom-edge resize handle */}
                              <div
                                onPointerDown={(e) => startCardDrag(e, block, 'resize')}
                                className="absolute bottom-0 left-0 right-0 h-2.5 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-px z-10"
                                title="Drag to resize"
                              >
                                <div className="w-6 h-1 rounded-full opacity-70" style={{ backgroundColor: blockColor }} />
                              </div>
                            </div>
                          );
                        })}
                        {/* Drag ghost for this column */}
                        {dragPreview && dragPreview.date === col.dateStr && (
                          <div
                            className="absolute left-1 right-1 rounded-lg border-2 border-dashed pointer-events-none z-40 px-1.5 py-0.5 overflow-hidden"
                            style={{
                              top: `${minutesToY(dragPreview.start, START_HOUR, hourHeight)}px`,
                              height: `${Math.max(26, minutesToY(dragPreview.end, START_HOUR, hourHeight) - minutesToY(dragPreview.start, START_HOUR, hourHeight))}px`,
                              borderColor: currentTheme.accent,
                              backgroundColor: `${currentTheme.accent}2b`,
                            }}
                          >
                            <span className="text-[9px] font-mono font-bold block" style={{ color: currentTheme.textPrimary }}>
                              {formatTimeRange12h(minutesToHHMM(dragPreview.start), minutesToHHMM(dragPreview.end))}
                              {dragPreview.mode === 'create' ? ' · new' : ''}
                              {dragPreview.altCopy ? ' · copy' : ''}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* =========================================================================
              VIEW 3: PLAN VIEW (Markdown Day Plan + Templates)
              ========================================================================= */}
          {calendarView === 'plan' && (
            <div className="flex-1 flex flex-col min-h-full">
            <DayPlanMarkdownView
              date={selectedDate}
              theme={theme}
              vaultPath={obsidianConfig?.vaultPath}
              onOpenSettings={onOpenSettings}
              modes={modes}
              plans={plans}
              onGenerateSchedule={handleGenerateSchedule}
            />
            </div>
          )}
        </div>
      </div>

      {/* =========================================================================
          APPLE EVENT INSPECTOR SHEET (ADD / EDIT CONTROL BLOCK MODAL)
          ========================================================================= */}
      {/* Schedule-cycles modal: split one task into per-cycle planner blocks,
          each individually scheduled. */}
      {cycleModalTask && (() => {
        const task = cycleModalTask;
        const plan = taskCyclePlan(task);
        const m = modes.find((x) => x.id === cycleModalModeId);
        const noMode = !m;
        const work = Math.max(1, m?.workDuration ?? 25);
        const count = Math.max(1, Math.min(12, cycleModalCount));
        const gap = Math.max(0, cycleModalGap);
        const freeDuration = Math.max(1, Math.min(24 * 60, Math.round(cycleModalDuration) || 60));
        const startMins = hhmmToMinutes(cycleModalStart);
        const lastEnd = noMode
          ? startMins + freeDuration
          : startMins + (count - 1) * (work + gap) + work;
        const overflow = lastEnd > 24 * 60;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
            <div onClick={() => setCycleModalTask(null)} className="absolute inset-0 bg-black/40" />
            <div
              className="relative w-full max-w-md p-6 rounded-3xl border shadow-2xl z-10 space-y-4 animate-modal-in"
              style={{
                backgroundColor: isDark ? '#0e111a' : '#ffffff',
                borderColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)',
              }}
            >
              <div
                className="flex items-center justify-between pb-3 border-b"
                style={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}
              >
                <div className="flex items-center space-x-2">
                  <div className="w-6 h-6 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
                    <Layers className="w-3.5 h-3.5" />
                  </div>
                  <h2 className="text-sm font-bold tracking-tight" style={{ color: currentTheme.textPrimary }}>
                    {noMode ? 'Schedule Time in the Day' : 'Arrange Cycles in the Day'}
                  </h2>
                </div>
                <button
                  onClick={() => setCycleModalTask(null)}
                  className="p-1 hover:opacity-70 cursor-pointer"
                  style={{ color: currentTheme.textSecondary }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-[11px] leading-relaxed" style={{ color: currentTheme.textSecondary }}>
                <span className="font-bold" style={{ color: currentTheme.textPrimary }}>
                  {stripDateSuffix(task.title)}
                </span>
                {noMode
                  ? task.estimateMinutes
                    ? ` — estimated ${task.estimateMinutes}m.`
                    : ''
                  : plan.total > 1
                    ? ` — ${plan.done} of ${plan.total} cycles done, ${Math.max(0, plan.total - plan.done)} left.`
                    : ''}{' '}
                {noMode
                  ? 'No mode needed — this is just time on your calendar.'
                  : 'Each block below is one cycle, linked to the task and movable to its own time.'}
              </p>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="col-span-2">
                  <label className="text-[11px] font-mono uppercase block mb-1 font-semibold" style={{ color: currentTheme.textSecondary }}>
                    Mode (optional)
                  </label>
                  <select
                    value={cycleModalModeId}
                    onChange={(e) => setCycleModalModeId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl liquid-glass-input border text-xs font-semibold outline-none"
                    style={{ color: currentTheme.textPrimary }}
                  >
                    <option value="" className="bg-neutral-900 text-neutral-200">
                      No mode — free time block
                    </option>
                    {modes.map((mm) => (
                      <option key={mm.id} value={mm.id} className="bg-neutral-900 text-neutral-200">
                        {mm.name} ({mm.workDuration}m / {mm.breakDuration}m)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-mono uppercase block mb-1 font-semibold" style={{ color: currentTheme.textSecondary }}>
                    {noMode ? 'Start' : 'First Cycle'}
                  </label>
                  <input
                    type="time"
                    value={cycleModalStart}
                    onChange={(e) => setCycleModalStart(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl liquid-glass-input border text-xs font-mono font-bold outline-none"
                    style={{ color: currentTheme.textPrimary }}
                  />
                </div>

                {noMode ? (
                  <div>
                    <label className="text-[11px] font-mono uppercase block mb-1 font-semibold" style={{ color: currentTheme.textSecondary }}>
                      Duration (min)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={cycleModalDuration}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setCycleModalDuration(Number.isFinite(v) ? Math.max(1, Math.min(1440, v)) : 60);
                      }}
                      className="w-full px-2.5 py-2 rounded-xl liquid-glass-input border text-xs font-mono font-bold outline-none"
                      style={{ color: currentTheme.textPrimary }}
                    />
                  </div>
                ) : (
                  <div>
                    <label className="text-[11px] font-mono uppercase block mb-1 font-semibold" style={{ color: currentTheme.textSecondary }}>
                      Gap (min)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={cycleModalGap}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setCycleModalGap(Number.isFinite(v) ? Math.max(0, Math.min(120, v)) : 0);
                      }}
                      className="w-full px-2.5 py-2 rounded-xl liquid-glass-input border text-xs font-mono font-bold outline-none"
                      style={{ color: currentTheme.textPrimary }}
                    />
                  </div>
                )}
              </div>

              {!noMode && (
                <div className="p-3 rounded-2xl liquid-glass border flex items-center justify-between">
                  <div className="min-w-0">
                    <span className="text-[11px] font-mono uppercase font-semibold block" style={{ color: currentTheme.textSecondary }}>
                      Cycles to place
                    </span>
                    <span className="text-[10px] font-mono" style={{ color: currentTheme.textMuted }}>
                      {work}m each · {plan.remaining} unplaced
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => setCycleModalCount((c) => Math.max(1, c - 1))}
                      className="w-7 h-7 rounded-lg liquid-glass border text-sm font-bold cursor-pointer hover:bg-white/10"
                      style={{ color: currentTheme.textPrimary }}
                    >
                      −
                    </button>
                    <span className="w-8 text-center font-mono font-bold text-sm" style={{ color: currentTheme.textPrimary }}>
                      {count}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCycleModalCount((c) => Math.min(12, c + 1))}
                      className="w-7 h-7 rounded-lg liquid-glass border text-sm font-bold cursor-pointer hover:bg-white/10"
                      style={{ color: currentTheme.textPrimary }}
                    >
                      +
                    </button>
                  </div>
                </div>
              )}

              <div
                className="p-2.5 rounded-xl liquid-glass border text-[11px] leading-relaxed"
                style={{ color: overflow ? '#f43f5e' : currentTheme.textSecondary }}
              >
                {overflow
                  ? "Doesn't fit before midnight — start earlier, place fewer cycles, or shrink the gap."
                  : noMode
                    ? `Free block from ${formatTime12h(cycleModalStart)} to ${minutesToHHMM(lastEnd)}. No timer, no blocking — it just marks the time.`
                    : `${count} block${count === 1 ? '' : 's'} from ${formatTime12h(cycleModalStart)} to ${minutesToHHMM(lastEnd)}. Blocking starts automatically when each cycle's time arrives.`}
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setCycleModalTask(null)}
                  className="px-4 py-2 rounded-xl liquid-glass border text-xs font-semibold hover:bg-white/10 cursor-pointer"
                  style={{ color: currentTheme.textSecondary }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmScheduleCycles}
                  disabled={overflow}
                  className={`px-5 py-2 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer text-white ${overflow ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-110 active:scale-95'}`}
                  style={{ backgroundColor: '#007aff' }}
                >
                  {noMode ? 'Add Block' : `Add ${count} Cycle${count === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
          <div 
            onClick={() => setIsEditModalOpen(false)}
            className="absolute inset-0 bg-transparent transition-opacity"
          />

          <div 
            className="relative w-full max-w-md p-6 rounded-3xl border shadow-2xl z-10 space-y-4 animate-modal-in"
            style={{
              backgroundColor: isDark ? '#0e111a' : '#ffffff',
              borderColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.12)',
            }}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b"
              style={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}
            >
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
                  <CalendarIcon className="w-3.5 h-3.5" />
                </div>
                <h2 
                  className="text-sm font-bold tracking-tight"
                  style={{ color: currentTheme.textPrimary }}
                >
                  {editingBlockId ? 'Edit Control Block' : 'Schedule Control Block'}
                </h2>
              </div>
              <button 
                onClick={() => setIsEditModalOpen(false)}
                className="p-1 hover:opacity-70 cursor-pointer"
                style={{ color: currentTheme.textSecondary }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5">
              {/* Event Title */}
              <div>
                <label className="text-[11px] font-mono uppercase block mb-1 font-semibold" style={{ color: currentTheme.textSecondary }}>
                  Control Event Title
                </label>
                <input
                  type="text"
                  value={blockTitle}
                  onChange={(e) => setBlockTitle(e.target.value)}
                  placeholder="e.g. Proofs & Problem Set, SAT Reading Practice..."
                  className="w-full px-3.5 py-2.5 rounded-2xl liquid-glass-input border text-xs font-semibold outline-none"
                  style={{ color: currentTheme.textPrimary }}
                  autoFocus
                />
              </div>

              {/* Study Mode Selector (Apple colored dots) */}
              <div>
                <div className="flex items-center justify-between mb-1 gap-2">
                  <label className="text-[11px] font-mono uppercase font-semibold" style={{ color: currentTheme.textSecondary }}>
                    Control Calendar / Study Mode
                  </label>
                  <ModeViewToggle view={blockModeView} onChange={setBlockModeView} theme={theme} />
                </div>
                <div className={blockModeView === 'grid' ? 'grid grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1' : 'space-y-1.5 max-h-36 overflow-y-auto pr-1'}>
                  <button
                    type="button"
                    onClick={() => setBlockModeId('')}
                    className={`p-2 rounded-xl text-left border flex items-center space-x-2 transition-all cursor-pointer col-span-2 ${
                      !blockModeId
                        ? 'bg-sky-500/20 border-sky-500/50 shadow-sm'
                        : 'liquid-glass border hover:bg-white/5'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: currentTheme.textMuted }} />
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-bold block truncate" style={{ color: currentTheme.textPrimary }}>
                        No mode — just block the time
                      </span>
                      <span className="text-[10px] font-mono block opacity-60" style={{ color: currentTheme.textSecondary }}>
                        Free duration · no timer · no blocking
                      </span>
                    </div>
                  </button>
                  {modeListEntries.map(({ label, mode: m }) => {
                    const isSel = blockModeId === m.id;
                    const modeColor = m.color || currentTheme.accent;
                    return (
                      <React.Fragment key={m.id}>
                        {label && (
                          <div
                            className="col-span-2 text-[10px] font-mono font-bold uppercase tracking-wider pt-1"
                            style={{ color: currentTheme.textMuted }}
                          >
                            {label}
                          </div>
                        )}
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          handleEditorModeChange(m.id);
                          if (!blockTitle) setBlockTitle(m.name);
                        }}
                        className={`p-2 rounded-xl text-left border flex items-center space-x-2 transition-all cursor-pointer ${
                          isSel 
                            ? 'bg-sky-500/20 border-sky-500/50 shadow-sm' 
                            : 'liquid-glass border hover:bg-white/5'
                        }`}
                      >
                        <span 
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: modeColor }}
                        />
                        <div className="min-w-0 flex-1">
                          <span className="text-xs font-bold block truncate" style={{ color: currentTheme.textPrimary }}>
                            {m.name}
                          </span>
                          <span className="text-[10px] font-mono block opacity-60" style={{ color: currentTheme.textSecondary }}>
                            {m.workDuration}m / {m.breakDuration}m
                          </span>
                        </div>
                      </button>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>

              {/* Date & Time Range */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="text-[11px] font-mono uppercase block mb-1 font-semibold" style={{ color: currentTheme.textSecondary }}>
                    Date
                  </label>
                  <input
                    type="date"
                    value={blockDate}
                    onChange={(e) => setBlockDate(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl liquid-glass-input border text-xs font-mono font-bold outline-none"
                    style={{ color: currentTheme.textPrimary }}
                  />
                </div>

                <div>
                  <label className="text-[11px] font-mono uppercase block mb-1 font-semibold" style={{ color: currentTheme.textSecondary }}>
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={blockStartTime}
                    onChange={(e) => handleEditorStartChange(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl liquid-glass-input border text-xs font-mono font-bold outline-none"
                    style={{ color: currentTheme.textPrimary }}
                  />
                </div>

                <div>
                  <label className="text-[11px] font-mono uppercase block mb-1 font-semibold" style={{ color: currentTheme.textSecondary }}>
                    End Time
                  </label>
                  <input
                    type="time"
                    value={blockEndTime}
                    onChange={(e) => handleEditorEndChange(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl liquid-glass-input border text-xs font-mono font-bold outline-none"
                    style={{ color: currentTheme.textPrimary }}
                  />
                </div>
              </div>

              {/* Cycles ↔ duration (R-04): locked together so the planned event
                  can never claim a length the session will not run. Hidden for
                  mode-less blocks, which have no timer at all. */}
              {!editorMode && (
                <div className="p-2.5 rounded-xl liquid-glass border text-[11px] leading-relaxed" style={{ color: currentTheme.textSecondary }}>
                  <span className="font-bold" style={{ color: currentTheme.textPrimary }}>No mode.</span>{' '}
                  This is just planned time — it shows on the calendar and as a task (without a mode),
                  but starts no timer and blocks nothing. Set any start and end you like.
                </div>
              )}
              {editorMode && !editorIsChill && (() => {
                const editingBlk = editingBlockId ? blocks.find((b) => b.id === editingBlockId) : null;
                const isCycleBlock = !!editingBlk?.taskId;
                const w = Math.max(1, editorMode?.workDuration ?? 25);
                const b = Math.max(0, editorMode?.breakDuration ?? 0);
                if (isCycleBlock) {
                  return (
                    <div className="p-2.5 rounded-xl liquid-glass border text-[11px] leading-relaxed" style={{ color: currentTheme.textSecondary }}>
                      <span className="font-bold text-sky-400">
                        Task cycle {editingBlk?.cycleIndex ?? '?'}
                        {editingBlk?.cyclesTotal ? ` of ${editingBlk.cyclesTotal}` : ''}
                      </span>
                      {editingBlk?.taskTitle ? ` — ${stripDateSuffix(editingBlk.taskTitle)}` : ''}.{' '}
                      Fixed at one control cycle ({w}m focus), so the event length equals the session
                      exactly. The task resumes at its next unfinished cycle.
                    </div>
                  );
                }
                return (
                  <div className="p-3 rounded-2xl liquid-glass border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono uppercase font-semibold" style={{ color: currentTheme.textSecondary }}>
                        Control Cycles
                      </span>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => handleEditorCyclesStep(-1)}
                          className="w-7 h-7 rounded-lg liquid-glass border text-sm font-bold cursor-pointer hover:bg-white/10"
                          style={{ color: currentTheme.textPrimary }}
                        >
                          −
                        </button>
                        <span className="w-8 text-center font-mono font-bold text-sm" style={{ color: currentTheme.textPrimary }}>
                          {blockCycles}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleEditorCyclesStep(1)}
                          className="w-7 h-7 rounded-lg liquid-glass border text-sm font-bold cursor-pointer hover:bg-white/10"
                          style={{ color: currentTheme.textPrimary }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] font-mono leading-relaxed" style={{ color: currentTheme.textMuted }}>
                      {blockCycles > 1
                        ? `${blockCycles} × ${w}m focus + ${blockCycles - 1} × ${b}m break = ${sessionWallMinutes(w, b, blockCycles)}m. The event is snapped to this exact wall and the timer runs exactly this long.`
                        : `One honest cycle: the event's ${Math.max(1, hhmmToMinutes(blockEndTime) - hhmmToMinutes(blockStartTime))}m is one control block — no trailing break. The timer runs exactly this long.`}
                    </p>
                  </div>
                );
              })()}

              {/* Time Calculation Badge */}
              <div className="p-2.5 rounded-xl liquid-glass border flex items-center justify-between text-xs">
                <span className="opacity-70" style={{ color: currentTheme.textSecondary }}>Estimated Duration:</span>
                <span className="font-mono font-bold text-sky-400">
                  {formatTimeRange12h(blockStartTime, blockEndTime)}
                </span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="pt-2 flex items-center justify-between space-x-2">
              {editingBlockId ? (
                <button
                  type="button"
                  onClick={(e) => {
                    const blk = blocks.find((b) => b.id === editingBlockId);
                    if (blk) handleDeleteBlock(blk, e);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 hover:bg-rose-500/25 text-xs font-semibold cursor-pointer"
                >
                  Delete
                </button>
              ) : <div />}

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-xl liquid-glass border text-xs font-semibold hover:bg-white/10 cursor-pointer"
                  style={{ color: currentTheme.textSecondary }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveModalBlock}
                  className="px-5 py-2 rounded-xl text-xs font-bold transition-all hover:brightness-110 active:scale-95 shadow-md cursor-pointer text-white"
                  style={{
                    backgroundColor: '#007aff', // Apple Blue
                  }}
                >
                  {editingBlockId ? 'Update Event' : 'Add to Calendar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
