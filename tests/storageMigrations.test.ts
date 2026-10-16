import { describe, expect, it } from 'vitest';
import { normalizeData } from '../src/services/storage';
import { INITIAL_APP_DATA } from '../src/services/defaultData';
import type { ControlAppData } from '../src/types';

function store(overrides: Partial<ControlAppData> = {}): ControlAppData {
  return { ...INITIAL_APP_DATA, ...overrides } as ControlAppData;
}

describe('load migrations (user-testing round)', () => {
  it('B-15: repairs mistyped blocklist domains without dropping entries', () => {
    const out = normalizeData(
      store({
        modes: [
          {
            ...INITIAL_APP_DATA.modes[0],
            id: 'm1',
            blocklist: ['youtube.com', 'chatgpt.com.com', 'claude.ai.com', 'gemini.google.com.com'],
          },
        ],
      })
    );
    expect(out.modes[0].blocklist).toEqual([
      'youtube.com',
      'chatgpt.com',
      'claude.ai',
      'gemini.google.com',
    ]);
  });

  it('B-17: repairs a dangling defaultModeId to the first surviving mode', () => {
    const out = normalizeData(
      store({
        modes: [{ ...INITIAL_APP_DATA.modes[0], id: 'm-kept' }],
        settings: { ...INITIAL_APP_DATA.settings, defaultModeId: 'mode-deleted' },
      })
    );
    expect(out.settings.defaultModeId).toBe('m-kept');
  });

  it('B-16: demotes an unblocked Break-named mode out of stats', () => {
    const out = normalizeData(
      store({
        modes: [
          { ...INITIAL_APP_DATA.modes[0], id: 'm-break', name: 'Break', blocklist: [], blockedApps: [], countTowardStats: true },
          { ...INITIAL_APP_DATA.modes[1], id: 'm-control', name: 'Control', blocklist: ['x.com'], countTowardStats: true },
        ],
      })
    );
    expect(out.modes.find((m) => m.id === 'm-break')?.countTowardStats).toBe(false);
    expect(out.modes.find((m) => m.id === 'm-control')?.countTowardStats).toBe(true);
  });

  it('B-16: converts break-mode control blocks to rest, leaves real meetings alone', () => {
    const mkBlock = (over: Record<string, unknown>) => ({
      id: 'b', date: '2026-10-11', startTime: '16:20', endTime: '16:30',
      modeId: 'm-break', modeName: 'Long Break', modeIcon: 'x', modeColor: '#fff',
      workDuration: 10, breakDuration: 0, cycles: 1, status: 'approved' as const,
      timerEnabled: true as const, ...over,
    });
    const out = normalizeData(
      store({
        modes: [
          { ...INITIAL_APP_DATA.modes[0], id: 'm-break', name: 'Break', blocklist: [], blockedApps: [] },
          { ...INITIAL_APP_DATA.modes[1], id: 'm-control', name: 'Control', blocklist: ['x.com'] },
        ],
        plans: {
          '2026-10-11': {
            date: '2026-10-11', goals: [], timeWindows: [], isApproved: true,
            updatedAt: '2026-10-11T00:00:00.000Z',
            blocks: [
              mkBlock({}),
              mkBlock({ id: 'b2', modeId: 'm-control', modeName: 'Lunch with team', startTime: '12:00', endTime: '13:00', workDuration: 60 }),
            ],
          },
        },
      })
    );
    const [rest, meeting] = out.plans['2026-10-11'].blocks;
    expect(rest.workDuration).toBe(0);
    expect(rest.breakDuration).toBe(10);
    expect(rest.timerEnabled).toBe(false);
    expect(meeting.workDuration).toBe(60);
    expect(meeting.timerEnabled).toBe(true);
  });

  it('B-18: sub-30 s sessions record zero actual minutes', () => {
    const out = normalizeData(
      store({
        sessions: [
          {
            id: 's1', modeId: 'm', modeName: 'M', modeIcon: 'x', isChillMode: false,
            startTime: '2026-10-14T12:34:50.194Z', endTime: '2026-10-14T12:34:53.934Z',
            plannedWorkMinutes: 90, actualWorkMinutes: 1, plannedCycles: 3,
            completedCycles: 0, status: 'completed', countTowardStats: true,
          },
        ],
      })
    );
    expect(out.sessions[0].actualWorkMinutes).toBe(0);
  });
});

describe('rename migration (Control → Control)', () => {
  it('renames pre-rename persisted fields: focusMinutes, block focusMode, minimalModeOnFocus', () => {
    // A genuine pre-rename store has the old keys and lacks the new ones.
    const legacySettings = {
      ...INITIAL_APP_DATA.settings, minimalModeOnFocus: false,
    } as unknown as Record<string, unknown>;
    delete legacySettings.minimalModeOnControl;
    const out = normalizeData(
      store({
        tasks: [
          { id: 't1', title: 'Math', completed: false, order: 0, createdAt: '2026-01-01', focusMinutes: 42 },
        ],
        plans: {
          '2026-10-16': {
            date: '2026-10-16', goals: [], timeWindows: [], isApproved: true,
            blocks: [
              { id: 'b1', date: '2026-10-16', startTime: '09:00', endTime: '10:00', modeId: 'm', modeName: 'M', modeIcon: 'x', modeColor: '#fff', workDuration: 45, breakDuration: 5, cycles: 1, status: 'approved', focusMode: true },
            ],
          },
        },
        settings: legacySettings as unknown as ControlAppData['settings'],
      } as unknown as Partial<ControlAppData>)
    );
    const task = out.tasks.find((t) => t.id === 't1') as unknown as Record<string, unknown>;
    expect(task.controlMinutes).toBe(42);
    expect(task.focusMinutes).toBeUndefined();
    const block = (out.plans['2026-10-16'].blocks[0] as unknown) as Record<string, unknown>;
    expect(block.controlMode).toBe(true);
    expect(block.focusMode).toBeUndefined();
    const settings = out.settings as unknown as Record<string, unknown>;
    expect(settings.minimalModeOnControl).toBe(false);
    expect(settings.minimalModeOnFocus).toBeUndefined();
  });
});
