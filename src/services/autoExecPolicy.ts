import { ControlAppData, ScheduleBlock, StudyMode } from '../types';

/**
 * Automatic study-day execution policy (pure, no Electron/Node APIs).
 *
 * Decides, from planner blocks + modes + persisted occurrence records,
 * which notifications to send and which control sessions to start/end — and
 * which occurrences to skip. The Electron service (`electron/autoexec.ts`)
 * executes these decisions (timers, Notification, renderer round-trips) and
 * persists the records; all branching rules live here so they are
 * deterministic and unit-testable with fake clocks.
 *
 * Safety principles encoded below:
 * - An occurrence is keyed `${blockId}|${date}|${startTime}`: rescheduling
 *   or deleting an event orphans the old key (pruned) and creates a fresh
 *   pending one. Stale occurrences can never fire.
 * - Notifications fire at most once and never for already-started windows.
 * - Starts happen only inside a short grace window after the start time;
 *   at most one start per reconcile (several missed → all skipped).
 * - The renderer re-validates at start time (active session wins); the
 *   scheduler never forces a session.
 */

export const DEFAULT_NOTIFY_LEAD_MINUTES = 5;
export const MIN_NOTIFY_LEAD_MINUTES = 1;
export const MAX_NOTIFY_LEAD_MINUTES = 120;
/** Start at most this long after the scheduled time (documented). */
export const MISSED_START_GRACE_MS = 10 * 60 * 1000;
/** Fallback reconciliation cadence for clock/timezone/sleep drift. */
export const RECONCILE_INTERVAL_MS = 60 * 1000;
/** Occurrence records older than this are pruned. */
export const RECORD_TTL_MS = 48 * 3600 * 1000;
/** How far ahead occurrences are materialized. */
export const DEFAULT_HORIZON_MS = 25 * 3600 * 1000;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface PolicyOccurrence {
  key: string;
  blockId: string;
  date: string;
  title: string;
  startTime: string;
  endTime: string;
  modeId: string;
  startAtMs: number;
  endAtMs: number;
  notifyAtMs: number;
}

export interface StoredOccurrence {
  notifiedAt?: string;
  startedAt?: string;
  endedAt?: string;
  skippedAt?: string;
  skipReason?: string;
  error?: string;
  blockingEnforced?: boolean;
  blockingError?: string;
}

/** Machine-local absolute timestamp (handles DST like the rest of Control). */
export function localDayMs(date: string, time: string): number | null {
  if (!DATE_RE.test(date)) return null;
  const tm = time.match(TIME_RE);
  if (!tm) return null;
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(y, mo - 1, d, parseInt(tm[1], 10), parseInt(tm[2], 10), 0, 0).getTime();
}

export function dayStrOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function occurrenceKey(blockId: string, date: string, startTime: string): string {
  return `${blockId}|${date}|${startTime}`;
}

export function getAutoExecSettings(data: ControlAppData): {
  enabled: boolean;
  notifyLeadMinutes: number;
} {
  const cfg = data.settings?.autoExecute;
  let lead = DEFAULT_NOTIFY_LEAD_MINUTES;
  if (typeof cfg?.notifyLeadMinutes === 'number' && Number.isFinite(cfg.notifyLeadMinutes)) {
    lead = Math.max(MIN_NOTIFY_LEAD_MINUTES, Math.min(MAX_NOTIFY_LEAD_MINUTES, Math.round(cfg.notifyLeadMinutes)));
  }
  return { enabled: cfg?.enabled === true, notifyLeadMinutes: lead };
}

function isEligible(block: ScheduleBlock, modes: StudyMode[]): boolean {
  if (block.allDay) return false;
  if (block.status !== 'proposed' && block.status !== 'approved' && block.status !== 'synced') return false;
  if (block.timerEnabled === false) return false;
  if (!block.modeId || !modes.some((m) => m.id === block.modeId)) return false;
  if (!TIME_RE.test(block.startTime || '') || !TIME_RE.test(block.endTime || '')) return false;
  return true;
}

/**
 * Materialize upcoming occurrences for today and tomorrow within the horizon.
 * Long-past occurrences are excluded (restart recovery marks them skipped via
 * `missedSkipReason` when their records exist; ancient ones need no record).
 */
export function computeOccurrences(
  data: ControlAppData,
  nowMs: number,
  horizonMs: number = DEFAULT_HORIZON_MS
): PolicyOccurrence[] {
  const { notifyLeadMinutes } = getAutoExecSettings(data);
  const modes = data.modes || [];
  const days = [dayStrOf(nowMs), dayStrOf(nowMs + 24 * 3600 * 1000)];
  const out: PolicyOccurrence[] = [];
  for (const date of days) {
    for (const block of data.plans?.[date]?.blocks || []) {
      if (!isEligible(block, modes)) continue;
      const startAtMs = localDayMs(date, block.startTime);
      const endAtMs = localDayMs(date, block.endTime);
      if (startAtMs === null || endAtMs === null) continue;
      if (endAtMs <= startAtMs) continue; // overnight unsupported for execution
      if (startAtMs < nowMs - MISSED_START_GRACE_MS - 6 * 3600 * 1000) continue;
      if (startAtMs > nowMs + horizonMs) continue;
      out.push({
        key: occurrenceKey(block.id, date, block.startTime),
        blockId: block.id,
        date,
        title: block.modeName || 'Scheduled session',
        startTime: block.startTime,
        endTime: block.endTime,
        modeId: block.modeId,
        startAtMs,
        endAtMs,
        notifyAtMs: startAtMs - notifyLeadMinutes * 60 * 1000,
      });
    }
  }
  out.sort((a, b) => a.startAtMs - b.startAtMs);
  return out;
}

export type DueKind = 'notify' | 'start' | 'end';

/** Which actions are due right now for one occurrence (idempotent). */
export function dueActions(
  occ: PolicyOccurrence,
  rec: StoredOccurrence | undefined,
  nowMs: number
): DueKind[] {
  const out: DueKind[] = [];
  if (!rec) {
    if (nowMs >= occ.notifyAtMs && nowMs < occ.startAtMs) out.push('notify');
    if (nowMs >= occ.startAtMs && nowMs - occ.startAtMs <= MISSED_START_GRACE_MS && nowMs < occ.endAtMs) {
      out.push('start');
    }
    return out;
  }
  if (rec.skippedAt || rec.error) return out;
  if (!rec.notifiedAt && nowMs >= occ.notifyAtMs && nowMs < occ.startAtMs) out.push('notify');
  if (
    !rec.startedAt &&
    nowMs >= occ.startAtMs &&
    nowMs - occ.startAtMs <= MISSED_START_GRACE_MS &&
    nowMs < occ.endAtMs
  ) {
    out.push('start');
  }
  if (rec.startedAt && !rec.endedAt && nowMs >= occ.endAtMs) out.push('end');
  return out;
}

/**
 * Terminal-skip reason when an occurrence can never run anymore, or null
 * when it is still actionable (or already terminal — callers check first).
 */
export function missedSkipReason(
  occ: PolicyOccurrence,
  rec: StoredOccurrence | undefined,
  nowMs: number
): string | null {
  if (!rec) {
    if (nowMs - occ.startAtMs > MISSED_START_GRACE_MS) return 'missed';
    return null;
  }
  if (rec.skippedAt || rec.startedAt || rec.error) return null;
  if (nowMs - occ.startAtMs > MISSED_START_GRACE_MS) return 'missed';
  return null;
}

/** Record keys safe to delete: vanished occurrences + ancient history. */
export function pruneKeys(
  records: Record<string, StoredOccurrence>,
  liveKeys: Set<string>,
  nowMs: number
): string[] {
  const out: string[] = [];
  for (const key of Object.keys(records)) {
    if (!liveKeys.has(key)) {
      out.push(key);
      continue;
    }
    const datePart = key.split('|')[1];
    if (datePart && DATE_RE.test(datePart)) {
      const dayMs = localDayMs(datePart, '00:00');
      if (dayMs !== null && nowMs - dayMs > RECORD_TTL_MS) out.push(key);
    }
  }
  return out;
}

/** Human reminder body, e.g. "Time to lock in. English 50 starts in 5 minutes." */
export function reminderBody(title: string, leadMinutes: number): string {
  const unit = leadMinutes === 1 ? 'minute' : 'minutes';
  return `Time to lock in. ${title} starts in ${leadMinutes} ${unit}.`;
}
