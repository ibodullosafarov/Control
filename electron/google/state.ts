import * as fs from 'fs';
import * as path from 'path';
import {
  CalendarSyncCursor,
  EventMapping,
  SyncOp,
  SyncState,
  SyncStateStorePort,
  SYNC_STATE_VERSION,
  emptySyncState,
} from './types';

/**
 * Durable sync state (~/.focus-app/google-sync/state.json).
 *
 * Everything needed to resume after a crash/restart lives here: mappings,
 * per-calendar sync tokens, the pending operation queue and tombstones.
 * Writes are atomic (tmp file + rename) so a crash never leaves a torn file.
 */

export interface StateStoreOptions {
  now?: () => number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Migrate older state files forward, preserving whatever data exists. */
export function migrateState(raw: unknown): SyncState {
  const base = emptySyncState();
  if (!isRecord(raw)) return base;

  const version = typeof raw.version === 'number' ? raw.version : 1;
  const state: SyncState = {
    ...base,
    version: SYNC_STATE_VERSION,
    targetCalendarId:
      typeof raw.targetCalendarId === 'string' && raw.targetCalendarId.trim()
        ? raw.targetCalendarId
        : base.targetCalendarId,
    cursors: {},
    mappings: {},
    googleToLocal: {},
    ops: [],
    tombstones: { local: {}, google: {} },
    counters: { ...base.counters },
  };

  if (typeof raw.connectedAt === 'string') state.connectedAt = raw.connectedAt;
  if (typeof raw.userEmail === 'string') state.userEmail = raw.userEmail;
  if (typeof raw.lastSyncedAt === 'string') state.lastSyncedAt = raw.lastSyncedAt;
  if (typeof raw.lastFullSyncAt === 'string') state.lastFullSyncAt = raw.lastFullSyncAt;
  if (typeof raw.lastError === 'string') state.lastError = raw.lastError;
  if (typeof raw.lastErrorCode === 'string') state.lastErrorCode = raw.lastErrorCode;

  if (isRecord(raw.cursors)) {
    for (const [cal, cur] of Object.entries(raw.cursors)) {
      if (!isRecord(cur)) continue;
      const c: CalendarSyncCursor = {};
      if (typeof cur.syncToken === 'string') c.syncToken = cur.syncToken;
      if (typeof cur.lastFullSyncAt === 'string') c.lastFullSyncAt = cur.lastFullSyncAt;
      if (typeof cur.lastIncrementalAt === 'string') c.lastIncrementalAt = cur.lastIncrementalAt;
      if (typeof cur.timeMin === 'string') c.timeMin = cur.timeMin;
      state.cursors[cal] = c;
    }
  }

  if (isRecord(raw.mappings)) {
    for (const [localId, m] of Object.entries(raw.mappings)) {
      if (!isRecord(m)) continue;
      if (typeof m.googleEventId !== 'string') continue;
      const mapping: EventMapping = {
        localId,
        googleEventId: m.googleEventId,
        calendarId: typeof m.calendarId === 'string' && m.calendarId ? m.calendarId : state.targetCalendarId,
        contentHash: typeof m.contentHash === 'string' ? m.contentHash : null,
      };
      if (typeof m.etag === 'string') mapping.etag = m.etag;
      if (typeof m.lastPushedAt === 'string') mapping.lastPushedAt = m.lastPushedAt;
      if (typeof m.lastPulledAt === 'string') mapping.lastPulledAt = m.lastPulledAt;
      state.mappings[localId] = mapping;
      state.googleToLocal[mapping.googleEventId] = localId;
    }
  }

  if (Array.isArray(raw.ops)) {
    for (const op of raw.ops) {
      if (!isRecord(op)) continue;
      if (typeof op.id !== 'string' || typeof op.localId !== 'string') continue;
      if (op.kind !== 'create' && op.kind !== 'update' && op.kind !== 'delete') continue;
      const migrated: SyncOp = {
        id: op.id,
        kind: op.kind,
        localId: op.localId,
        attempts: typeof op.attempts === 'number' ? op.attempts : 0,
        nextAttemptAt: typeof op.nextAttemptAt === 'number' ? op.nextAttemptAt : 0,
        createdAt: typeof op.createdAt === 'string' ? op.createdAt : new Date().toISOString(),
        updatedAt: typeof op.updatedAt === 'string' ? op.updatedAt : new Date().toISOString(),
      };
      if (typeof op.hash === 'string') migrated.hash = op.hash;
      if (typeof op.googleEventId === 'string') migrated.googleEventId = op.googleEventId;
      if (typeof op.calendarId === 'string') migrated.calendarId = op.calendarId;
      if (typeof op.lastError === 'string') migrated.lastError = op.lastError;
      if (typeof op.lastErrorCode === 'string') migrated.lastErrorCode = op.lastErrorCode;
      if (op.permanent === true) migrated.permanent = true;
      if (op.uncertain === true) migrated.uncertain = true;
      state.ops.push(migrated);
    }
  }

  if (isRecord(raw.tombstones)) {
    if (isRecord(raw.tombstones.local)) {
      for (const [id, at] of Object.entries(raw.tombstones.local)) {
        if (typeof at === 'string') state.tombstones.local[id] = at;
      }
    }
    if (isRecord(raw.tombstones.google)) {
      for (const [id, at] of Object.entries(raw.tombstones.google)) {
        if (typeof at === 'string') state.tombstones.google[id] = at;
      }
    }
  }

  if (isRecord(raw.counters)) {
    if (typeof raw.counters.imported === 'number') state.counters.imported = raw.counters.imported;
    if (typeof raw.counters.pushed === 'number') state.counters.pushed = raw.counters.pushed;
    if (typeof raw.counters.conflicts === 'number') state.counters.conflicts = raw.counters.conflicts;
  }

  // Version bump sanity: unknown future versions are read best-effort above.
  void version;
  return state;
}

export class SyncStateStore implements SyncStateStorePort {
  private cache: SyncState | null = null;
  private readonly now: () => number;

  constructor(
    private readonly filePath: string,
    opts: StateStoreOptions = {}
  ) {
    this.now = opts.now ?? (() => Date.now());
  }

  load(): SyncState {
    if (this.cache) return this.cache;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        this.cache = migrateState(raw);
        return this.cache;
      }
    } catch (err) {
      console.warn('[gcal] Failed to load sync state, starting fresh:', err instanceof Error ? err.message : err);
    }
    this.cache = emptySyncState();
    return this.cache;
  }

  save(state: SyncState): void {
    this.cache = state;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${this.filePath}.tmp.${this.now()}`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('[gcal] Failed to persist sync state:', err instanceof Error ? err.message : err);
    }
  }

  /** In-memory only (tests / transient previews). */
  static inMemory(initial?: SyncState): SyncStateStorePort & { state: SyncState } {
    let state = initial ?? emptySyncState();
    return {
      get state() {
        return state;
      },
      load: () => state,
      save: (s) => {
        state = s;
      },
    };
  }
}

/** Prune tombstones older than `maxAgeMs` so the state file cannot grow forever. */
export function pruneTombstones(state: SyncState, nowMs: number, maxAgeMs = 7 * 24 * 3600 * 1000): void {
  for (const bucket of [state.tombstones.local, state.tombstones.google] as Array<Record<string, string>>) {
    for (const [id, at] of Object.entries(bucket)) {
      const ts = Date.parse(at);
      if (!Number.isFinite(ts) || nowMs - ts > maxAgeMs) delete bucket[id];
    }
  }
}
