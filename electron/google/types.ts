import { DayPlan, GoogleApplyMutations, GoogleApplyResult, ScheduleBlock } from '../../src/types';

/**
 * Internal types for the Google Calendar sync subsystem.
 *
 * Everything here lives in the main process. Nothing in this module may be
 * forwarded verbatim to the renderer: OAuth tokens and raw credentials must
 * never cross the process boundary (only GoogleSyncStatus, which is a filtered
 * projection built by GoogleSyncService).
 */

/** Loose shape of a Google Calendar API event resource (only known fields typed). */
export interface GoogleEventResource {
  id: string;
  status?: string;
  etag?: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  created?: string;
  updated?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: { date?: string; dateTime?: string; timeZone?: string };
  iCalUID?: string;
  transparency?: string;
  visibility?: string;
  guestsCanInviteOthers?: string;
  locked?: string;
  hangoutLink?: string;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
  attachments?: Array<{ fileUrl?: string; title?: string; mimeType?: string }>;
  reminders?: { useDefault?: boolean; overrides?: Array<{ method?: string; minutes?: number }> };
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  [key: string]: unknown;
}

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  accessRole?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  selected?: boolean;
  hidden?: boolean;
}

/** Durable local-id ↔ Google-event link. Survives restarts in the state file. */
export interface EventMapping {
  localId: string;
  googleEventId: string;
  calendarId: string;
  /** Last ETag observed for the remote event — conflict detection on push. */
  etag?: string;
  /** Hash of the managed fields last known to match both sides (null = unknown). */
  contentHash: string | null;
  lastPushedAt?: string;
  lastPulledAt?: string;
}

export type SyncOpKind = 'create' | 'update' | 'delete';

/**
 * A persisted pending operation. At most one op exists per localId (later
 * intents replace earlier ones), which keeps the queue coalesced and makes
 * retries naturally idempotent.
 */
export interface SyncOp {
  id: string;
  kind: SyncOpKind;
  localId: string;
  /** Remote id for update/delete when known at enqueue time. */
  googleEventId?: string;
  calendarId?: string;
  attempts: number;
  /** Epoch ms before which this op must not be retried. */
  nextAttemptAt: number;
  /**
   * Hash of the block content this op was created for. An identical pending
   * op is kept as-is (preserving backoff/permanent flags); a changed hash
   * replaces it so edits reset retries.
   */
  hash?: string;
  lastError?: string;
  lastErrorCode?: string;
  /** Permanent failures (invalid data, permission) are surfaced but not retried. */
  permanent?: boolean;
  /**
   * A create request may have been sent without the response being recorded
   * (crash mid-flight). Before any retry the engine searches the calendar for
   * the block's extended property so a duplicate is never inserted.
   */
  uncertain?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarSyncCursor {
  syncToken?: string;
  lastFullSyncAt?: string;
  lastIncrementalAt?: string;
  /** RFC3339 lower bound used for the last full import. */
  timeMin?: string;
}

/** Persisted sync state (~/.control-app/google-sync/state.json). */
export interface SyncState {
  version: number;
  connectedAt?: string;
  targetCalendarId: string;
  /** Per-calendar incremental cursors. */
  cursors: Record<string, CalendarSyncCursor>;
  mappings: Record<string, EventMapping>;
  googleToLocal: Record<string, string>;
  ops: SyncOp[];
  /** Deleted ids kept briefly so a racing pull cannot resurrect them. */
  tombstones: {
    local: Record<string, string>;
    google: Record<string, string>;
  };
  counters: {
    imported: number;
    pushed: number;
    conflicts: number;
  };
  /** Account email captured at connect time (status projection only). */
  userEmail?: string;
  lastSyncedAt?: string;
  lastFullSyncAt?: string;
  lastError?: string;
  lastErrorCode?: string;
}

export const SYNC_STATE_VERSION = 1;

export function emptySyncState(): SyncState {
  return {
    version: SYNC_STATE_VERSION,
    targetCalendarId: 'primary',
    cursors: {},
    mappings: {},
    googleToLocal: {},
    ops: [],
    tombstones: { local: {}, google: {} },
    counters: { imported: 0, pushed: 0, conflicts: 0 },
  };
}

/** Serialized block content used to detect local edits between syncs. */
export interface ManagedBlockFields {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  description: string;
  location: string;
}

/** Result of one syncOnce() run — drives UI feedback and tests. */
export interface SyncRunResult {
  success: boolean;
  created: number;
  updated: number;
  deleted: number;
  imported: number;
  conflicts: number;
  error?: string;
  errorCode?: string;
  /** True when the run stopped because a sync token was invalidated (full re-sync performed). */
  resynced?: boolean;
}

// ── Ports (dependency injection — keeps the engine testable without Electron) ─

export interface SyncStateStorePort {
  load(): SyncState;
  save(state: SyncState): void;
}

export interface LocalDataPort {
  /** Current day plans (source of truth for local events). */
  getPlans(): Record<string, DayPlan>;
  /**
   * Fold remote changes into the renderer's plans and persist them.
   * Resolves only after the renderer confirmed the save, so a sync token is
   * never advanced before the corresponding changes are durably applied.
   */
  apply(mutations: GoogleApplyMutations): Promise<GoogleApplyResult>;
}

export interface CalendarApiPort {
  listCalendars(): Promise<GoogleCalendarListEntry[]>;
  getUserEmail(): Promise<string>;
  /** One page of events. Query semantics mirror the REST API. */
  listEvents(
    calendarId: string,
    params: {
      syncToken?: string;
      pageToken?: string;
      timeMin?: string;
      singleEvents?: boolean;
      showDeleted?: boolean;
      maxResults?: number;
    }
  ): Promise<{ items: GoogleEventResource[]; nextPageToken?: string; nextSyncToken?: string }>;
  getEvent(calendarId: string, eventId: string): Promise<GoogleEventResource>;
  /** Find a non-cancelled event carrying private extended property controlBlockId=<id>. */
  findEventByControlBlockId(calendarId: string, blockId: string): Promise<GoogleEventResource | null>;
  insertEvent(calendarId: string, body: Partial<GoogleEventResource>): Promise<GoogleEventResource>;
  patchEvent(
    calendarId: string,
    eventId: string,
    body: Partial<GoogleEventResource>,
    ifMatch?: string
  ): Promise<GoogleEventResource>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

export interface SyncLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface EnginePorts {
  stateStore: SyncStateStorePort;
  localData: LocalDataPort;
  api: CalendarApiPort;
  logger: SyncLogger;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** IANA time zone of the machine running Control. */
  timeZone: string;
  /** Default mode used to render imported events in the planner. */
  getDefaultMode(): { id: string; name: string; icon: string; color: string } | null;
  /** Called whenever persisted counters/errors change so the UI can refresh. */
  onStateSaved?(state: SyncState): void;
}
