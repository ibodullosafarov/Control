import { ScheduleBlock, StudyMode } from '../types';
import { extractVariables, parseFrontmatter } from './scheduleTemplates';

/**
 * Flexible Markdown templates ("absolute-time" format).
 *
 * Grammar (deterministic, local, no network):
 *
 *   {{date}} Day Plan            <- preamble; {{date}} resolves to target date
 *
 *   # English 50                 <- H1 = one task (title verbatim)
 *
 *   ## Time                      <- Time subsection (case-insensitive)
 *   13:30-15:45                  <- range (`-`, `–`, `—` separators, spaces OK)
 *                                or `Start: HH:mm` / `End: HH:mm` lines
 *
 *   ## Blocking                  <- Blocking subsection (case-insensitive)
 *   Mode: {Quick}                <- mode reference (braces optional)
 *
 *   ## Anything else             <- notes, preserved verbatim
 *
 * Anything outside these rules (paragraphs, other lists, extra headings) is
 * preserved as notes/preamble and never fails parsing. Fatal problems —
 * missing/malformed Time, end <= start (cross-midnight is rejected: the
 * planner models same-date events) — are reported with task/field context.
 * Mode references are validated against real modes at apply time (no silent
 * fallback, no fake modes).
 */

export interface FlexTask {
  order: number;
  title: string;
  start: string | null; // HH:mm
  end: string | null; // HH:mm
  /** Mode name as written, braces stripped. Null when no Mode line. */
  modeRef: string | null;
  /** Raw Time text for error messages. */
  rawTimeText: string | null;
  /** Other subsection content, preserved verbatim. */
  notes: string[];
}

export interface FlexTemplate {
  name: string;
  title: string;
  description: string | null;
  hasDatePlaceholder: boolean;
  preamble: string;
  tasks: FlexTask[];
  variables: string[];
  warnings: string[];
}

export interface FlexParseError {
  template: string;
  task: string | null;
  field: string | null;
  message: string;
}

const H1_RE = /^#\s+(.*)$/;
const H2_RE = /^##\s+(.*)$/;
const TIME_RANGE_RE = /^(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})$/;
const TIME_VALUE_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const START_LINE_RE = /^start\s*:\s*(.+)$/i;
const END_LINE_RE = /^end\s*:\s*(.+)$/i;
const MODE_LINE_RE = /^mode\s*:\s*(.+)$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function err(
  template: string,
  task: string | null,
  field: string | null,
  message: string
): FlexParseError {
  return { template, task, field, message };
}

function normTime(value: string): string | null {
  const m = value.trim().match(TIME_VALUE_RE);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function stripModeBraces(value: string): string {
  const t = value.trim().replace(/^\{(.+)\}$/, '$1').trim();
  return t;
}

export function formatFlexDate(date: string): string {
  return date; // YYYY-MM-DD, the planner's canonical date form
}

export function parseFlexTemplate(
  name: string,
  raw: string
): { template: FlexTemplate; errors: FlexParseError[] } {
  const errors: FlexParseError[] = [];
  const warnings: string[] = [];
  const { data, body } = parseFrontmatter(raw || '');

  const title = (data.name || '').trim() || null;
  const description = (data.description || '').trim() || null;

  interface RawTask {
    title: string;
    lines: string[];
  }
  const preambleLines: string[] = [];
  const rawTasks: RawTask[] = [];
  let current: RawTask | null = null;
  for (const line of body.split('\n')) {
    const h1 = line.match(H1_RE);
    // `# ` only (not `##`): a line starting with exactly one #.
    if (h1 && !line.startsWith('##')) {
      current = { title: h1[1].trim(), lines: [] };
      rawTasks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else preambleLines.push(line);
  }

  // Note: unlike checklist templates, the first H1 is a task, not a title —
  // so the title falls back to the file name, never to a task heading.
  const resolvedTitle = title || name;
  const fullText = body;
  const hasDatePlaceholder = /\{\{\s*date\s*\}\}/.test(fullText);
  const variables = extractVariables(fullText);

  const tasks: FlexTask[] = rawTasks.map((rt, order) => {
    const task: FlexTask = {
      order,
      title: rt.title,
      start: null,
      end: null,
      modeRef: null,
      rawTimeText: null,
      notes: [],
    };
    if (!rt.title) {
      errors.push(err(name, null, null, `Task #${order + 1} has an empty heading.`));
      return task;
    }
    // Group lines by ## subsection (case-insensitive name).
    const sections = new Map<string, string[]>();
    const sectionOrder: string[] = [];
    let active: string | null = null;
    for (const line of rt.lines) {
      const h2 = line.match(H2_RE);
      if (h2) {
        active = h2[1].trim().toLowerCase();
        if (!sections.has(active)) {
          sections.set(active, []);
          sectionOrder.push(active);
        }
        continue;
      }
      if (active) sections.get(active)!.push(line);
      else if (line.trim()) task.notes.push(line.trim());
    }

    // Time subsection.
    const timeLines = (sections.get('time') || []).map((l) => l.trim()).filter(Boolean);
    if (timeLines.length === 0) {
      errors.push(
        err(name, rt.title, 'Time', `Task "${rt.title}" has no Time section (add "## Time" with e.g. "13:30-15:45").`)
      );
    } else {
      let start: string | null = null;
      let end: string | null = null;
      for (const tl of timeLines) {
        const range = tl.match(TIME_RANGE_RE);
        if (range) {
          start = normTime(range[1]);
          end = normTime(range[2]);
          break;
        }
        const sm = tl.match(START_LINE_RE);
        if (sm) {
          start = normTime(sm[1]);
          continue;
        }
        const em = tl.match(END_LINE_RE);
        if (em) {
          end = normTime(em[1]);
          continue;
        }
      }
      task.rawTimeText = timeLines.join(' / ');
      if (start === null || end === null) {
        errors.push(
          err(
            name,
            rt.title,
            'Time',
            `Task "${rt.title}" has malformed time "${task.rawTimeText}" (expected "HH:mm-HH:mm" or Start:/End: lines).`
          )
        );
      } else if (end <= start) {
        errors.push(
          err(
            name,
            rt.title,
            'Time',
            `Task "${rt.title}" ends at ${end}, not after ${start}: cross-midnight ranges are not supported — split it into two tasks.`
          )
        );
      } else {
        task.start = start;
        task.end = end;
      }
    }

    // Blocking subsection.
    const blockingLines = (sections.get('blocking') || []).map((l) => l.trim()).filter(Boolean);
    let modeFound = false;
    for (const bl of blockingLines) {
      const mm = bl.match(MODE_LINE_RE);
      if (mm) {
        modeFound = true;
        const ref = stripModeBraces(mm[1]);
        if (!ref) {
          errors.push(err(name, rt.title, 'Mode', `Task "${rt.title}" has an empty Mode reference.`));
        } else {
          task.modeRef = ref;
        }
      }
    }
    if (blockingLines.length > 0 && !modeFound) {
      warnings.push(`Task "${rt.title}" has a Blocking section without a "Mode:" line.`);
    }
    if (!task.modeRef) {
      errors.push(
        err(name, rt.title, 'Mode', `Task "${rt.title}" names no mode (add "Mode: {Mode Name}" under "## Blocking").`)
      );
    }

    // All other subsections are preserved notes.
    for (const sname of sectionOrder) {
      if (sname === 'time' || sname === 'blocking') continue;
      const content = (sections.get(sname) || []).join('\n').trim();
      if (content) task.notes.push(content);
    }
    return task;
  });

  if (rawTasks.length === 0) {
    errors.push(
      err(name, null, null, 'No tasks found (add "# Task title" headings with Time and Blocking sections).')
    );
  }

  return {
    template: {
      name,
      title: resolvedTitle,
      description,
      hasDatePlaceholder,
      preamble: preambleLines.join('\n').trim(),
      tasks,
      variables,
      warnings,
    },
    errors,
  };
}

export interface FlexModeResolution {
  order: number;
  modeId: string | null;
  error: string | null;
}

/** Resolve each task's mode reference against real modes (built-in + custom). */
export function resolveFlexTaskModes(
  template: FlexTemplate,
  modes: StudyMode[]
): FlexModeResolution[] {
  return template.tasks.map((t) => {
    if (!t.modeRef) {
      return { order: t.order, modeId: null, error: `Task "${t.title}" names no mode.` };
    }
    const found = modes.find((m) => m.name.toLowerCase() === t.modeRef!.toLowerCase());
    if (!found) {
      const known = modes.map((m) => m.name).join(', ') || '(no modes defined)';
      return {
        order: t.order,
        modeId: null,
        error: `Task "${t.title}" references unknown mode "${t.modeRef}". Available: ${known}.`,
      };
    }
    return { order: t.order, modeId: found.id, error: null };
  });
}

export interface FlexApplyConfig {
  date: string; // YYYY-MM-DD — also resolves {{date}}
  variables?: Record<string, string>;
  /** order -> mode id override chosen in the UI. */
  modeOverrides?: Record<number, string>;
  /** order -> start/end overrides (fix event times without editing the file). */
  timeOverrides?: Record<number, { start?: string; end?: string }>;
}

export interface FlexConflict {
  taskIndex: number;
  taskTitle: string;
  startTime: string;
  endTime: string;
  overlapping: Array<{ id: string; title: string; startTime: string; endTime: string }>;
}

export interface FlexApplyResult {
  blocks: import('../types').ScheduleBlock[];
  conflicts: FlexConflict[];
  errors: string[];
  totalMinutes: number;
  alreadyApplied: boolean;
}

function substitute(text: string, date: string, variables: Record<string, string>): string {
  let out = text.replace(/\{\{\s*date\s*\}\}/g, formatFlexDate(date));
  out = out.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_full, v: string) =>
    variables[v] !== undefined && variables[v] !== '' ? variables[v] : `{{${v}}}`
  );
  return out;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Build real planner blocks from absolute-time tasks. Pure: single validation
 * pass first (any fatal problem → `{ blocks: [], errors }`, nothing partial),
 * then construction. Overlaps are non-fatal warnings for the confirm step.
 */
export function applyFlexTemplate(
  template: FlexTemplate,
  config: FlexApplyConfig,
  ctx: {
    modes: StudyMode[];
    existingBlocks?: import('../types').ScheduleBlock[];
    nowMs?: number;
    idSalt?: () => string;
  }
): FlexApplyResult {
  const fail = (errors: string[]): FlexApplyResult => ({
    blocks: [],
    conflicts: [],
    errors,
    totalMinutes: 0,
    alreadyApplied: false,
  });

  if (!DATE_RE.test(config.date || '')) {
    return fail([`Invalid target date "${config.date}" (expected YYYY-MM-DD).`]);
  }
  if (template.tasks.length === 0) {
    return fail([`Template "${template.name}" defines no tasks.`]);
  }
  const resolutions = resolveFlexTaskModes(template, ctx.modes);
  const problems: string[] = [];
  const effectiveTimes = new Map<number, { start: string; end: string }>();
  for (const t of template.tasks) {
    const to = config.timeOverrides?.[t.order];
    let start = t.start;
    let end = t.end;
    if (to?.start !== undefined || to?.end !== undefined) {
      const rawStart = to?.start !== undefined && to.start !== '' ? to.start : t.start;
      const rawEnd = to?.end !== undefined && to.end !== '' ? to.end : t.end;
      const ps = rawStart ? normTime(rawStart) : null;
      const pe = rawEnd ? normTime(rawEnd) : null;
      if (ps === null || pe === null) {
        problems.push(
          `Task "${t.title || `#${t.order + 1}`}" has an invalid overridden time (expected HH:mm).`
        );
        continue;
      }
      if (pe <= ps) {
        problems.push(
          `Task "${t.title || `#${t.order + 1}`}" override ends at ${pe}, not after ${ps}.`
        );
        continue;
      }
      start = ps;
      end = pe;
    }
    if (!start || !end) {
      problems.push(`Task "${t.title || `#${t.order + 1}`}" has no usable time range.`);
      continue;
    }
    effectiveTimes.set(t.order, { start, end });
    const override = config.modeOverrides?.[t.order];
    const res = resolutions[t.order];
    const modeId = override || res.modeId;
    if (!modeId) {
      problems.push(res.error || `Task "${t.title}" has no resolvable mode.`);
      continue;
    }
    if (!ctx.modes.some((m) => m.id === modeId)) {
      problems.push(`Task "${t.title}" override selects an unknown mode.`);
    }
  }
  if (problems.length > 0) return fail(problems);

  const variables = config.variables || {};
  const nowMs = ctx.nowMs ?? Date.now();
  const salt = ctx.idSalt || (() => Math.random().toString(36).slice(2, 8));
  const appliedAt = new Date(nowMs).toISOString();

  const blocks = template.tasks.map((t, i) => {
    const override = config.modeOverrides?.[t.order];
    const modeId = override || resolutions[i].modeId!;
    const mode = ctx.modes.find((m) => m.id === modeId)!;
    const title = substitute(t.title, config.date, variables).trim() || mode.name;
    const times = effectiveTimes.get(t.order)!;
    const duration = toMinutes(times.end) - toMinutes(times.start);
    const detail = t.notes.map((n) => substitute(n, config.date, variables)).filter((n) => n.trim());
    return {
      id: `block-${nowMs.toString(36)}-${salt()}`,
      date: config.date,
      startTime: times.start,
      endTime: times.end,
      modeId: mode.id,
      modeName: title,
      modeIcon: mode.icon,
      modeColor: mode.color,
      workDuration: duration,
      breakDuration: 0,
      cycles: 1,
      status: 'approved' as const,
      ...(detail.length > 0 ? { description: detail.join(' · ') } : {}),
      timerEnabled: true,
      originTemplate: template.name,
      originTemplateAppliedAt: appliedAt,
      source: 'control' as const,
    };
  });

  const existing = (ctx.existingBlocks || []).filter((b) => b.date === config.date);
  const conflicts: FlexConflict[] = [];
  blocks.forEach((b, i) => {
    const overlapping = existing
      .filter(
        (e) =>
          toMinutes(b.startTime) < toMinutes(e.endTime) &&
          toMinutes(e.startTime) < toMinutes(b.endTime)
      )
      .map((e) => ({ id: e.id, title: e.modeName, startTime: e.startTime, endTime: e.endTime }));
    if (overlapping.length > 0) {
      conflicts.push({
        taskIndex: i,
        taskTitle: b.modeName,
        startTime: b.startTime,
        endTime: b.endTime,
        overlapping,
      });
    }
  });

  return {
    blocks,
    conflicts,
    errors: [],
    totalMinutes: blocks.reduce((acc, b) => acc + (toMinutes(b.endTime) - toMinutes(b.startTime)), 0),
    alreadyApplied: existing.some((b) => b.originTemplate === template.name),
  };
}

/** Partition a date's blocks for an explicit replace (caller confirms first). */
export function partitionForReplace(
  existingBlocks: import('../types').ScheduleBlock[]
): { removeIds: string[]; googleMapped: number } {
  return {
    removeIds: existingBlocks.map((b) => b.id),
    googleMapped: existingBlocks.filter((b) => b.googleCalendarEventId).length,
  };
}
