import { describe, expect, it, vi } from 'vitest';
import { SyncEngine } from '../electron/google/syncEngine';
import { GoogleApiError } from '../electron/google/api';
import { todayLocal, addDays, localDateTime, contentHash } from '../electron/google/mapping';
import {
  CalendarApiPort,
  EnginePorts,
  GoogleEventResource,
  SyncOp,
  SyncState,
} from '../electron/google/types';
import { DayPlan, GoogleApplyMutations, GoogleApplyResult, ScheduleBlock } from '../src/types';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const TODAY = todayLocal(NOW);

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

function makePlan(date: string, blocks: ScheduleBlock[]): DayPlan {
  return {
    date,
    goals: [],
    timeWindows: [],
    blocks,
    isApproved: true,
    updatedAt: new Date(NOW).toISOString(),
  };
}

function emptyState(overrides: Partial<SyncState> = {}): SyncState {
  return {
    version: 1,
    targetCalendarId: 'primary',
    connectedAt: '2026-10-01T00:00:00.000Z',
    cursors: {},
    mappings: {},
    googleToLocal: {},
    ops: [],
    tombstones: { local: {}, google: {} },
    counters: { imported: 0, pushed: 0, conflicts: 0 },
    ...overrides,
  };
}

function timedEvent(
  id: string,
  date: string,
  start: string,
  end: string,
  extra: Partial<GoogleEventResource> = {}
): GoogleEventResource {
  return {
    id,
    etag: `etag-${id}`,
    status: 'confirmed',
    summary: `Event ${id}`,
    start: { dateTime: localDateTime(date, start).toISOString(), timeZone: 'UTC' },
    end: { dateTime: localDateTime(date, end).toISOString(), timeZone: 'UTC' },
    updated: new Date(NOW).toISOString(),
    ...extra,
  };
}

interface Harness {
  engine: SyncEngine;
  state: { current: SyncState };
  api: CalendarApiPort & {
    listEvents: ReturnType<typeof vi.fn>;
    insertEvent: ReturnType<typeof vi.fn>;
    patchEvent: ReturnType<typeof vi.fn>;
    deleteEvent: ReturnType<typeof vi.fn>;
    findEventByControlBlockId: ReturnType<typeof vi.fn>;
  };
  applied: GoogleApplyMutations[];
  applyImpl: (m: GoogleApplyMutations) => Promise<GoogleApplyResult>;
  setApplyImpl: (fn: (m: GoogleApplyMutations) => Promise<GoogleApplyResult>) => void;
  /** Move the harness clock forward (op backoff is time-based). */
  advanceTime: (ms: number) => void;
}

function makeHarness(opts: {
  plans?: Record<string, DayPlan>;
  state?: SyncState;
  listEventsImpl?: CalendarApiPort['listEvents'];
  applyImpl?: (m: GoogleApplyMutations) => Promise<GoogleApplyResult>;
}): Harness {
  const state = { current: opts.state ?? emptySyncState() };
  const applied: GoogleApplyMutations[] = [];
  let applyImpl =
    opts.applyImpl ?? (async (m: GoogleApplyMutations) => ({ success: true, applied: 1, requestId: m.requestId }));
  let nowOffset = 0;

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const api = {
    listCalendars: vi.fn(async () => []),
    getUserEmail: vi.fn(async () => 'user@example.com'),
    getEvent: vi.fn(async () => {
      throw new GoogleApiError('missing', 404, 'not_found');
    }),
    findEventByControlBlockId: vi.fn(async () => null),
    insertEvent: vi.fn(async (_cal: string, body: Partial<GoogleEventResource>) => ({
      id: `g-${Math.random().toString(36).slice(2, 8)}`,
      etag: '"new-etag"',
      status: 'confirmed',
      ...body,
    })),
    patchEvent: vi.fn(
      async (_cal: string, id: string, _body: Partial<GoogleEventResource>, _ifMatch?: string) => ({
        id,
        etag: '"patched-etag"',
        status: 'confirmed',
      })
    ),
    deleteEvent: vi.fn(async () => undefined),
    listEvents: vi.fn(
      opts.listEventsImpl ??
        (async () => ({ items: [], nextSyncToken: 'tok-1' }))
    ),
  };

  const ports: EnginePorts = {
    stateStore: {
      load: () => state.current,
      save: (s) => {
        state.current = s;
      },
    },
    localData: {
      getPlans: () => opts.plans ?? {},
      apply: async (m: GoogleApplyMutations) => {
        applied.push(m);
        return applyImpl(m);
      },
    },
    api,
    logger,
    now: () => NOW + nowOffset,
    sleep: async () => undefined,
    timeZone: 'UTC',
    getDefaultMode: () => ({ id: 'mode-free', name: 'Free', icon: 'coffee', color: '#fff' }),
  };

  return {
    engine: new SyncEngine(ports),
    state,
    api,
    applied,
    applyImpl,
    setApplyImpl: (fn) => {
      applyImpl = fn;
    },
    advanceTime: (ms: number) => {
      nowOffset += ms;
    },
  };
}

function emptySyncState(): SyncState {
  return emptyState();
}

describe('SyncEngine.reconcile', () => {
  it('queues a create op for a new eligible block', async () => {
    const h = makeHarness({ plans: { [TODAY]: makePlan(TODAY, [makeBlock('b1', TODAY)]) } });
    const res = await h.engine.syncOnce();
    expect(res.success).toBe(true);
    expect(res.created).toBe(1);
    expect(h.api.insertEvent).toHaveBeenCalledTimes(1);
    const body = h.api.insertEvent.mock.calls[0][1] as Partial<GoogleEventResource>;
    expect(body.extendedProperties?.private?.controlBlockId).toBe('b1');
    const mapping = h.state.current.mappings.b1;
    expect(mapping).toBeDefined();
    expect(h.state.current.googleToLocal[mapping.googleEventId]).toBe('b1');
    expect(h.state.current.ops).toHaveLength(0);
    // Nothing pulled: renderer apply not needed.
    expect(h.applied).toHaveLength(0);
    // Full pull happened: cursor written.
    expect(h.state.current.cursors.primary?.syncToken).toBe('tok-1');
  });

  it('does not push untouched history', async () => {
    const old = addDays(TODAY, -60);
    const h = makeHarness({ plans: { [old]: makePlan(old, [makeBlock('b-old', old)]) } });
    const res = await h.engine.syncOnce();
    expect(res.success).toBe(true);
    expect(h.api.insertEvent).not.toHaveBeenCalled();
    expect(h.state.current.ops).toHaveLength(0);
  });

  it('queues an update op when a mapped block changes', async () => {
    const block = makeBlock('b1', TODAY, { description: 'edited locally' });
    const state = emptyState({
      mappings: {
        b1: {
          localId: 'b1',
          googleEventId: 'g1',
          calendarId: 'primary',
          contentHash: 'stale-hash',
          etag: '"etag-1"',
        },
      },
      googleToLocal: { g1: 'b1' },
    });
    const h = makeHarness({ plans: { [TODAY]: makePlan(TODAY, [block]) }, state });
    const res = await h.engine.syncOnce();
    expect(res.success).toBe(true);
    expect(res.updated).toBe(1);
    expect(h.api.patchEvent).toHaveBeenCalledTimes(1);
    expect(h.api.patchEvent.mock.calls[0][3]).toBe('"etag-1"'); // If-Match
    expect(h.state.current.mappings.b1.contentHash).not.toBe('stale-hash');
  });

  it('queues a delete op when the local block is gone', async () => {
    const state = emptyState({
      mappings: {
        b1: { localId: 'b1', googleEventId: 'g1', calendarId: 'primary', contentHash: 'h' },
      },
      googleToLocal: { g1: 'b1' },
    });
    const h = makeHarness({ plans: { [TODAY]: makePlan(TODAY, []) }, state });
    const res = await h.engine.syncOnce();
    expect(res.success).toBe(true);
    expect(res.deleted).toBe(1);
    expect(h.api.deleteEvent).toHaveBeenCalledWith('primary', 'g1');
    expect(h.state.current.mappings.b1).toBeUndefined();
    expect(h.state.current.tombstones.google.g1).toBeDefined();
    expect(h.state.current.tombstones.local.b1).toBeDefined();
  });

  it('tolerates delete of an already-gone remote event (404)', async () => {
    const state = emptyState({
      mappings: {
        b1: { localId: 'b1', googleEventId: 'g1', calendarId: 'primary', contentHash: 'h' },
      },
      googleToLocal: { g1: 'b1' },
    });
    const h = makeHarness({ plans: { [TODAY]: makePlan(TODAY, []) }, state });
    h.api.deleteEvent.mockRejectedValueOnce(new GoogleApiError('gone', 404, 'not_found'));
    const res = await h.engine.syncOnce();
    expect(res.success).toBe(true);
    expect(res.deleted).toBe(1);
    expect(h.state.current.mappings.b1).toBeUndefined();
  });

  it('skips ops in backoff and keeps them queued', async () => {
    const op: SyncOp = {
      id: 'op-1',
      kind: 'create',
      localId: 'b1',
      hash: contentHash(makeBlock('b1', TODAY)),
      attempts: 2,
      nextAttemptAt: NOW + 60_000,
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
    };
    const h = makeHarness({
      plans: { [TODAY]: makePlan(TODAY, [makeBlock('b1', TODAY)]) },
      state: emptyState({ ops: [op] }),
    });
    const res = await h.engine.syncOnce();
    expect(res.success).toBe(true);
    expect(h.api.insertEvent).not.toHaveBeenCalled();
    expect(h.state.current.ops).toHaveLength(1);
  });
});

describe('SyncEngine.create idempotency', () => {
  it('adopts the remote event instead of inserting a duplicate', async () => {
    const block = makeBlock('b1', TODAY);
    const remote = timedEvent('g-existing', TODAY, '09:00', '10:00', {
      extendedProperties: { private: { controlBlockId: 'b1', controlSync: '1' } },
    });
    const h = makeHarness({ plans: { [TODAY]: makePlan(TODAY, [block]) } });
    h.api.findEventByControlBlockId.mockResolvedValueOnce(remote);
    const res = await h.engine.syncOnce();
    expect(res.success).toBe(true);
    expect(h.api.insertEvent).not.toHaveBeenCalled();
    expect(h.api.patchEvent).toHaveBeenCalledTimes(1);
    expect(h.state.current.mappings.b1.googleEventId).toBe('g-existing');
    expect(res.created).toBe(0);
  });

  it('marks uncertain creates on 409 and adopts on retry', async () => {
    const block = makeBlock('b1', TODAY);
    const h = makeHarness({ plans: { [TODAY]: makePlan(TODAY, [block]) } });
    h.api.insertEvent.mockRejectedValueOnce(new GoogleApiError('duplicate', 409, 'permanent'));
    const first = await h.engine.syncOnce();
    expect(first.success).toBe(true);
    expect(h.state.current.ops).toHaveLength(1);
    expect(h.state.current.ops[0].uncertain).toBe(true);
    expect(h.state.current.ops[0].permanent).toBeFalsy();

    const remote = timedEvent('g-adopted', TODAY, '09:00', '10:00', {
      extendedProperties: { private: { controlBlockId: 'b1' } },
    });
    h.api.findEventByControlBlockId.mockResolvedValue(remote);
    // The 409 failure backs the op off; move past the delay.
    h.advanceTime(60_000);
    const second = await h.engine.syncOnce();
    expect(second.success).toBe(true);
    expect(h.api.insertEvent).toHaveBeenCalledTimes(1); // no second insert
    expect(h.state.current.mappings.b1.googleEventId).toBe('g-adopted');
    expect(h.state.current.ops).toHaveLength(0);
  });
});

describe('SyncEngine.update conflicts', () => {
  function mappedState(): SyncState {
    return emptyState({
      mappings: {
        b1: {
          localId: 'b1',
          googleEventId: 'g1',
          calendarId: 'primary',
          contentHash: 'stale',
          etag: '"etag-1"',
        },
      },
      googleToLocal: { g1: 'b1' },
    });
  }

  it('local wins on 412: re-patches without etag and counts a conflict', async () => {
    const block = makeBlock('b1', TODAY, { description: 'local edit' });
    const h = makeHarness({ plans: { [TODAY]: makePlan(TODAY, [block]) }, state: mappedState() });
    h.api.patchEvent.mockImplementationOnce(async () => {
      throw new GoogleApiError('precondition', 412, 'conflict');
    });
    const res = await h.engine.syncOnce();
    expect(res.success).toBe(true);
    expect(res.updated).toBe(1);
    expect(res.conflicts).toBe(1);
    expect(h.api.patchEvent).toHaveBeenCalledTimes(2);
    expect(h.api.patchEvent.mock.calls[0][3]).toBe('"etag-1"');
    expect(h.api.patchEvent.mock.calls[1][3]).toBeUndefined();
    expect(h.state.current.mappings.b1.etag).toBe('"patched-etag"');
  });

  it('remote deletion beats a pending edit: renderer removal deferred until apply confirms', async () => {
    const block = makeBlock('b1', TODAY, { description: 'local edit' });
    const h = makeHarness({ plans: { [TODAY]: makePlan(TODAY, [block]) }, state: mappedState() });
    h.api.patchEvent.mockRejectedValueOnce(new GoogleApiError('missing', 404, 'not_found'));
    h.api.findEventByControlBlockId.mockResolvedValue(null);

    const res = await h.engine.syncOnce();
    expect(res.success).toBe(true);
    expect(res.conflicts).toBe(1);
    // Renderer was asked to remove the block.
    expect(h.applied).toHaveLength(1);
    expect(h.applied[0].removals).toEqual([{ localId: 'b1', date: TODAY }]);
    // Mapping unlinked only after the apply round-trip.
    expect(h.state.current.mappings.b1).toBeUndefined();
    expect(h.state.current.tombstones.local.b1).toBeDefined();
    expect(h.state.current.ops).toHaveLength(0);
  });

  it('re-links when the remote event moved (404 then found elsewhere)', async () => {
    const block = makeBlock('b1', TODAY, { description: 'local edit' });
    const h = makeHarness({ plans: { [TODAY]: makePlan(TODAY, [block]) }, state: mappedState() });
    h.api.patchEvent.mockRejectedValueOnce(new GoogleApiError('missing', 404, 'not_found'));
    const moved = timedEvent('g-moved', TODAY, '09:00', '10:00');
    h.api.findEventByControlBlockId.mockResolvedValueOnce(moved);

    const res = await h.engine.syncOnce();
    expect(res.success).toBe(true);
    expect(h.api.patchEvent).toHaveBeenCalledTimes(2);
    expect(h.api.patchEvent.mock.calls[1][1]).toBe('g-moved');
    expect(h.state.current.mappings.b1.googleEventId).toBe('g-moved');
    expect(h.state.current.googleToLocal['g-moved']).toBe('b1');
  });

  it('auth failures abort the run as auth_required', async () => {
    const block = makeBlock('b1', TODAY, { description: 'local edit' });
    const h = makeHarness({ plans: { [TODAY]: makePlan(TODAY, [block]) }, state: mappedState() });
    h.api.patchEvent.mockRejectedValue(new GoogleApiError('denied', 401, 'auth'));
    const res = await h.engine.syncOnce();
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('auth_required');
  });
});

describe('SyncEngine.pull', () => {
  it('imports new remote events and records mappings after apply', async () => {
    const remote = timedEvent('ev9', TODAY, '14:00', '15:00', { summary: 'Standup' });
    const h = makeHarness({
      plans: {},
      listEventsImpl: async () => ({ items: [remote], nextSyncToken: 'tok-a' }),
    });
    const res = await h.engine.syncOnce();
    expect(res.success).toBe(true);
    expect(res.imported).toBe(1);
    expect(h.applied).toHaveLength(1);
    expect(h.applied[0].upserts).toHaveLength(1);
    expect(h.applied[0].upserts[0].block.modeName).toBe('Standup');
    const localId = h.applied[0].upserts[0].localId;
    expect(h.state.current.mappings[localId]?.googleEventId).toBe('ev9');
    expect(h.state.current.cursors.primary?.syncToken).toBe('tok-a');
    expect(h.state.current.counters.imported).toBe(1);
  });

  it('does not advance the cursor when the renderer rejects the apply', async () => {
    const remote = timedEvent('ev9', TODAY, '14:00', '15:00');
    const h = makeHarness({
      plans: {},
      listEventsImpl: async () => ({ items: [remote], nextSyncToken: 'tok-a' }),
      applyImpl: async () => ({ success: false, error: 'disk full' }),
    });
    const res = await h.engine.syncOnce();
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('apply_failed');
    expect(h.state.current.cursors.primary?.syncToken).toBeUndefined();
    expect(h.state.current.mappings).toEqual({});
    expect(h.state.current.counters.imported).toBe(0);
  });

  it('pulls remote edits once the pending push completes', async () => {
    const block = makeBlock('b1', TODAY);
    const state = emptyState({
      mappings: {
        b1: {
          localId: 'b1',
          googleEventId: 'g1',
          calendarId: 'primary',
          contentHash: 'stale',
          etag: '"etag-1"',
        },
      },
      googleToLocal: { g1: 'b1' },
    });
    const remote = timedEvent('g1', TODAY, '09:00', '10:00', {
      summary: 'Renamed remotely',
      etag: '"etag-2"',
      extendedProperties: { private: { controlBlockId: 'b1' } },
    });
    const h = makeHarness({
      plans: { [TODAY]: makePlan(TODAY, [block]) },
      state,
      listEventsImpl: async () => ({ items: [remote], nextSyncToken: 'tok-b' }),
    });
    const res = await h.engine.syncOnce();
    expect(res.success).toBe(true);
    // Reconcile queued an update for the stale hash and drain pushed it; the
    // pull then sees the concurrent remote rename (pending-op deferral only
    // covers ops still queued at pull time) and folds it into the renderer.
    expect(h.api.patchEvent).toHaveBeenCalledTimes(1);
    expect(h.applied).toHaveLength(1);
    expect(h.applied[0].upserts[0].block.modeName).toBe('Renamed remotely');
    expect(h.state.current.cursors.primary?.syncToken).toBe('tok-b');
  });

  it('defers remote changes while their op is still queued', async () => {
    const block = makeBlock('b1', TODAY);
    const state = emptyState({
      mappings: {
        b1: {
          localId: 'b1',
          googleEventId: 'g1',
          calendarId: 'primary',
          contentHash: 'stale',
          etag: '"etag-1"',
        },
      },
      googleToLocal: { g1: 'b1' },
    });
    const remote = timedEvent('g1', TODAY, '09:00', '10:00', {
      summary: 'Renamed remotely',
      etag: '"etag-2"',
      extendedProperties: { private: { controlBlockId: 'b1' } },
    });
    const h = makeHarness({
      plans: { [TODAY]: makePlan(TODAY, [block]) },
      state,
      listEventsImpl: async () => ({ items: [remote], nextSyncToken: 'tok-b' }),
    });
    // The push keeps failing transiently: the op stays queued, so the remote
    // rename must NOT overwrite the local edit (local wins while pending).
    h.api.patchEvent.mockRejectedValue(new GoogleApiError('flaky', 500, 'transient'));
    const res = await h.engine.syncOnce();
    expect(res.success).toBe(true);
    expect(h.state.current.ops).toHaveLength(1);
    expect(h.applied).toHaveLength(0);
    expect(h.state.current.cursors.primary?.syncToken).toBe('tok-b');
  });

  it('removes locally a remotely-cancelled event and unlinks the mapping', async () => {
    const block = makeBlock('b1', TODAY);
    const state = emptyState({
      mappings: {
        b1: { localId: 'b1', googleEventId: 'g1', calendarId: 'primary', contentHash: 'h' },
      },
      googleToLocal: { g1: 'b1' },
    });
    const cancelled: GoogleEventResource = { id: 'g1', status: 'cancelled' };
    const h = makeHarness({
      plans: { [TODAY]: makePlan(TODAY, [block]) },
      state,
      listEventsImpl: async () => ({ items: [cancelled], nextSyncToken: 'tok-c' }),
    });
    const res = await h.engine.syncOnce();
    expect(res.success).toBe(true);
    expect(h.applied).toHaveLength(1);
    expect(h.applied[0].removals).toEqual([{ localId: 'b1', date: TODAY }]);
    expect(h.state.current.mappings.b1).toBeUndefined();
    expect(h.state.current.tombstones.google.g1).toBeDefined();
  });

  it('performs a full resync when the sync token is gone (410)', async () => {
    const calls: Array<{ syncToken?: string; timeMin?: string }> = [];
    const state = emptyState({ cursors: { primary: { syncToken: 'stale' } } });
    const h = makeHarness({
      plans: {},
      state,
      listEventsImpl: async (_cal, params) => {
        calls.push({ syncToken: params.syncToken, timeMin: params.timeMin });
        if (params.syncToken) throw new GoogleApiError('gone', 410, 'gone');
        return { items: [], nextSyncToken: 'tok-fresh' };
      },
    });
    const res = await h.engine.syncOnce();
    expect(res.success).toBe(true);
    expect(res.resynced).toBe(true);
    expect(calls[0].syncToken).toBe('stale');
    expect(calls[1].timeMin).toBeDefined();
    expect(calls[1].syncToken).toBeUndefined();
    expect(h.state.current.cursors.primary?.syncToken).toBe('tok-fresh');
  });

  it('ignores tombstoned remote events (no resurrection)', async () => {
    const ghost: GoogleEventResource = { id: 'g-ghost', status: 'confirmed', summary: 'Ghost' };
    const state = emptyState({ tombstones: { local: {}, google: { 'g-ghost': new Date(NOW).toISOString() } } });
    const h = makeHarness({
      plans: {},
      state,
      listEventsImpl: async () => ({ items: [ghost], nextSyncToken: 'tok-g' }),
    });
    const res = await h.engine.syncOnce();
    expect(res.success).toBe(true);
    expect(res.imported).toBe(0);
    expect(h.applied).toHaveLength(0);
  });

  it('force-full drops cursors before pulling', async () => {
    const seen: string[] = [];
    const state = emptyState({ cursors: { primary: { syncToken: 'old' } } });
    const h = makeHarness({
      plans: {},
      state,
      listEventsImpl: async (_cal, params) => {
        seen.push(params.syncToken ?? '(full)');
        return { items: [], nextSyncToken: 'tok-new' };
      },
    });
    const res = await h.engine.syncOnce({ full: true });
    expect(res.success).toBe(true);
    expect(seen).toEqual(['(full)']);
    expect(h.state.current.cursors.primary?.syncToken).toBe('tok-new');
  });

  it('surfaces a disabled Calendar API as a config error, not auth_required', async () => {
    const h = makeHarness({
      plans: {},
      listEventsImpl: async () => {
        throw new GoogleApiError(
          'Google Calendar API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=123 then retry.',
          403,
          'permanent'
        );
      },
    });
    const res = await h.engine.syncOnce();
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('api_error');
    expect(res.error).toMatch(/has not been used in project/);
    expect(h.state.current.lastErrorCode).toBe('api_error');
    expect(h.state.current.cursors.primary?.syncToken).toBeUndefined();
  });
});

describe('SyncEngine.op coalescing', () => {
  it('keeps a single op per block across runs with unchanged content', async () => {
    const block = makeBlock('b1', TODAY);
    const h = makeHarness({ plans: { [TODAY]: makePlan(TODAY, [block]) } });
    // First run: insert fails transiently, op stays queued with backoff.
    h.api.insertEvent.mockRejectedValueOnce(new GoogleApiError('flaky', 500, 'transient'));
    // findOwnedEvent search happens first — return null (no remote copy).
    h.api.findEventByControlBlockId.mockResolvedValue(null);
    const first = await h.engine.syncOnce();
    expect(first.success).toBe(true);
    expect(h.state.current.ops).toHaveLength(1);

    // Reconcile runs again on the next sync: same content must not duplicate.
    const second = await h.engine.syncOnce();
    expect(second.success).toBe(true);
    expect(h.state.current.ops).toHaveLength(1);
  });
});
