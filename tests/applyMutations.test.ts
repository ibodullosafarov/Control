import { describe, expect, it } from 'vitest';
import { applyMutationsToData, countMutationTargets } from '../src/services/googleSync';
import {
  DayPlan,
  ControlAppData,
  GoogleApplyMutations,
  ScheduleBlock,
  UserSettings,
} from '../src/types';

function makeBlock(id: string, date: string, startTime = '09:00'): ScheduleBlock {
  return {
    id,
    date,
    startTime,
    endTime: '10:00',
    modeId: 'mode-deep',
    modeName: 'Deep Work',
    modeIcon: 'target',
    modeColor: '#38bdf8',
    workDuration: 50,
    breakDuration: 10,
    cycles: 3,
    status: 'approved',
  };
}

function makePlan(date: string, blocks: ScheduleBlock[]): DayPlan {
  return {
    date,
    goals: [{ modeId: 'mode-deep', targetMinutes: 120 }],
    timeWindows: [],
    blocks,
    isApproved: true,
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

function makeData(plans: Record<string, DayPlan>): ControlAppData {
  return {
    modes: [],
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
      defaultModeId: 'mode-deep',
      blockingEnabled: false,
      blockingStrategy: 'none',
      googleCalendar: { connected: false, calendarId: 'primary' },
      minimalModeOnControl: false,
    } as UserSettings,
    plans,
  };
}

function mutations(partial: Partial<GoogleApplyMutations>): GoogleApplyMutations {
  return { requestId: 'req-1', upserts: [], removals: [], ...partial };
}

describe('applyMutationsToData', () => {
  it('returns the same reference when there is nothing to apply', () => {
    const data = makeData({});
    expect(applyMutationsToData(data, mutations({}))).toBe(data);
  });

  it('inserts a new block into the target plan, sorted by start time', () => {
    const data = makeData({
      '2026-10-09': makePlan('2026-10-09', [
        makeBlock('a', '2026-10-09', '08:00'),
        makeBlock('c', '2026-10-09', '12:00'),
      ]),
    });
    const next = applyMutationsToData(
      data,
      mutations({ upserts: [{ localId: 'b', date: '2026-10-09', block: makeBlock('b', '2026-10-09', '10:00') }] })
    );
    expect(next).not.toBe(data);
    expect(next.plans['2026-10-09'].blocks.map((b) => b.id)).toEqual(['a', 'b', 'c']);
    // Untouched plans keep their reference; goals are never touched.
    expect(next.plans['2026-10-09'].goals).toEqual(data.plans['2026-10-09'].goals);
  });

  it('creates the target plan when it does not exist', () => {
    const data = makeData({});
    const next = applyMutationsToData(
      data,
      mutations({ upserts: [{ localId: 'b', date: '2026-10-10', block: makeBlock('b', '2026-10-10') }] })
    );
    expect(next.plans['2026-10-10'].blocks.map((b) => b.id)).toEqual(['b']);
    expect(next.plans['2026-10-10'].date).toBe('2026-10-10');
  });

  it('replaces a same-date block in place', () => {
    const data = makeData({
      '2026-10-09': makePlan('2026-10-09', [
        makeBlock('a', '2026-10-09', '08:00'),
        makeBlock('b', '2026-10-09', '10:00'),
      ]),
    });
    const updated = { ...makeBlock('b', '2026-10-09', '10:00'), modeName: 'Renamed' };
    const next = applyMutationsToData(
      data,
      mutations({ upserts: [{ localId: 'b', date: '2026-10-09', block: updated }] })
    );
    expect(next.plans['2026-10-09'].blocks.map((b) => b.id)).toEqual(['a', 'b']);
    expect(next.plans['2026-10-09'].blocks[1].modeName).toBe('Renamed');
  });

  it('moves a block to a different date (drop + insert)', () => {
    const data = makeData({
      '2026-10-09': makePlan('2026-10-09', [makeBlock('b', '2026-10-09', '10:00')]),
      '2026-10-10': makePlan('2026-10-10', [makeBlock('z', '2026-10-10', '08:00')]),
    });
    const moved = { ...makeBlock('b', '2026-10-10', '09:00') };
    const next = applyMutationsToData(
      data,
      mutations({ upserts: [{ localId: 'b', date: '2026-10-10', block: moved }] })
    );
    expect(next.plans['2026-10-09'].blocks).toEqual([]);
    expect(next.plans['2026-10-10'].blocks.map((b) => b.id)).toEqual(['z', 'b']);
    expect(next.plans['2026-10-10'].blocks[1].date).toBe('2026-10-10');
  });

  it('removes blocks wherever they live', () => {
    const data = makeData({
      '2026-10-09': makePlan('2026-10-09', [makeBlock('a', '2026-10-09'), makeBlock('b', '2026-10-09')]),
      '2026-10-10': makePlan('2026-10-10', [makeBlock('b', '2026-10-10')]),
    });
    const next = applyMutationsToData(
      data,
      mutations({ removals: [{ localId: 'b', date: '2026-10-09' }] })
    );
    expect(next.plans['2026-10-09'].blocks.map((b) => b.id)).toEqual(['a']);
    expect(next.plans['2026-10-10'].blocks).toEqual([]);
  });

  it('is immutable: input plans are not mutated', () => {
    const plan = makePlan('2026-10-09', [makeBlock('a', '2026-10-09')]);
    const data = makeData({ '2026-10-09': plan });
    applyMutationsToData(
      data,
      mutations({
        upserts: [{ localId: 'n', date: '2026-10-09', block: makeBlock('n', '2026-10-09') }],
        removals: [{ localId: 'a' }],
      })
    );
    expect(plan.blocks.map((b) => b.id)).toEqual(['a']);
  });
});

describe('countMutationTargets', () => {
  it('counts upserts plus removals', () => {
    expect(
      countMutationTargets(
        mutations({
          upserts: [
            { localId: 'a', date: 'd', block: makeBlock('a', 'd') },
            { localId: 'b', date: 'd', block: makeBlock('b', 'd') },
          ],
          removals: [{ localId: 'c' }],
        })
      )
    ).toBe(3);
    expect(countMutationTargets(mutations({}))).toBe(0);
  });
});
