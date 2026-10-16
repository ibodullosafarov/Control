import { describe, expect, it } from 'vitest';
import { attributeApp, timelineByDay, usageByApp } from '../src/services/activity';
import type { ActivitySample, StudyMode, TaskItem } from '../src/types';

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

function mode(id: string, name: string): StudyMode {
  return {
    id,
    name,
    description: '',
    icon: 'Brain',
    color: '#000000',
    workDuration: 25,
    breakDuration: 5,
    cycles: 4,
    longBreakDuration: 15,
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
  };
}

// Fixed local timestamps: Wed Oct 14 2026.
const T_0900 = new Date(2026, 9, 14, 9, 0, 10).getTime();
const T_0900_LATE = new Date(2026, 9, 14, 9, 0, 50).getTime();
const T_0901 = new Date(2026, 9, 14, 9, 1, 5).getTime();
const T_0903 = new Date(2026, 9, 14, 9, 3, 0).getTime();
const T_OTHER_DAY = new Date(2026, 9, 13, 9, 0, 0).getTime();

function sample(t: number, app: string): ActivitySample {
  return { t, app };
}

describe('timelineByDay', () => {
  it('dedupes to one entry per minute with last-wins and sorts ascending', () => {
    const samples = [
      sample(T_0903, 'Xcode'),
      sample(T_0900, 'Safari'),
      sample(T_0900_LATE, 'Xcode'),
      sample(T_0901, 'Notes'),
    ];
    expect(timelineByDay(samples, '2026-10-14')).toEqual([
      { start: '09:00', app: 'Xcode' },
      { start: '09:01', app: 'Notes' },
      { start: '09:03', app: 'Xcode' },
    ]);
  });

  it('filters out samples from other local days', () => {
    const samples = [sample(T_OTHER_DAY, 'Xcode'), sample(T_0900, 'Safari')];
    expect(timelineByDay(samples, '2026-10-14')).toEqual([{ start: '09:00', app: 'Safari' }]);
    expect(timelineByDay(samples, '2026-10-13')).toEqual([{ start: '09:00', app: 'Xcode' }]);
  });

  it('returns an empty timeline without samples', () => {
    expect(timelineByDay([], '2026-10-14')).toEqual([]);
  });
});

describe('usageByApp', () => {
  it('sums deduped minutes per app sorted desc', () => {
    const samples = [
      sample(T_0900, 'Safari'),
      sample(T_0900_LATE, 'Xcode'),
      sample(T_0901, 'Xcode'),
      sample(T_0903, 'Safari'),
      sample(T_OTHER_DAY, 'Safari'),
    ];
    expect(usageByApp(samples, '2026-10-14')).toEqual([
      { app: 'Xcode', minutes: 2 },
      { app: 'Safari', minutes: 1 },
    ]);
  });

  it('returns an empty list for a day without samples', () => {
    expect(usageByApp([sample(T_0900, 'Xcode')], '2026-10-15')).toEqual([]);
  });
});

describe('attributeApp', () => {
  const modes = [mode('m-deep', 'Deep Work'), mode('m-mail', 'Email')];

  it('matches a mode name case-insensitively', () => {
    expect(attributeApp('deep work timer', [task('t1')], modes)).toEqual({ modeId: 'm-deep' });
    expect(attributeApp('Xcode', [task('t1', { title: 'Write Xcode notes' })], modes)).toEqual({
      taskId: 't1',
    });
  });

  it('matches when the app name is contained in the mode name', () => {
    expect(attributeApp('Mail', [], [mode('m-client', 'FastMail Client')])).toEqual({
      modeId: 'm-client',
    });
  });

  it('ignores substring matches shorter than 4 chars', () => {
    expect(attributeApp('Go', [], [mode('m-go', 'Go write code')])).toEqual({});
    expect(attributeApp('A', [], [mode('m-a', 'A')])).toEqual({});
  });

  it('attributes to the task sharing the most significant title words', () => {
    const tasks = [
      task('t-chem', { title: 'Write chemistry lab report', order: 0 }),
      task('t-math', { title: 'Study math', order: 1 }),
    ];
    expect(attributeApp('Chemistry Notes', tasks, [])).toEqual({ taskId: 't-chem' });
    expect(attributeApp('CHEMISTRY', tasks, [])).toEqual({ taskId: 't-chem' });
  });

  it('prefers modes over task titles', () => {
    const tasks = [task('t-deep', { title: 'Deep work planning', order: 0 })];
    expect(attributeApp('Deep Work', tasks, modes)).toEqual({ modeId: 'm-deep' });
  });

  it('breaks task ties by lowest order and skips completed tasks', () => {
    const tasks = [
      task('t-done', { title: 'Read chemistry notes', order: 0, completed: true }),
      task('t-b', { title: 'Read chemistry notes', order: 5 }),
      task('t-a', { title: 'Read chemistry notes', order: 2 }),
    ];
    expect(attributeApp('Chemistry reader', tasks, [])).toEqual({ taskId: 't-a' });
  });

  it('returns {} when nothing matches', () => {
    expect(attributeApp('Solitaire', [task('t1', { title: 'Study math' })], modes)).toEqual({});
    expect(attributeApp('Anything', [], [])).toEqual({});
  });

  it('ignores short title words', () => {
    const tasks = [task('t1', { title: 'Do the run', order: 0 })];
    expect(attributeApp('The Runner', tasks, [])).toEqual({});
  });
});
