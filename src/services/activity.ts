import type { ActivitySample, StudyMode, TaskItem } from '../types';

export interface AppUsage {
  app: string;
  minutes: number;
}

/** One occupied minute of the UI timeline (`start` is local HH:mm). */
export interface DayTimelineBucket {
  start: string;
  app: string;
}

export interface Attribution {
  taskId?: string;
  modeId?: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local-calendar YYYY-MM-DD key (wall-clock day, not UTC). */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function floorToMinute(t: number): number {
  const d = new Date(t);
  d.setSeconds(0, 0);
  return d.getTime();
}

/**
 * One entry per occupied minute of the local day: samples are floored to
 * the minute with last-sample-wins dedupe, sorted ascending.
 */
export function timelineByDay(samples: ActivitySample[], dayKey: string): DayTimelineBucket[] {
  const byMinute = new Map<number, string>();
  for (const s of samples) {
    if (localDayKey(new Date(s.t)) !== dayKey) continue;
    byMinute.set(floorToMinute(s.t), s.app);
  }
  return [...byMinute.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([minute, app]) => ({ start: formatTime(new Date(minute)), app }));
}

/** Minutes per app for the local day (one minute = one deduped bucket). */
export function usageByApp(samples: ActivitySample[], dayKey: string): AppUsage[] {
  const counts = new Map<string, number>();
  for (const bucket of timelineByDay(samples, dayKey)) {
    counts.set(bucket.app, (counts.get(bucket.app) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([app, minutes]) => ({ app, minutes }))
    .sort((a, b) => b.minutes - a.minutes || (a.app < b.app ? -1 : a.app > b.app ? 1 : 0));
}

function significantWords(title: string): string[] {
  const seen = new Set<string>();
  for (const part of title.toLowerCase().split(/[^a-z0-9]+/)) {
    if (part.length >= 4 && !seen.has(part)) seen.add(part);
  }
  return [...seen];
}

/**
 * Attribute a frontmost-app name to a mode or task.
 * Modes win: case-insensitive containment either direction, ignoring
 * matches where the shorter side is under 4 chars. Otherwise the
 * uncompleted task sharing the most distinct significant title words
 * (length >= 4) with the app name wins; ties go to the lowest order.
 */
export function attributeApp(
  app: string,
  tasks: TaskItem[],
  modes: StudyMode[]
): Attribution {
  const a = app.trim().toLowerCase();
  if (a.length > 0) {
    for (const mode of modes) {
      const m = mode.name.trim().toLowerCase();
      if (m.length === 0) continue;
      if (Math.min(a.length, m.length) < 4) continue;
      if (a.includes(m) || m.includes(a)) {
        return { modeId: mode.id };
      }
    }
  }

  let best: TaskItem | null = null;
  let bestScore = 0;
  for (const task of tasks) {
    if (task.completed) continue;
    const words = significantWords(task.title);
    let score = 0;
    for (const w of words) {
      if (a.includes(w)) score += 1;
    }
    if (score > 0 && (score > bestScore || (score === bestScore && (best === null || task.order < best.order)))) {
      best = task;
      bestScore = score;
    }
  }
  if (best !== null) return { taskId: (best as TaskItem).id };
  return {};
}
