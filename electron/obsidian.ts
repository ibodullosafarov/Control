import { dialog, BrowserWindow, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  TaskItem,
  StudyMode,
  ObsidianConfig,
  ObsidianSyncResult,
  ObsidianTaskFile,
  TasksMdReadResult,
} from '../src/types';
import { formatDateSuffix, hasDateSuffix, stripDateSuffix } from '../src/services/taskTitles';

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>#^[\]]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

// ── Minimal local frontmatter reader (avoids a circular import with
//    plannerMarkdown.ts, which imports sanitizeFilename from this file) ──────
function readFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const data: Record<string, string> = {};
  if (!raw.startsWith('---')) return { data, body: raw };
  const lines = raw.split('\n');
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') {
      i++;
      break;
    }
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.replace(/^"|"$/g, '');
      }
    }
    data[key] = value;
  }
  return { data, body: lines.slice(i).join('\n') };
}

const CHECKBOX_RE = /^(\s*[-*]\s+)\[( |x|X)\]\s*(.*)$/;

/**
 * Stable task id derived from a note's filename. Used for hand-made notes
 * that have no frontmatter id, so imports match across runs and GC can
 * recognize the file again after a rename.
 * NOTE: identical logic lives in src/services/obsidian.ts — keep in sync.
 */
export function taskIdFromFileName(fileName: string): string {
  const slug = fileName
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  let h = 5381;
  for (let i = 0; i < fileName.length; i++) {
    h = ((h << 5) + h + fileName.charCodeAt(i)) >>> 0;
  }
  return `task-md-${slug || 'note'}-${h.toString(36)}`;
}

// ── Folder layout ───────────────────────────────────────────────────────────
// Tasks live at <vault>/Control/<folderName>/ (default "Tasks"), as a sibling
// of Control/Templates and Control/Days. Older builds wrote to
// <vault>/<folderName> (default "Control Tasks"); those notes are migrated
// into the Control folder on first use.

export function resolveTasksFolder(config: ObsidianConfig): string {
  const vault = (config.vaultPath || '').trim().replace(/\/+$/, '');
  if (!vault) return '';
  const rawLeaf = (config.folderName || '').trim();
  const leaf = !rawLeaf || rawLeaf === 'Control Tasks' ? 'Tasks' : rawLeaf;
  if (path.basename(vault) === leaf) return vault;
  return path.join(vault, 'Control', leaf);
}

function legacyCandidateFolders(config: ObsidianConfig, targetDir: string): Array<{ dir: string; isAppDefault: boolean }> {
  const vault = (config.vaultPath || '').trim().replace(/\/+$/, '');
  if (!vault) return [];
  const rawLeaf = (config.folderName || '').trim();
  const candidates = new Map<string, boolean>();
  candidates.set(path.join(vault, 'Control Tasks'), true); // created by older builds
  const custom = rawLeaf ? path.join(vault, rawLeaf) : '';
  if (custom && custom !== path.join(vault, 'Control Tasks')) {
    candidates.set(custom, false);
  }
  return Array.from(candidates, ([dir, isAppDefault]) => ({ dir, isAppDefault })).filter(
    (c) => c.dir !== targetDir && c.dir !== vault
  );
}

/**
 * Move notes from the old flat vault folders into <vault>/Control/<folderName>,
 * then drop the old folder if it is empty. The app-created default folder
 * ("Control Tasks") is moved wholesale; custom folders only yield files that
 * carry Control frontmatter, so unrelated user folders stay untouched.
 */
function migrateLegacyFolders(config: ObsidianConfig, targetDir: string): void {
  for (const { dir: legacy, isAppDefault } of legacyCandidateFolders(config, targetDir)) {
    try {
      if (!fs.existsSync(legacy)) continue;
      const files = fs.readdirSync(legacy);
      for (const f of files) {
        const src = path.join(legacy, f);
        try {
          if (!isAppDefault) {
            if (!f.toLowerCase().endsWith('.md')) continue;
            const head = fs.readFileSync(src, 'utf-8').slice(0, 2000);
            if (!head.includes('control/task') && !head.includes('control/index')) continue;
          }
          const dest = path.join(targetDir, f);
          if (fs.existsSync(dest)) continue;
          fs.renameSync(src, dest);
        } catch (err) {
          console.warn(`Could not migrate legacy task note ${src}:`, err);
        }
      }
      if (fs.readdirSync(legacy).length === 0) {
        fs.rmdirSync(legacy);
      }
    } catch (err) {
      console.warn(`Could not migrate legacy tasks folder ${legacy}:`, err);
    }
  }
}

function prepareTasksDir(config: ObsidianConfig): string | null {
  const targetDir = resolveTasksFolder(config);
  if (!targetDir) return null;
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  migrateLegacyFolders(config, targetDir);
  return targetDir;
}

export class ObsidianManager {
  private watcher: fs.FSWatcher | null = null;
  private watchingKey = '';
  private watchTimer: NodeJS.Timeout | null = null;
  private watchNotify: (() => void) | null = null;

  async selectDirectory(window?: BrowserWindow | null): Promise<{ canceled: boolean; filePaths: string[] }> {
    try {
      const result = await dialog.showOpenDialog(window || undefined as any, {
        title: 'Select Obsidian Vault or Tasks Folder',
        buttonLabel: 'Choose Folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      return { canceled: result.canceled, filePaths: result.filePaths };
    } catch (err) {
      console.error('Error selecting directory:', err);
      return { canceled: true, filePaths: [] };
    }
  }

  async openPath(targetPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!fs.existsSync(targetPath)) {
        return { success: false, error: 'Path does not exist' };
      }
      const errorMsg = await shell.openPath(targetPath);
      if (errorMsg) {
        return { success: false, error: errorMsg };
      }
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }

  // ── Two-way watch: notify renderer when any task note changes on disk ─────
  ensureWatching(config: ObsidianConfig | undefined, notify: () => void): void {
    if (!config || !config.enabled || !config.vaultPath || !config.vaultPath.trim()) {
      this.stopWatching();
      return;
    }
    const dir = resolveTasksFolder(config);
    if (!dir) {
      this.stopWatching();
      return;
    }
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      migrateLegacyFolders(config, dir);
    } catch (err) {
      console.warn('Could not prepare tasks folder for watching:', err);
      return;
    }
    if (dir === this.watchingKey && this.watchNotify) {
      this.watchNotify = notify;
      return;
    }
    this.stopWatching();
    try {
      this.watcher = fs.watch(dir, (_event, filename) => {
        if (!filename || !filename.toString().toLowerCase().endsWith('.md')) return;
        if (this.watchTimer) clearTimeout(this.watchTimer);
        this.watchTimer = setTimeout(() => {
          this.watchTimer = null;
          this.watchNotify?.();
        }, 350);
      });
      this.watchingKey = dir;
      this.watchNotify = notify;
    } catch (err) {
      console.warn('Failed to watch tasks dir:', err);
    }
  }

  stopWatching(): void {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        /* ignore */
      }
    }
    this.watcher = null;
    this.watchingKey = '';
    this.watchNotify = null;
    if (this.watchTimer) {
      clearTimeout(this.watchTimer);
      this.watchTimer = null;
    }
  }

  // ── Import: parse every task note back into structured entries ────────────
  async readTasks(config: ObsidianConfig): Promise<TasksMdReadResult> {
    try {
      const dir = prepareTasksDir(config);
      if (!dir) {
        return { success: false, folder: '', tasks: [], error: 'No Obsidian vault or folder path selected.' };
      }
      const out: ObsidianTaskFile[] = [];
      for (const f of fs.readdirSync(dir).sort()) {
        if (!f.toLowerCase().endsWith('.md')) continue;
        const fp = path.join(dir, f);
        let raw: string;
        try {
          raw = fs.readFileSync(fp, 'utf-8');
        } catch {
          continue;
        }
        const { data, body } = readFrontmatter(raw);
        if (data.type === 'control/index') continue;

        let completed: boolean | null = null;
        let checkboxTitle = '';
        for (const line of body.split('\n')) {
          const m = CHECKBOX_RE.exec(line);
          if (m) {
            completed = m[2].toLowerCase() === 'x';
            checkboxTitle = m[3].trim();
            break;
          }
        }
        const isAppNote = Boolean(data.id) || raw.slice(0, 1500).includes('control/task');
        if (completed === null && !isAppNote) continue; // unrelated note in the folder

        const title = (checkboxTitle || data.title || f.replace(/\.md$/i, ''))
          .replace(/\s+#task$/i, '')
          .trim();
        if (!title) continue;

        const orderNum = Number(data.order);
        out.push({
          id: data.id || undefined,
          fileName: f,
          title,
          completed: completed ?? data.status === 'completed',
          order: data.order !== undefined && data.order !== '' && Number.isFinite(orderNum) ? orderNum : undefined,
          modeName: data.mode || undefined,
          createdAt: data.created_at || undefined,
          completedAt: data.completed_at && data.completed_at !== 'null' ? data.completed_at : undefined,
        });
      }
      return { success: true, folder: dir, tasks: out };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Failed to read tasks from Obsidian:', err);
      return { success: false, folder: '', tasks: [], error: msg };
    }
  }

  // ── Export: write task notes + index, GC orphans, migrate legacy folder ───
  async syncTasks(
    tasks: TaskItem[],
    modes: StudyMode[],
    config: ObsidianConfig
  ): Promise<ObsidianSyncResult> {
    try {
      const targetDir = prepareTasksDir(config);
      if (!targetDir) {
        return {
          success: false,
          syncedCount: 0,
          createdCount: 0,
          updatedCount: 0,
          folder: '',
          error: 'No Obsidian vault or folder path selected.',
        };
      }

      const modeMap = new Map(modes.map((m) => [m.id, m]));
      const wantsIndividual = config.syncFormat === 'individual' || config.syncFormat === 'both';
      const wantsConsolidated = config.syncFormat === 'consolidated' || config.syncFormat === 'both';
      const tasksToSync = config.includeCompleted ? tasks : tasks.filter((t) => !t.completed);

      let createdCount = 0;
      let updatedCount = 0;

      // Unique desired filenames (titles can collide after sanitizing).
      // Genuine duplicates across tasks are disambiguated with the task's own
      // creation date ("Name 12.10.2026") — stable across syncs and never
      // doubled (titles already carrying a valid suffix skip this).
      const desiredName = new Map<string, string>();
      const usedNames = new Set<string>();
      for (const task of tasksToSync) {
        const base = (sanitizeFilename(task.title).slice(0, 70) || task.id).slice(0, 70);
        let name = `${base}.md`;
        if (usedNames.has(name.toLowerCase()) && !hasDateSuffix(task.title)) {
          const suffix = formatDateSuffix(task.createdAt);
          if (suffix) {
            const dated = `${base.slice(0, Math.max(0, 69 - suffix.length))} ${suffix}`.trim();
            if (dated) name = `${dated}.md`;
          }
        }
        if (usedNames.has(name.toLowerCase())) {
          name = `${base.slice(0, 58)}-${task.id.slice(-6)}.md`;
        }
        let bump = 2;
        while (usedNames.has(name.toLowerCase())) {
          name = `${base.slice(0, 54)}-${task.id.slice(-6)}-${bump}.md`;
          bump++;
        }
        usedNames.add(name.toLowerCase());
        desiredName.set(task.id, name);
      }

      // 1. Individual markdown file per task

      // Pre-scan existing notes by task id so user Notes survive renames:
      // when the desired filename differs from what is on disk, the old file
      // is still the source of the "## Notes" section.
      const existingById = new Map<string, string>();
      if (wantsIndividual) {
        for (const f of fs.readdirSync(targetDir)) {
          if (!f.toLowerCase().endsWith('.md')) continue;
          const fp = path.join(targetDir, f);
          try {
            const raw = fs.readFileSync(fp, 'utf-8');
            const fm = readFrontmatter(raw.slice(0, 3000));
            if (fm.data.type === 'control/index') continue;
            const hasCheckbox = raw.split('\n').some((line) => CHECKBOX_RE.test(line));
            const id =
              fm.data.id ||
              (hasCheckbox || raw.slice(0, 1500).includes('control/task') ? taskIdFromFileName(f) : undefined);
            if (id && !existingById.has(id)) existingById.set(id, fp);
          } catch {
            /* unreadable note — skip */
          }
        }
      }

      if (wantsIndividual) {
        for (const task of tasksToSync) {
          const mode = task.modeId ? modeMap.get(task.modeId) : undefined;
          const modeName = mode ? mode.name : 'Focus';
          const workDuration = mode?.workDuration || 45;
          const breakDuration = mode?.breakDuration || 10;

          const fileName = desiredName.get(task.id)!;
          const filePath = path.join(targetDir, fileName);
          const isExisting = fs.existsSync(filePath);
          const notesSourcePath = isExisting ? filePath : existingById.get(task.id);

          // Preserve any existing notes the user wrote under "## Notes" in Obsidian
          let existingUserNotes = '';
          if (notesSourcePath) {
            try {
              const existingContent = fs.readFileSync(notesSourcePath, 'utf-8');
              const notesIdx = existingContent.indexOf('## Notes\n');
              if (notesIdx !== -1) {
                existingUserNotes = existingContent.substring(notesIdx + 9).trim();
              }
            } catch (readErr) {
              console.warn('Could not read existing user notes:', readErr);
            }
          }

          const frontmatter = [
            '---',
            `id: ${JSON.stringify(task.id)}`,
            `title: ${JSON.stringify(task.title)}`,
            `status: ${task.completed ? 'completed' : 'pending'}`,
            `mode: ${JSON.stringify(modeName)}`,
            `created_at: ${JSON.stringify(task.createdAt)}`,
            `completed_at: ${task.completedAt ? JSON.stringify(task.completedAt) : 'null'}`,
            `order: ${task.order}`,
            'tags:',
            '  - control/task',
            `  - ${task.completed ? 'control/completed' : 'control/pending'}`,
            `  - mode/${sanitizeFilename(modeName).toLowerCase()}`,
            '---',
          ].join('\n');

          const body = [
            frontmatter,
            '',
            `# ${task.title}`,
            '',
            `- [${task.completed ? 'x' : ' '}] ${task.title} #task`,
            '',
            '## Focus Details',
            `- **Mode**: ${modeName}`,
            `- **Interval**: ${workDuration}m focus / ${breakDuration}m break`,
            `- **Status**: ${task.completed ? '✅ Completed' : '⏳ In Progress'}`,
            `- **Created**: ${formatDate(task.createdAt)}`,
            task.completedAt ? `- **Completed At**: ${formatDate(task.completedAt)}` : '',
            `- **Source**: Control for macOS`,
            '',
            '## Notes',
            existingUserNotes || '<!-- Write your thoughts or task notes here in Obsidian -->',
            '',
          ]
            .filter((line) => line !== undefined)
            .join('\n');

          fs.writeFileSync(filePath, body, 'utf-8');

          if (isExisting) {
            updatedCount++;
          } else {
            createdCount++;
          }
        }
      }

      // 2. Consolidated master note if requested
      if (wantsConsolidated) {
        const consolidatedFilePath = path.join(targetDir, 'Control Tasks.md');
        const pendingTasks = tasks.filter((t) => !t.completed);
        const completedTasks = config.includeCompleted ? tasks.filter((t) => t.completed) : [];

        const nowFormatted = formatDate(new Date().toISOString());

        const masterLines = [
          '---',
          'title: "Control Tasks Backlog"',
          'type: control/index',
          `last_synced: ${JSON.stringify(new Date().toISOString())}`,
          'tags:',
          '  - control/index',
          '  - control/backlog',
          '---',
          '',
          '# 🎯 Control Tasks',
          '',
          `> Synchronized from **Control for macOS** on ${nowFormatted}.`,
          `> **${pendingTasks.length}** pending · **${completedTasks.length}** completed · **${pendingTasks.length + completedTasks.length}** total`,
          '',
          '## ⏳ Pending Tasks',
        ];

        if (pendingTasks.length === 0) {
          masterLines.push('_All tasks completed! Great work._');
        } else {
          for (const t of pendingTasks) {
            const mode = t.modeId ? modeMap.get(t.modeId) : undefined;
            const modeName = mode ? `(${mode.name})` : '';
            const safeName = sanitizeFilename(t.title).slice(0, 70) || t.id;
            // Link target stays the full-title filename; only the visible text is cleaned.
            const link = config.syncFormat === 'both' ? `[[${safeName}|${stripDateSuffix(t.title)}]]` : stripDateSuffix(t.title);
            masterLines.push(`- [ ] ${link} ${modeName} #task`);
          }
        }

        masterLines.push('', '## ✅ Completed Tasks');
        if (completedTasks.length === 0) {
          masterLines.push('_No completed tasks yet._');
        } else {
          for (const t of completedTasks) {
            const safeName = sanitizeFilename(t.title).slice(0, 70) || t.id;
            const link = config.syncFormat === 'both' ? `[[${safeName}|${stripDateSuffix(t.title)}]]` : stripDateSuffix(t.title);
            const compDate = t.completedAt ? `(done: ${formatDate(t.completedAt)})` : '';
            masterLines.push(`- [x] ${link} ${compDate} #task`);
          }
        }

        masterLines.push('');
        fs.writeFileSync(consolidatedFilePath, masterLines.join('\n'), 'utf-8');
      }

      // 3. Garbage-collect app-owned notes that no longer correspond to a task
      //    (renamed titles, deleted tasks, excluded completed). Notes without
      //    Control frontmatter are only touched if they carry a checkbox —
      //    those are part of the two-way system via a filename-derived id.
      const allTaskIds = new Set(tasks.map((t) => t.id));
      const desiredPaths = new Set(
        wantsIndividual
          ? Array.from(desiredName.values()).map((n) => path.join(targetDir, n))
          : []
      );
      let fileIds: string[] = [];
      if (wantsIndividual) {
        fileIds = tasksToSync.map((t) => t.id);
      }
      try {
        for (const f of fs.readdirSync(targetDir)) {
          if (!f.toLowerCase().endsWith('.md')) continue;
          const fp = path.join(targetDir, f);
          let content: string;
          try {
            content = fs.readFileSync(fp, 'utf-8');
          } catch {
            continue;
          }
          const fm = readFrontmatter(content.slice(0, 3000));
          const isIndex = fm.data.type === 'control/index';
          const hasCheckbox = content.split('\n').some((line) => CHECKBOX_RE.test(line));
          const isAppTagged = content.slice(0, 1500).includes('control/task');
          if (isIndex) {
            if (!wantsConsolidated) {
              try {
                fs.unlinkSync(fp);
              } catch (err) {
                console.warn('Could not remove stale task index:', err);
              }
            }
            continue;
          }
          if (!fm.data.id && !hasCheckbox && !isAppTagged) continue; // unrelated note
          const id = fm.data.id || taskIdFromFileName(f);
          if (!allTaskIds.has(id) || !desiredPaths.has(fp)) {
            try {
              fs.unlinkSync(fp);
            } catch (err) {
              console.warn('Could not remove stale task note:', err);
            }
          }
        }
      } catch (err) {
        console.warn('Task note cleanup failed:', err);
      }

      return {
        success: true,
        syncedCount: tasksToSync.length,
        createdCount,
        updatedCount,
        folder: targetDir,
        fileIds,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Failed to sync tasks to Obsidian:', err);
      return {
        success: false,
        syncedCount: 0,
        createdCount: 0,
        updatedCount: 0,
        folder: config.vaultPath,
        error: msg,
      };
    }
  }
}

export const obsidianManager = new ObsidianManager();
