import { describe, expect, it } from 'vitest';
import {
  applyMoveToList,
  createRange,
  describeMove,
  hhmmToMinutes,
  layoutOverlappingBlocks,
  makeCopy,
  minutesToHHMM,
  minutesToY,
  moveRange,
  nextSharedHorizon,
  rangesOverlap,
  resizeRange,
  resizeStartRange,
  snapMinutes,
  toLocalDateStr,
  yToMinutes,
} from '../src/services/calendarGrid';
import { ScheduleBlock } from '../src/types';

function makeBlock(overrides: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id: 'b1',
    date: '2026-10-12',
    startTime: '09:00',
    endTime: '10:00',
    modeId: 'm',
    modeName: 'Deep Work',
    modeIcon: 'target',
    modeColor: '#38bdf8',
    workDuration: 48,
    breakDuration: 12,
    cycles: 1,
    status: 'approved',
    ...overrides,
  };
}

describe('toLocalDateStr', () => {
  it('formats local calendar dates without UTC shifts', () => {
    // Constructed from local components, so TZ-independent.
    expect(toLocalDateStr(new Date(2026, 9, 11, 0, 0))).toBe('2026-10-11');
    expect(toLocalDateStr(new Date(2026, 9, 11, 23, 59))).toBe('2026-10-11');
    expect(toLocalDateStr(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
    // Local midnight stays on the same date (toISOString would shift this
    // to the previous day in UTC+ timezones).
    const midnight = new Date(2026, 9, 12, 0, 0);
    midnight.setDate(midnight.getDate() - 1);
    expect(toLocalDateStr(midnight)).toBe('2026-10-11');
  });
});

describe('timeline coordinates', () => {
  it('event edges and the current-time line share one coordinate system', () => {
    // minutesToY is the single helper used by event cards, the red line and
    // the drag ghost: same minutes in → same pixels out, at any hour.
    for (const mins of [0, 60, 9 * 60 + 30, 14 * 60 + 5, 22 * 60 + 59]) {
      expect(minutesToY(mins, 6)).toBe(((mins - 360) / 60) * 68);
    }
    // 09:30 sits exactly halfway between the 09:00 and 10:00 rows.
    expect(minutesToY(570, 6)).toBe(minutesToY(540, 6) + 34);
    // Round-trips through pointer coordinates (grid top at clientY 0).
    expect(yToMinutes(minutesToY(663, 6), 0, 6)).toBeCloseTo(663, 8);
  });
});

describe('time math', () => {
  it('snaps to 15 minutes', () => {
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(532)).toBe(525);
    expect(snapMinutes(538)).toBe(540);
    expect(snapMinutes(548)).toBe(555);
  });

  it('converts HH:mm both ways', () => {
    expect(hhmmToMinutes('09:00')).toBe(540);
    expect(hhmmToMinutes('23:59')).toBe(1439);
    expect(minutesToHHMM(540)).toBe('09:00');
    expect(minutesToHHMM(0)).toBe('00:00');
    expect(minutesToHHMM(1439)).toBe('23:59');
    expect(minutesToHHMM(1440)).toBe('23:59');
    expect(minutesToHHMM(-5)).toBe('00:00');
  });

  it('maps pointer Y to minutes and back', () => {
    // Grid starts at 06:00, 68px/hour, top edge at clientY=200.
    expect(yToMinutes(200, 200, 6)).toBe(360);
    expect(yToMinutes(200 + 68, 200, 6)).toBe(420);
    expect(minutesToY(360, 6)).toBe(0);
    expect(minutesToY(420, 6)).toBe(68);
  });
});

describe('moveRange / resizeRange / createRange', () => {
  it('moves preserving duration', () => {
    expect(moveRange(540, 600, 60)).toEqual({ start: 600, end: 660 });
    expect(moveRange(540, 600, -60)).toEqual({ start: 480, end: 540 });
  });

  it('clamps moves inside the day', () => {
    expect(moveRange(60, 120, -500)).toEqual({ start: 0, end: 60 });
    expect(moveRange(1380, 1440, 500)).toEqual({ start: 1380, end: 1440 });
  });

  it('enforces minimum durations', () => {
    expect(moveRange(540, 545, 0)).toEqual({ start: 540, end: 555 });
    expect(resizeRange(540, 545)).toBe(555);
    expect(resizeRange(540, 900)).toBe(900);
    expect(resizeRange(540, 2000)).toBe(1440);
  });

  it('resizes the start (top handle) with a minimum duration', () => {
    expect(resizeStartRange(600, 540)).toBe(540);
    expect(resizeStartRange(600, 590)).toBe(585); // keeps a 15-minute block
    expect(resizeStartRange(600, -30)).toBe(0);
    expect(resizeStartRange(600, 1000)).toBe(585);
  });

  it('normalizes create drags in either direction', () => {
    expect(createRange(540, 660)).toEqual({ start: 540, end: 660 });
    expect(createRange(660, 540)).toEqual({ start: 540, end: 660 });
    expect(createRange(540, 545)).toEqual({ start: 540, end: 555 });
    expect(createRange(540, 540)).toEqual({ start: 540, end: 555 });
  });

  it('detects overlaps half-open', () => {
    expect(rangesOverlap(540, 600, 590, 660)).toBe(true);
    expect(rangesOverlap(540, 600, 600, 660)).toBe(false); // touching is fine
    expect(rangesOverlap(540, 600, 500, 540)).toBe(false);
    expect(rangesOverlap(540, 600, 500, 660)).toBe(true);
  });
});

describe('describeMove / applyMoveToList', () => {
  it('describes a move preserving duration', () => {
    const move = describeMove(makeBlock(), '2026-10-12', 660);
    expect(move).toEqual({
      fromDate: '2026-10-12',
      toDate: '2026-10-12',
      blockId: 'b1',
      startTime: '11:00',
      endTime: '12:00',
    });
  });

  it('describes cross-day moves', () => {
    const move = describeMove(makeBlock(), '2026-10-13', 660);
    expect(move.fromDate).toBe('2026-10-12');
    expect(move.toDate).toBe('2026-10-13');
  });

  it('applies a move to one date list only', () => {
    const list = [makeBlock(), makeBlock({ id: 'b2', startTime: '12:00', endTime: '13:00' })];
    const next = applyMoveToList(list, 'b1', '11:00', '12:00');
    expect(next[0].startTime).toBe('11:00');
    expect(next[0].endTime).toBe('12:00');
    expect(next[1].startTime).toBe('12:00'); // untouched
    expect(list[0].startTime).toBe('09:00'); // input immutable
  });
});

describe('layoutOverlappingBlocks', () => {
  const ev = (id: string, start: string, end: string) => ({ id, startTime: start, endTime: end });
  const full = { left: 0, width: 1, lane: 0, span: 1, lanes: 1 };

  it('gives full width to non-overlapping events', () => {
    const out = layoutOverlappingBlocks([ev('a', '09:00', '10:00'), ev('b', '11:00', '12:00')]);
    expect(out).toEqual({ a: full, b: full });
  });

  it('treats touching events as non-overlapping', () => {
    const out = layoutOverlappingBlocks([ev('a', '09:00', '10:00'), ev('b', '10:00', '11:00')]);
    expect(out).toEqual({ a: full, b: full });
  });

  it('places a simple overlapping pair side by side as halves', () => {
    const out = layoutOverlappingBlocks([ev('a', '09:00', '10:00'), ev('b', '09:30', '10:30')]);
    expect(out.a).toEqual({ left: 0, width: 0.5, lane: 0, span: 1, lanes: 2 });
    expect(out.b).toEqual({ left: 0.5, width: 0.5, lane: 1, span: 1, lanes: 2 });
  });

  it('clusters transitively and reuses freed columns', () => {
    // a and c never overlap each other, but both overlap b → one cluster.
    const out = layoutOverlappingBlocks([
      ev('a', '09:00', '10:00'),
      ev('b', '09:30', '10:30'),
      ev('c', '10:00', '11:00'),
    ]);
    expect(out.a).toEqual({ left: 0, width: 0.5, lane: 0, span: 1, lanes: 2 });
    expect(out.b).toEqual({ left: 0.5, width: 0.5, lane: 1, span: 1, lanes: 2 });
    expect(out.c).toEqual({ left: 0, width: 0.5, lane: 0, span: 1, lanes: 2 });
  });

  it('opens a third column only when three overlap at once', () => {
    const out = layoutOverlappingBlocks([
      ev('a', '09:00', '12:00'),
      ev('b', '09:30', '10:30'),
      ev('c', '10:00', '11:00'),
    ]);
    expect(out.a).toEqual({ left: 0, width: 1 / 3, lane: 0, span: 1, lanes: 3 });
    expect(out.b).toEqual({ left: 1 / 3, width: 1 / 3, lane: 1, span: 1, lanes: 3 });
    expect(out.c).toEqual({ left: 2 / 3, width: 1 / 3, lane: 2, span: 1, lanes: 3 });
  });

  it('expands an event across a column its neighbour has vacated', () => {
    // a and c stack in columns 1–2 for the first half hour; once c ends, b
    // (reusing a's column) grows right into the now-free column, reading wider
    // than a instead of being squeezed to a third.
    const out = layoutOverlappingBlocks([
      ev('e', '09:00', '10:00'),
      ev('a', '09:00', '09:30'),
      ev('c', '09:00', '09:30'),
      ev('b', '09:30', '10:00'),
    ]);
    expect(out.b).toEqual({ left: 1 / 3, width: 2 / 3, lane: 1, span: 2, lanes: 3 });
    expect(out.a).toEqual({ left: 1 / 3, width: 1 / 3, lane: 1, span: 1, lanes: 3 });
    expect(out.c).toEqual({ left: 2 / 3, width: 1 / 3, lane: 2, span: 1, lanes: 3 });
    expect(out.e).toEqual({ left: 0, width: 1 / 3, lane: 0, span: 1, lanes: 3 });
  });

  it('springs back to full width when an event overlaps nothing', () => {
    // b touches a on the boundary, so it forms its own cluster and takes the row.
    const out = layoutOverlappingBlocks([
      ev('a', '09:00', '09:30'),
      ev('c', '09:00', '09:15'),
      ev('d', '09:15', '09:30'),
      ev('b', '09:30', '10:00'),
    ]);
    expect(out.b).toEqual(full);
  });

  it('never lets events that overlap in time overlap horizontally', () => {
    const blocks = [
      ev('a', '09:00', '12:00'),
      ev('b', '09:00', '09:30'),
      ev('c', '09:15', '10:00'),
      ev('d', '10:00', '11:00'),
      ev('e', '11:00', '12:30'),
      ev('f', '12:00', '13:00'),
    ];
    const out = layoutOverlappingBlocks(blocks);
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const A = blocks[i];
        const B = blocks[j];
        const overlapsTime = rangesOverlap(
          hhmmToMinutes(A.startTime),
          hhmmToMinutes(A.endTime),
          hhmmToMinutes(B.startTime),
          hhmmToMinutes(B.endTime)
        );
        if (!overlapsTime) continue;
        const a = out[A.id];
        const b = out[B.id];
        const overlapsHoriz = a.left < b.left + b.width - 1e-9 && b.left < a.left + a.width - 1e-9;
        expect(overlapsHoriz).toBe(false);
      }
    }
  });

  it('keeps separate clusters independent', () => {
    const out = layoutOverlappingBlocks([
      ev('a', '09:00', '10:00'),
      ev('b', '09:30', '09:45'),
      ev('c', '14:00', '15:00'),
      ev('d', '14:30', '15:30'),
    ]);
    expect([out.a.lanes, out.b.lanes, out.c.lanes, out.d.lanes]).toEqual([2, 2, 2, 2]);
    expect(out.c.lane).not.toBe(out.d.lane);
  });

  it('gives point events inside another event a side column; invalid times get full width', () => {
    const out = layoutOverlappingBlocks([
      ev('zero', '09:00', '09:00'),
      ev('bad', 'nope', '10:00'),
      ev('ok', '09:00', '10:00'),
    ]);
    // Zero-length gets a one-minute effective interval, so it can't be covered.
    expect(out.zero).toEqual({ left: 0.5, width: 0.5, lane: 1, span: 1, lanes: 2 });
    expect(out.ok).toEqual({ left: 0, width: 0.5, lane: 0, span: 1, lanes: 2 });
    expect(out.bad).toEqual(full);
  });

  it('is deterministic regardless of input order', () => {
    const blocks = [ev('a', '09:00', '10:00'), ev('b', '09:30', '10:30'), ev('c', '09:45', '11:00')];
    const forward = layoutOverlappingBlocks(blocks);
    const backward = layoutOverlappingBlocks([...blocks].reverse());
    expect(backward).toEqual(forward);
  });

  it('clusters overnight events with the evening instead of covering everything', () => {
    // 22:00–06:00 occupies the rest of the visible day for layout.
    const out = layoutOverlappingBlocks([
      ev('night', '22:00', '06:00'),
      ev('late', '23:00', '23:30'),
      ev('morning', '09:00', '10:00'),
    ]);
    expect(out.night.lanes).toBe(2);
    expect(out.late.lanes).toBe(2);
    expect(out.night.lane).not.toBe(out.late.lane);
    expect(out.morning).toEqual(full);
  });

  it('splits same-start events into columns so none covers another', () => {
    const out = layoutOverlappingBlocks([
      ev('a', '09:00', '10:00'),
      ev('b', '09:00', '10:30'),
    ]);
    // The longer event keeps the left column.
    expect(out.b).toEqual({ left: 0, width: 0.5, lane: 0, span: 1, lanes: 2 });
    expect(out.a).toEqual({ left: 0.5, width: 0.5, lane: 1, span: 1, lanes: 2 });
  });

  it('splits same-start triples into thirds', () => {
    const out = layoutOverlappingBlocks([
      ev('a', '09:00', '10:00'),
      ev('b', '09:00', '10:00'),
      ev('c', '09:00', '10:00'),
    ]);
    expect(new Set([out.a.lane, out.b.lane, out.c.lane])).toEqual(new Set([0, 1, 2]));
    expect(out.a.lanes).toBe(3);
    expect(out.a.width).toBeCloseTo(1 / 3, 8);
  });

  it('splits overlapping events into columns so none covers another', () => {
    const out = layoutOverlappingBlocks([
      ev('a', '09:00', '12:00'),
      ev('b', '09:30', '10:30'),
    ]);
    expect(out.a.left + out.a.width).toBeLessThanOrEqual(1);
    expect(out.b.left).toBe(0.5);
    expect(out.a.width).toBe(0.5);
  });

  it('gives identical point events distinct lanes', () => {
    const out = layoutOverlappingBlocks([
      ev('p1', '09:00', '09:00'),
      ev('p2', '09:00', '09:00'),
    ]);
    expect(out.p1.lanes).toBe(2);
    expect(out.p1.lane).not.toBe(out.p2.lane);
  });
});

describe('nextSharedHorizon', () => {
  const ev = (id: string, start: string, end: string) => ({ id, startTime: start, endTime: end });

  it('finds the next later event in the same column', () => {
    // Back-to-back 15-minute events sit in one full-width column.
    const blocks = [ev('a', '09:00', '09:15'), ev('b', '09:15', '09:30')];
    const out = layoutOverlappingBlocks(blocks);
    expect(nextSharedHorizon('a', blocks, out)).toBe(9 * 60 + 15);
    expect(nextSharedHorizon('b', blocks, out)).toBe(24 * 60);
  });

  it('ignores events that sit in a different horizontal column', () => {
    const blocks = [ev('a', '09:00', '10:00'), ev('b', '09:30', '10:30')];
    const out = layoutOverlappingBlocks(blocks);
    // a and b are side by side, so neither caps the other's height.
    expect(nextSharedHorizon('a', blocks, out)).toBe(24 * 60);
    expect(nextSharedHorizon('b', blocks, out)).toBe(24 * 60);
  });

  it('caps against the nearest of several later neighbours', () => {
    // Three stacked 15-minute events all share the full-width column; a is
    // capped by b (the nearest), b by c.
    const blocks = [
      ev('a', '09:00', '09:15'),
      ev('b', '09:15', '09:30'),
      ev('c', '09:30', '09:45'),
    ];
    const out = layoutOverlappingBlocks(blocks);
    expect(nextSharedHorizon('a', blocks, out)).toBe(9 * 60 + 15);
    expect(nextSharedHorizon('b', blocks, out)).toBe(9 * 60 + 30);
    expect(nextSharedHorizon('c', blocks, out)).toBe(24 * 60);
  });
});

describe('makeCopy', () => {
  it('duplicates without identity or Google linkage', () => {
    const src = makeBlock({
      id: 'orig',
      googleCalendarEventId: 'g1',
      googleEventETag: '"e"',
      googleCalendarId: 'primary',
      googleRaw: '{}',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
      originTemplate: 'Daily SAT',
      controlMode: false,
    });
    const copy = makeCopy(src, '2026-10-13', '14:00', '15:00', () => 'copy-1');
    expect(copy.id).toBe('copy-1');
    expect(copy.date).toBe('2026-10-13');
    expect(copy.startTime).toBe('14:00');
    expect(copy.modeName).toBe('Deep Work');
    expect(copy.status).toBe('approved');
    expect(copy.source).toBe('control');
    // Template prefs travel; sync linkage must not.
    expect(copy.originTemplate).toBe('Daily SAT');
    expect(copy.controlMode).toBe(false);
    expect(copy.googleCalendarEventId).toBeUndefined();
    expect(copy.googleEventETag).toBeUndefined();
    expect(copy.googleCalendarId).toBeUndefined();
    expect(copy.googleRaw).toBeUndefined();
    expect(copy.createdAt).toBeUndefined();
    expect(copy.updatedAt).toBeUndefined();
    expect(src.id).toBe('orig'); // input immutable
  });
});
