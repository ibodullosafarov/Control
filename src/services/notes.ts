import type { Note, NoteFolder } from '../types';

/** A note group paired with its notes. `folder` is null for ungrouped notes. */
export interface NoteGroup {
  folder: NoteFolder | null;
  notes: Note[];
}

/**
 * Keep only well-formed note folders from unknown input (old backups, hand
 * edits). Dedupes by id, preserving first-seen order.
 */
export function sanitizeNoteFoldersInput(raw: unknown): NoteFolder[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: NoteFolder[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== 'string' || !rec.id || seen.has(rec.id)) continue;
    if (typeof rec.name !== 'string' || !rec.name.trim()) continue;
    seen.add(rec.id);
    out.push({
      id: rec.id,
      name: rec.name.trim(),
      ...(typeof rec.modeId === 'string' && rec.modeId ? { modeId: rec.modeId } : {}),
      createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : new Date().toISOString(),
    });
  }
  return out;
}

/**
 * Group notes under their folders (folder order first), ungrouped trailing.
 * Empty folders are kept so they stay manageable; the ungrouped group only
 * appears when it has notes. Notes pointing at missing folders fall back to
 * ungrouped. Newest first within each group.
 */
export function groupNotesByFolder(notes: Note[], folders: NoteFolder[]): NoteGroup[] {
  const byFolder = new Map<string, Note[]>();
  const ungrouped: Note[] = [];
  const folderIds = new Set(folders.map((f) => f.id));
  const sorted = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const n of sorted) {
    if (n.folderId && folderIds.has(n.folderId)) {
      const list = byFolder.get(n.folderId) || [];
      list.push(n);
      byFolder.set(n.folderId, list);
    } else {
      ungrouped.push(n);
    }
  }
  const groups: NoteGroup[] = folders.map((folder) => ({
    folder,
    notes: byFolder.get(folder.id) || [],
  }));
  if (ungrouped.length > 0) {
    groups.push({ folder: null, notes: ungrouped });
  }
  return groups;
}

/** Drop folder assignments that point at folders which no longer exist. */
export function dropOrphanNoteFolderIds(notes: Note[], folders: NoteFolder[]): Note[] {
  const folderIds = new Set(folders.map((f) => f.id));
  return notes.map((n) =>
    n.folderId && !folderIds.has(n.folderId) ? { ...n, folderId: undefined } : n
  );
}

const yaml = (value: string | undefined): string =>
  value === undefined ? 'null' : JSON.stringify(value);

/**
 * Render a note as Obsidian markdown: YAML frontmatter carrying the full
 * origin (task, mode, folder) plus the body. Control is the source of truth
 * for the body; the frontmatter is what makes notes attributable in the vault.
 */
export function buildNoteMarkdown(note: Note, folderName?: string): string {
  const frontmatter = [
    '---',
    `id: ${JSON.stringify(note.id)}`,
    'type: control/note',
    `created: ${JSON.stringify(note.createdAt)}`,
    `updated: ${JSON.stringify(note.updatedAt)}`,
    `task: ${yaml(note.taskTitle)}`,
    `task_id: ${yaml(note.taskId)}`,
    `mode: ${yaml(note.modeName)}`,
    `mode_id: ${yaml(note.modeId)}`,
    `folder: ${yaml(folderName)}`,
    'tags:',
    '  - control/note',
    ...(note.modeName ? [`  - mode/${note.modeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`] : []),
    '---',
  ].join('\n');
  return `${frontmatter}\n\n${note.content.trim()}\n`;
}

/** Stable Obsidian filename from the note's first line, disambiguated by id. */
export function noteFileName(note: Note): string {
  const firstLine = (note.content.split('\n')[0] || '').trim();
  const base = firstLine
    .replace(/[\\/:*?"<>|#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'note';
  return `${base}-${note.id.slice(-6)}.md`;
}

/** One-line preview of a note body for cards and rows. */
export function notePreview(note: Note, max = 120): string {
  const flat = note.content.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trim()}…` : flat;
}
