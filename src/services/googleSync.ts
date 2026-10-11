import { useSyncExternalStore } from 'react';
import {
  DayPlan,
  FocusAppData,
  GoogleApplyMutations,
  GoogleApplyResult,
  GoogleSyncStatus,
  ScheduleBlock,
} from '../types';

/**
 * Renderer-side handle to the main-process Google Calendar sync engine.
 *
 * - Holds the latest GoogleSyncStatus pushed from the main process.
 * - Registers the apply handler that folds remote changes into app data and
 *   persists them (the main process only advances its sync token after this
 *   round-trip resolves successfully).
 * - Contains the pure `applyMutationsToData` reducer (unit-testable).
 *
 * OAuth tokens and credentials never appear here.
 */

export const DISCONNECTED_STATUS: GoogleSyncStatus = {
  available: false,
  configured: false,
  connected: false,
  needsReauth: false,
  phase: 'unavailable',
  syncing: false,
  pendingOps: 0,
  conflictCount: 0,
  insecureStorage: false,
  importedCount: 0,
  pushedCount: 0,
};

type ApplyHandler = (mutations: GoogleApplyMutations) => Promise<GoogleApplyResult>;

class GoogleSyncClient {
  private status: GoogleSyncStatus = DISCONNECTED_STATUS;
  private readonly listeners = new Set<(s: GoogleSyncStatus) => void>();
  private applyHandler: ApplyHandler | null = null;
  private initialized = false;

  getStatus(): GoogleSyncStatus {
    return this.status;
  }

  subscribe(listener: (s: GoogleSyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Idempotent: attaches status + apply listeners (Electron only). */
  init(): () => void {
    if (this.initialized || !window.focusAPI?.googleCalendar) {
      return () => undefined;
    }
    this.initialized = true;
    const api = window.focusAPI.googleCalendar;

    const unsubStatus = api.onStatus((status) => this.setStatus(status));
    const unsubApply = api.onApplyChanges(async (mutations) => {
      if (!this.applyHandler) {
        return { success: false, error: 'Calendar sync handler is not ready.' } as GoogleApplyResult;
      }
      return this.applyHandler(mutations);
    });

    void api
      .getStatus()
      .then((status) => this.setStatus(status))
      .catch(() => undefined);

    return () => {
      unsubStatus();
      unsubApply();
      this.initialized = false;
    };
  }

  /** App registers the routine that folds mutations into FocusAppData. */
  registerApplyHandler(handler: ApplyHandler): () => void {
    this.applyHandler = handler;
    return () => {
      if (this.applyHandler === handler) this.applyHandler = null;
    };
  }

  private setStatus(status: GoogleSyncStatus): void {
    this.status = status;
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (err) {
        console.warn('[gcal] status listener failed', err);
      }
    }
  }
}

export const googleSync = new GoogleSyncClient();

export function useGoogleSyncStatus(): GoogleSyncStatus {
  return useSyncExternalStore(
    (cb) => googleSync.subscribe(cb),
    () => googleSync.getStatus(),
    () => DISCONNECTED_STATUS
  );
}

// ── Pure reducer: fold remote mutations into app data ──────────────────────

function emptyPlan(date: string): DayPlan {
  return {
    date,
    goals: [],
    timeWindows: [],
    blocks: [],
    isApproved: false,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Apply sync mutations to FocusAppData (immutable).
 *
 * - An upsert removes the block from whatever plan currently holds it (an
 *   event whose date moved arrives under its new date) and inserts/merges it
 *   into the target plan.
 * - A removal deletes the block wherever it lives; goals/windows/settings are
 *   never touched.
 * - Planner-specific fields that a merged block already carries are preserved
 *   as-is: incoming blocks were built by the sync engine on top of the
 *   existing block.
 */
export function applyMutationsToData(
  data: FocusAppData,
  mutations: GoogleApplyMutations
): FocusAppData {
  if (!mutations || (!mutations.upserts?.length && !mutations.removals?.length)) {
    return data;
  }

  const removalIds = new Set((mutations.removals || []).map((r) => r.localId));
  const upserts = mutations.upserts || [];
  const upsertById = new Map<string, { date: string; block: ScheduleBlock }>();
  for (const u of upserts) {
    upsertById.set(u.localId, { date: u.date || u.block.date, block: u.block });
  }

  const nextPlans: Record<string, DayPlan> = {};
  const consumed = new Set<string>();
  const now = new Date().toISOString();

  for (const [date, plan] of Object.entries(data.plans || {})) {
    let changed = false;
    const kept: ScheduleBlock[] = [];
    for (const block of plan.blocks || []) {
      if (removalIds.has(block.id)) {
        changed = true;
        continue;
      }
      const upsert = upsertById.get(block.id);
      if (upsert) {
        changed = true;
        if (upsert.date === date) {
          // Same date: replace in place, preserving position.
          kept.push({ ...upsert.block, date });
          consumed.add(block.id);
        }
        // Date moved: drop the old copy here; inserted into the new plan below.
        continue;
      }
      kept.push(block);
    }
    nextPlans[date] = changed ? { ...plan, blocks: kept, updatedAt: now } : plan;
  }

  // New blocks and blocks that moved to a different date.
  for (const u of upserts) {
    if (consumed.has(u.localId)) continue;
    const date = u.date || u.block.date;
    const base = nextPlans[date] || emptyPlan(date);
    const blocks = (base.blocks || []).filter((b) => b.id !== u.localId);
    blocks.push({ ...u.block, date });
    blocks.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    nextPlans[date] = { ...base, date, blocks, updatedAt: now };
  }

  return { ...data, plans: nextPlans };
}

/** Count how many blocks a mutation batch would touch (for UI feedback). */
export function countMutationTargets(mutations: GoogleApplyMutations): number {
  return (mutations.upserts?.length || 0) + (mutations.removals?.length || 0);
}
