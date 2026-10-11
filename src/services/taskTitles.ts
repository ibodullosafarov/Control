/**
 * Clean display titles vs unique Obsidian note titles.
 *
 * Recurring tasks share one clean name ("25 Math questions 1") while each
 * Obsidian note stays unique via a trailing DD.MM.YYYY date suffix
 * ("25 Math questions 1 11.10.2026"). The full title (with suffix) is the
 * internal identity-adjacent value stored on tasks, blocks and note files;
 * only the clean title is ever DISPLAYED (Tasks tab, Planner tab, Google
 * Calendar titles, consolidated index lines).
 *
 * Rules:
 * - Only a VALID trailing DD.MM.YYYY suffix is stripped — real calendar
 *   dates (day/month ranges checked, Feb 30 rejected). Mid-title dates and
 *   unrelated numbers are never touched.
 * - Notes are NEVER identified by cleaned title: identity is the frontmatter
 *   id (or filename-derived id), so identical clean titles stay separate.
 * - Editing a clean title re-attaches the note's original suffix instead of
 *   renaming the note (which would orphan/delete it via GC).
 * - New dated names use the task's own creation date (stable, no churn).
 */

const DATE_SUFFIX_RE = /\s(\d{2})\.(\d{2})\.(\d{4})$/;

function isRealDate(dd: number, mm: number, yyyy: number): boolean {
  if (yyyy < 1900 || yyyy > 2100) return false;
  if (mm < 1 || mm > 12) return false;
  if (dd < 1 || dd > 31) return false;
  const d = new Date(yyyy, mm - 1, dd);
  return d.getFullYear() === yyyy && d.getMonth() === mm - 1 && d.getDate() === dd;
}

export interface SplitTitle {
  /** Title without the date suffix (what the user sees). */
  clean: string;
  /** The DD.MM.YYYY suffix, or null when the title carries none. */
  suffix: string | null;
}

/** Split "25 Math questions 1 11.10.2026" → clean + suffix. */
export function splitDateSuffix(title: string): SplitTitle {
  const m = (title || '').match(DATE_SUFFIX_RE);
  if (!m) return { clean: (title || '').trim(), suffix: null };
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const yyyy = parseInt(m[3], 10);
  if (!isRealDate(dd, mm, yyyy)) return { clean: (title || '').trim(), suffix: null };
  const clean = (title || '').slice(0, m.index).trim();
  if (!clean) return { clean: (title || '').trim(), suffix: null };
  return { clean, suffix: `${m[1]}.${m[2]}.${m[3]}` };
}

/** Display form: never show the disambiguating date suffix. */
export function stripDateSuffix(title: string): string {
  return splitDateSuffix(title).clean;
}

/** True when the title ends with a valid DD.MM.YYYY suffix. */
export function hasDateSuffix(title: string): boolean {
  return splitDateSuffix(title).suffix !== null;
}

/** DD.MM.YYYY for an ISO instant, in the local zone. */
export function formatDateSuffix(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/**
 * Merge an edited (usually clean) title back onto the stored full title.
 * Keeps the note's original suffix so edits never rename/orphan the note;
 * never double-appends.
 */
export function preserveDateSuffix(oldFullTitle: string, newTitle: string): string {
  const next = (newTitle || '').trim();
  if (!next) return oldFullTitle;
  if (hasDateSuffix(next)) return next;
  const { suffix } = splitDateSuffix(oldFullTitle);
  if (suffix) return `${next} ${suffix}`;
  return next;
}

/**
 * Build a unique dated title for a colliding duplicate: "Name DD.MM.YYYY"
 * from the task's own creation date (stable across syncs — no churn).
 * Returns the input unchanged when it already carries a valid suffix.
 */
export function withDateSuffix(title: string, createdAtIso: string): string {
  const clean = (title || '').trim();
  if (!clean || hasDateSuffix(clean)) return clean;
  const suffix = formatDateSuffix(createdAtIso);
  if (!suffix) return clean;
  return `${clean} ${suffix}`;
}
