import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SyncStateStore,
  migrateState,
  pruneTombstones,
} from '../electron/google/state';
import { emptySyncState, SyncState } from '../electron/google/types';

const tmpDirs: string[] = [];

function tmpFile(name = 'state.json'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'control-gcal-state-'));
  tmpDirs.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('migrateState', () => {
  it('returns an empty state for garbage input', () => {
    expect(migrateState(null).mappings).toEqual({});
    expect(migrateState('nope').ops).toEqual([]);
    expect(migrateState([1, 2]).version).toBe(emptySyncState().version);
  });

  it('preserves cursors, mappings, ops, tombstones, counters and email', () => {
    const raw = {
      version: 1,
      targetCalendarId: 'cal-1',
      connectedAt: '2026-10-01T00:00:00.000Z',
      userEmail: 'user@example.com',
      lastSyncedAt: '2026-10-02T00:00:00.000Z',
      cursors: { 'cal-1': { syncToken: 'tok-1', lastFullSyncAt: 'x' }, bad: 'ignore-me' },
      mappings: {
        b1: { googleEventId: 'g1', calendarId: 'cal-1', contentHash: 'h1', etag: 'e1' },
        broken: { calendarId: 'cal-1' },
      },
      ops: [
        { id: 'op1', kind: 'update', localId: 'b1', hash: 'h2', attempts: 3, nextAttemptAt: 123, createdAt: 'a', updatedAt: 'b', uncertain: true },
        { id: 'op2', kind: 'nuke', localId: 'b2' },
        { id: 'op3' },
      ],
      tombstones: { local: { gone: 'at' }, google: { gone2: 'at2' } },
      counters: { imported: 5, pushed: 7, conflicts: 2 },
    };

    const state = migrateState(raw);
    expect(state.targetCalendarId).toBe('cal-1');
    expect(state.connectedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(state.userEmail).toBe('user@example.com');
    expect(state.cursors['cal-1']?.syncToken).toBe('tok-1');
    expect(state.cursors.bad).toBeUndefined();
    expect(state.mappings.b1.googleEventId).toBe('g1');
    expect(state.mappings.b1.etag).toBe('e1');
    expect(state.googleToLocal.g1).toBe('b1');
    expect(state.mappings.broken).toBeUndefined();
    expect(state.ops).toHaveLength(1);
    expect(state.ops[0].hash).toBe('h2');
    expect(state.ops[0].attempts).toBe(3);
    expect(state.ops[0].uncertain).toBe(true);
    expect(state.tombstones.local.gone).toBe('at');
    expect(state.tombstones.google.gone2).toBe('at2');
    expect(state.counters).toEqual({ imported: 5, pushed: 7, conflicts: 2 });
  });

  it('fills defaults for fields the older version lacks', () => {
    const state = migrateState({ version: 1 });
    expect(state.targetCalendarId).toBe('primary');
    expect(state.cursors).toEqual({});
    expect(state.counters).toEqual({ imported: 0, pushed: 0, conflicts: 0 });
    expect(state.userEmail).toBeUndefined();
  });
});

describe('SyncStateStore', () => {
  it('round-trips state through an atomic file write', () => {
    const file = tmpFile();
    const store = new SyncStateStore(file, { now: () => 42 });
    const state = emptySyncState();
    state.userEmail = 'a@b.c';
    state.mappings.b1 = { localId: 'b1', googleEventId: 'g1', calendarId: 'primary', contentHash: 'h' };
    store.save(state);

    expect(fs.existsSync(file)).toBe(true);
    // No leftover tmp files from the atomic rename.
    expect(fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.tmp.'))).toHaveLength(0);

    const fresh = new SyncStateStore(file);
    const loaded = fresh.load();
    expect(loaded.userEmail).toBe('a@b.c');
    expect(loaded.mappings.b1.googleEventId).toBe('g1');
    expect(loaded.googleToLocal.g1).toBe('b1');
  });

  it('returns an empty state when the file is corrupt', () => {
    const file = tmpFile();
    fs.writeFileSync(file, '{ not json !!!', 'utf-8');
    const store = new SyncStateStore(file);
    const state = store.load();
    expect(state.mappings).toEqual({});
    expect(state.ops).toEqual([]);
  });

  it('caches until a new state is saved', () => {
    const file = tmpFile();
    const store = new SyncStateStore(file);
    const first = store.load();
    first.userEmail = 'cached@example.com';
    expect(store.load().userEmail).toBe('cached@example.com');
    const replaced = emptySyncState();
    store.save(replaced);
    expect(store.load().userEmail).toBeUndefined();
  });
});

describe('pruneTombstones', () => {
  it('drops tombstones older than the retention window', () => {
    const state: SyncState = emptySyncState();
    const now = Date.parse('2026-10-09T00:00:00Z');
    state.tombstones.local.recent = new Date(now - 1000).toISOString();
    state.tombstones.local.stale = new Date(now - 8 * 24 * 3600 * 1000).toISOString();
    state.tombstones.google.stale = new Date(now - 30 * 24 * 3600 * 1000).toISOString();
    state.tombstones.google.unparseable = 'not-a-date';

    pruneTombstones(state, now);

    expect(state.tombstones.local.recent).toBeDefined();
    expect(state.tombstones.local.stale).toBeUndefined();
    expect(state.tombstones.google.stale).toBeUndefined();
    expect(state.tombstones.google.unparseable).toBeUndefined();
  });
});
