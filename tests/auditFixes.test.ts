import { describe, expect, it } from 'vitest';
import { allocateSessionMinutes, minutesByLocalDay } from '../src/services/progress';
import { formatMinutes, parseTimeMinutes } from '../src/services/scheduleTemplates';
import { resolveWorkCompletion } from '../src/services/sessionFlow';
import type { ControlSession, TaskItem } from '../src/types';

const base = (over: Partial<ControlSession>): ControlSession => ({
  id: 's1', modeId: 'm', modeName: 'Deep', modeIcon: 'x',
  isChillMode: false, startTime: new Date(2026, 9, 14, 10, 0).toISOString(),
  endTime: new Date(2026, 9, 14, 11, 0).toISOString(),
  plannedWorkMinutes: 60, actualWorkMinutes: 10, plannedCycles: 3,
  completedCycles: 3, status: 'completed', countTowardStats: true,
  ...over,
});
const task = (over: Partial<TaskItem>): TaskItem => ({
  id: 't', title: 'T', completed: true, order: 0, createdAt: new Date().toISOString(), ...over,
});

describe('audit regression', () => {
  it('D1: final work phase completes all cycles', () => {
    expect(resolveWorkCompletion(0, 1)).toBe('complete');
    expect(resolveWorkCompletion(2, 3)).toBe('complete');
    expect(resolveWorkCompletion(1, 3)).toBe('break');
  });
  it('D6: midnight never wraps to 00:00', () => {
    expect(formatMinutes(1440)).toBe('24:00');
    expect(parseTimeMinutes('24:00')).toBe(1440);
  });
  it('D7: attribution sums to mins, non-negative, session order', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })];
    const s = base({ actualWorkMinutes: 10, taskIds: ['c', 'b', 'a'] });
    const out = allocateSessionMinutes(s, tasks, { a: 1, b: 1, c: 1 });
    const vals = out.map((t) => t.controlMinutes || 0);
    expect(vals.reduce((x, y) => x + y, 0)).toBe(10);
    expect(vals.every((v) => v >= 0)).toBe(true);
    // even split remainder goes to session-first 'c'
    const even = allocateSessionMinutes(base({ actualWorkMinutes: 10, taskIds: ['c', 'b', 'a'] }), tasks);
    const byId = Object.fromEntries(even.map((t) => [t.id, t.controlMinutes]));
    expect(byId['c'] as number).toBeGreaterThanOrEqual(byId['a'] as number);
  });
  it('D9: cross-midnight splits across days', () => {
    const s = base({
      startTime: new Date(2026, 9, 14, 23, 30).toISOString(),
      endTime: new Date(2026, 9, 15, 0, 30).toISOString(),
      actualWorkMinutes: 60,
    });
    const m = minutesByLocalDay([s]);
    expect(m.get('2026-10-14') as number).toBe(30);
    expect(m.get('2026-10-15') as number).toBe(30);
  });
});
