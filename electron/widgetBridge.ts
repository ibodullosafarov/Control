import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ControlAppData, ActiveSessionState, ControlSession, ScheduleBlock } from '../src/types';

/**
 * Bridges the app's state to the native macOS WidgetKit widgets.
 *
 * Widgets run in a separate, non-sandboxed extension process, so we publish a
 * small, stable JSON snapshot to a well-known path in the app's data dir that
 * the extension reads on its timeline tick. Keeping the schema in one file here
 * (and mirrored in macos/ControlWidgets/Sources/Shared/WidgetModels.swift) keeps
 * both sides in sync.
 */

const STATE_DIR = path.join(os.homedir(), '.control-app');
const STATE_FILE = path.join(STATE_DIR, 'widget-state.json');

/** Bump whenever the shape below changes in a breaking way. */
export const WIDGET_STATE_SCHEMA_VERSION = 1;

export interface WidgetSession {
  active: boolean;
  modeName: string;
  modeColor: string;
  phase: string;
  phaseLabel: string;
  isPaused: boolean;
  /** Epoch ms when the current phase ends, or null when paused/inactive. */
  endsAt: number | null;
  remainingSeconds: number;
  currentCycle: number;
  totalCycles: number;
  currentTask: string | null;
}

export interface WidgetBlock {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  modeName: string;
  color: string;
  status: string;
}

export interface WidgetStats {
  focusMinutesToday: number;
  cyclesToday: number;
  sessionsToday: number;
  streakDays: number;
}

export interface WidgetNote {
  text: string;
  updatedAt: string;
  taskTitle: string | null;
}

export interface WidgetState {
  schemaVersion: number;
  updatedAt: string;
  name: string;
  session: WidgetSession;
  today: { date: string; blocks: WidgetBlock[] };
  stats: WidgetStats;
  note: WidgetNote | null;
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local calendar date of an epoch-ms / ISO timestamp, or null if unparseable. */
function localDateOf(value: string | number | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return toLocalDateStr(d);
}

const PHASE_LABELS: Record<string, string> = {
  work: 'Focus',
  short_break: 'Short Break',
  long_break: 'Long Break',
  chill: 'Chill',
};

function buildSession(session: ActiveSessionState | null): WidgetSession {
  const empty: WidgetSession = {
    active: false,
    modeName: '',
    modeColor: '#8e8e93',
    phase: 'idle',
    phaseLabel: 'Idle',
    isPaused: false,
    endsAt: null,
    remainingSeconds: 0,
    currentCycle: 0,
    totalCycles: 0,
    currentTask: null,
  };
  if (!session) return empty;

  const now = Date.now();
  const phaseMs = Math.max(0, (session.phaseDurationSeconds || 0) * 1000);
  const pausedMs = Math.max(0, (session.totalPauseSecondsThisPhase || 0) * 1000);
  let endsAt: number | null = null;
  let remainingSeconds = 0;

  if (session.isPaused && session.pauseStartedAt) {
    const elapsedBeforePause = session.pauseStartedAt - session.phaseStartTime - pausedMs;
    remainingSeconds = Math.max(0, Math.round((phaseMs - elapsedBeforePause) / 1000));
  } else {
    const end = session.phaseStartTime + phaseMs + pausedMs;
    endsAt = end;
    remainingSeconds = Math.max(0, Math.round((end - now) / 1000));
  }

  return {
    active: true,
    modeName: session.modeName || 'Control',
    modeColor: session.modeColor || '#8e8e93',
    phase: session.phase || 'work',
    phaseLabel: PHASE_LABELS[session.phase] || 'Focus',
    isPaused: !!session.isPaused,
    endsAt,
    remainingSeconds,
    currentCycle: session.currentCycle || 0,
    totalCycles: session.totalCycles || 0,
    currentTask: null,
  };
}

function blockTitle(block: ScheduleBlock): string {
  const title = (block as { title?: string }).title;
  if (title && title.trim()) return title.trim();
  if (block.modeName && block.modeName.trim()) return block.modeName.trim();
  return 'Planned block';
}

function buildTodayBlocks(data: ControlAppData, today: string): WidgetBlock[] {
  const plan = data.plans?.[today];
  const blocks = plan?.blocks || [];
  return blocks
    .filter((b) => !b.allDay)
    .slice()
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((b) => ({
      id: b.id,
      title: blockTitle(b),
      startTime: b.startTime,
      endTime: b.endTime,
      modeName: b.modeName || '',
      color: b.modeColor || '#8e8e93',
      status: b.status || 'proposed',
    }));
}

function sessionMinutes(s: ControlSession): number {
  if (typeof s.actualWorkMinutes === 'number') return s.actualWorkMinutes;
  if (typeof s.wallMinutes === 'number') return s.wallMinutes;
  return 0;
}

function buildStats(data: ControlAppData, today: string): WidgetStats {
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const counted = sessions.filter((s) => s.countTowardStats !== false);

  let focusMinutesToday = 0;
  let cyclesToday = 0;
  let sessionsToday = 0;
  const activeDays = new Set<string>();

  for (const s of counted) {
    const date = localDateOf(s.startTime);
    if (!date) continue;
    if (sessionMinutes(s) > 0 || (s.completedCycles || 0) > 0) activeDays.add(date);
    if (date === today) {
      focusMinutesToday += sessionMinutes(s);
      cyclesToday += s.completedCycles || 0;
      sessionsToday += 1;
    }
  }

  // Fold in the in-progress session so the widget isn't stale mid-session.
  if (data.activeSession && data.activeSession.countTowardStats !== false) {
    focusMinutesToday += Math.round((data.activeSession.accumulatedWorkSeconds || 0) / 60);
    cyclesToday += data.activeSession.completedCyclesCount || 0;
  }

  // Streak: consecutive days ending today (or yesterday if today has none yet).
  let streakDays = 0;
  const cursor = new Date(`${today}T00:00:00`);
  if (!activeDays.has(toLocalDateStr(cursor))) cursor.setDate(cursor.getDate() - 1);
  for (;;) {
    const key = toLocalDateStr(cursor);
    if (activeDays.has(key)) {
      streakDays += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  return {
    focusMinutesToday: Math.max(0, Math.round(focusMinutesToday)),
    cyclesToday: Math.max(0, cyclesToday),
    sessionsToday,
    streakDays,
  };
}

function buildNote(data: ControlAppData): WidgetNote | null {
  const notes = Array.isArray(data.notes) ? data.notes : [];
  if (!notes.length) return null;
  const latest = notes
    .slice()
    .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''))[0];
  if (!latest?.content?.trim()) return null;
  return {
    text: latest.content.trim().slice(0, 280),
    updatedAt: latest.updatedAt || latest.createdAt || '',
    taskTitle: latest.taskTitle || null,
  };
}

export function buildWidgetState(data: ControlAppData): WidgetState {
  const today = toLocalDateStr(new Date());
  const session = buildSession(data.activeSession);
  // Attach the active task title to the session snapshot (kept separate above
  // so buildSession stays free of task lookups).
  if (session.active) {
    if (data.activeSession?.activeTaskId) {
      const task = (data.tasks || []).find((t) => t.id === data.activeSession?.activeTaskId);
      session.currentTask = task?.title || null;
    } else if (data.activeSession?.taskIds?.length) {
      const remainingId = data.activeSession.taskIds.find(
        (id) => !(data.activeSession?.completedTaskIds || []).includes(id)
      ) || data.activeSession.taskIds[0];
      const task = (data.tasks || []).find((t) => t.id === remainingId);
      session.currentTask = task?.title || null;
    }
  }

  return {
    schemaVersion: WIDGET_STATE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    name: (data.settings?.userName || '').trim(),
    session,
    today: { date: today, blocks: buildTodayBlocks(data, today) },
    stats: buildStats(data, today),
    note: buildNote(data),
  };
}

/** Atomically write the widget snapshot. Never throws — widgets are best-effort. */
export function writeWidgetState(data: ControlAppData): boolean {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    const state = buildWidgetState(data);
    const tmp = `${STATE_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp, STATE_FILE);
    return true;
  } catch (err) {
    console.warn('Failed to write widget state:', err);
    return false;
  }
}

export { STATE_FILE as WIDGET_STATE_FILE };
