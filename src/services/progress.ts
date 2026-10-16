import type { ControlSession, TaskItem } from '../types';

/** Local-calendar YYYY-MM-DD key (wall-clock day, not UTC). */
export function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Total controlled minutes per local day, splitting cross-midnight sessions at midnight. */
export function minutesByLocalDay(sessions: ControlSession[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of sessions) {
    if (!s.startTime) continue;
    const mins = s.actualWorkMinutes || 0;
    if (mins <= 0) continue;
    const start = new Date(s.startTime);
    const end = s.endTime ? new Date(s.endTime) : new Date(start.getTime() + mins * 60000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
      const k = localDayKey(start);
      map.set(k, (map.get(k) || 0) + mins);
      continue;
    }
    // Split proportionally across local days at midnight boundaries.
    let cursor = start.getTime();
    const totalMs = Math.max(1, end.getTime() - start.getTime());
    while (cursor < end.getTime()) {
      const d = new Date(cursor);
      const nextMidnight = new Date(d);
      nextMidnight.setHours(24, 0, 0, 0);
      const segEnd = Math.min(end.getTime(), nextMidnight.getTime());
      const share = mins * ((segEnd - cursor) / totalMs);
      const k = localDayKey(d);
      map.set(k, (map.get(k) || 0) + share);
      cursor = segEnd;
    }
  }
  // Round per-day totals to whole minutes, preserving the grand total.
  let grand = 0;
  const rounded = new Map<string, number>();
  map.forEach((v, k) => { const r = Math.round(v); rounded.set(k, r); grand += r; });
  return rounded;
}

/** Controlled minutes on one local day. */
export function minutesOnDay(sessions: ControlSession[], dayKey: string): number {
  return minutesByLocalDay(sessions).get(dayKey) || 0;
}

/**
 * Consecutive goal-meeting days ending today — with the usual grace rule:
 * when today hasn't met the goal yet, the streak counts through yesterday.
 */
export function computeStreak(
  sessions: ControlSession[],
  goalMinutes: number,
  now: Date = new Date()
): number {
  if (!goalMinutes || goalMinutes <= 0) return 0;
  const byDay = minutesByLocalDay(sessions);
  const qualifies = (k: string) => (byDay.get(k) || 0) >= goalMinutes;
  const cursor = new Date(now);
  if (!qualifies(localDayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!qualifies(localDayKey(cursor))) return 0;
  }
  let streak = 0;
  while (qualifies(localDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export interface WeeklyDigest {
  /** Local Monday of the reviewed week (YYYY-MM-DD). */
  weekStart: string;
  weekMinutes: number;
  prevWeekMinutes: number;
  /** Percent change vs previous week, or null when last week was 0. */
  deltaPct: number | null;
  sessionsCount: number;
  tasksCompleted: number;
  activeDays: number;
  /** Average controlled minutes across all 7 days. */
  dailyAvg: number;
  bestDay: { name: string; minutes: number } | null;
  topMode: { name: string; minutes: number } | null;
}

function startOfWeekMonday(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  c.setDate(c.getDate() - ((c.getDay() + 6) % 7));
  return c;
}

/** Monday-to-Sunday review of the week containing `now`, vs the week before. */
export function computeWeeklyDigest(
  sessions: ControlSession[],
  now: Date = new Date()
): WeeklyDigest {
  const start = startOfWeekMonday(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const prevStart = new Date(start);
  prevStart.setDate(prevStart.getDate() - 7);
  const inRange = (s: ControlSession, from: Date, to: Date) => {
    if (!s.startTime) return false;
    const t = new Date(s.startTime).getTime();
    return t >= from.getTime() && t < to.getTime();
  };
  const week = sessions.filter((s) => inRange(s, start, end));
  const prev = sessions.filter((s) => inRange(s, prevStart, start));

  const sum = (list: ControlSession[]) =>
    list.reduce((acc, s) => acc + (s.actualWorkMinutes || 0), 0);
  const weekMinutes = sum(week);
  const prevWeekMinutes = sum(prev);

  const byDay = new Map<string, number>();
  for (const s of week) {
    const k = localDayKey(new Date(s.startTime));
    byDay.set(k, (byDay.get(k) || 0) + (s.actualWorkMinutes || 0));
  }
  let bestDay: WeeklyDigest['bestDay'] = null;
  byDay.forEach((minutes, key) => {
    if (!bestDay || minutes > bestDay.minutes) {
      const [y, m, d] = key.split('-').map(Number);
      bestDay = {
        name: new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' }),
        minutes,
      };
    }
  });

  const byMode = new Map<string, number>();
  for (const s of week) {
    const name = s.modeName || 'Unknown';
    byMode.set(name, (byMode.get(name) || 0) + (s.actualWorkMinutes || 0));
  }
  let topMode: WeeklyDigest['topMode'] = null;
  byMode.forEach((minutes, name) => {
    if (!topMode || minutes > topMode.minutes) topMode = { name, minutes };
  });

  return {
    weekStart: localDayKey(start),
    weekMinutes,
    prevWeekMinutes,
    deltaPct:
      prevWeekMinutes > 0
        ? Math.round(((weekMinutes - prevWeekMinutes) / prevWeekMinutes) * 100)
        : null,
    sessionsCount: week.length,
    tasksCompleted: week.reduce((acc, s) => acc + (s.tasksCompleted || 0), 0),
    activeDays: byDay.size,
    dailyAvg: Math.round(weekMinutes / 7),
    bestDay,
    topMode,
  };
}

/**
 * Attribute a finished session's minutes to the tasks completed in it,
 * split evenly (leftover minutes go to the earliest tasks first).
 * Returns a new task array; no-ops when there is nothing to attribute.
 *
 * B-19: credit goes to completed tasks stamped with this session id OR
 * listed in the summary's taskIds (session tasks finished from the queue
 * view never got a sessionId stamp and previously earned zero minutes).
 *
 * S-16: when dwellSeconds are supplied (per-task work-phase dwell tracked
 * by the timer), minutes split proportionally instead of evenly. Falls
 * back to even split when dwell is missing.
 */
export function allocateSessionMinutes(
  summary: ControlSession,
  tasks: TaskItem[],
  dwellSeconds?: Record<string, number>
): TaskItem[] {
  const mins = Math.max(0, Math.round(summary.actualWorkMinutes || 0));
  if (mins === 0) return tasks;
  const inSession = new Set(summary.taskIds || []);
  const targets = tasks.filter(
    (t) => t.completed && (t.sessionId === summary.id || inSession.has(t.id))
  );
  if (targets.length === 0) return tasks;
  // Proportional split when dwell data exists and sums > 0.
  if (dwellSeconds) {
    const total = targets.reduce((a, t) => a + Math.max(0, dwellSeconds[t.id] || 0), 0);
    if (total > 0) {
      // Floor all but last, clamp at 0, give the remainder to the last
      // target in session order so shares always sum to mins and stay >= 0.
      const ordered = summary.taskIds?.length
        ? [...targets].sort((a, b) => (summary.taskIds as string[]).indexOf(a.id) - (summary.taskIds as string[]).indexOf(b.id))
        : targets;
      const shares = new Map<string, number>();
      let assigned = 0;
      ordered.forEach((t, i) => {
        if (i === ordered.length - 1) return;
        const share = Math.max(0, Math.floor((mins * Math.max(0, dwellSeconds[t.id] || 0)) / total));
        shares.set(t.id, share);
        assigned += share;
      });
      const lastShare = Math.max(0, mins - assigned);
      shares.set(ordered[ordered.length - 1].id, lastShare);
      return tasks.map((t) => {
        if (!shares.has(t.id)) return t;
        return { ...t, controlMinutes: (t.controlMinutes || 0) + (shares.get(t.id) || 0) };
      });
    }
  }
  const share = Math.floor(mins / targets.length);
  let remainder = mins - share * targets.length;
  // Remainder follows session order, not global task order.
  const orderIdx = (id: string) => {
    const i = summary.taskIds ? summary.taskIds.indexOf(id) : -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const ids = new Set(targets.map((t) => t.id));
  const remainderOrder = [...targets].sort((a, b) => orderIdx(a.id) - orderIdx(b.id)).map((t) => t.id);
  const extra = new Set(remainderOrder.slice(0, Math.max(0, remainder)));
  return tasks.map((t) => {
    if (!ids.has(t.id)) return t;
    return { ...t, controlMinutes: (t.controlMinutes || 0) + share + (extra.has(t.id) ? 1 : 0) };
  });
}
