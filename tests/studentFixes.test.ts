import { describe, expect, it } from 'vitest';
import { checkQuestionDensity, isLongBreakCycle, sessionWallMinutesFull } from '../src/services/sessionFlow';
import { generateDeterministicScheduleWithReport } from '../src/services/planner';
import { generateSchedule, parseScheduleTemplate } from '../src/services/scheduleTemplates';
import { allocateSessionMinutes } from '../src/services/progress';
import { wasClampedToMidnight } from '../src/services/calendarGrid';
import { INITIAL_MODES } from '../src/services/defaultData';

describe('S-01 density', () => {
  it('flags 50 questions in 20m', () => {
    expect(checkQuestionDensity(50, 'questions', 20)).not.toBeNull();
  });
  it('flags 150 questions in 30m', () => {
    expect(checkQuestionDensity(150, 'questions', 30)).not.toBeNull();
  });
  it('passes 10 questions in 52m', () => {
    expect(checkQuestionDensity(10, 'questions', 52)).toBeNull();
  });
});

describe('S-04 long breaks', () => {
  it('uses long break every N cycles with no trailing break', () => {
    expect(isLongBreakCycle(3, 4, 3, 20, 10)).toBe(20);
    expect(isLongBreakCycle(1, 4, 3, 20, 10)).toBe(10);
    expect(isLongBreakCycle(4, 4, 3, 20, 10)).toBe(0);
    // interval 2: breaks after cycles 1..3 -> short, long, short
    expect(sessionWallMinutesFull(25, 5, 4, 20, 2)).toBe(4 * 25 + 5 + 20 + 5);
  });
});

describe('S-05 planner adjustments', () => {
  it('reports shrink when goal exceeds window', () => {
    const rep = generateDeterministicScheduleWithReport('2026-10-15',
      [{ modeId: 'mode-deep-work', targetMinutes: 120 }],
      [{ start: '09:00', end: '10:00' }], INITIAL_MODES);
    expect(rep.blocks.length).toBeGreaterThan(0);
    expect(rep.adjustments.length).toBeGreaterThan(0);
  });
});

describe('S-01 template density warnings + S-14 fallback', () => {
  it('warns on dense template and unknown mode fallback', () => {
    const tpl = parseScheduleTemplate('dense', '# Dense\n## Math 50\nDuration: 20m\nQuestions: 50\nMode: Nope');
    expect(tpl.template).not.toBeNull();
    const res = generateSchedule(tpl.template!, { date: '2026-10-15', startTime: '09:00' }, { modes: INITIAL_MODES });
    expect(res.errors).toEqual([]);
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.warnings.join(' ')).toMatch(/dense|not found/i);
  });
});

describe('S-15 midnight clamp', () => {
  it('detects 24:00 clamp', () => {
    expect(wasClampedToMidnight(1440)).toBe(true);
    expect(wasClampedToMidnight(60)).toBe(false);
  });
});

describe('S-16 proportional attribution', () => {
  it('splits by dwell when provided', () => {
    const summary: any = { id: 's1', actualWorkMinutes: 60, taskIds: ['a', 'b'] };
    const tasks: any[] = [
      { id: 'a', completed: true, sessionId: 's1', controlMinutes: 0 },
      { id: 'b', completed: true, sessionId: 's1', controlMinutes: 0 },
    ];
    const out = allocateSessionMinutes(summary, tasks, { a: 5400, b: 1800 });
    const a = out.find((t) => t.id === 'a')!;
    const b = out.find((t) => t.id === 'b')!;
    expect(a.controlMinutes).toBeGreaterThan(b.controlMinutes!);
    expect(a.controlMinutes! + b.controlMinutes!).toBe(60);
  });
  it('falls back to even split without dwell', () => {
    const summary: any = { id: 's1', actualWorkMinutes: 60, taskIds: ['a', 'b'] };
    const tasks: any[] = [
      { id: 'a', completed: true, sessionId: 's1', controlMinutes: 0 },
      { id: 'b', completed: true, sessionId: 's1', controlMinutes: 0 },
    ];
    const out = allocateSessionMinutes(summary, tasks);
    expect(out.find((t) => t.id === 'a')!.controlMinutes).toBe(30);
  });
});
