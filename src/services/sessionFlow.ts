/**
 * Focus-session phase-transition rules (pure, no React/Electron).
 *
 * Extracted verbatim from ActiveSessionView's work-completion branch so the
 * exact production logic is unit-testable. Behavior contract:
 *  - A finished work phase completes the session when all cycles are done —
 *    notably, a single-cycle mode ends right after its one focus block with
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

/** A mode represents exactly one focus block (no multi-cycle extension). */
export function isSingleBlockMode(cycles: number | undefined | null, isChillMode?: boolean): boolean {
  if (isChillMode) return false;
  return (cycles ?? 1) <= 1;
}
