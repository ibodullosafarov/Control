import {
  GoogleEventResource,
  ManagedBlockFields,
} from './types';
import { ScheduleBlock } from '../../src/types';
import { stripDateSuffix } from '../../src/services/taskTitles';

/**
 * Conversions between Control's ScheduleBlock model and Google Calendar
 * events, plus content hashing (edit detection) and the push eligibility
 * policy.
 *
 * Time-zone rules:
 *  - Control stores wall-clock times (YYYY-MM-DD + HH:mm) in the machine's
 *    local zone; Google stores instants. We bridge with Date math, which
 *    handles DST transitions correctly for the local zone.
 *  - All-day events use Google's `date` form (no zone); Control represents
 *    them with allDay=true, 00:00–23:59 and keeps the exclusive end date in
 *    googleEnd.
 *  - Raw Google start/end strings are preserved on the block so round trips
 *    never lose information Control does not model (e.g. per-event zones,
 *    overnight end times).
 */

const MODE_PRIVATE_PROPS = ['controlSync', 'controlBlockId', 'controlModeId', 'controlCycles', 'controlWork', 'controlBreak'] as const;

export function managedFields(block: ScheduleBlock): ManagedBlockFields {
  return {
    title: block.modeName || '',
    date: block.date,
    startTime: block.startTime,
    endTime: block.endTime,
    allDay: !!block.allDay,
    description: block.description || '',
    location: block.location || '',
  };
}

/** Stable hash over the fields Control mirrors to Google. */
export function contentHash(block: ScheduleBlock): string {
  const f = managedFields(block);
  const input = [
    f.title,
    f.date,
    f.startTime,
    f.endTime,
    f.allDay ? '1' : '0',
    f.description,
    f.location,
  ].join('\u0001');
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return `w${h.toString(36)}-${input.length.toString(36)}`;
}

// ── Date/time helpers (local machine zone) ────────────────────────────────

export function fmtLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fmtLocalTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days, 12, 0, 0, 0);
  return fmtLocalDate(dt);
}

export function localDateTime(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
}

/** Today (YYYY-MM-DD) in the local zone. */
export function todayLocal(nowMs: number): string {
  return fmtLocalDate(new Date(nowMs));
}

// ── Push eligibility ──────────────────────────────────────────────────────

/**
 * Safety policy (documented in docs/google-calendar.md):
 *  - Every Day Planner event is a calendar event and may sync, but existing
 *    *historical* entries are only uploaded when the user edits them after
 *    connecting (updatedAt > connectedAt). Recent (past 45 days) and future
 *    entries sync automatically so the current plan mirrors the calendar.
 *  - Tasks, Markdown templates and session history are never calendar events
 *    and are never uploaded (the engine only ever reads DayPlan.blocks).
 */
export function isEligibleForPush(block: ScheduleBlock, today: string, connectedAt?: string): boolean {
  if (block.googleCalendarEventId) return true; // already linked — keep both sides consistent
  const floor = addDays(today, -45);
  if (block.date >= floor) return true;
  if (block.updatedAt && connectedAt && block.updatedAt > connectedAt) return true;
  return false;
}

// ── Control → Google ──────────────────────────────────────────────────────

export interface BlockToEventOptions {
  timeZone: string;
  /** Mode metadata embedded as private extended properties (lossless restore). */
  mode?: { id: string; cycles: number; workDuration: number; breakDuration: number } | null;
}

export function blockToGoogleBody(block: ScheduleBlock, opts: BlockToEventOptions): Partial<GoogleEventResource> {
  const allDay = !!block.allDay;
  let start: { date?: string; dateTime?: string; timeZone?: string };
  let end: { date?: string; dateTime?: string; timeZone?: string };

  if (allDay) {
    const exclusiveEnd = block.googleEnd && block.googleEnd > block.date ? block.googleEnd : addDays(block.date, 1);
    start = { date: block.date };
    end = { date: exclusiveEnd };
  } else {
    const startDt = localDateTime(block.date, block.startTime);
    let endDt = localDateTime(block.date, block.endTime);
    if (endDt.getTime() <= startDt.getTime()) {
      endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
    }
    start = { dateTime: startDt.toISOString(), timeZone: opts.timeZone };
    end = { dateTime: endDt.toISOString(), timeZone: opts.timeZone };
  }

  const body: Partial<GoogleEventResource> = {
    // Google shows the clean display title (no disambiguating date suffix).
    summary: stripDateSuffix(block.modeName) || '',
    start,
    end,
  };
  if (block.description) body.description = block.description;
  if (block.location) body.location = block.location;

  const privateProps: Record<string, string> = { controlSync: '1', controlBlockId: block.id };
  if (opts.mode) {
    privateProps.controlModeId = opts.mode.id;
    privateProps.controlCycles = String(opts.mode.cycles);
    privateProps.controlWork = String(opts.mode.workDuration);
    privateProps.controlBreak = String(opts.mode.breakDuration);
  }
  // Anchor for the full local title so pulls restore it losslessly (and stay
  // diff-stable instead of churning every sync). Only stored when different.
  if (block.modeName && stripDateSuffix(block.modeName) !== block.modeName) {
    privateProps.controlTitle = block.modeName;
  }
  // Only attach properties to events we own (identified by controlBlockId).
  // For imports controlBlockId is the block id — stable across state loss.
  body.extendedProperties = { private: privateProps };

  return body;
}

/** Fields managed by Control — sent on every push so edits propagate. */
export function managedPatchBody(block: ScheduleBlock, opts: BlockToEventOptions): Partial<GoogleEventResource> {
  const body = blockToGoogleBody(block, opts);
  // Never carry the id over in a patch body.
  delete body.id;
  return body;
}

export function modePrivateProps(modeId: string, cycles: number, work: number, brk: number): Record<string, string> {
  return {
    controlSync: '1',
    controlModeId: modeId,
    controlCycles: String(cycles),
    controlWork: String(work),
    controlBreak: String(brk),
  };
}

export function controlBlockIdOf(event: GoogleEventResource): string | undefined {
  const p = event.extendedProperties?.private;
  if (!p) return undefined;
  const id = p.controlBlockId;
  return typeof id === 'string' && id ? id : undefined;
}

/**
 * Full local title stashed at push time (see blockToGoogleBody). Restored on
 * pull only when the remote summary still matches its clean form — a summary
 * edited directly in Google Calendar wins over the stale anchor instead of
 * being reverted every sync.
 */
export function controlTitleOf(event: GoogleEventResource): string | undefined {
  const p = event.extendedProperties?.private;
  if (!p) return undefined;
  const title = p.controlTitle;
  if (typeof title !== 'string' || !title) return undefined;
  const summary = typeof event.summary === 'string' ? event.summary : '';
  if (stripDateSuffix(title) !== summary) return undefined;
  return title;
}

export function isControlOwnedEvent(event: GoogleEventResource): boolean {
  return controlBlockIdOf(event) !== undefined;
}

// ── Google → Control ──────────────────────────────────────────────────────

export function isAllDayEvent(event: GoogleEventResource): boolean {
  return !!event.start?.date;
}

export function isRecurringInstance(event: GoogleEventResource): boolean {
  return !!event.recurringEventId;
}

export interface GoogleToBlockOptions {
  /** Default mode used when rendering an imported event in the planner. */
  defaultMode: { id: string; name: string; icon: string; color: string } | null;
  /** Existing block to merge into (preserves app-only fields like cycles). */
  existing?: ScheduleBlock;
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Build the ScheduleBlock for a Google event.
 *
 * When merging into an existing block, planner-specific fields (mode choice,
 * cycles, durations, status, timestamps) are retained — only the fields that
 * Control mirrors to Google are refreshed from the remote event.
 */
export function googleEventToBlock(event: GoogleEventResource, opts: GoogleToBlockOptions): ScheduleBlock {
  const existing = opts.existing;
  const privateProps = event.extendedProperties?.private || {};
  const allDay = isAllDayEvent(event);

  let date = '';
  let startTime = '00:00';
  let endTime = '23:59';
  let googleEnd: string | undefined;
  let googleStartRaw: string | undefined;

  if (allDay) {
    date = event.start?.date || fmtLocalDate(new Date());
    startTime = '00:00';
    endTime = '23:59';
    if (event.end?.date) googleEnd = event.end.date;
    googleStartRaw = event.start?.date;
  } else {
    const startDt = event.start?.dateTime ? new Date(event.start.dateTime) : null;
    const endDt = event.end?.dateTime ? new Date(event.end.dateTime) : null;
    const safeStart = startDt && !isNaN(startDt.getTime()) ? startDt : new Date();
    date = fmtLocalDate(safeStart);
    startTime = fmtLocalTime(safeStart);
    if (endDt && !isNaN(endDt.getTime())) {
      const sameDay = fmtLocalDate(endDt) === date;
      endTime = sameDay ? fmtLocalTime(endDt) : '23:59';
      if (!sameDay) {
        // Overnight event: keep the true raw end for lossless round trips.
        googleEnd = endDt.toISOString();
      } else if (endDt.getTime() <= safeStart.getTime()) {
        endTime = fmtLocalTime(new Date(safeStart.getTime() + 60 * 60 * 1000));
      }
    } else {
      endTime = fmtLocalTime(new Date(safeStart.getTime() + 60 * 60 * 1000));
    }
    googleStartRaw = event.start?.dateTime;
  }

  const title =
    controlTitleOf(event) || event.summary || existing?.modeName || opts.defaultMode?.name || 'Imported event';
  const modeId = privateProps.controlModeId || existing?.modeId || opts.defaultMode?.id || '';
  const cycles = privateProps.controlCycles ? num(privateProps.controlCycles, 1) : existing?.cycles ?? 1;
  const workDuration = privateProps.controlWork
    ? num(privateProps.controlWork, 60)
    : existing?.workDuration ?? 60;
  const breakDuration = privateProps.controlBreak
    ? num(privateProps.controlBreak, 10)
    : existing?.breakDuration ?? 10;

  const block: ScheduleBlock = {
    id: existing?.id || controlBlockIdOf(event) || `gcal-${event.id}`,
    date,
    startTime,
    endTime,
    modeId,
    modeName: title,
    modeIcon: existing?.modeIcon || opts.defaultMode?.icon || 'target',
    modeColor: existing?.modeColor || opts.defaultMode?.color || '#38bdf8',
    workDuration,
    breakDuration,
    cycles,
    status: existing?.status || 'approved',
    allDay,
    source: 'google',
    googleCalendarEventId: event.id,
    googleEventETag: event.etag,
    googleStatus: event.status || 'confirmed',
  };

  if (event.description) block.description = event.description;
  else if (existing?.description && !eventHasField(event, 'description')) {
    delete (block as unknown as Record<string, unknown>).description;
  }
  if (event.location) block.location = event.location;
  if (event.recurringEventId) block.googleRecurringEventId = event.recurringEventId;
  if (googleStartRaw) block.googleStart = googleStartRaw;
  if (googleEnd) block.googleEnd = googleEnd;
  else if (allDay && event.end?.date) block.googleEnd = event.end.date;
  if (googleEnd && !allDay && !event.end?.dateTime?.includes('T')) block.googleEnd = googleEnd;
  if (event.recurrence && event.recurrence.length) block.recurrence = event.recurrence;
  if (event.updated) block.updatedAt = event.updated;
  if (existing?.createdAt) block.createdAt = existing.createdAt;
  block.googleCalendarSyncedAt = new Date().toISOString();

  try {
    block.googleRaw = JSON.stringify(event);
  } catch {
    /* raw preservation is best-effort */
  }

  return block;
}

function eventHasField(event: GoogleEventResource, key: string): boolean {
  return event[key] !== undefined && event[key] !== null;
}

/** True when the mirrored fields of an event differ from a block. */
export function remoteDiffers(block: ScheduleBlock, event: GoogleEventResource): boolean {
  const rebuilt = googleEventToBlock(event, { defaultMode: null, existing: block });
  return contentHash(rebuilt) !== contentHash(block);
}

/** Delete this block's description only if the remote event has none. */
export function stripDescriptionIfRemoteLacks(block: ScheduleBlock, event: GoogleEventResource): boolean {
  if (block.description && !event.description) {
    delete block.description;
    return true;
  }
  return false;
}

export { MODE_PRIVATE_PROPS };
