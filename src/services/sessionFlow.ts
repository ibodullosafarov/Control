/**
 * Control-session phase-transition rules (pure, no React/Electron).
 *
 * Extracted verbatim from ActiveSessionView's work-completion branch so the
 * exact production logic is unit-testable. Behavior contract:
 *  - A finished work phase completes the session when all cycles are done —
 *    notably, a single-cycle mode ends right after its one control block with
 *    NO trailing break timer. Breaks live between scheduled calendar events,
 *    never inside a single-block session.
 *  - Multi-cycle modes are untouched: mid-run work phases still transition
 *    to a break.
 */

/** What a completed work phase turns into. */
export type WorkCompletion = 'complete' | 'break';

/**
 * Decide what follows a finished work phase.
 *
 * Mirrors the production check `completedCyclesCount + 1 >= totalCycles`.
 * Defensive clamps (totalCycles < 1, negative counts) resolve to 'complete'
 * rather than inventing extra cycles.
 */
export function resolveWorkCompletion(
  completedCyclesCount: number,
  totalCycles: number
): WorkCompletion {
  const done = Math.floor(completedCyclesCount) + 1;
  const total = Math.floor(totalCycles);
  if (total < 1) return 'complete';
  return done >= total ? 'complete' : 'break';
}

/** A mode represents exactly one control block (no multi-cycle extension). */
export function isSingleBlockMode(cycles: number | undefined | null, isChillMode?: boolean): boolean {
  if (isChillMode) return false;
  return (cycles ?? 1) <= 1;
}

/** Clamp a user-chosen cycle count into the supported range. */
export function clampCycles(value: unknown, fallback = 1): number {
  const n = typeof value === 'number' ? Math.floor(value) : parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(12, Math.max(1, n));
}

/**
 * Honest wall-clock length of a session: control plus the breaks between
 * cycles (never a trailing break after the last cycle).
 */
export function sessionWallMinutes(workMins: number, breakMins: number, cycles: number): number {
  const c = Math.max(1, Math.floor(cycles));
  const w = Math.max(0, workMins);
  const b = Math.max(0, breakMins);
  return c * w + (c > 1 ? (c - 1) * b : 0);
}

/** Wall length honoring long breaks every N cycles (S-04). */
export function sessionWallMinutesFull(
  workMins: number,
  breakMins: number,
  cycles: number,
  longBreakMins = 0,
  longBreakInterval = 0
): number {
  const c = Math.max(1, Math.floor(cycles));
  if (c <= 1) return Math.max(0, workMins);
  let total = c * Math.max(0, workMins);
  for (let i = 1; i < c; i++) {
    total += isLongBreakCycle(i, c, longBreakInterval, longBreakMins, breakMins);
  }
  return total;
}

/** Break length after completed cycle `cycleIdx` (1-based). */
export function isLongBreakCycle(
  cycleIdx: number,
  totalCycles: number,
  longBreakInterval: number,
  longBreakMins: number,
  breakMins: number
): number {
  if (cycleIdx >= totalCycles) return 0; // never trailing
  if (longBreakInterval > 0 && longBreakMins > 0 && cycleIdx % longBreakInterval === 0) {
    return longBreakMins;
  }
  return Math.max(0, breakMins);
}

/** Per-minute question density warning (S-01). Null = fine. */
export function checkQuestionDensity(
  count: number | null | undefined,
  label: string | null | undefined,
  eventMinutes: number
): string | null {
  if (count == null || !Number.isFinite(count) || count <= 0) return null;
  if (!eventMinutes || eventMinutes <= 0) return null;
  const l = (label || 'items').toLowerCase();
  const perMin = count / eventMinutes;
  const limit = l.includes('question') || l.includes('problem') ? 2
    : l.includes('word') || l.includes('card') ? 6
    : l.includes('page') ? 0.5 : 4;
  if (perMin > limit) {
    return `${count} ${label || 'items'} in ${eventMinutes}m (~${perMin.toFixed(1)}/min) looks too dense — consider more time or fewer items.`;
  }
  return null;
}

/**
 * One-click task starts resolve cycles silently (per-task choice wins).
 * Above this wall length the user should consent explicitly instead of
 * discovering a 2-hour session after pressing play.
 */
export const LONG_SESSION_CONFIRM_WALL_MINS = 60;

export interface SessionCycleSource {
  /** Tasks currently in the store (looked up by id). */
  tasks: Array<{ id: string; cycles?: number }>;
  /** Tasks attached to the session being started. */
  taskIds: string[];
  /** Mode fallback for tasks that predate per-task cycles. */
  modeCycles: number;
  /** Explicit per-session override (planner blocks, launcher stepper). Wins. */
  overrideCycles?: number;
}

/**
 * Resolve how many control blocks a session runs:
 * explicit override → strongest per-task choice among the attached tasks →
 * mode fallback. Never below 1.
 */
export function resolveSessionCycles(source: SessionCycleSource): number {
  if (source.overrideCycles !== undefined) return clampCycles(source.overrideCycles, 1);
  let best = 0;
  for (const id of source.taskIds) {
    const task = source.tasks.find((t) => t.id === id);
    const c = task && typeof task.cycles === 'number' ? Math.floor(task.cycles) : 0;
    if (Number.isFinite(c) && c > best) best = c;
  }
  if (best >= 1) return clampCycles(best, 1);
  return clampCycles(source.modeCycles, 1);
}
