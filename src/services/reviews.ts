import type { TaskItem, TaskReviewState } from '../types';

const MIN_INTERVAL = 1;
const MAX_INTERVAL = 365;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseDayKey(dayKey: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(dayKey: string, days: number): string {
  const d = parseDayKey(dayKey);
  d.setDate(d.getDate() + days);
  return formatDayKey(d);
}

function clampInterval(n: number): number {
  if (!Number.isFinite(n)) return MIN_INTERVAL;
  return Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.round(n)));
}

/**
 * Grade a review with a 1-5 quality score (SM-2 lite).
 * Success (quality >= 3) advances reps and grows the interval;
 * failure resets reps and restores a 1-day interval.
 * Pure: never mutates its input.
 */
export function gradeReview(
  prev: { intervalDays: number; reps: number } | undefined,
  quality: 1 | 2 | 3 | 4 | 5,
  todayDayKey: string
): TaskReviewState {
  if (quality < 3) {
    return { intervalDays: 1, dueDay: addDays(todayDayKey, 1), reps: 0 };
  }
  const repsAfter = (prev?.reps ?? 0) + 1;
  let intervalDays: number;
  if (repsAfter === 1) {
    intervalDays = 1;
  } else if (repsAfter === 2) {
    intervalDays = 3;
  } else {
    intervalDays = clampInterval((prev?.intervalDays ?? 1) * 2.2);
  }
  intervalDays = clampInterval(intervalDays);
  return { intervalDays, dueDay: addDays(todayDayKey, intervalDays), reps: repsAfter };
}

/** Review tasks due on or before `todayDayKey`, excluding completed ones. */
export function dueReviews(tasks: TaskItem[], todayDayKey: string): TaskItem[] {
  return tasks
    .filter((t) => !t.completed && t.review !== undefined && t.review.dueDay <= todayDayKey)
    .sort((a, b) => {
      if (a.review!.dueDay !== b.review!.dueDay) {
        return a.review!.dueDay < b.review!.dueDay ? -1 : 1;
      }
      return a.order - b.order;
    });
}

/** Attach fresh review state (due immediately) without mutating the task. */
export function startReviewing(task: TaskItem, todayDayKey: string): TaskItem {
  return {
    ...task,
    review: { intervalDays: 1, dueDay: todayDayKey, reps: 0 },
  };
}
