import type { ModeFolder, StudyMode } from '../types';

/** A folder group paired with its modes. `folder` is null for ungrouped modes. */
export interface ModeGroup {
  folder: ModeFolder | null;
  modes: StudyMode[];
}

/**
 * Keep only well-formed folders from unknown input (old backups, hand edits).
 * Dedupes by id, preserving first-seen order.
 */
export function sanitizeModeFolders(raw: unknown): ModeFolder[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ModeFolder[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { id, name, createdAt } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !id || typeof name !== 'string' || !name.trim()) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: name.trim(),
      createdAt: typeof createdAt === 'string' ? createdAt : new Date().toISOString(),
    });
  }
  return out;
}

/**
 * Group modes under their folders (folder order first), with ungrouped
 * modes trailing. Empty folders are kept so they stay manageable;
 * the ungrouped group is only included when it has modes.
 */
export function groupModesByFolder(modes: StudyMode[], folders: ModeFolder[]): ModeGroup[] {
  const byFolder = new Map<string, StudyMode[]>();
  const ungrouped: StudyMode[] = [];
  const folderIds = new Set(folders.map((f) => f.id));
  for (const m of modes) {
    if (m.folderId && folderIds.has(m.folderId)) {
      const list = byFolder.get(m.folderId) || [];
      list.push(m);
      byFolder.set(m.folderId, list);
    } else {
      ungrouped.push(m);
    }
  }
  const groups: ModeGroup[] = folders.map((folder) => ({
    folder,
    modes: byFolder.get(folder.id) || [],
  }));
  if (ungrouped.length > 0) {
    groups.push({ folder: null, modes: ungrouped });
  }
  return groups;
}

/** Drop folder assignments that point at folders which no longer exist. */
export function dropOrphanFolderIds(modes: StudyMode[], folders: ModeFolder[]): StudyMode[] {
  const folderIds = new Set(folders.map((f) => f.id));
  return modes.map((m) =>
    m.folderId && !folderIds.has(m.folderId) ? { ...m, folderId: undefined } : m
  );
}
