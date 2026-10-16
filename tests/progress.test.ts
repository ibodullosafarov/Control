import { describe, expect, it } from 'vitest';
import {
  allocateSessionMinutes,
  computeStreak,
  computeWeeklyDigest,
  localDayKey,
  minutesOnDay,
} from '../src/services/progress';
import type { ControlSession, TaskItem } from '../src/types';

function session(dayKey: string, mins: number, extra: Partial<ControlSession> = {}): ControlSession {
  return {
    id: `s-${dayKey}-${mins}-${Math.random().toString(36).slice(2, 6)}`,
    modeId: 'mode-deep-work',
    modeName: 'Deep Work',
    modeIcon: 'Brain',
    isChillMode: false,
    startTime: `${dayKey}T10:00:00`,
    endTime: `${dayKey}T11:00:00`,
    plannedWorkMinutes: mins,
    actualWorkMinutes: mins,
    plannedCycles: 1,
    completedCycles: 1,
    status: 'completed',
    countTowardStats: true,
    ...extra,
  } as ControlSession;
}

function task(id: string, extra: Partial<TaskItem> = {}): TaskItem {
  return {
    id,
    title: id,
    completed: false,
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

describe('localDayKey', () => {
  it('formats the wall-clock day', () => {
    expect(localDayKey(new Date(2026, 9, 14, 23, 30))).toBe('2026-10-14');
  });
});

describe('minutesOnDay', () => {
  it('sums minutes for the matching day only', () => {
    const sessions = [session('2026-10-14', 30), session('2026-10-14', 20), session('2026-10-13', 60)];
    expect(minutesOnDay(sessions, '2026-10-14')).toBe(50);
    expect(minutesOnDay(sessions, '2026-10-12')).toBe(0);
  });
});

describe('computeStreak', () => {
  const now = new Date(2026, 9, 14, 18, 0); // Wed Oct 14, local
  const day = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    return localDayKey(d);
  };

  it('counts consecutive goal-meeting days', () => {
    const sessions = [session(day(0), 130), session(day(1), 120), session(day(2), 200)];
    expect(computeStreak(sessions, 120, now)).toBe(3);
  });

  it('ignores days below the goal', () => {
    const sessions = [session(day(0), 130), session(day(1), 30)];
    expect(computeStreak(sessions, 120, now)).toBe(1);
  });

  it('extends through yesterday when today is unmet', () => {
    const sessions = [session(day(1), 150), session(day(2), 150)];
    expect(computeStreak(sessions, 120, now)).toBe(2);
  });

  it('returns 0 when neither today nor yesterday qualifies', () => {
    const sessions = [session(day(2), 150)];
    expect(computeStreak(sessions, 120, now)).toBe(0);
  });

  it('returns 0 for empty history or non-positive goals', () => {
    expect(computeStreak([], 120, now)).toBe(0);
    expect(computeStreak([session(day(0), 50)], 0, now)).toBe(0);
  });
});

describe('computeWeeklyDigest', () => {
  // Monday Oct 12 2026 .. Sunday Oct 18 2026; now = Wed Oct 14.
  const now = new Date(2026, 9, 14, 12, 0);

  it('buckets the Monday-start week and compares with the previous one', () => {
    const sessions = [
      session('2026-10-12', 60, { modeName: 'Deep Work', tasksCompleted: 2 }),
      session('2026-10-13', 30, { modeName: 'Study', tasksCompleted: 1 }),
      session('2026-10-05', 200, { modeName: 'Deep Work' }),
    ];
    const d = computeWeeklyDigest(sessions, now);
    expect(d.weekStart).toBe('2026-10-12');
    expect(d.weekMinutes).toBe(90);
    expect(d.prevWeekMinutes).toBe(200);
    expect(d.deltaPct).toBe(-55);
    expect(d.sessionsCount).toBe(2);
    expect(d.tasksCompleted).toBe(3);
    expect(d.activeDays).toBe(2);
    expect(d.dailyAvg).toBe(13);
    expect(d.bestDay).toEqual({ name: 'Monday', minutes: 60 });
    expect(d.topMode).toEqual({ name: 'Deep Work', minutes: 60 });
  });

  it('returns null delta when the previous week is empty', () => {
    const d = computeWeeklyDigest([session('2026-10-14', 25)], now);
    expect(d.deltaPct).toBeNull();
    expect(d.bestDay?.minutes).toBe(25);
  });

  it('handles an empty week', () => {
    const d = computeWeeklyDigest([], now);
    expect(d.weekMinutes).toBe(0);
    expect(d.bestDay).toBeNull();
    expect(d.topMode).toBeNull();
  });
});

describe('allocateSessionMinutes', () => {
  const summary = session('2026-10-14', 100, { id: 'sess-1', tasksCompleted: 2 });

  it('splits minutes evenly across completed session tasks', () => {
    const tasks = [
      task('a', { completed: true, sessionId: 'sess-1', controlMinutes: 10 }),
      task('b', { completed: true, sessionId: 'sess-1' }),
      task('c', { completed: false, sessionId: 'sess-1' }),
      task('d', { completed: true }),
    ];
    const out = allocateSessionMinutes(summary, tasks);
    expect(out.find((t) => t.id === 'a')?.controlMinutes).toBe(60);
    expect(out.find((t) => t.id === 'b')?.controlMinutes).toBe(50);
    expect(out.find((t) => t.id === 'c')?.controlMinutes).toBeUndefined();
    expect(out.find((t) => t.id === 'd')?.controlMinutes).toBeUndefined();
  });

  it('hands leftover minutes to the earliest tasks first', () => {
    const tasks = [
      task('a', { completed: true, sessionId: 'sess-1' }),
      task('b', { completed: true, sessionId: 'sess-1' }),
      task('c', { completed: true, sessionId: 'sess-1' }),
    ];
    const out = allocateSessionMinutes(session('2026-10-14', 100, { id: 'sess-1' }), tasks);
    expect(out.map((t) => t.controlMinutes)).toEqual([34, 33, 33]);
  });

  it('no-ops without minutes or matching tasks', () => {
    const tasks = [task('a', { completed: true, sessionId: 'sess-1' })];
    expect(allocateSessionMinutes(session('2026-10-14', 0, { id: 'sess-1' }), tasks)).toBe(tasks);
    expect(allocateSessionMinutes(session('2026-10-14', 50, { id: 'other' }), tasks)).toBe(tasks);
  });

  it('B-19: credits session tasks completed outside the timer UI', () => {
    const withIds = session('2026-10-14', 60, { id: 'sess-9', taskIds: ['q1', 'q2'] });
    const tasks = [
      task('q1', { completed: true }),
      task('q2', { completed: true }),
      task('unrelated', { completed: true }),
    ];
    const out = allocateSessionMinutes(withIds, tasks);
    expect(out.find((t) => t.id === 'q1')?.controlMinutes).toBe(30);
    expect(out.find((t) => t.id === 'q2')?.controlMinutes).toBe(30);
    expect(out.find((t) => t.id === 'unrelated')?.controlMinutes).toBeUndefined();
  });
});
