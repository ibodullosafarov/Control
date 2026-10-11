import { ScheduleBlock, StudyMode } from '../types';

/**
 * Schedule-template engine (pure, no Electron/Node APIs).
 *
 * A schedule template is a reusable `.md` blueprint that generates real
 * Day Planner `ScheduleBlock` events. This module owns:
 *   - parsing template Markdown into `ScheduleTemplate` sessions,
 *   - validating durations / booleans / times with actionable errors,
 *   - generating timed blocks from a config (date, start, overrides),
 *   - detecting overlaps with existing blocks,
 *   - building/merging the `## Generated Schedule` daily-note section.
 *
 * File I/O stays in the Electron main process (`electron/plannerMarkdown.ts`
 * + IPC); persistence of generated blocks reuses PlannerView's
 * `persistBlocksForDate`, so Google Calendar sync picks them up exactly like
 * hand-created events (fresh `updatedAt`, no Google IDs, debounced save).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type TemplateSessionKind = 'session' | 'break';

export interface TemplateSession {
  /** Position in the file (0-based); stable key for per-session overrides. */
  order: number;
  title: string;
  kind: TemplateSessionKind;
  /** Null when unspecified — generation reports a validation error. */
  durationMinutes: number | null;
  /** Null = not specified (sessions default true, breaks default false). */
  timer: boolean | null;
  /** Null = not specified (follow the mode's Focus rules). */
  focusMode: boolean | null;
  /** Mode name as written in the template, if any. */
  modeName: string | null;
  /** e.g. 50 with label 'questions'. */
  countValue: number | null;
  countLabel: string | null;
  /** Free text + preserved unknown `Key:` lines. */
  notes: string[];
}

export interface ScheduleTemplate {
  /** File name without `.md`. */
  name: string;
  /** Frontmatter `name`, else first `# H1`, else file name. */
  title: string;
  description: string | null;
  /** Frontmatter `version` (default 1). Unknown versions parse best-effort. */
  version: number;
  /** Frontmatter `default-start` (`HH:mm`), if valid. */
  defaultStart: string | null;
  /** Frontmatter `default-duration` in minutes, if valid. */
  defaultDurationMinutes: number | null;
  sessions: TemplateSession[];
  /** `{{variable}}` placeholders found in titles/notes. */
  variables: string[];
  /** Non-fatal observations (unknown version, sections without content). */
  warnings: string[];
}

export interface TemplateParseError {
  template: string;
  section: string | null;
  field: string | null;
  message: string;
}

export interface SessionOverride {
  title?: string;
  durationMinutes?: number;
  countValue?: number | null;
  timer?: boolean;
  focusMode?: boolean | null;
  modeId?: string;
}

export interface GenerationConfig {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  variables?: Record<string, string>;
  overrides?: Record<number, SessionOverride>;
}

export interface ScheduleConflict {
  sessionIndex: number;
  sessionTitle: string;
  startTime: string;
  endTime: string;
  overlapping: Array<{ id: string; title: string; startTime: string; endTime: string }>;
}

export interface GenerationResult {
  blocks: ScheduleBlock[];
  conflicts: ScheduleConflict[];
  /** Fatal problems — when non-empty, `blocks` is empty. */
  errors: string[];
  totalMinutes: number;
  endTime: string | null;
  /** True when the date already holds blocks generated from this template. */
  alreadyApplied: boolean;
}

// ── Small parsers ────────────────────────────────────────────────────────────

const VARIABLE_RE = /\{\{\s*([\w-]+)\s*\}\}/g;
const CHECKBOX_RE = /^\s*[-*]\s+\[[ xX]\]\s*(.*)$/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const SESSION_HEADING_RE = /^##\s+(.*)$/;
const ANY_HEADING_RE = /^(#{1,6})\s+(.*)$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDurationMinutes(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d+)\s*:\s*([0-5]\d)$/); // H:MM
  if (m) {
    const total = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    return total > 0 && total <= 24 * 60 ? total : null;
  }
  m = s.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?)?(?:\s*(\d+(?:\.\d+)?)\s*m(?:in(?:s|utes?)?)?)?$/);
  if (m) {
    const total = Math.round(parseFloat(m[1]) * 60 + (m[2] ? parseFloat(m[2]) : 0));
    return total > 0 && total <= 24 * 60 ? total : null;
  }
  m = s.match(/^(\d+(?:\.\d+)?)(?:\s*m(?:in(?:s|utes?)?)?)?$/); // bare number = minutes
  if (m) {
    const total = Math.round(parseFloat(m[1]));
    return total > 0 && total <= 24 * 60 ? total : null;
  }
  return null;
}

export function parseBool(raw: string): boolean | null {
  const s = raw.trim().toLowerCase();
  if (/^(true|yes|y|1|on)$/.test(s)) return true;
  if (/^(false|no|n|0|off)$/.test(s)) return false;
  return null;
}

export function parseTimeMinutes(time: string): number | null {
  const m = time.trim().match(TIME_RE);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Flat `key: value` frontmatter (mirrors electron/plannerMarkdown.ts). */
export function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const data: Record<string, string> = {};
  if (!raw.startsWith('---')) return { data, body: raw };
  const lines = raw.split('\n');
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return { data, body: raw };
  for (let i = 1; i < end; i++) {
    const match = lines[i].match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    data[match[1]] = value;
  }
  return { data, body: lines.slice(end + 1).join('\n') };
}

export function extractVariables(text: string): string[] {
  const found: string[] = [];
  VARIABLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VARIABLE_RE.exec(text)) !== null) {
    if (!found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

export function applyTemplateVariables(
  text: string,
  variables: Record<string, string>
): string {
  return text.replace(VARIABLE_RE, (_full, name: string) =>
    variables[name] !== undefined && variables[name] !== '' ? variables[name] : `{{${name}}}`
  );
}

// ── Template parsing ─────────────────────────────────────────────────────────

const COUNT_KEYS: Record<string, string> = {
  questions: 'questions',
  problems: 'problems',
  words: 'words',
  items: 'items',
  cards: 'cards',
  pages: 'pages',
  sets: 'sets',
  reps: 'reps',
};

function err(
  template: string,
  section: string | null,
  field: string | null,
  message: string
): TemplateParseError {
  return { template, section, field, message };
}

function stripBold(key: string): string {
  return key.replace(/^\*\*(.+)\*\*$/, '$1').trim();
}

function isBreakHeading(title: string): boolean {
  return /^(break|rest|pause|breather|coffee|lunch)$/i.test(title.trim());
}

/**
 * Parse a template file. Never throws for malformed content — problems are
 * reported in `errors` with template/section/field context. Unknown `Key:`
 * lines are preserved into session notes (never silently dropped).
 */
export function parseScheduleTemplate(
  name: string,
  raw: string
): { template: ScheduleTemplate; errors: TemplateParseError[] } {
  const errors: TemplateParseError[] = [];
  const warnings: string[] = [];
  const { data, body } = parseFrontmatter(raw || '');

  let title = (data.name || '').trim();
  let description = (data.description || '').trim() || null;
  let version = 1;
  if (data.version !== undefined && data.version !== '') {
    const v = parseInt(data.version, 10);
    if (Number.isFinite(v) && v > 0) {
      version = v;
      if (v > 2) warnings.push(`Unknown template version ${v}; parsing best-effort as v2.`);
    } else {
      errors.push(err(name, null, 'version', `Invalid version "${data.version}" (expected a positive integer).`));
    }
  }
  let defaultStart: string | null = null;
  if ((data['default-start'] || '').trim()) {
    const mins = parseTimeMinutes(data['default-start']);
    if (mins === null) {
      errors.push(
        err(name, null, 'default-start', `Invalid default-start "${data['default-start']}" (expected HH:mm).`)
      );
    } else {
      defaultStart = formatMinutes(mins);
    }
  }
  let defaultDurationMinutes: number | null = null;
  if ((data['default-duration'] || '').trim()) {
    const d = parseDurationMinutes(data['default-duration']);
    if (d === null) {
      errors.push(
        err(name, null, 'default-duration', `Invalid default-duration "${data['default-duration']}".`)
      );
    } else {
      defaultDurationMinutes = d;
    }
  }

  // Split body into `##` sessions (document order = schedule order).
  interface RawSection {
    title: string;
    lines: string[];
  }
  const sections: RawSection[] = [];
  let firstH1: string | null = null;
  let current: RawSection | null = null;
  for (const line of body.split('\n')) {
    const h = line.match(ANY_HEADING_RE);
    if (h) {
      const level = h[1].length;
      if (level === 1 && firstH1 === null) firstH1 = h[2].trim();
      if (level === 2) {
        current = { title: h[2].trim(), lines: [] };
        sections.push(current);
        continue;
      }
      // Deeper headings are session notes, not new sessions.
      if (current) current.lines.push(line);
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (!title) title = firstH1 || name;

  const sessions: TemplateSession[] = [];
  sections.forEach((section, order) => {
    if (!section.title) {
      errors.push(err(name, null, null, `Section #${order + 1} has an empty heading.`));
      return;
    }
    const session: TemplateSession = {
      order,
      title: section.title,
      kind: 'session',
      durationMinutes: null,
      timer: null,
      focusMode: null,
      modeName: null,
      countValue: null,
      countLabel: null,
      notes: [],
    };
    let explicitKind: TemplateSessionKind | null = null;
    let hasContent = false;

    for (const rawLine of section.lines) {
      const line = rawLine.trimEnd();
      if (!line.trim()) continue;
      hasContent = true;
      const checkbox = line.match(CHECKBOX_RE);
      if (checkbox) {
        // Checklist items are notes, not schedulable units — sections are.
        if (checkbox[1].trim()) session.notes.push(checkbox[1].trim());
        continue;
      }
      const bullet = line.match(BULLET_RE);
      const text = (bullet ? bullet[1] : line).trim();
      const kv = text.match(/^(.+?)\s*:\s*(.*)$/);
      if (!kv) {
        session.notes.push(text);
        continue;
      }
      const key = stripBold(kv[1]).toLowerCase();
      const value = kv[2].trim();
      if (key === 'duration') {
        const d = parseDurationMinutes(value);
        if (d === null) {
          errors.push(
            err(name, section.title, 'Duration', `Invalid Duration "${value}" (try "60m", "1h30m" or "90").`)
          );
        } else {
          session.durationMinutes = d;
        }
      } else if (key === 'timer') {
        const b = parseBool(value);
        if (b === null) {
          errors.push(err(name, section.title, 'Timer', `Invalid Timer "${value}" (expected true/false).`));
        } else {
          session.timer = b;
        }
      } else if (key === 'focus mode' || key === 'focus') {
        const b = parseBool(value);
        if (b === null) {
          errors.push(
            err(name, section.title, 'Focus Mode', `Invalid Focus Mode "${value}" (expected true/false).`)
          );
        } else {
          session.focusMode = b;
        }
      } else if (key === 'type') {
        const t = value.toLowerCase();
        if (t === 'break' || t === 'session') {
          explicitKind = t;
        } else {
          errors.push(err(name, section.title, 'Type', `Invalid Type "${value}" (expected "session" or "break").`));
        }
      } else if (key === 'mode') {
        if (!value) {
          errors.push(err(name, section.title, 'Mode', 'Mode name must not be empty.'));
        } else {
          session.modeName = value;
        }
      } else if (key === 'count') {
        const cm = value.match(/^(\d+)(?:\s+(.+))?$/);
        if (!cm) {
          errors.push(err(name, section.title, 'Count', `Invalid Count "${value}" (try "50 questions").`));
        } else {
          session.countValue = parseInt(cm[1], 10);
          session.countLabel = (cm[2] || 'items').trim().toLowerCase();
        }
      } else if (COUNT_KEYS[key]) {
        const n = parseInt(value, 10);
        if (!Number.isFinite(n) || n <= 0 || String(n) !== value.trim()) {
          errors.push(
            err(name, section.title, kv[1].trim(), `Invalid ${kv[1].trim()} "${value}" (expected a positive whole number).`)
          );
        } else {
          session.countValue = n;
          session.countLabel = COUNT_KEYS[key];
        }
      } else if (key === 'description' || key === 'notes' || key === 'note') {
        if (value) session.notes.push(value);
      } else {
        // Preserve unknown keys verbatim — never silently discard user content.
        session.notes.push(text);
      }
    }

    session.kind = explicitKind || (isBreakHeading(session.title) ? 'break' : 'session');
    if (session.durationMinutes === null && defaultDurationMinutes !== null) {
      session.durationMinutes = defaultDurationMinutes;
    }
    if (session.durationMinutes === null) {
      errors.push(
        err(
          name,
          section.title,
          'Duration',
          `Section "${section.title}" has no usable Duration (add "- Duration: 60m", or a "default-duration" to the frontmatter).`
        )
      );
    }
    if (!hasContent) {
      warnings.push(`Section "${section.title}" has no content lines.`);
    }
    sessions.push(session);
  });

  if (sessions.length === 0) {
    errors.push(err(name, null, null, 'No schedulable sections found (add "## Session" headings with Durations).'));
  }

  const variables = extractVariables(
    [title, description || '', ...sessions.flatMap((s) => [s.title, s.modeName || '', ...s.notes])].join('\n')
  );

  return {
    template: { name, title, description, version, defaultStart, defaultDurationMinutes, sessions, variables, warnings },
    errors,
  };
}

// ── Schedule generation ──────────────────────────────────────────────────────

function resolveMode(
  modes: StudyMode[],
  modeId: string | undefined,
  modeName: string | null,
  forBreak: boolean
): StudyMode | null {
  if (modeId) {
    const byId = modes.find((m) => m.id === modeId);
    if (byId) return byId;
  }
  if (modeName) {
    const byName = modes.find((m) => m.name.toLowerCase() === modeName.toLowerCase());
    if (byName) return byName;
  }
  if (forBreak) {
    const rest = modes.find((m) => /^(break|rest)$/i.test(m.name));
    if (rest) return rest;
  }
  return modes.find((m) => m.isDefault) || modes[0] || null;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function makeBlockId(nowMs: number, salt: string): string {
  return `block-${nowMs.toString(36)}-${salt}`;
}

/**
 * Compute timed blocks for `config`. Pure: no I/O, no timers, no side effects.
 * Fatal problems → `{ blocks: [], errors }`. Overlaps are non-fatal
 * (`conflicts`) — the caller decides add-alongside vs cancel.
 */
export function generateSchedule(
  template: ScheduleTemplate,
  config: GenerationConfig,
  ctx: {
    modes: StudyMode[];
    existingBlocks?: ScheduleBlock[];
    nowMs?: number;
    idSalt?: () => string;
  }
): GenerationResult {
  const fail = (
    errors: string[],
    partial?: Partial<GenerationResult>
  ): GenerationResult => ({
    blocks: [],
    conflicts: [],
    errors,
    totalMinutes: 0,
    endTime: null,
    alreadyApplied: false,
    ...partial,
  });

  if (!DATE_RE.test(config.date || '')) {
    return fail([`Invalid target date "${config.date}" (expected YYYY-MM-DD).`]);
  }
  const startMinutes = parseTimeMinutes(config.startTime || '');
  if (startMinutes === null) {
    return fail([`Invalid start time "${config.startTime}" (expected HH:mm).`]);
  }
  if (template.sessions.length === 0) {
    return fail([`Template "${template.name}" defines no sessions.`]);
  }
  if (!ctx.modes || ctx.modes.length === 0) {
    return fail(['No focus modes are defined — create one before generating a schedule.']);
  }

  const variables = config.variables || {};
  const overrides = config.overrides || {};
  const nowMs = ctx.nowMs ?? Date.now();
  const salt = ctx.idSalt || (() => Math.random().toString(36).slice(2, 8));
  const appliedAt = new Date(nowMs).toISOString();

  const blocks: ScheduleBlock[] = [];
  let cursor = startMinutes;
  let totalMinutes = 0;

  for (const session of template.sessions) {
    const ov = overrides[session.order] || {};
    const duration = ov.durationMinutes ?? session.durationMinutes;
    if (!Number.isFinite(duration as number) || (duration as number) <= 0) {
      return fail([
        `Section "${session.title}" has no usable duration — set Duration in the template or override it here.`,
      ]);
    }
    const durationMinutes = Math.round(duration as number);
    const title = (ov.title !== undefined ? ov.title : applyTemplateVariables(session.title, variables)).trim();
    if (!title) {
      return fail([`Section #${session.order + 1} needs a title.`]);
    }
    const end = cursor + durationMinutes;
    if (end > 24 * 60) {
      return fail([
        `"${title}" would end after midnight — shorten a duration or pick an earlier start time.`,
      ]);
    }
    const mode = resolveMode(ctx.modes, ov.modeId, session.modeName ? applyTemplateVariables(session.modeName, variables) : null, session.kind === 'break');
    if (!mode) {
      return fail([`No focus mode available for "${title}".`]);
    }

    const countValue = ov.countValue !== undefined ? ov.countValue : session.countValue;
    const countLabel = session.countLabel || 'items';
    const notes = session.notes.map((n) => applyTemplateVariables(n, variables)).filter((n) => n.trim());
    const detailParts: string[] = [];
    if (countValue !== null && countValue !== undefined) detailParts.push(`${countValue} ${countLabel}`);
    if (notes.length > 0) detailParts.push(notes.join(' · '));

    const startTime = formatMinutes(cursor);
    const endTime = formatMinutes(end);
    // modeName is the visible event title (same convention as manually
    // created blocks); the resolved mode travels in modeId/modeIcon/modeColor
    // for timer start, and counts/notes travel in description.
    blocks.push({
      id: makeBlockId(nowMs, salt()),
      date: config.date,
      startTime,
      endTime,
      modeId: mode.id,
      modeName: title,
      modeIcon: mode.icon,
      modeColor: mode.color,
      workDuration: durationMinutes,
      breakDuration: 0,
      cycles: 1,
      status: 'approved',
      ...(detailParts.length > 0 ? { description: detailParts.join(' · ') } : {}),
      timerEnabled: ov.timer ?? session.timer ?? (session.kind === 'break' ? false : true),
      ...(ov.focusMode !== undefined || session.focusMode !== null
        ? { focusMode: ov.focusMode ?? (session.focusMode as boolean) }
        : {}),
      originTemplate: template.name,
      originTemplateAppliedAt: appliedAt,
      source: 'control',
    });
    cursor = end;
    totalMinutes += durationMinutes;
  }

  const existing = (ctx.existingBlocks || []).filter((b) => b.date === config.date);
  const conflicts: ScheduleConflict[] = [];
  blocks.forEach((block, i) => {
    const overlapping = existing
      .filter((b) => overlaps(block.startTime, block.endTime, b.startTime, b.endTime))
      .map((b) => ({ id: b.id, title: b.modeName, startTime: b.startTime, endTime: b.endTime }));
    if (overlapping.length > 0) {
      const session = template.sessions[i];
      conflicts.push({
        sessionIndex: session.order,
        sessionTitle: block.modeName,
        startTime: block.startTime,
        endTime: block.endTime,
        overlapping,
      });
    }
  });

  return {
    blocks,
    conflicts,
    errors: [],
    totalMinutes,
    endTime: blocks.length > 0 ? blocks[blocks.length - 1].endTime : null,
    alreadyApplied: existing.some((b) => b.originTemplate === template.name),
  };
}

// ── Daily-note schedule section ──────────────────────────────────────────────

export function dayScheduleHeading(templateTitle: string, date: string): string {
  return `## Generated Schedule — ${templateTitle} (${date})`;
}

export interface DayScheduleLine {
  startTime: string;
  endTime: string;
  title: string;
  detail?: string;
}

/**
 * Plain bullets (NOT checkboxes): the daily note records what was scheduled,
 * while completion lives on the calendar events themselves. This avoids two
 * competing sources of truth for "done".
 */
export function buildDayScheduleSection(
  templateTitle: string,
  date: string,
  lines: DayScheduleLine[]
): string {
  const body = lines
    .map((l) => `- ${l.startTime}–${l.endTime} · ${l.title}${l.detail ? ` (${l.detail})` : ''}`)
    .join('\n');
  return `${dayScheduleHeading(templateTitle, date)}\n${body}\n`;
}

/**
 * Insert or replace the generated-schedule section in a day file. Pure string
 * surgery: unrelated content (including user prose and task checkboxes) is
 * preserved verbatim. An exact heading match wins; otherwise any older
 * `## Generated Schedule` section is replaced so re-applying never stacks
 * duplicate sections.
 */
export function mergeDayScheduleSection(
  existingRaw: string,
  date: string,
  sectionBody: string
): string {
  const raw = existingRaw || '';
  if (!raw.trim()) {
    return `---\ntype: control-day\ndate: ${date}\n---\n\n${sectionBody}`;
  }
  const lines = raw.split('\n');
  const exactIdx = lines.findIndex((l) => l.trim() === sectionBody.split('\n')[0].trim());
  let idx = exactIdx;
  if (idx === -1) {
    idx = lines.findIndex((l) => l.trim().startsWith('## Generated Schedule'));
  }
  if (idx === -1) {
    const trimmedEnd = raw.replace(/\s+$/, '');
    return `${trimmedEnd}\n\n${sectionBody}`;
  }
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const next = [...lines.slice(0, idx), ...sectionBody.replace(/\n$/, '').split('\n'), ...lines.slice(end)];
  return next.join('\n');
}

// ── Single-block duration validation ─────────────────────────────────────────

export interface DurationMismatch {
  /** Index into the block list passed in. */
  index: number;
  title: string;
  /** Scheduled event length in minutes. */
  eventMinutes: number;
  /** The mode's configured focus length in minutes. */
  focusMinutes: number;
  modeName: string;
  modeId: string;
}

function eventMinutesOf(startTime: string, endTime: string): number | null {
  const s = parseTimeMinutes(startTime);
  const e = parseTimeMinutes(endTime);
  if (s === null || e === null || e <= s) return null;
  return e - s;
}

/**
 * Check scheduled events against their modes' focus durations.
 *
 * Only applies to single-block modes (cycles <= 1, non-chill): for those, the
 * calendar event IS the focus block, so its length should equal the mode's
 * `workDuration`. Multi-cycle modes are deliberately exempt — their events
 * intentionally span several work/break cycles.
 *
 * Returns mismatches (never throws); callers surface them as warnings with a
 * chance to fix, never silent stretching.
 */
export function validateSingleBlockDurations(
  blocks: Array<{ startTime: string; endTime: string; modeId: string; modeName: string }>,
  modes: StudyMode[]
): DurationMismatch[] {
  const out: DurationMismatch[] = [];
  blocks.forEach((b, index) => {
    const mode = modes.find((m) => m.id === b.modeId);
    if (!mode || mode.isChillMode || (mode.cycles ?? 1) > 1) return;
    const eventMinutes = eventMinutesOf(b.startTime, b.endTime);
    if (eventMinutes === null) return; // malformed times are reported elsewhere
    if (eventMinutes !== mode.workDuration) {
      out.push({
        index,
        title: b.modeName,
        eventMinutes,
        focusMinutes: mode.workDuration,
        modeName: mode.name,
        modeId: mode.id,
      });
    }
  });
  return out;
}
