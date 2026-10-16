import { describe, expect, it } from 'vitest';
import {
  buildExamBlocks,
  daysUntil,
  examBurndown,
  examTotals,
  spreadMinutesAcrossDays,
} from '../src/services/exams';
import type { Exam } from '../src/types';

function makeExam(extra: Partial<Exam> = {}): Exam {
  return {
    id: 'exam-1',
    name: 'Biology Final',
    date: '2026-10-20',
    dailyMinutes: 60,
    modeId: 'mode-deep',
    createdAt: '2026-10-01T00:00:00.000Z',
    topics: [],
    ...extra,
  };
}

describe('daysUntil', () => {
  it('returns 0 for today', () => {
    expect(daysUntil('2026-10-14', new Date(2026, 9, 14, 18, 0))).toBe(0);
  });

  it('returns 1 for tomorrow regardless of time of day', () => {
    expect(daysUntil('2026-10-15', new Date(2026, 9, 14, 0, 0))).toBe(1);
    expect(daysUntil('2026-10-15', new Date(2026, 9, 14, 23, 59))).toBe(1);
  });

  it('returns negative values for past dates', () => {
    expect(daysUntil('2026-10-13', new Date(2026, 9, 14, 12, 0))).toBe(-1);
    expect(daysUntil('2026-10-10', new Date(2026, 9, 14, 12, 0))).toBe(-4);
  });

  it('counts across month boundaries (leap year Feb)', () => {
    // 2024 is a leap year: Feb 28 -> Mar 1 is 2 days.
    expect(daysUntil('2024-03-01', new Date(2024, 1, 28, 9, 0))).toBe(2);
    expect(daysUntil('2024-02-29', new Date(2024, 1, 28, 9, 0))).toBe(1);
  });
});

describe('spreadMinutesAcrossDays', () => {
  it('fits exactly when total matches capacity', () => {
    expect(spreadMinutesAcrossDays(120, '2026-10-14', '2026-10-16', 60)).toEqual([
      { day: '2026-10-14', minutes: 60 },
      { day: '2026-10-15', minutes: 60 },
    ]);
  });

  it('spills over capped days earliest-first with a partial tail', () => {
    expect(spreadMinutesAcrossDays(150, '2026-10-14', '2026-10-20', 60)).toEqual([
      { day: '2026-10-14', minutes: 60 },
      { day: '2026-10-15', minutes: 60 },
      { day: '2026-10-16', minutes: 30 },
    ]);
  });

  it('excludes the exam day itself', () => {
    const out = spreadMinutesAcrossDays(1000, '2026-10-14', '2026-10-15', 60);
    expect(out).toEqual([{ day: '2026-10-14', minutes: 60 }]);
  });

  it('truncates when capacity runs out before the exam', () => {
    const out = spreadMinutesAcrossDays(500, '2026-10-14', '2026-10-16', 60);
    expect(out).toEqual([
      { day: '2026-10-14', minutes: 60 },
      { day: '2026-10-15', minutes: 60 },
    ]);
  });

  it('returns [] for zero/negative/NaN totals or caps', () => {
    expect(spreadMinutesAcrossDays(0, '2026-10-14', '2026-10-16', 60)).toEqual([]);
    expect(spreadMinutesAcrossDays(-30, '2026-10-14', '2026-10-16', 60)).toEqual([]);
    expect(spreadMinutesAcrossDays(NaN, '2026-10-14', '2026-10-16', 60)).toEqual([]);
    expect(spreadMinutesAcrossDays(60, '2026-10-14', '2026-10-16', 0)).toEqual([]);
    expect(spreadMinutesAcrossDays(60, '2026-10-14', '2026-10-16', -10)).toEqual([]);
    expect(spreadMinutesAcrossDays(60, '2026-10-14', '2026-10-16', NaN)).toEqual([]);
  });

  it('returns [] when fromDay is on or after the exam', () => {
    expect(spreadMinutesAcrossDays(60, '2026-10-16', '2026-10-16', 60)).toEqual([]);
    expect(spreadMinutesAcrossDays(60, '2026-10-17', '2026-10-16', 60)).toEqual([]);
  });
});

describe('examTotals', () => {
  it('sums targets and logged minutes with remaining clamped per topic', () => {
    const exam = makeExam({
      topics: [
        { id: 't1', name: 'Cells', targetMinutes: 100, loggedMinutes: 30 },
        { id: 't2', name: 'Genetics', targetMinutes: 50, loggedMinutes: 80 },
      ],
    });
    expect(examTotals(exam)).toEqual({ target: 150, logged: 110, remaining: 70 });
  });

  it('clamps negative logged minutes to 0', () => {
    const exam = makeExam({
      topics: [{ id: 't1', name: 'Cells', targetMinutes: 100, loggedMinutes: -20 }],
    });
    expect(examTotals(exam)).toEqual({ target: 100, logged: 0, remaining: 100 });
  });

  it('returns zeros for an empty syllabus', () => {
    expect(examTotals(makeExam())).toEqual({ target: 0, logged: 0, remaining: 0 });
  });
});

describe('examBurndown', () => {
  const now = new Date(2026, 9, 14, 12, 0);

  it('reports onTrack when the daily need fits the budget', () => {
    const exam = makeExam({
      date: '2026-10-17', // 3 days left (exam day excluded from study days but included in divisor per spec)
      dailyMinutes: 60,
      topics: [{ id: 't1', name: 'Cells', targetMinutes: 90, loggedMinutes: 0 }],
    });
    expect(examBurndown(exam, now)).toEqual({
      daysLeft: 3,
      totalRemaining: 90,
      perDayNeeded: 30,
      onTrack: true,
    });
  });

  it('reports off-track when the daily need exceeds the budget', () => {
    const exam = makeExam({
      date: '2026-10-15', // 1 day left
      dailyMinutes: 60,
      topics: [{ id: 't1', name: 'Cells', targetMinutes: 120, loggedMinutes: 0 }],
    });
    expect(examBurndown(exam, now)).toEqual({
      daysLeft: 1,
      totalRemaining: 120,
      perDayNeeded: 120,
      onTrack: false,
    });
  });

  it('demands everything today when the exam is past but work remains', () => {
    const exam = makeExam({
      date: '2026-10-12',
      dailyMinutes: 60,
      topics: [{ id: 't1', name: 'Cells', targetMinutes: 45, loggedMinutes: 0 }],
    });
    expect(examBurndown(exam, now)).toEqual({
      daysLeft: -2,
      totalRemaining: 45,
      perDayNeeded: 45,
      onTrack: true,
    });
  });

  it('reports zero need when everything is done', () => {
    const exam = makeExam({
      date: '2026-10-20',
      dailyMinutes: 60,
      topics: [{ id: 't1', name: 'Cells', targetMinutes: 50, loggedMinutes: 50 }],
    });
    expect(examBurndown(exam, now)).toEqual({
      daysLeft: 6,
      totalRemaining: 0,
      perDayNeeded: 0,
      onTrack: true,
    });
  });
});

describe('buildExamBlocks', () => {
  const base = {
    modeId: 'mode-deep',
    modeName: 'Deep Work',
    startTime: '09:00',
    fromDay: '2026-10-14',
  };

  it('emits stable ids with correct end-time math and ordering', () => {
    const exam = makeExam({
      id: 'bio',
      name: 'Biology Final',
      date: '2026-10-16',
      dailyMinutes: 60,
      topics: [
        { id: 'cells', name: 'Cells', targetMinutes: 90, loggedMinutes: 0 },
        { id: 'genes', name: 'Genetics', targetMinutes: 30, loggedMinutes: 0 },
      ],
    });
    const blocks = buildExamBlocks({ exam, ...base });
    expect(blocks.map((b) => b.id)).toEqual([
      'exam-bio-cells-2026-10-14',
      'exam-bio-genes-2026-10-14',
      'exam-bio-cells-2026-10-15',
    ]);
    expect(blocks.map((b) => [b.date, b.workDuration, b.endTime])).toEqual([
      ['2026-10-14', 60, '10:00'],
      ['2026-10-14', 30, '09:30'],
      ['2026-10-15', 30, '09:30'],
    ]);
    // Second call is deterministic: same stable ids.
    const again = buildExamBlocks({ exam, ...base });
    expect(again.map((b) => b.id)).toEqual(blocks.map((b) => b.id));
  });

  it('computes endTime from startTime plus minutes (09:00 + 90m = 10:30)', () => {
    const exam = makeExam({
      date: '2026-10-15',
      dailyMinutes: 120,
      topics: [{ id: 't1', name: 'Cells', targetMinutes: 100, loggedMinutes: 10 }],
    });
    const blocks = buildExamBlocks({ exam, ...base });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].startTime).toBe('09:00');
    expect(blocks[0].endTime).toBe('10:30');
    expect(blocks[0].workDuration).toBe(90);
  });

  it('sets status, mode fields, and description on every block', () => {
    const exam = makeExam({
      date: '2026-10-15',
      dailyMinutes: 60,
      topics: [{ id: 't1', name: 'Cells', targetMinutes: 30, loggedMinutes: 0 }],
    });
    const blocks = buildExamBlocks({ exam, ...base });
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(b.status).toBe('proposed');
    expect(b.modeId).toBe('mode-deep');
    expect(b.modeName).toBe('Deep Work');
    expect(b.modeIcon).toBe('');
    expect(b.modeColor).toBe('');
    expect(b.breakDuration).toBe(0);
    expect(b.cycles).toBe(1);
    expect(b.description).toBe('Biology Final: Cells');
    expect(b.createdAt).toBeUndefined();
    expect(b.updatedAt).toBeUndefined();
  });

  it('skips topics with no remaining minutes', () => {
    const exam = makeExam({
      date: '2026-10-16',
      dailyMinutes: 60,
      topics: [
        { id: 'done', name: 'Done', targetMinutes: 50, loggedMinutes: 50 },
        { id: 'over', name: 'Over', targetMinutes: 20, loggedMinutes: 99 },
        { id: 'live', name: 'Live', targetMinutes: 30, loggedMinutes: 0 },
      ],
    });
    const blocks = buildExamBlocks({ exam, ...base });
    expect(blocks.map((b) => b.id)).toEqual(['exam-exam-1-live-2026-10-14']);
  });

  it('returns [] when there is no study window', () => {
    const exam = makeExam({
      date: '2026-10-14',
      dailyMinutes: 60,
      topics: [{ id: 't1', name: 'Cells', targetMinutes: 30, loggedMinutes: 0 }],
    });
    expect(buildExamBlocks({ exam, ...base })).toEqual([]);
  });
});
