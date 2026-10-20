import { describe, expect, it } from 'vitest';
import { clampCycles, fitCyclesToDuration, isSingleBlockMode, remainingTaskCycles, resolveSessionCycles, resolveWorkCompletion, sessionWallMinutes } from '../src/services/sessionFlow';

describe('resolveWorkCompletion', () => {
  it('completes a single-cycle mode right after its one work phase (no trailing break)', () => {
    expect(resolveWorkCompletion(0, 1)).toBe('complete');
  });

  it('runs breaks between cycles of multi-cycle modes, completing after the last', () => {
    expect(resolveWorkCompletion(0, 3)).toBe('break');
    expect(resolveWorkCompletion(1, 3)).toBe('break');
    expect(resolveWorkCompletion(2, 3)).toBe('complete');
  });

  it('never invents extra cycles for degenerate totals', () => {
    // completedCyclesCount starts at 0 and only increments in production.
    expect(resolveWorkCompletion(0, 0)).toBe('complete');
    expect(resolveWorkCompletion(5, 3)).toBe('complete');
    expect(resolveWorkCompletion(0, -2)).toBe('complete');
  });
});

describe('isSingleBlockMode', () => {
  it('treats one-cycle modes as single blocks', () => {
    expect(isSingleBlockMode(1)).toBe(true);
    expect(isSingleBlockMode(undefined)).toBe(true);
  });

  it('leaves multi-cycle and chill modes alone', () => {
    expect(isSingleBlockMode(3)).toBe(false);
    expect(isSingleBlockMode(2)).toBe(false);
    expect(isSingleBlockMode(1, true)).toBe(false);
  });
});

describe('resolveSessionCycles', () => {
  const tasks = [
    { id: 'a', cycles: 2 },
    { id: 'b', cycles: 4 },
    { id: 'legacy' },
  ];

  it('prefers an explicit override over everything', () => {
    expect(resolveSessionCycles({ tasks, taskIds: ['b'], modeCycles: 3, overrideCycles: 5 })).toBe(5);
  });

  it('uses the strongest per-task choice among attached tasks', () => {
    expect(resolveSessionCycles({ tasks, taskIds: ['a', 'b'], modeCycles: 3 })).toBe(4);
    expect(resolveSessionCycles({ tasks, taskIds: ['a'], modeCycles: 3 })).toBe(2);
  });

  it('falls back to the mode for tasks without a choice', () => {
    expect(resolveSessionCycles({ tasks, taskIds: ['legacy'], modeCycles: 3 })).toBe(3);
    expect(resolveSessionCycles({ tasks, taskIds: [], modeCycles: 3 })).toBe(3);
  });

  it('never drops below one cycle', () => {
    expect(resolveSessionCycles({ tasks, taskIds: [], modeCycles: 0 })).toBe(1);
    expect(resolveSessionCycles({ tasks, taskIds: ['a'], modeCycles: 3, overrideCycles: 0 })).toBe(1);
  });
});

describe('remainingTaskCycles + resume', () => {
  it('subtracts already-done cycles so a resumed task picks up where it left off', () => {
    expect(remainingTaskCycles({ cycles: 8 })).toBe(8);
    expect(remainingTaskCycles({ cycles: 8, cyclesCompleted: 3 })).toBe(5);
    expect(remainingTaskCycles({ cycles: 8, cyclesCompleted: 99 })).toBe(1);
    expect(remainingTaskCycles({})).toBe(1);
  });

  it('resolveSessionCycles uses the REMAINING count, not the original total', () => {
    const t = [
      { id: 'resumed', cycles: 8, cyclesCompleted: 3 },
      { id: 'fresh', cycles: 4 },
      { id: 'legacy' },
    ];
    expect(resolveSessionCycles({ tasks: t, taskIds: ['resumed'], modeCycles: 3 })).toBe(5);
    expect(resolveSessionCycles({ tasks: t, taskIds: ['resumed', 'fresh'], modeCycles: 3 })).toBe(5);
    expect(resolveSessionCycles({ tasks: t, taskIds: ['resumed'], modeCycles: 3, overrideCycles: 1 })).toBe(1);
  });
});

describe('fitCyclesToDuration', () => {
  it('snaps an arbitrary wall length to the nearest whole cycle count', () => {
    // 25 work / 7 break: wall(c) = 25c + 7(c-1)
    expect(fitCyclesToDuration(25, 25, 7)).toBe(1);
    expect(fitCyclesToDuration(57, 25, 7)).toBe(2);
    expect(fitCyclesToDuration(64, 25, 7)).toBe(2);
    expect(fitCyclesToDuration(89, 25, 7)).toBe(3);
    expect(fitCyclesToDuration(10, 25, 7)).toBe(1); // never below one
    expect(fitCyclesToDuration(10000, 25, 7)).toBe(12); // clamped
  });
});

describe('clampCycles', () => {
  it('clamps into the 1..12 range', () => {
    expect(clampCycles(3)).toBe(3);
    expect(clampCycles(0)).toBe(1);
    expect(clampCycles(99)).toBe(12);
    expect(clampCycles('abc', 2)).toBe(2);
  });
});

describe('sessionWallMinutes', () => {
  it('sums control plus inter-cycle breaks with no trailing break', () => {
    expect(sessionWallMinutes(30, 7, 1)).toBe(30);
    expect(sessionWallMinutes(20, 5, 4)).toBe(4 * 20 + 3 * 5);
    expect(sessionWallMinutes(30, 7, 4)).toBe(4 * 30 + 3 * 7);
  });
});
