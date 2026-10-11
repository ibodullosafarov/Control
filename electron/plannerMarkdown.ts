import * as fs from 'fs';
import * as path from 'path';
import {
  DayMarkdownPlan,
  DayMdSection,
  DayMdTask,
  PlannerFileChangeEvent,
  PlannerMdStatus,
  PlannerTemplate,
  ApplyTemplateResult,
  PlannerMdTaskOpResult,
} from '../src/types';
import { sanitizeFilename } from './obsidian';
import { mergeDayScheduleSection } from '../src/services/scheduleTemplates';

const PLANNER_ROOT_NAME = 'Control';
const TEMPLATES_DIR_NAME = 'Templates';
const DAYS_DIR_NAME = 'Days';

const CHECKBOX_LINE_RE = /^(\s*[-*]\s+)\[( |x|X)\]\s*(.*)$/;
const DURATION_LINE_RE = /^\s{2,}[-*]\s+(?:\*\*)?Duration(?:\*\*)?\s*:\s*(\d+)\s*(?:m|min|mins|minutes)?\s*$/i;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const VARIABLE_RE = /\{\{\s*([\w-]+)\s*\}\}/g;

interface PlannerDirs {
  root: string;
  days: string;
  templates: string;
}

export function getPlannerDirs(vaultPath: string): PlannerDirs {
  const root = path.join(vaultPath.trim(), PLANNER_ROOT_NAME);
  return {
    root,
    days: path.join(root, DAYS_DIR_NAME),
    templates: path.join(root, TEMPLATES_DIR_NAME),
  };
}

function ensureDirs(dirs: PlannerDirs) {
  for (const dir of [dirs.root, dirs.days, dirs.templates]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// ── Minimal YAML frontmatter (flat key: value pairs) ────────────────────────

export function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const data: Record<string, string> = {};
  if (!raw.startsWith('---')) {
    return { data, body: raw };
  }
  const lines = raw.split('\n');
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { data, body: raw };
  }
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  const body = lines.slice(end + 1).join('\n');
  return { data, body };
}

export function buildFrontmatter(data: Record<string, string | undefined>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const needsQuotes = /[:#{}\[\]]/.test(value) || value.includes('"');
    lines.push(`${key}: ${needsQuotes ? JSON.stringify(value) : value}`);
  }
  lines.push('---');
  return lines.join('\n');
}

// ── Markdown plan parser ────────────────────────────────────────────────────

export function parseDayMarkdown(
  date: string,
  raw: string,
  filePath: string
): DayMarkdownPlan {
  const { data, body } = parseFrontmatter(raw);
  const lines = body.split('\n');

  let title = '';
  const sections: DayMdSection[] = [];
  let currentSection: DayMdSection | null = null;
  const tasks: DayMdTask[] = [];
  let checkIndex = 0;

  for (const line of lines) {
    const heading = line.match(HEADING_RE);
    if (heading) {
      if (heading[1].length === 1) {
        if (!title) title = heading[2].trim();
        continue;
      }
      if (heading[1].length === 2) {
        currentSection = { title: heading[2].trim(), tasks: [] };
        sections.push(currentSection);
        continue;
      }
      continue; // deeper headings are not structural sections
    }

    const checkbox = line.match(CHECKBOX_LINE_RE);
    if (checkbox) {
      const completed = checkbox[2].toLowerCase() === 'x';
      const taskTitle = checkbox[3].trim();
      const task: DayMdTask = {
        index: checkIndex++,
        title: taskTitle,
        completed,
        section: currentSection ? currentSection.title : '',
        order: tasks.length,
      };
      tasks.push(task);
      if (currentSection) currentSection.tasks.push(task);
      continue;
    }

    // A "Duration: 25m" sub-bullet attaches to the most recent task
    const duration = line.match(DURATION_LINE_RE);
    if (duration && tasks.length > 0) {
      tasks[tasks.length - 1].durationMinutes = parseInt(duration[1], 10);
      if (currentSection && currentSection.tasks.length > 0) {
        currentSection.tasks[currentSection.tasks.length - 1].durationMinutes =
          tasks[tasks.length - 1].durationMinutes;
      }
    }
  }

  // Sections may hold references to the same task objects; keep section task
  // arrays in sync is already handled above. Tasks without any heading go
  // under a default section so the UI always has something to render.
  const unsectioned = tasks.filter((t) => t.section === '');
  if (unsectioned.length > 0 && sections.length > 0) {
    sections.unshift({ title: '', tasks: unsectioned });
  }

  const completedTasks = tasks.filter((t) => t.completed).length;

  return {
    date,
    exists: true,
    path: filePath,
    title: title || `Day Plan — ${date}`,
    templateName: data.template || undefined,
    sections: sections.length > 0 ? sections : tasks.length > 0 ? [{ title: '', tasks }] : [],
    totalTasks: tasks.length,
    completedTasks,
    raw,
  };
}

export function emptyDayPlan(date: string, dirs: PlannerDirs): DayMarkdownPlan {
  return {
    date,
    exists: false,
    path: path.join(dirs.days, `${date}.md`),
    title: `Day Plan — ${date}`,
    sections: [],
    totalTasks: 0,
    completedTasks: 0,
    raw: '',
  };
}

// ── Template helpers ────────────────────────────────────────────────────────

export function extractVariables(raw: string): string[] {
  const { body } = parseFrontmatter(raw);
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  VARIABLE_RE.lastIndex = 0;
  while ((match = VARIABLE_RE.exec(body)) !== null) {
    found.add(match[1]);
  }
  return Array.from(found);
}

export function applyVariables(raw: string, variables: Record<string, string>): string {
  const { data, body } = parseFrontmatter(raw);
  const substituted = body.replace(VARIABLE_RE, (_full, name: string) => {
    const value = variables[name];
    return value !== undefined && value !== '' ? value : `{{${name}}}`;
  });
  const frontmatter = Object.keys(data).length > 0 ? buildFrontmatter(data) + '\n\n' : '';
  return frontmatter + substituted;
}

function formatDayHeading(date: string): string {
  const d = new Date(date + 'T00:00:00');
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  const monthDay = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  return `${weekday} — ${monthDay}`;
}

function templateToPlannerTemplate(name: string, filePath: string, raw: string): PlannerTemplate {
  const { data, body } = parseFrontmatter(raw);
  const lines = body.split('\n');
  let title = '';
  let taskCount = 0;
  const sections = new Set<string>();
  for (const line of lines) {
    const heading = line.match(HEADING_RE);
    if (heading) {
      if (heading[1].length === 1 && !title) title = heading[2].trim();
      if (heading[1].length === 2) sections.add(heading[2].trim());
      continue;
    }
    if (CHECKBOX_LINE_RE.test(line)) taskCount++;
  }
  let updatedAt = '';
  try {
    updatedAt = fs.statSync(filePath).mtime.toISOString();
  } catch {
    updatedAt = new Date().toISOString();
  }
  return {
    name,
    path: filePath,
    title: data.name || title || name,
    variables: extractVariables(raw),
    taskCount,
    sectionCount: sections.size,
    updatedAt,
  };
}

// ── Day file generation from a template ─────────────────────────────────────

function generateDayContent(
  templateRaw: string,
  templateName: string,
  date: string,
  variables: Record<string, string>
): string {
  const substituted = applyVariables(templateRaw, variables);
  const { body } = parseFrontmatter(substituted);
  const lines = body.split('\n');

  // Reset every checkbox to unchecked — a fresh day starts unstarted
  const resetLines = lines.map((line) =>
    CHECKBOX_LINE_RE.test(line) ? line.replace(CHECKBOX_LINE_RE, (_m, prefix) => `${prefix}[ ]`) : line
  );

  // Replace the first H1 with the date heading (or prepend one)
  let headingPlaced = false;
  const withHeading = resetLines.map((line) => {
    if (!headingPlaced && /^#\s+/.test(line)) {
      headingPlaced = true;
      return `# ${formatDayHeading(date)}`;
    }
    return line;
  });
  if (!headingPlaced) {
    withHeading.unshift(`# ${formatDayHeading(date)}`, '');
  }

  const frontmatter = buildFrontmatter({
    type: 'control-day',
    template: templateName,
    date,
  });

  return frontmatter + '\n\n' + withHeading.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ── Task write-back (line surgery on the raw Markdown) ──────────────────────

function mutateTaskLine(
  raw: string,
  taskIndex: number,
  mutate: (match: RegExpExecArray, line: string) => string | null
): { raw: string; error?: string } {
  const { data, body } = parseFrontmatter(raw);
  const bodyLines = body.split('\n');
  let checkIndex = 0;
  let changed = false;

  for (let i = 0; i < bodyLines.length; i++) {
    const match = CHECKBOX_LINE_RE.exec(bodyLines[i]);
    if (!match) continue;
    if (checkIndex === taskIndex) {
      const next = mutate(match, bodyLines[i]);
      if (next === null) {
        return { raw, error: `Task #${taskIndex + 1} not found in day file.` };
      }
      bodyLines[i] = next;
      changed = true;
      break;
    }
    checkIndex++;
  }

  if (!changed) {
    return { raw, error: `Task #${taskIndex + 1} not found in day file.` };
  }

  const frontmatter = Object.keys(data).length > 0 ? buildFrontmatter(data) + '\n\n' : '';
  return { raw: frontmatter + bodyLines.join('\n') };
}

// ── Manager ─────────────────────────────────────────────────────────────────

export class PlannerMarkdownManager {
  private watchers: fs.FSWatcher[] = [];
  private watchingKey = '';
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingEvents = new Map<string, PlannerFileChangeEvent>();
  private notify: ((payload: PlannerFileChangeEvent) => void) | null = null;

  getStatus(vaultPath?: string): PlannerMdStatus {
    if (!vaultPath || !vaultPath.trim()) {
      return {
        enabled: false,
        rootPath: '',
        daysDir: '',
        templatesDir: '',
        error: 'No Obsidian vault selected. Choose your vault in Settings → Obsidian.',
      };
    }
    const dirs = getPlannerDirs(vaultPath);
    return {
      enabled: true,
      rootPath: dirs.root,
      daysDir: dirs.days,
      templatesDir: dirs.templates,
    };
  }

  listTemplates(vaultPath: string): PlannerTemplate[] {
    const dirs = getPlannerDirs(vaultPath);
    ensureDirs(dirs);
    try {
      const files = fs
        .readdirSync(dirs.templates)
        .filter((f) => f.toLowerCase().endsWith('.md'))
        .sort((a, b) => a.localeCompare(b));
      return files.map((f) => {
        const filePath = path.join(dirs.templates, f);
        let raw = '';
        try {
          raw = fs.readFileSync(filePath, 'utf-8');
        } catch {
          raw = '';
        }
        return templateToPlannerTemplate(f.replace(/\.md$/i, ''), filePath, raw);
      });
    } catch (err) {
      console.warn('Failed to list planner templates:', err);
      return [];
    }
  }

  readDay(vaultPath: string, date: string): DayMarkdownPlan {
    const dirs = getPlannerDirs(vaultPath);
    ensureDirs(dirs);
    const filePath = path.join(dirs.days, `${date}.md`);
    if (!fs.existsSync(filePath)) {
      return emptyDayPlan(date, dirs);
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return parseDayMarkdown(date, raw, filePath);
  }

  /** Raw content of a schedule template for renderer-side parsing/generation. */
  readTemplate(
    vaultPath: string,
    name: string
  ): { success: boolean; content?: string; error?: string } {
    const dirs = getPlannerDirs(vaultPath);
    ensureDirs(dirs);
    const safeName = sanitizeFilename(name);
    const filePath = path.join(dirs.templates, `${safeName}.md`);
    if (!safeName || !fs.existsSync(filePath)) {
      return { success: false, error: `Template "${name}" was not found in ${dirs.templates}.` };
    }
    try {
      return { success: true, content: fs.readFileSync(filePath, 'utf-8') };
    } catch (err) {
      return {
        success: false,
        error: `Could not read template "${name}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Record a generated schedule in `Days/YYYY-MM-DD.md` under a
   * `## Generated Schedule` section. Only that section is touched —
   * everything else in the file (prose, checklists, frontmatter) is
   * preserved verbatim, and re-applying replaces the old section instead of
   * stacking duplicates.
   */
  updateDaySchedule(
    vaultPath: string,
    date: string,
    sectionBody: string
  ): { success: boolean; error?: string; path?: string } {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { success: false, error: `Invalid date "${date}" (expected YYYY-MM-DD).` };
    }
    if (!sectionBody || !sectionBody.trim()) {
      return { success: false, error: 'Nothing to record in the daily note.' };
    }
    try {
      const dirs = getPlannerDirs(vaultPath);
      ensureDirs(dirs);
      const filePath = path.join(dirs.days, `${date}.md`);
      const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
      fs.writeFileSync(filePath, mergeDayScheduleSection(existing, date, sectionBody), 'utf-8');
      return { success: true, path: filePath };
    } catch (err) {
      return {
        success: false,
        error: `Could not update the daily note: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  applyTemplate(
    vaultPath: string,
    templateName: string,
    date: string,
    variables: Record<string, string>
  ): ApplyTemplateResult {
    const dirs = getPlannerDirs(vaultPath);
    ensureDirs(dirs);
    const safeName = sanitizeFilename(templateName);
    const templatePath = path.join(dirs.templates, `${safeName}.md`);
    if (!fs.existsSync(templatePath)) {
      return { success: false, error: `Template "${templateName}" not found.` };
    }
    const templateRaw = fs.readFileSync(templatePath, 'utf-8');
    const content = generateDayContent(templateRaw, safeName, date, variables);
    const dayPath = path.join(dirs.days, `${date}.md`);
    const replaced = fs.existsSync(dayPath);
    fs.writeFileSync(dayPath, content, 'utf-8');
    const plan = parseDayMarkdown(date, content, dayPath);
    return { success: true, plan, replaced };
  }

  createTemplate(
    vaultPath: string,
    name: string,
    content: string
  ): { success: boolean; error?: string; template?: PlannerTemplate } {
    const dirs = getPlannerDirs(vaultPath);
    ensureDirs(dirs);
    const safeName = sanitizeFilename(name).slice(0, 80);
    if (!safeName) return { success: false, error: 'Template name is required.' };
    const filePath = path.join(dirs.templates, `${safeName}.md`);
    if (fs.existsSync(filePath)) {
      return { success: false, error: `A template named "${safeName}" already exists.` };
    }
    const raw =
      content && content.trim()
        ? content
        : [
            buildFrontmatter({ type: 'control-day-template', name: safeName }),
            '',
            `# ${safeName}`,
            '',
            '## Morning',
            '',
            '- [ ] First task',
            '  - Duration: 25m',
            '',
          ].join('\n');
    fs.writeFileSync(filePath, raw, 'utf-8');
    return { success: true, template: templateToPlannerTemplate(safeName, filePath, raw) };
  }

  /**
   * Create or overwrite a template file with verbatim content (template
   * editor). Unlike createTemplate, this never invents a skeleton and never
   * rejects existing files — the renderer confirms overwrites explicitly.
   */
  writeTemplate(
    vaultPath: string,
    name: string,
    content: string
  ): { success: boolean; error?: string; template?: PlannerTemplate } {
    const dirs = getPlannerDirs(vaultPath);
    ensureDirs(dirs);
    const safeName = sanitizeFilename(name).slice(0, 80);
    if (!safeName) return { success: false, error: 'Template name is required.' };
    if (!content || !content.trim()) {
      return { success: false, error: 'Template content must not be empty.' };
    }
    try {
      const filePath = path.join(dirs.templates, `${safeName}.md`);
      fs.writeFileSync(filePath, content.replace(/\s+$/, '') + '\n', 'utf-8');
      return { success: true, template: templateToPlannerTemplate(safeName, filePath, content) };
    } catch (err) {
      return {
        success: false,
        error: `Could not save template "${name}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  saveDayAsTemplate(
    vaultPath: string,
    date: string,
    name: string
  ): { success: boolean; error?: string; template?: PlannerTemplate } {
    const dirs = getPlannerDirs(vaultPath);
    ensureDirs(dirs);
    const safeName = sanitizeFilename(name).slice(0, 80);
    if (!safeName) return { success: false, error: 'Template name is required.' };
    const dayPath = path.join(dirs.days, `${date}.md`);
    if (!fs.existsSync(dayPath)) {
      return { success: false, error: `No day plan found for ${date}.` };
    }
    const dayRaw = fs.readFileSync(dayPath, 'utf-8');
    const { body } = parseFrontmatter(dayRaw);

    // Convert the day into a reusable template: reset checkboxes, keep structure
    const resetBody = body
      .split('\n')
      .map((line) => (CHECKBOX_LINE_RE.test(line) ? line.replace(CHECKBOX_LINE_RE, (_m, prefix) => `${prefix}[ ]`) : line))
      .join('\n');

    const templateRaw =
      buildFrontmatter({ type: 'control-day-template', name: safeName }) +
      '\n\n' +
      resetBody.trim() +
      '\n';

    const filePath = path.join(dirs.templates, `${safeName}.md`);
    fs.writeFileSync(filePath, templateRaw, 'utf-8');
    return { success: true, template: templateToPlannerTemplate(safeName, filePath, templateRaw) };
  }

  duplicateTemplate(
    vaultPath: string,
    name: string,
    newName: string
  ): { success: boolean; error?: string; template?: PlannerTemplate } {
    const dirs = getPlannerDirs(vaultPath);
    ensureDirs(dirs);
    const safeName = sanitizeFilename(name);
    const safeNewName = sanitizeFilename(newName).slice(0, 80);
    if (!safeNewName) return { success: false, error: 'New template name is required.' };
    const srcPath = path.join(dirs.templates, `${safeName}.md`);
    if (!fs.existsSync(srcPath)) {
      return { success: false, error: `Template "${name}" not found.` };
    }
    const destPath = path.join(dirs.templates, `${safeNewName}.md`);
    if (fs.existsSync(destPath)) {
      return { success: false, error: `A template named "${safeNewName}" already exists.` };
    }
    let raw = fs.readFileSync(srcPath, 'utf-8');
    const { data, body } = parseFrontmatter(raw);
    data.name = safeNewName;
    raw = buildFrontmatter(data) + '\n\n' + body.trim() + '\n';
    fs.writeFileSync(destPath, raw, 'utf-8');
    return { success: true, template: templateToPlannerTemplate(safeNewName, destPath, raw) };
  }

  deleteTemplate(vaultPath: string, name: string): { success: boolean; error?: string } {
    const dirs = getPlannerDirs(vaultPath);
    const safeName = sanitizeFilename(name);
    const filePath = path.join(dirs.templates, `${safeName}.md`);
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `Template "${name}" not found.` };
    }
    fs.unlinkSync(filePath);
    return { success: true };
  }

  toggleTask(
    vaultPath: string,
    date: string,
    taskIndex: number,
    completed: boolean
  ): PlannerMdTaskOpResult {
    const dirs = getPlannerDirs(vaultPath);
    const filePath = path.join(dirs.days, `${date}.md`);
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `No day plan found for ${date}.` };
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const result = mutateTaskLine(raw, taskIndex, (match) => {
      const prefix = match[1];
      return `${prefix}[${completed ? 'x' : ' '}] ${match[3]}`;
    });
    if (result.error) return { success: false, error: result.error };
    fs.writeFileSync(filePath, result.raw, 'utf-8');
    return { success: true, plan: parseDayMarkdown(date, result.raw, filePath) };
  }

  updateTaskTitle(
    vaultPath: string,
    date: string,
    taskIndex: number,
    title: string
  ): PlannerMdTaskOpResult {
    const dirs = getPlannerDirs(vaultPath);
    const filePath = path.join(dirs.days, `${date}.md`);
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `No day plan found for ${date}.` };
    }
    const cleanTitle = title.replace(/\r?\n/g, ' ').trim();
    if (!cleanTitle) return { success: false, error: 'Task title cannot be empty.' };
    const raw = fs.readFileSync(filePath, 'utf-8');
    const result = mutateTaskLine(raw, taskIndex, (match) => {
      const prefix = match[1];
      const mark = match[2].toLowerCase() === 'x' ? 'x' : ' ';
      return `${prefix}[${mark}] ${cleanTitle}`;
    });
    if (result.error) return { success: false, error: result.error };
    fs.writeFileSync(filePath, result.raw, 'utf-8');
    return { success: true, plan: parseDayMarkdown(date, result.raw, filePath) };
  }

  // ── File watching (two-way sync with Obsidian) ────────────────────────────

  ensureWatching(vaultPath: string, notify: (payload: PlannerFileChangeEvent) => void) {
    if (!vaultPath || !vaultPath.trim()) {
      this.stopWatching();
      return;
    }
    const dirs = getPlannerDirs(vaultPath);
    const key = `${dirs.days}|${dirs.templates}`;
    if (key === this.watchingKey && this.notify) {
      this.notify = notify;
      return;
    }
    this.stopWatching();
    ensureDirs(dirs);
    this.notify = notify;
    this.watchingKey = key;

    const watchDir = (dir: string, kind: 'day' | 'template') => {
      try {
        const watcher = fs.watch(dir, (_event, filename) => {
          if (!filename || !filename.toLowerCase().endsWith('.md')) return;
          this.queueEvent({ kind, fileName: filename.toString() });
        });
        this.watchers.push(watcher);
      } catch (err) {
        console.warn(`Failed to watch planner ${kind} dir:`, err);
      }
    };

    watchDir(dirs.days, 'day');
    watchDir(dirs.templates, 'template');
  }

  private queueEvent(event: PlannerFileChangeEvent) {
    const key = `${event.kind}:${event.fileName}`;
    this.pendingEvents.set(key, event);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const events = Array.from(this.pendingEvents.values());
      this.pendingEvents.clear();
      this.debounceTimer = null;
      for (const e of events) {
        this.notify?.(e);
      }
    }, 350);
  }

  stopWatching() {
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    this.watchers = [];
    this.watchingKey = '';
    this.notify = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingEvents.clear();
  }
}

export const plannerMarkdown = new PlannerMarkdownManager();
