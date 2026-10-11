import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFY_LEAD_MINUTES,
  MISSED_START_GRACE_MS,
  computeOccurrences,
  dayStrOf,
  dueActions,
  getAutoExecSettings,
  localDayMs,
  missedSkipReason,
  occurrenceKey,
  pruneKeys,
  reminderBody,
  type PolicyOccurrence,
  type StoredOccurrence,
} from '../src/services/autoExecPolicy';
import { FocusAppData, ScheduleBlock, StudyMode, UserSettings } from '../src/types';

const NOON = (() => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.getTime();
})();
const TODAY = dayStrOf(NOON);

function makeMode(overrides: Partial<StudyMode> = {}): StudyMode {
  return {
    id: 'm1',
    name: 'Deep Work',
    description: 'd',
    icon: 'target',
    color: '#38bdf8',
    workDuration: 50,
    breakDuration: 10,
    cycles: 3,
    longBreakDuration: 20,
    longBreakInterval: 4,
    blocklist: [],
    blockedApps: [],
    allowlist: [],
    allowBreakWebsites: true,
    countTowardStats: true,
    isChillMode: false,
    blockingStrategy: 'none',
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeBlock(id: string, start: string, end: string, overrides: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id,
    date: TODAY,
    startTime: start,
    endTime: end,
    modeId: 'm1',
    modeName: `Block ${id}`,
    modeIcon: 'target',
    modeColor: '#38bdf8',
    workDuration: 50,
    breakDuration: 10,
    cycles: 1,
    status: 'approved',
    ...overrides,
  };
}

function makeData(
  blocks: ScheduleBlock[],
  settings: Partial<UserSettings> = {},
  modes: StudyMode[] = [makeMode()]
): FocusAppData {
  return {
    modes,
    sessions: [],
    tasks: [],
    activeSession: null,
    settings: {
      theme: 'serika',
      soundEnabled: true,
      soundVolume: 0.5,
      launchAtLogin: false,
      autoStartBreaks: true,
      autoStartWork: true,
      defaultModeId: 'm1',
      blockingEnabled: false,
      blockingStrategy: 'none',
      googleCalendar: { connected: false, calendarId: 'primary' },
      minimalModeOnFocus: false,
      autoExecute: { enabled: true, notifyLeadMinutes: 5 },
      ...settings,
    } as UserSettings,
    plans: { [TODAY]: { date: TODAY, goals: [], timeWindows: [], blocks, isApproved: true, updatedAt: '' } },
  };
}

function occAt(startMin: number, durMin = 60, id = 'b1'): PolicyOccurrence {
  const h = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const startAtMs = localDayMs(TODAY, h(startMin))!;
  return {
    key: occurrenceKey(id, TODAY, h(startMin)),
    blockId: id,
    date: TODAY,
    title: `Block ${id}`,
    startTime: h(startMin),
    endTime: h(startMin + durMin),
    modeId: 'm1',
    startAtMs,
    endAtMs: startAtMs + durMin * 60_000,
    notifyAtMs: startAtMs - 5 * 60_000,
  };
}

describe('settings + keys', () => {
  it('defaults to disabled with a 5 minute lead', () => {
    const s = getAutoExecSettings(makeData([], { autoExecute: undefined }));
    expect(s).toEqual({ enabled: false, notifyLeadMinutes: DEFAULT_NOTIFY_LEAD_MINUTES });
  });

  it('clamps the lead time into range', () => {
    expect(getAutoExecSettings(makeData([], { autoExecute: { enabled: true, notifyLeadMinutes: 0 } })).notifyLeadMinutes).toBe(1);
    expect(getAutoExecSettings(makeData([], { autoExecute: { enabled: true, notifyLeadMinutes: 500 } })).notifyLeadMinutes).toBe(120);
  });

  it('builds stable keys that change with reschedules', () => {
    expect(occurrenceKey('b', '2026-10-12', '09:00')).toBe('b|2026-10-12|09:00');
    expect(occurrenceKey('b', '2026-10-12', '10:00')).not.toBe(occurrenceKey('b', '2026-10-12', '09:00'));
  });

  it('computes local absolute timestamps', () => {
    const ms = localDayMs(TODAY, '09:30')!;
    const d = new Date(ms);
    expect([d.getHours(), d.getMinutes()]).toEqual([9, 30]);
    expect(dayStrOf(ms)).toBe(TODAY);
    expect(localDayMs('nope', '09:00')).toBeNull();
    expect(localDayMs(TODAY, '9am')).toBeNull();
  });
});

describe('computeOccurrences', () => {
  it('lists eligible blocks with absolute instants', () => {
    const occs = computeOccurrences(makeData([makeBlock('b1', '14:00', '15:00')]), NOON);
    expect(occs).toHaveLength(1);
    const [o] = occs;
    expect(o.startAtMs).toBe(localDayMs(TODAY, '14:00'));
    expect(o.endAtMs).toBe(localDayMs(TODAY, '15:00'));
    expect(o.notifyAtMs).toBe(localDayMs(TODAY, '14:00')! - 5 * 60_000);
  });

  it('skips completed, timer-disabled, all-day, unknown-mode and overnight blocks', () => {
    const blocks = [
      makeBlock('done', '14:00', '15:00', { status: 'completed' }),
      makeBlock('notimer', '14:00', '15:00', { timerEnabled: false }),
      makeBlock('allday', '00:00', '23:59', { allDay: true }),
      makeBlock('nomode', '14:00', '15:00', { modeId: 'ghost' }),
      makeBlock('night', '23:00', '22:00'),
    ];
    expect(computeOccurrences(makeData(blocks), NOON)).toEqual([]);
  });

  it('includes proposed and synced blocks, excludes far-future ones', () => {
    const blocks = [
      makeBlock('p', '14:00', '15:00', { status: 'proposed' }),
      makeBlock('s', '15:00', '16:00', { status: 'synced' }),
    ];
    expect(computeOccurrences(makeData(blocks), NOON)).toHaveLength(2);
    const far = localDayMs(TODAY, '14:00')! + 30 * 3600 * 1000;
    expect(computeOccurrences(makeData(blocks), NOON, 1000)).toEqual([]);
    void far;
  });
});

describe('dueActions', () => {
  const o = occAt(14 * 60);

  it('notifies in the lead window, once', () => {
    expect(dueActions(o, undefined, o.notifyAtMs)).toEqual(['notify']);
    expect(dueActions(o, undefined, o.startAtMs - 1000)).toEqual(['notify']);
    expect(dueActions(o, { notifiedAt: 'x' }, o.notifyAtMs + 1000)).toEqual([]);
    // Stale: window passed without notifying → no backlog notification.
    expect(dueActions(o, undefined, o.startAtMs + 1000)).toEqual(['start']);
  });

  it('starts at the scheduled time and inside the grace window', () => {
    expect(dueActions(o, { notifiedAt: 'x' }, o.startAtMs)).toEqual(['start']);
    expect(dueActions(o, undefined, o.startAtMs + MISSED_START_GRACE_MS)).toEqual(['start']);
    expect(dueActions(o, undefined, o.startAtMs + MISSED_START_GRACE_MS + 1)).toEqual([]);
    // A started occurrence never restarts.
    expect(dueActions(o, { notifiedAt: 'x', startedAt: 'y' }, o.startAtMs + 1000)).toEqual([]);
    // Skipped stays skipped.
    expect(dueActions(o, { skippedAt: 'z', skipReason: 'r' }, o.startAtMs)).toEqual([]);
  });

  it('does not start with no scheduled time left', () => {
    const short = occAt(14 * 60, 5);
    // 6 minutes late into a 5-minute event: grace remains but the event is over.
    expect(dueActions(short, undefined, short.startAtMs + 6 * 60_000)).toEqual([]);
  });

  it('ends a started session at the scheduled end', () => {
    expect(dueActions(o, { notifiedAt: 'x', startedAt: 'y' }, o.endAtMs)).toEqual(['end']);
    expect(dueActions(o, { notifiedAt: 'x', startedAt: 'y' }, o.endAtMs - 1000)).toEqual([]);
    expect(dueActions(o, { notifiedAt: 'x', startedAt: 'y', endedAt: 'z' }, o.endAtMs + 5000)).toEqual([]);
    // Never-started occurrences get no end action.
    expect(dueActions(o, undefined, o.endAtMs + 1000)).toEqual([]);
  });
});

describe('missedSkipReason + pruneKeys', () => {
  const o = occAt(14 * 60);

  it('skips long-past unstarted occurrences (restart/sleep recovery)', () => {
    expect(missedSkipReason(o, undefined, o.startAtMs + MISSED_START_GRACE_MS + 1)).toBe('missed');
    expect(missedSkipReason(o, undefined, o.startAtMs)).toBeNull();
    expect(missedSkipReason(o, { startedAt: 'x' }, o.startAtMs + 99999999)).toBeNull();
    expect(missedSkipReason(o, { skippedAt: 'x' }, o.startAtMs + 99999999)).toBeNull();
  });

  it('prunes vanished keys and ancient history', () => {
    const recs: Record<string, StoredOccurrence> = {
      'gone|2026-10-12|09:00': {},
      [`b1|${TODAY}|09:00`]: { startedAt: 'x', endedAt: 'y' },
      'old|x|09:00': {},
    };
    const pruned = pruneKeys(recs, new Set([`b1|${TODAY}|09:00`]), NOON);
    expect(pruned).toContain('gone|2026-10-12|09:00');
    expect(pruned).not.toContain(`b1|${TODAY}|09:00`);
  });
});

describe('reminderBody', () => {
  it('uses motivating wording with singular/plural lead', () => {
    expect(reminderBody('English 50', 5)).toBe('Time to lock in. English 50 starts in 5 minutes.');
    expect(reminderBody('English 50', 1)).toBe('Time to lock in. English 50 starts in 1 minute.');
  });
});
