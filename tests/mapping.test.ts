import { describe, expect, it } from 'vitest';
import {
  addDays,
  blockToGoogleBody,
  contentHash,
  controlBlockIdOf,
  controlTitleOf,
  googleEventToBlock,
  isEligibleForPush,
  localDateTime,
  managedFields,
  remoteDiffers,
  todayLocal,
} from '../electron/google/mapping';
import { ScheduleBlock } from '../src/types';
import { GoogleEventResource } from '../electron/google/types';

function makeBlock(id: string, date: string, overrides: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id,
    date,
    startTime: '09:00',
    endTime: '10:00',
    modeId: 'mode-deep',
    modeName: 'Deep Work',
    modeIcon: 'target',
    modeColor: '#38bdf8',
    workDuration: 50,
    breakDuration: 10,
    cycles: 3,
    status: 'approved',
    ...overrides,
  };
}

const NOW = Date.parse('2026-10-09T12:00:00Z');
const TODAY = todayLocal(NOW);

describe('contentHash', () => {
  it('is stable for identical content', () => {
    expect(contentHash(makeBlock('b1', '2026-10-10'))).toBe(
      contentHash(makeBlock('b1', '2026-10-10'))
    );
  });

  it('changes when a mirrored field changes', () => {
    const base = contentHash(makeBlock('b1', '2026-10-10'));
    expect(contentHash(makeBlock('b1', '2026-10-10', { modeName: 'Reading' }))).not.toBe(base);
    expect(contentHash(makeBlock('b1', '2026-10-10', { startTime: '09:30' }))).not.toBe(base);
    expect(contentHash(makeBlock('b1', '2026-10-10', { endTime: '11:00' }))).not.toBe(base);
    expect(contentHash(makeBlock('b1', '2026-10-10', { description: 'notes' }))).not.toBe(base);
    expect(contentHash(makeBlock('b1', '2026-10-10', { location: 'Room 2' }))).not.toBe(base);
    expect(contentHash(makeBlock('b1', '2026-10-10', { allDay: true }))).not.toBe(base);
    expect(contentHash(makeBlock('b1', '2026-10-11'))).not.toBe(base);
  });

  it('ignores fields Control does not mirror', () => {
    const base = contentHash(makeBlock('b1', '2026-10-10'));
    expect(contentHash(makeBlock('b1', '2026-10-10', { status: 'completed', cycles: 9 }))).toBe(base);
  });

  it('managedFields normalizes missing optional strings', () => {
    const block = makeBlock('b1', '2026-10-10', { description: undefined, location: undefined });
    const f = managedFields(block);
    expect(f.description).toBe('');
    expect(f.location).toBe('');
    expect(f.title).toBe('Deep Work');
    expect(f.allDay).toBe(false);
  });
});

describe('isEligibleForPush', () => {
  const floor = addDays(TODAY, -45);
  const old = addDays(TODAY, -60);

  it('accepts future and recent blocks', () => {
    expect(isEligibleForPush(makeBlock('b', TODAY), TODAY, undefined)).toBe(true);
    expect(isEligibleForPush(makeBlock('b', addDays(TODAY, 7)), TODAY, undefined)).toBe(true);
    expect(isEligibleForPush(makeBlock('b', floor), TODAY, undefined)).toBe(true);
  });

  it('rejects untouched history', () => {
    expect(isEligibleForPush(makeBlock('b', old), TODAY, '2026-01-01T00:00:00.000Z')).toBe(false);
  });

  it('accepts historical blocks edited after connecting', () => {
    const block = makeBlock('b', old, { updatedAt: '2026-10-09T11:00:00.000Z' });
    expect(isEligibleForPush(block, TODAY, '2026-10-01T00:00:00.000Z')).toBe(true);
    expect(isEligibleForPush(block, TODAY, '2026-10-09T12:00:01.000Z')).toBe(false);
  });

  it('always accepts already-linked blocks', () => {
    const block = makeBlock('b', old, { googleCalendarEventId: 'g1' });
    expect(isEligibleForPush(block, TODAY, undefined)).toBe(true);
  });
});

describe('blockToGoogleBody', () => {
  it('maps timed blocks to UTC instants with the machine zone', () => {
    const block = makeBlock('b1', '2026-03-10', { startTime: '09:30', endTime: '10:15', description: 'd', location: 'l' });
    const body = blockToGoogleBody(block, {
      timeZone: 'Europe/Berlin',
      mode: { id: 'mode-deep', cycles: 3, workDuration: 50, breakDuration: 10 },
    });

    expect(body.start?.dateTime).toBe(localDateTime('2026-03-10', '09:30').toISOString());
    expect(body.end?.dateTime).toBe(localDateTime('2026-03-10', '10:15').toISOString());
    expect(body.start?.timeZone).toBe('Europe/Berlin');
    expect(body.summary).toBe('Deep Work');
    expect(body.description).toBe('d');
    expect(body.location).toBe('l');
    expect(body.extendedProperties?.private).toEqual({
      controlSync: '1',
      controlBlockId: 'b1',
      controlModeId: 'mode-deep',
      controlCycles: '3',
      controlWork: '50',
      controlBreak: '10',
    });
  });

  it('forces a minimum duration when end <= start', () => {
    const block = makeBlock('b1', '2026-03-10', { startTime: '23:30', endTime: '23:00' });
    const body = blockToGoogleBody(block, { timeZone: 'UTC' });
    expect(Date.parse(body.end!.dateTime!) - Date.parse(body.start!.dateTime!)).toBe(3600_000);
  });

  it('uses Google all-day date form with an exclusive end', () => {
    const block = makeBlock('b1', '2026-03-10', { allDay: true, startTime: '00:00', endTime: '23:59' });
    const body = blockToGoogleBody(block, { timeZone: 'UTC' });
    expect(body.start).toEqual({ date: '2026-03-10' });
    expect(body.end).toEqual({ date: '2026-03-11' });
    expect(body.start?.dateTime).toBeUndefined();
  });

  it('keeps a multi-day all-day block end date', () => {
    const block = makeBlock('b1', '2026-03-10', { allDay: true, googleEnd: '2026-03-12' });
    const body = blockToGoogleBody(block, { timeZone: 'UTC' });
    expect(body.end).toEqual({ date: '2026-03-12' });
  });
});

describe('googleEventToBlock', () => {
  it('round-trips a same-day timed event', () => {
    const start = localDateTime('2026-03-10', '14:00').toISOString();
    const end = localDateTime('2026-03-10', '15:30').toISOString();
    const event: GoogleEventResource = {
      id: 'g1',
      etag: 'etag-1',
      summary: 'Standup',
      start: { dateTime: start, timeZone: 'UTC' },
      end: { dateTime: end, timeZone: 'UTC' },
      extendedProperties: { private: { controlBlockId: 'b1' } },
      updated: '2026-03-09T10:00:00Z',
    };
    const block = googleEventToBlock(event, { defaultMode: null });
    expect(block.id).toBe('b1');
    expect(block.date).toBe('2026-03-10');
    expect(block.startTime).toBe('14:00');
    expect(block.endTime).toBe('15:30');
    expect(block.source).toBe('google');
    expect(block.googleCalendarEventId).toBe('g1');
    expect(block.googleEventETag).toBe('etag-1');
    expect(block.allDay).toBeFalsy();
    expect(contentHash(block)).toBe(
      contentHash({ ...block, modeName: 'Standup' })
    );
  });

  it('clamps overnight events to 23:59 and keeps the raw end', () => {
    const start = localDateTime('2026-03-10', '22:00').toISOString();
    const end = localDateTime('2026-03-11', '06:00').toISOString();
    const event: GoogleEventResource = {
      id: 'g2',
      summary: 'Night shift',
      start: { dateTime: start },
      end: { dateTime: end },
    };
    const block = googleEventToBlock(event, { defaultMode: null });
    expect(block.date).toBe('2026-03-10');
    expect(block.startTime).toBe('22:00');
    expect(block.endTime).toBe('23:59');
    expect(block.googleEnd).toBe(end);
  });

  it('maps all-day events', () => {
    const event: GoogleEventResource = {
      id: 'g3',
      summary: 'Conference',
      start: { date: '2026-03-10' },
      end: { date: '2026-03-12' },
    };
    const block = googleEventToBlock(event, { defaultMode: null });
    expect(block.allDay).toBe(true);
    expect(block.date).toBe('2026-03-10');
    expect(block.startTime).toBe('00:00');
    expect(block.endTime).toBe('23:59');
    expect(block.googleEnd).toBe('2026-03-12');
  });

  it('merges into an existing block preserving planner-only fields', () => {
    const existing = makeBlock('b1', '2026-03-10', {
      cycles: 8,
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      description: 'local notes',
    });
    const event: GoogleEventResource = {
      id: 'g1',
      summary: 'Renamed remotely',
      description: 'remote notes',
      start: { dateTime: localDateTime('2026-03-10', '09:00').toISOString() },
      end: { dateTime: localDateTime('2026-03-10', '10:00').toISOString() },
      extendedProperties: { private: { controlBlockId: 'b1', controlModeId: 'mode-deep' } },
    };
    const block = googleEventToBlock(event, { defaultMode: null, existing });
    expect(block.id).toBe('b1');
    expect(block.modeName).toBe('Renamed remotely');
    expect(block.cycles).toBe(8);
    expect(block.status).toBe('completed');
    expect(block.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(block.description).toBe('remote notes');
  });

  it('builds a new id for unmanaged events', () => {
    const block = googleEventToBlock(
      { id: 'g9', summary: 'Team lunch', start: { date: '2026-03-10' }, end: { date: '2026-03-11' } },
      { defaultMode: { id: 'm', name: 'Free', icon: 'coffee', color: '#fff' } }
    );
    expect(block.id).toBe('gcal-g9');
    expect(block.modeId).toBe('m');
    expect(block.modeName).toBe('Team lunch');
  });
});

describe('controlBlockIdOf', () => {
  it('reads the private extended property', () => {
    expect(controlBlockIdOf({ id: 'g1', extendedProperties: { private: { controlBlockId: 'b1' } } })).toBe('b1');
    expect(controlBlockIdOf({ id: 'g1' })).toBeUndefined();
    expect(controlBlockIdOf({ id: 'g1', extendedProperties: { private: { controlBlockId: '' } } })).toBeUndefined();
  });
});

describe('clean titles across the Google round-trip', () => {
  const full = '25 Math questions 1 11.10.2026';
  const clean = '25 Math questions 1';

  function datedBlock() {
    return makeBlock('b1', '2026-03-10', { modeName: full });
  }

  function pushedEvent(): GoogleEventResource {
    const body = blockToGoogleBody(datedBlock(), { timeZone: 'UTC' });
    return {
      id: 'g1',
      etag: '"e1"',
      status: 'confirmed',
      ...body,
      start: { dateTime: localDateTime('2026-03-10', '09:00').toISOString() },
      end: { dateTime: localDateTime('2026-03-10', '10:00').toISOString() },
    };
  }

  it('pushes the clean title and anchors the full title privately', () => {
    const body = blockToGoogleBody(datedBlock(), { timeZone: 'UTC' });
    expect(body.summary).toBe(clean);
    expect(body.extendedProperties?.private?.controlTitle).toBe(full);
    expect(body.extendedProperties?.private?.controlBlockId).toBe('b1');
  });

  it('stores no anchor for titles without a suffix', () => {
    const body = blockToGoogleBody(makeBlock('b2', '2026-03-10'), { timeZone: 'UTC' });
    expect(body.summary).toBe('Deep Work');
    expect(body.extendedProperties?.private?.controlTitle).toBeUndefined();
  });

  it('pull restores the full title without reporting a diff (no sync churn)', () => {
    const block = datedBlock();
    const event = pushedEvent();
    expect(controlTitleOf(event)).toBe(full);
    const merged = googleEventToBlock(event, { defaultMode: null, existing: block });
    expect(merged.modeName).toBe(full);
    expect(remoteDiffers(block, event)).toBe(false);
  });

  it('a title edited directly in Google wins over the stale anchor', () => {
    const block = datedBlock();
    const event = { ...pushedEvent(), summary: 'Renamed in Google' };
    expect(controlTitleOf(event)).toBeUndefined();
    const merged = googleEventToBlock(event, { defaultMode: null, existing: block });
    expect(merged.modeName).toBe('Renamed in Google');
    expect(remoteDiffers(block, event)).toBe(true);
  });

  it('legacy events without an anchor behave exactly as before', () => {
    const block = datedBlock();
    const legacy: GoogleEventResource = {
      id: 'g-old',
      summary: full,
      start: { dateTime: localDateTime('2026-03-10', '09:00').toISOString() },
      end: { dateTime: localDateTime('2026-03-10', '10:00').toISOString() },
      extendedProperties: { private: { controlBlockId: 'b1' } },
    };
    expect(controlTitleOf(legacy)).toBeUndefined();
    const merged = googleEventToBlock(legacy, { defaultMode: null, existing: block });
    expect(merged.modeName).toBe(full);
    expect(remoteDiffers(block, legacy)).toBe(false);
  });
});
