import { ScheduleBlock, GoogleApplyMutations } from '../../src/types';
import {
  EnginePorts,
  EventMapping,
  GoogleEventResource,
  SyncOp,
  SyncRunResult,
  SyncState,
} from './types';
import {
  GoogleApiError,
  isAuthError,
  isConflictError,
  isNotFoundError,
  isSyncTokenGone,
  isTransientError,
} from './api';
import {
  blockToGoogleBody,
  contentHash,
  controlBlockIdOf,
  googleEventToBlock,
  isEligibleForPush,
  managedPatchBody,
  todayLocal,
} from './mapping';
import { pruneTombstones } from './state';

/**
 * The two-way sync engine.
 *
 * One syncOnce() run performs, in order:
 *   1. reconcile  — diff local Day Planner blocks against persisted mappings
 *                   and coalesce at most one pending op per block
 *   2. drain      — execute pending ops against the Google Calendar API
 *                   (create/update/delete) with idempotency + conflict rules
 *   3. pull       — incremental (or full) event pull; remote changes are
 *                   folded into the renderer via LocalDataPort.apply()
 *   4. cursors    — sync tokens advance ONLY after the renderer confirmed
 *                   the changes were durably saved
 *
 * The engine never imports `electron`: all I/O arrives through EnginePorts.
 */

const FULL_SYNC_LOOKBACK_MS = 45 * 24 * 60 * 60 * 1000;
const MAX_BACKOFF_MS = 10 * 60 * 1000;

/** Errors that abort the whole run (auth loss). */
class FatalSyncError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'FatalSyncError';
  }
}

interface BlockRef {
  block: ScheduleBlock;
  date: string;
}

interface TaggedEvent {
  calendarId: string;
  event: GoogleEventResource;
}

interface PullPlan {
  upserts: GoogleApplyMutations['upserts'];
  removals: GoogleApplyMutations['removals'];
  /** localId → event for mapping refresh after a successful apply. */
  events: Map<string, TaggedEvent>;
  /** localIds whose remote event was cancelled (mapping removal after apply). */
  cancelledLocalIds: Set<string>;
  /** Cursors to write only after apply succeeds. */
  cursorWrites: Array<{ calendarId: string; syncToken?: string; full: boolean; timeMin?: string }>;
  resynced: boolean;
}

export interface SyncOnceOptions {
  /** Force a full re-import (drops all sync tokens first). */
  full?: boolean;
}

export class SyncEngine {
  constructor(private readonly ports: EnginePorts) {}

  async syncOnce(opts: SyncOnceOptions = {}): Promise<SyncRunResult> {
    const result: SyncRunResult = {
      success: true,
      created: 0,
      updated: 0,
      deleted: 0,
      imported: 0,
      conflicts: 0,
    };
    const state = this.ports.stateStore.load();

    if (opts.full) {
      state.cursors = {};
      this.save(state);
    }

    const local = this.snapshotLocal();
    const defaultMode = this.ports.getDefaultMode();

    try {
      this.reconcile(state, local);
      this.save(state);

      const push = await this.drainOps(state, local, result);
      if (push.removals.length > 0) {
        const ok = await this.applyToRenderer({
          requestId: this.newRequestId('push'),
          upserts: [],
          removals: push.removals,
        });
        if (!ok) {
          // Mappings stay intact so the next run can retry this decision.
          throw new FatalSyncError(
            'The app could not apply a conflict resolution received from Google Calendar.',
            'apply_failed'
          );
        }
        for (const localId of push.unlink) {
          const mapping = state.mappings[localId];
          if (mapping) {
            delete state.googleToLocal[mapping.googleEventId];
            state.tombstones.google[mapping.googleEventId] = new Date(this.ports.now()).toISOString();
            delete state.mappings[localId];
          }
          state.tombstones.local[localId] = new Date(this.ports.now()).toISOString();
          local.delete(localId);
        }
        this.save(state);
      }

      const plan = await this.pull(state, local, defaultMode, opts);
      if (plan.resynced) result.resynced = true;

      if (plan.upserts.length > 0 || plan.removals.length > 0 || plan.cancelledLocalIds.size > 0) {
        const ok = await this.applyToRenderer({
          requestId: this.newRequestId('pull'),
          upserts: plan.upserts,
          removals: plan.removals,
        });
        if (!ok) {
          throw new FatalSyncError(
            'The app could not save the changes received from Google Calendar.',
            'apply_failed'
          );
        }
      }

      // Renderer confirmed — now it is safe to advance cursors & mappings.
      const importedBefore = state.counters.imported;
      this.finalizePull(state, plan);
      result.imported = state.counters.imported - importedBefore;
      state.lastSyncedAt = new Date(this.ports.now()).toISOString();
      delete state.lastError;
      delete state.lastErrorCode;
      pruneTombstones(state, this.ports.now());
      this.save(state);
      return result;
    } catch (err) {
      result.success = false;
      const message = err instanceof Error ? err.message : String(err);
      let code = 'api_error';
      if (err instanceof FatalSyncError) {
        code = err.code;
      } else if (isAuthError(err)) {
        code = 'auth_required';
      } else if (err instanceof GoogleApiError && (err.kind === 'transient' || err.kind === 'rate_limit')) {
        code = 'offline';
      } else if (isTransientError(err)) {
        code = 'offline';
      }
      result.error = message;
      result.errorCode = code;
      state.lastError = message;
      state.lastErrorCode = code;
      this.save(state);
      this.ports.logger.warn('Sync run failed', { code, error: message });
      return result;
    }
  }

  // ── 1. Reconcile: local blocks → pending ops ─────────────────────────────

  private reconcile(state: SyncState, local: Map<string, BlockRef>): void {
    const today = todayLocal(this.ports.now());
    const connectedAt = state.connectedAt;

    for (const { block } of local.values()) {
      const mapping = state.mappings[block.id];

      if (mapping) {
        // Keep the link in sync if the block carries a (repaired) Google id.
        if (block.googleCalendarEventId && block.googleCalendarEventId !== mapping.googleEventId) {
          delete state.googleToLocal[mapping.googleEventId];
          mapping.googleEventId = block.googleCalendarEventId;
          state.googleToLocal[mapping.googleEventId] = block.id;
        }
        const hash = contentHash(block);
        if (mapping.contentHash !== hash) {
          this.upsertOp(state, {
            kind: 'update',
            localId: block.id,
            googleEventId: mapping.googleEventId,
            calendarId: mapping.calendarId,
            hash,
          });
        }
        continue;
      }

      if (block.googleCalendarEventId) {
        // Self-heal a lost mapping from the id stored on the renderer block.
        if (state.googleToLocal[block.googleCalendarEventId] !== block.id) {
          delete state.googleToLocal[block.googleCalendarEventId];
          const healed: EventMapping = {
            localId: block.id,
            googleEventId: block.googleCalendarEventId,
            calendarId: block.googleCalendarId || state.targetCalendarId,
            contentHash: null,
            etag: block.googleEventETag,
          };
          state.mappings[block.id] = healed;
          state.googleToLocal[healed.googleEventId] = block.id;
          this.upsertOp(state, {
            kind: 'update',
            localId: block.id,
            googleEventId: healed.googleEventId,
            calendarId: healed.calendarId,
            hash: contentHash(block),
          });
        }
        continue;
      }

      if (!isEligibleForPush(block, today, connectedAt)) continue;
      this.upsertOp(state, { kind: 'create', localId: block.id, hash: contentHash(block) });
    }

    // Mappings whose local block is gone → the user deleted it locally.
    for (const mapping of Object.values(state.mappings)) {
      if (local.has(mapping.localId)) continue;
      this.upsertOp(state, {
        kind: 'delete',
        localId: mapping.localId,
        googleEventId: mapping.googleEventId,
        calendarId: mapping.calendarId,
      });
    }

    // Orphaned ops (no block, no mapping): an attempted create may have landed
    // remotely — turn it into a delete (drain searches by extended property).
    const orphanIds = state.ops
      .filter((op) => !local.has(op.localId) && !state.mappings[op.localId])
      .map((op) => op.id);
    for (const id of orphanIds) {
      const op = state.ops.find((o) => o.id === id);
      if (!op) continue;
      const attempted = op.uncertain || op.attempts > 0;
      state.ops = state.ops.filter((o) => o.id !== id);
      if (attempted && op.kind !== 'delete') {
        this.upsertOp(state, {
          kind: 'delete',
          localId: op.localId,
          googleEventId: op.googleEventId,
          calendarId: op.calendarId,
        });
      }
    }
  }

  /**
   * Insert or replace the pending op for a localId. An identical pending op
   * is left untouched (keeps backoff / permanent flags / uncertain state).
   */
  private upsertOp(
    state: SyncState,
    spec: {
      kind: SyncOp['kind'];
      localId: string;
      googleEventId?: string;
      calendarId?: string;
      hash?: string;
    }
  ): SyncOp | undefined {
    const existing = state.ops.find((o) => o.localId === spec.localId);
    const nowIso = new Date(this.ports.now()).toISOString();

    if (existing) {
      const sameIntent =
        existing.kind === spec.kind &&
        (spec.kind === 'delete'
          ? true
          : (existing.hash ?? null) === (spec.hash ?? null));
      if (sameIntent) {
        // Content unchanged — keep retry state; refresh link info if provided.
        if (spec.googleEventId) existing.googleEventId = spec.googleEventId;
        if (spec.calendarId) existing.calendarId = spec.calendarId;
        return existing;
      }

      const next: SyncOp = {
        id: existing.id,
        kind: spec.kind,
        localId: spec.localId,
        attempts: 0,
        nextAttemptAt: 0,
        createdAt: existing.createdAt,
        updatedAt: nowIso,
      };
      if (spec.hash !== undefined) next.hash = spec.hash;
      if (spec.googleEventId !== undefined) next.googleEventId = spec.googleEventId;
      else if (existing.googleEventId !== undefined) next.googleEventId = existing.googleEventId;
      if (spec.calendarId !== undefined) next.calendarId = spec.calendarId;
      else if (existing.calendarId !== undefined) next.calendarId = existing.calendarId;
      // A create that may already exist remotely stays flagged across re-queues.
      if (spec.kind === 'create' && existing.kind === 'create' && (existing.uncertain || existing.attempts > 0)) {
        next.uncertain = true;
      }
      const idx = state.ops.findIndex((o) => o.id === existing.id);
      state.ops[idx] = next;
      return next;
    }

    const created: SyncOp = {
      id: `op-${spec.localId}-${this.ports.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      kind: spec.kind,
      localId: spec.localId,
      attempts: 0,
      nextAttemptAt: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    if (spec.hash !== undefined) created.hash = spec.hash;
    if (spec.googleEventId !== undefined) created.googleEventId = spec.googleEventId;
    if (spec.calendarId !== undefined) created.calendarId = spec.calendarId;
    state.ops.push(created);
    return created;
  }

  private removeOp(state: SyncState, opId: string): void {
    state.ops = state.ops.filter((o) => o.id !== opId);
  }

  // ── 2. Drain: execute pending ops ────────────────────────────────────────

  /**
   * Executes pending ops. `removals` are renderer instructions for when a
   * remote deletion beats a pending local edit; `unlink` lists localIds whose
   * mapping may only be dropped AFTER the renderer confirmed `removals`.
   */
  private async drainOps(
    state: SyncState,
    local: Map<string, BlockRef>,
    result: SyncRunResult
  ): Promise<{ removals: GoogleApplyMutations['removals']; unlink: string[] }> {
    const removals: GoogleApplyMutations['removals'] = [];
    const unlink: string[] = [];
    const queue = [...state.ops].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const queued of queue) {
      const op = state.ops.find((o) => o.id === queued.id);
      if (!op) continue;
      if (op.permanent) continue;
      if (op.nextAttemptAt > this.ports.now()) continue;

      try {
        await this.executeOp(state, local, op, result, removals, unlink);
        this.removeOp(state, op.id);
        this.save(state);
      } catch (err) {
        if (err instanceof FatalSyncError) throw err;
        if (isAuthError(err)) {
          throw new FatalSyncError('Google authorization expired. Please reconnect.', 'auth_required');
        }
        this.recordOpFailure(state, op, err);
        this.save(state);
      }
    }
    return { removals, unlink };
  }

  private async executeOp(
    state: SyncState,
    local: Map<string, BlockRef>,
    op: SyncOp,
    result: SyncRunResult,
    removals: GoogleApplyMutations['removals'],
    unlink: string[]
  ): Promise<void> {
    const ref = local.get(op.localId);

    // Intent races: block reappeared / vanished since reconcile ran.
    if (op.kind === 'delete' && ref) {
      return; // next reconcile re-queues the current intent
    }
    if (op.kind !== 'delete' && !ref) {
      return; // next reconcile converts this to a delete (or drops it)
    }

    if (op.kind === 'create') {
      await this.executeCreate(state, op, ref!, result);
      return;
    }
    if (op.kind === 'update') {
      await this.executeUpdate(state, op, ref!, result, removals, unlink);
      return;
    }
    await this.executeDelete(state, op, result);
  }

  private modeMetaFor(block: ScheduleBlock): { id: string; cycles: number; workDuration: number; breakDuration: number } {
    return {
      id: block.modeId,
      cycles: block.cycles,
      workDuration: block.workDuration,
      breakDuration: block.breakDuration,
    };
  }

  private async executeCreate(
    state: SyncState,
    op: SyncOp,
    ref: BlockRef,
    result: SyncRunResult
  ): Promise<void> {
    const block = ref.block;
    const calId = op.calendarId || state.targetCalendarId;
    const body = blockToGoogleBody(block, {
      timeZone: this.ports.timeZone,
      mode: this.modeMetaFor(block),
    });

    // ALWAYS search by controlBlockId before inserting — even when this op
    // was never attempted — so a retry can never create a duplicate.
    const existingRemote = await this.findOwnedEvent(state, calId, block.id);
    let event: GoogleEventResource;

    if (existingRemote) {
      const patchBody = { ...body };
      delete patchBody.id;
      try {
        event = await this.ports.api.patchEvent(calId, existingRemote.id, patchBody, existingRemote.etag);
      } catch (err) {
        if (!isConflictError(err)) throw err;
        // The adopted event changed remotely — local wins on concurrent edit.
        result.conflicts++;
        state.counters.conflicts++;
        event = await this.ports.api.patchEvent(calId, existingRemote.id, patchBody);
      }
    } else {
      try {
        event = await this.ports.api.insertEvent(calId, body);
      } catch (err) {
        // A create that reached Google but whose response was lost surfaces
        // as a duplicate-key style error on retry; mark uncertain and let the
        // next attempt's search adopt it.
        if (err instanceof GoogleApiError && err.status === 409) {
          op.uncertain = true;
        }
        throw err;
      }
    }

    this.recordMapping(state, block.id, event, calId, contentHash(block), true);
    if (!existingRemote) result.created++;
  }

  private async executeUpdate(
    state: SyncState,
    op: SyncOp,
    ref: BlockRef,
    result: SyncRunResult,
    removals: GoogleApplyMutations['removals'],
    unlink: string[]
  ): Promise<void> {
    const block = ref.block;
    let mapping = state.mappings[op.localId];
    if (!mapping) {
      // Mapping lost mid-run — fall back to create semantics (search + insert).
      await this.executeCreate(state, op, ref, result);
      return;
    }

    const body = managedPatchBody(block, {
      timeZone: this.ports.timeZone,
      mode: this.modeMetaFor(block),
    });

    let event: GoogleEventResource;
    try {
      event = await this.ports.api.patchEvent(
        mapping.calendarId,
        mapping.googleEventId,
        body,
        mapping.etag
      );
    } catch (err) {
      if (isConflictError(err)) {
        // Concurrent remote edit — local wins: re-patch without the ETag.
        result.conflicts++;
        state.counters.conflicts++;
        event = await this.ports.api.patchEvent(mapping.calendarId, mapping.googleEventId, body);
      } else if (isNotFoundError(err)) {
        const found = await this.findOwnedEvent(state, mapping.calendarId, block.id);
        if (found) {
          event = await this.ports.api.patchEvent(mapping.calendarId, found.id, body);
          if (found.id !== mapping.googleEventId) {
            delete state.googleToLocal[mapping.googleEventId];
            mapping.googleEventId = found.id;
            state.googleToLocal[found.id] = block.id;
          }
        } else {
          // Remote deletion beats the pending local edit (documented policy).
          // The mapping is unlinked only after the renderer confirms the
          // removal — see the `unlink` list applied in syncOnce().
          result.conflicts++;
          state.counters.conflicts++;
          removals.push({ localId: block.id, date: ref.date });
          unlink.push(block.id);
          this.ports.logger.info('Remote event deleted before local edit reached Google', {
            localId: block.id,
          });
          return;
        }
      } else {
        throw err;
      }
    }

    this.recordMapping(state, block.id, event, mapping.calendarId, contentHash(block), false);
    result.updated++;
  }

  private async executeDelete(
    state: SyncState,
    op: SyncOp,
    result: SyncRunResult
  ): Promise<void> {
    const mapping = state.mappings[op.localId];
    const calId = op.calendarId || mapping?.calendarId || state.targetCalendarId;
    let gid = op.googleEventId || mapping?.googleEventId;

    if (!gid) {
      const found = await this.findOwnedEvent(state, calId, op.localId);
      if (!found) {
        // Nothing remote to delete — state is already consistent.
        if (mapping) {
          delete state.mappings[op.localId];
          delete state.googleToLocal[mapping.googleEventId];
        }
        return;
      }
      gid = found.id;
    }

    try {
      await this.ports.api.deleteEvent(calId, gid);
    } catch (err) {
      // 404/410: already gone — idempotent success.
      if (!isNotFoundError(err)) throw err;
    }

    if (mapping) delete state.mappings[op.localId];
    delete state.googleToLocal[gid];
    const nowIso = new Date(this.ports.now()).toISOString();
    state.tombstones.google[gid] = nowIso;
    state.tombstones.local[op.localId] = nowIso;
    result.deleted++;
  }

  private recordMapping(
    state: SyncState,
    localId: string,
    event: GoogleEventResource,
    calendarId: string,
    hash: string,
    isCreate: boolean
  ): void {
    const existing = state.mappings[localId];
    if (existing && existing.googleEventId !== event.id) {
      delete state.googleToLocal[existing.googleEventId];
    }
    const mapping: EventMapping = {
      localId,
      googleEventId: event.id,
      calendarId,
      contentHash: hash,
      lastPushedAt: new Date(this.ports.now()).toISOString(),
    };
    const etag = event.etag ?? (event as { etag?: string }).etag;
    if (etag) mapping.etag = etag;
    else if (existing?.etag) mapping.etag = existing.etag;
    if (existing?.lastPulledAt) mapping.lastPulledAt = existing.lastPulledAt;
    state.mappings[localId] = mapping;
    state.googleToLocal[event.id] = localId;
    if (isCreate) state.counters.pushed++;
  }

  private recordOpFailure(state: SyncState, op: SyncOp, err: unknown): void {
    const nowIso = new Date(this.ports.now()).toISOString();
    op.attempts += 1;
    op.updatedAt = nowIso;
    op.lastError = err instanceof Error ? err.message : String(err);

    if (err instanceof GoogleApiError) {
      op.lastErrorCode = err.kind;
      if (err.kind === 'transient' || err.kind === 'rate_limit') {
        const delay = Math.min(800 * 2 ** (op.attempts - 1), MAX_BACKOFF_MS);
        const jitter = Math.floor(Math.random() * 300);
        op.nextAttemptAt = this.ports.now() + delay + jitter;
        this.ports.logger.warn('Retrying sync operation', {
          kind: op.kind,
          attempts: op.attempts,
          error: op.lastError,
        });
        return;
      }
      if (err.kind === 'not_found' || err.kind === 'gone') {
        // Link is stale: drop it so the next reconcile re-creates cleanly.
        const mapping = state.mappings[op.localId];
        if (mapping) {
          delete state.mappings[op.localId];
          delete state.googleToLocal[mapping.googleEventId];
        }
        const delay = Math.min(800 * 2 ** (op.attempts - 1), MAX_BACKOFF_MS);
        op.nextAttemptAt = this.ports.now() + delay;
        return;
      }
      // Validation / permission problems: stop retrying until content changes.
      // Exception: an uncertain create may already exist remotely (the 409
      // arrived after a lost response), so back off and let the next attempt's
      // pre-insert search adopt it instead of giving up.
      if (op.kind === 'create' && op.uncertain) {
        const delay = Math.min(800 * 2 ** (op.attempts - 1), MAX_BACKOFF_MS);
        op.nextAttemptAt = this.ports.now() + delay;
        return;
      }
      op.permanent = true;
      state.lastError = op.lastError;
      state.lastErrorCode = err.kind;
      this.ports.logger.error('Sync operation failed permanently', {
        kind: op.kind,
        error: op.lastError,
        status: err.status,
      });
      return;
    }

    if (isTransientError(err)) {
      op.lastErrorCode = 'transient';
      const delay = Math.min(800 * 2 ** (op.attempts - 1), MAX_BACKOFF_MS);
      op.nextAttemptAt = this.ports.now() + delay + Math.floor(Math.random() * 300);
      return;
    }

    op.permanent = true;
    op.lastErrorCode = 'unknown';
    state.lastError = op.lastError;
    state.lastErrorCode = 'unknown';
  }

  // ── 3. Pull: remote changes → renderer ───────────────────────────────────

  private async pull(
    state: SyncState,
    local: Map<string, BlockRef>,
    defaultMode: { id: string; name: string; icon: string; color: string } | null,
    opts: SyncOnceOptions
  ): Promise<PullPlan> {
    const plan: PullPlan = {
      upserts: [],
      removals: [],
      events: new Map(),
      cancelledLocalIds: new Set(),
      cursorWrites: [],
      resynced: false,
    };

    const timeMin = new Date(this.ports.now() - FULL_SYNC_LOOKBACK_MS).toISOString();
    const calendars = Array.from(
      new Set([
        state.targetCalendarId,
        ...Object.values(state.mappings).map((m) => m.calendarId),
      ])
    ).filter((c) => !!c);

    const pendingLocalIds = new Set(state.ops.map((o) => o.localId));

    for (const calendarId of calendars) {
      const cursor = state.cursors[calendarId] || {};
      let fetched: { items: TaggedEvent[]; nextSyncToken?: string };

      if (cursor.syncToken) {
        try {
          fetched = await this.fetchCalendar(calendarId, { syncToken: cursor.syncToken });
        } catch (err) {
          const stale =
            isSyncTokenGone(err) ||
            (err instanceof GoogleApiError && err.status === 400);
          if (!stale) throw err;
          plan.resynced = true;
          this.ports.logger.info('Sync token invalid — performing full re-sync', { calendarId });
          fetched = await this.fetchCalendar(calendarId, { timeMin });
          plan.cursorWrites.push({ calendarId, syncToken: fetched.nextSyncToken, full: true, timeMin });
        }
        if (!plan.cursorWrites.some((w) => w.calendarId === calendarId)) {
          plan.cursorWrites.push({ calendarId, syncToken: fetched.nextSyncToken, full: false });
        }
      } else {
        fetched = await this.fetchCalendar(calendarId, { timeMin });
        plan.cursorWrites.push({ calendarId, syncToken: fetched.nextSyncToken, full: true, timeMin });
      }

      for (const tagged of fetched.items) {
        this.classifyEvent(state, local, pendingLocalIds, defaultMode, tagged, plan);
      }
    }

    return plan;
  }

  private async fetchCalendar(
    calendarId: string,
    params: { syncToken?: string; timeMin?: string }
  ): Promise<{ items: TaggedEvent[]; nextSyncToken?: string }> {
    const items: TaggedEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    do {
      const res = await this.ports.api.listEvents(calendarId, {
        syncToken: params.syncToken,
        timeMin: params.timeMin,
        pageToken,
        singleEvents: true,
        showDeleted: true,
        maxResults: 250,
      });
      for (const event of res.items || []) items.push({ calendarId, event });
      pageToken = res.nextPageToken;
      if (!pageToken && res.nextSyncToken) nextSyncToken = res.nextSyncToken;
    } while (pageToken);
    return { items, nextSyncToken };
  }

  private classifyEvent(
    state: SyncState,
    local: Map<string, BlockRef>,
    pendingLocalIds: Set<string>,
    defaultMode: { id: string; name: string; icon: string; color: string } | null,
    tagged: TaggedEvent,
    plan: PullPlan
  ): void {
    const { calendarId, event } = tagged;
    if (!event?.id) return;
    if (state.tombstones.google[event.id]) return;

    const controlId = controlBlockIdOf(event);
    const localId = controlId || state.googleToLocal[event.id];
    const mapping = localId ? state.mappings[localId] : undefined;
    if (localId && state.tombstones.local[localId] && !local.has(localId)) return;

    // Remote deletion of a mapped event.
    if (event.status === 'cancelled') {
      if (!localId) return;
      const ref = local.get(localId);
      if (ref) {
        plan.removals.push({ localId, date: ref.date });
        plan.cancelledLocalIds.add(localId);
      } else if (mapping) {
        // Mapping exists but the block is already gone locally — just unlink.
        plan.cancelledLocalIds.add(localId);
      } else if (controlId) {
        plan.cancelledLocalIds.add(controlId);
      }
      return;
    }

    // A local op is pending for this block → local wins; the remote change is
    // superseded by our outgoing push (documented conflict policy).
    if (localId && pendingLocalIds.has(localId)) return;

    if (localId && local.has(localId)) {
      const existing = local.get(localId)!;
      const rebuilt = googleEventToBlock(event, { defaultMode, existing: existing.block });
      const rebuiltHash = contentHash(rebuilt);

      if (mapping && mapping.contentHash === rebuiltHash) {
        // Mirrored content already in sync (any etag drift is cosmetic).
        mapping.etag = event.etag ?? mapping.etag;
        mapping.lastPulledAt = new Date(this.ports.now()).toISOString();
        return;
      }

      const block = googleEventToBlock(event, { defaultMode, existing: existing.block });
      plan.upserts.push({ localId: existing.block.id, date: block.date, block });
      plan.events.set(existing.block.id, { calendarId, event });
      return;
    }

    // New remote event → import as a block.
    const block = googleEventToBlock(event, { defaultMode });
    if (local.has(block.id)) return;
    plan.upserts.push({ localId: block.id, date: block.date, block });
    plan.events.set(block.id, { calendarId, event });
  }

  /**
   * Runs after the renderer confirmed the changes were saved: advances sync
   * tokens, refreshes mappings and imports counters.
   */
  private finalizePull(state: SyncState, plan: PullPlan): void {
    const nowIso = new Date(this.ports.now()).toISOString();

    for (const write of plan.cursorWrites) {
      const cursor = state.cursors[write.calendarId] || {};
      if (write.full) {
        cursor.lastFullSyncAt = nowIso;
        if (write.timeMin) cursor.timeMin = write.timeMin;
        state.lastFullSyncAt = nowIso;
      } else {
        cursor.lastIncrementalAt = nowIso;
      }
      if (write.syncToken) cursor.syncToken = write.syncToken;
      else delete cursor.syncToken;
      state.cursors[write.calendarId] = cursor;
    }

    for (const upsert of plan.upserts) {
      const tagged = plan.events.get(upsert.localId);
      if (!tagged) continue;
      const isNew = !state.mappings[upsert.localId];
      const mapping: EventMapping = {
        localId: upsert.localId,
        googleEventId: tagged.event.id,
        calendarId: tagged.calendarId,
        contentHash: contentHash(upsert.block),
        lastPulledAt: nowIso,
      };
      if (tagged.event.etag) mapping.etag = tagged.event.etag;
      const prev = state.mappings[upsert.localId];
      if (prev?.lastPushedAt) mapping.lastPushedAt = prev.lastPushedAt;
      state.mappings[upsert.localId] = mapping;
      state.googleToLocal[tagged.event.id] = upsert.localId;
      if (isNew) state.counters.imported++;
    }

    for (const localId of plan.cancelledLocalIds) {
      const mapping = state.mappings[localId];
      if (mapping) {
        delete state.googleToLocal[mapping.googleEventId];
        state.tombstones.google[mapping.googleEventId] = nowIso;
        delete state.mappings[localId];
      }
      state.tombstones.local[localId] = nowIso;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async applyToRenderer(mutations: GoogleApplyMutations): Promise<boolean> {
    try {
      const res = await this.ports.localData.apply(mutations);
      if (res?.success) return true;
      this.ports.logger.warn('Renderer rejected sync changes', { error: res?.error });
      return false;
    } catch (err) {
      this.ports.logger.warn('Renderer apply failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  private async findOwnedEvent(
    state: SyncState,
    preferredCalendar: string,
    blockId: string
  ): Promise<GoogleEventResource | null> {
    const calendars = Array.from(
      new Set([preferredCalendar, state.targetCalendarId])
    ).filter((c) => !!c);
    for (const cal of calendars) {
      try {
        const found = await this.ports.api.findEventByControlBlockId(cal, blockId);
        if (found) return found;
      } catch (err) {
        if (isAuthError(err)) throw err;
        this.ports.logger.warn('Lookup by controlBlockId failed', {
          calendarId: cal,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return null;
  }

  private snapshotLocal(): Map<string, BlockRef> {
    const map = new Map<string, BlockRef>();
    const plans = this.ports.localData.getPlans();
    for (const plan of Object.values(plans || {})) {
      if (!plan) continue;
      for (const block of plan.blocks || []) {
        if (!block?.id) continue;
        map.set(block.id, { block, date: block.date || plan.date });
      }
    }
    return map;
  }

  private save(state: SyncState): void {
    this.ports.stateStore.save(state);
    this.ports.onStateSaved?.(state);
  }

  private newRequestId(prefix: string): string {
    return `${prefix}-${this.ports.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }
}
