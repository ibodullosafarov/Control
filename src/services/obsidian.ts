import { TaskItem, StudyMode, ObsidianConfig, ObsidianSyncResult, TasksMdReadResult, ObsidianTaskFile } from '../types';

// Ids whose individual notes the last successful export expects on disk.
// Used to tell "file deleted in Obsidian" (propagate) apart from "file never
// exported" (keep the task).
let lastExportedIds: string[] = [];
let syncing = false;

/**
 * Mirror of the main-process folder resolver — keep in sync with
 * resolveTasksFolder in electron/obsidian.ts.
 */
export function resolveTasksFolder(config: ObsidianConfig): string {
  const vault = (config.vaultPath || '').trim().replace(/\/+$/, '');
  if (!vault) return '';
  const rawLeaf = (config.folderName || '').trim();
  const leaf = !rawLeaf || rawLeaf === 'Control Tasks' ? 'Tasks' : rawLeaf;
  const base = vault.split('/').pop() || '';
  if (base === leaf) return vault;
  return `${vault}/Control/${leaf}`;
}

/**
 * Stable task id derived from a note's filename (hand-made notes without
 * frontmatter id). Keep in sync with taskIdFromFileName in electron/obsidian.ts.
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

export interface TaskMergeResult {
  tasks: TaskItem[];
  changed: boolean;
  /** True when an imported note has no frontmatter id yet — trigger one export so the app writes its id in. */
  needsIdBackfill: boolean;
}

/**
 * Reconcile the app's task list with notes parsed from the vault.
 * The file wins for title/completion/timestamps (Obsidian is the source of
 * truth); a task is removed only when its note disappeared after we know we
 * had exported it (expectedIds).
 */
export function mergeImportedTasks(
  current: TaskItem[],
  imported: ObsidianTaskFile[],
  expectedIds: string[],
  modes: StudyMode[]
): TaskMergeResult {
  const expected = new Set(expectedIds);
  const modeByName = new Map(modes.map((m) => [m.name, m]));
  const next: TaskItem[] = current.map((t) => ({ ...t }));
  const byId = new Map(next.map((t) => [t.id, t]));
  const importedIds = new Set<string>();
  let changed = false;
  let needsIdBackfill = false;

  for (const file of imported) {
    if (!file.id) needsIdBackfill = true;
    const id = file.id || taskIdFromFileName(file.fileName);
    importedIds.add(id);

    const modeId = file.modeName ? modeByName.get(file.modeName)?.id : undefined;
    const existing = byId.get(id);

    if (existing) {
      const completedAt = file.completed
        ? file.completedAt || existing.completedAt || new Date().toISOString()
        : undefined;
      const nextMode = modeId !== undefined ? modeId : existing.modeId;
      const nextOrder = file.order !== undefined ? file.order : existing.order;
      if (
        existing.title !== file.title ||
        existing.completed !== file.completed ||
        (existing.completedAt || undefined) !== (completedAt || undefined) ||
        (existing.modeId || undefined) !== (nextMode || undefined) ||
        existing.order !== nextOrder
      ) {
        existing.title = file.title;
        existing.completed = file.completed;
        existing.completedAt = completedAt;
        existing.modeId = nextMode;
        existing.order = nextOrder;
        changed = true;
      }
    } else {
      const maxOrder = next.reduce((acc, t) => Math.max(acc, t.order ?? 0), -1);
      const task: TaskItem = {
        id,
        title: file.title,
        completed: file.completed,
        order: file.order !== undefined ? file.order : maxOrder + 1,
        modeId,
        createdAt: file.createdAt || new Date().toISOString(),
        completedAt: file.completed ? file.completedAt || new Date().toISOString() : undefined,
      };
      byId.set(id, task);
      next.push(task);
      changed = true;
    }
  }

  // Deletions: only when we previously exported the file and it is now gone.
  const kept = next.filter((t) => !(expected.has(t.id) && !importedIds.has(t.id)));
  if (kept.length !== next.length) changed = true;

  return { tasks: kept, changed, needsIdBackfill };
}

export class ObsidianService {
  async selectDirectory(): Promise<{ canceled: boolean; filePaths: string[] }> {
    if (window.focusAPI?.selectDirectory) {
      return await window.focusAPI.selectDirectory();
    }
    return { canceled: true, filePaths: [] };
  }

  isSyncing(): boolean {
    return syncing;
  }

  getLastExportedIds(): string[] {
    return lastExportedIds;
  }

  async syncTasks(
    tasks: TaskItem[],
    modes: StudyMode[],
    config: ObsidianConfig
  ): Promise<ObsidianSyncResult> {
    if (window.focusAPI?.syncTasksToObsidian) {
      syncing = true;
      try {
        const res = await window.focusAPI.syncTasksToObsidian(tasks, modes, config);
        if (res.success && config.syncFormat !== 'consolidated') {
          lastExportedIds = res.fileIds || [];
        } else if (res.success) {
          lastExportedIds = [];
        }
        return res;
      } finally {
        syncing = false;
      }
    }
    return {
      success: false,
      syncedCount: 0,
      createdCount: 0,
      updatedCount: 0,
      folder: config.vaultPath,
      error: 'Electron API is not available in browser mode.',
    };
  }

  async readTasks(config: ObsidianConfig): Promise<TasksMdReadResult> {
    if (window.focusAPI?.readTasksFromObsidian) {
      return await window.focusAPI.readTasksFromObsidian(config);
    }
    return { success: false, folder: '', tasks: [], error: 'Electron API is not available in browser mode.' };
  }

  async openFolder(folderPath: string): Promise<{ success: boolean; error?: string }> {
    if (window.focusAPI?.openPath) {
      return await window.focusAPI.openPath(folderPath);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }
}

export const obsidianService = new ObsidianService();
