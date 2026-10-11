import { ScheduleBlock } from '../types';
/**
 * Pure calendar-grid math for drag & drop (move / resize / create / copy).
 *
 * Times are minutes since midnight; `HH:mm` only at the edges. No DOM, no
 * Electron — the component translates pointer coordinates into minutes and
 * commits results through its existing `persistBlocksForDate` path (so
 * timestamp stamping and Google Calendar sync behave exactly like manual
 * edits). All functions are deterministic and unit-tested.
 */

export const DRAG_SNAP_MINUTES = 15;
export const DRAG_MIN_DURATION = 15;
export const DRAG_THRESHOLD_PX = 5;
/** Pixels per hour — must match PlannerView's HOUR_HEIGHT. */
export const GRID_PX_PER_HOUR = 68;

export function snapMinutes(minutes: number, snap: number = DRAG_SNAP_MINUTES): number {
  return Math.round(minutes / snap) * snap;
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToHHMM(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  if (h >= 24) return '23:59';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Format a Date as local YYYY-MM-DD (NOT toISOString, which is UTC and shifts
 * the day for UTC± timezones — the source of wrong "today" highlighting,
 * backward day navigation, and mislabeled week columns).
 */
export function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Y offset inside the grid body → minutes since midnight. */
export function yToMinutes(
  clientY: number,
  gridTop: number,
  gridStartHour: number,
  pxPerHour: number = GRID_PX_PER_HOUR
): number {
  return gridStartHour * 60 + ((clientY - gridTop) / pxPerHour) * 60;
}

/** Minutes since midnight → Y offset inside the grid body. */
export function minutesToY(
  minutes: number,
  gridStartHour: number,
  pxPerHour: number = GRID_PX_PER_HOUR
): number {
  return ((minutes - gridStartHour * 60) / 60) * pxPerHour;
}

/**
 * Move a block, preserving its duration. The start is clamped so the whole
 * event stays inside 00:00–24:00.
 */
export function moveRange(
  origStart: number,
  origEnd: number,
  deltaMinutes: number
): { start: number; end: number } {
  const duration = Math.max(DRAG_MIN_DURATION, origEnd - origStart);
  const start = Math.max(0, Math.min(24 * 60 - duration, origStart + deltaMinutes));
  return { start, end: start + duration };
}

/** Resize a block's end, keeping at least DRAG_MIN_DURATION and ≤ 24:00. */
export function resizeRange(origStart: number, newEnd: number): number {
  return Math.max(origStart + DRAG_MIN_DURATION, Math.min(24 * 60, newEnd));
}

/** Resize a block's start (top handle), keeping ≥ 00:00 and a minimum duration. */
export function resizeStartRange(origEnd: number, newStart: number): number {
  return Math.min(origEnd - DRAG_MIN_DURATION, Math.max(0, newStart));
}

/** Normalize a create-drag into [start, end) with a minimum duration. */
export function createRange(anchor: number, cursor: number): { start: number; end: number } {
  const start = Math.max(0, Math.min(anchor, cursor));
  const end = Math.max(start + DRAG_MIN_DURATION, Math.max(anchor, cursor));
  return { start: Math.min(start, 24 * 60 - DRAG_MIN_DURATION), end: Math.min(end, 24 * 60) };
}

export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// ── Overlap layout (Apple-Calendar-style expanding columns) ────────────────

/**
 * Minimum effective duration (in minutes) used for zero-length events during
 * layout. Without this a point event would never collide with anything and
 * could be covered by another event at the same instant.
 */
export const POINT_EPSILON_MINUTES = 1;

export interface OverlapPlacement {
  /** Left edge as a fraction (0..1) of the day column. */
  left: number;
  /** Width as a fraction (0..1) of the day column. */
  width: number;
  /** Zero-based leftmost column (lane) within the cluster. */
  lane: number;
  /** Number of columns the event occupies (≥ 1). */
  span: number;
  /** Total columns in the event's overlap cluster (≥ 1). */
  lanes: number;
}

/**
 * Lay out same-day events Apple/Google-Calendar-style using the classic
 * "maximum width" interval layout:
 *
 * 1. Events that overlap (directly or transitively) form one cluster.
 * 2. Within a cluster, events are packed greedily into columns (interval
 *    partitioning) — the leftmost column where they don't collide.
 * 3. The cluster's column count sets the base width (1 / lanes).
 * 4. Each event then expands to the right across every following column that
 *    stays clear for its whole duration, taking the widest span possible
 *    without ever covering another event. This is what keeps a tight schedule
 *    readable: a short block beside a long one still gets its own space, and an
 *    event whose neighbours have already ended springs back to full width.
 *
 * Touching events (end == start) never collide (half-open intervals), and
 * zero-length events get a one-minute effective duration so they are never
 * covered. Pure and deterministic (ties broken by id).
 */
export function layoutOverlappingBlocks<T extends { id: string; startTime: string; endTime: string }>(
  blocks: T[]
): Record<string, OverlapPlacement> {
  interface Item {
    id: string;
    start: number;
    end: number;
    valid: boolean;
  }

  const parsed: Item[] = blocks.map((b) => {
    const [sh, sm] = b.startTime.split(':').map(Number);
    const [eh, em] = b.endTime.split(':').map(Number);
    const start = sh * 60 + (sm || 0);
    const rawEnd = eh * 60 + (em || 0);
    const valid = Number.isFinite(start) && Number.isFinite(rawEnd);
    // Overnight events (end < start, e.g. an imported 22:00–06:00) occupy the
    // rest of the visible day so they cluster with the evening instead of
    // blanketing it; zero-length events become a minimal interval so they can
    // never be covered by an event at the same instant.
    let end = rawEnd;
    if (valid) {
      if (rawEnd < start) end = 24 * 60;
      else if (rawEnd === start) end = start + POINT_EPSILON_MINUTES;
    }
    return { id: b.id, start, end, valid };
  });

  const out: Record<string, OverlapPlacement> = {};
  for (const p of parsed) {
    if (!p.valid) out[p.id] = { left: 0, width: 1, lane: 0, span: 1, lanes: 1 };
  }

  const timed = parsed
    .filter((p) => p.valid)
    .sort((a, b) => a.start - b.start || b.end - a.end || (a.id < b.id ? -1 : 1));

  const collides = (a: Item, b: Item) => a.start < b.end && b.start < a.end;

  // Sweep into transitive overlap clusters. A new cluster starts only when the
  // next event begins at or after everything seen so far has ended.
  const clusters: Item[][] = [];
  let current: Item[] = [];
  let clusterEnd = -1;
  for (const ev of timed) {
    if (current.length > 0 && ev.start >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -1;
    }
    current.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.end);
  }
  if (current.length > 0) clusters.push(current);

  for (const cluster of clusters) {
    // Greedy interval partitioning: the leftmost collision-free column wins.
    const columns: Item[][] = [];
    for (const ev of cluster) {
      const col = columns.find((c) => c.every((other) => !collides(other, ev)));
      if (col) col.push(ev);
      else columns.push([ev]);
    }

    const lanes = Math.max(1, columns.length);
    columns.forEach((col, i) => {
      for (const ev of col) {
        // Grow rightwards while every following column stays clear of ev.
        let span = 1;
        for (let c = i + 1; c < columns.length; c++) {
          if (columns[c].some((other) => collides(other, ev))) break;
          span += 1;
        }
        out[ev.id] = { left: i / lanes, width: span / lanes, lane: i, span, lanes };
      }
    });
  }

  return out;
}

/**
 * Earliest start (minutes since midnight) of any other event that shares
 * horizontal space with `blockId` and begins later. That is where this card
 * would start covering a neighbour, so it caps how tall a card may be drawn
 * (the minimum-height floor must never inflate a short event into the next
 * one). Returns 24*60 when nothing constrains it.
 */
export function nextSharedHorizon(
  blockId: string,
  blocks: Array<{ id: string; startTime: string }>,
  placements: Record<string, OverlapPlacement>
): number {
  const place = placements[blockId];
  if (!place) return 24 * 60;
  const self = blocks.find((b) => b.id === blockId);
  if (!self) return 24 * 60;
  const start = hhmmToMinutes(self.startTime);
  let limit = 24 * 60;
  for (const other of blocks) {
    if (other.id === blockId) continue;
    const op = placements[other.id];
    if (!op) continue;
    const otherStart = hhmmToMinutes(other.startTime);
    if (otherStart <= start) continue;
    const xOverlap =
      place.left < op.left + op.width - 1e-6 && op.left < place.left + place.width - 1e-6;
    if (xOverlap && otherStart < limit) limit = otherStart;
  }
  return limit;
}

export interface BlockMove {
  /** Date the block must be removed from (equals target for same-day moves). */
  fromDate: string;
  toDate: string;
  blockId: string;
  startTime: string;
  endTime: string;
}

/** Describe a move without touching state — the caller persists it. */
export function describeMove(
  block: ScheduleBlock,
  toDate: string,
  newStartMinutes: number
): BlockMove {
  const origStart = hhmmToMinutes(block.startTime);
  const duration = Math.max(DRAG_MIN_DURATION, hhmmToMinutes(block.endTime) - origStart);
  const moved = moveRange(origStart, origStart + duration, newStartMinutes - origStart);
  return {
    fromDate: block.date,
    toDate,
    blockId: block.id,
    startTime: minutesToHHMM(moved.start),
    endTime: minutesToHHMM(moved.end),
  };
}

/**
 * Apply a committed move to a block list snapshot. Returns the updated list
 * for a single date (same-day case). Cross-day moves are two calls: remove
 * from the source date, add to the target date (see `makeCopy` for adds).
 */
export function applyMoveToList(
  list: ScheduleBlock[],
  blockId: string,
  startTime: string,
  endTime: string
): ScheduleBlock[] {
  return list.map((b) => (b.id === blockId ? { ...b, startTime, endTime } : b));
}

/** Build a duplicate of a block at a new time (Alt-drag copy). New id, no Google linkage. */
export function makeCopy(
  block: ScheduleBlock,
  toDate: string,
  startTime: string,
  endTime: string,
  idFactory: () => string
): ScheduleBlock {
  const {
    googleCalendarEventId: _gid,
    googleCalendarSyncedAt: _synced,
    googleEventETag: _etag,
    googleCalendarId: _cal,
    googleRecurringEventId: _rec,
    googleStart: _gs,
    googleEnd: _ge,
    googleStatus: _gst,
    googleRaw: _raw,
    id: _id,
    createdAt: _created,
    updatedAt: _updated,
    ...rest
  } = block;
  void _gid; void _synced; void _etag; void _cal; void _rec; void _gs;
  void _ge; void _gst; void _raw; void _id; void _created; void _updated;
  return {
    ...rest,
    id: idFactory(),
    date: toDate,
    startTime,
    endTime,
    status: 'approved',
    source: 'control',
  };
}
