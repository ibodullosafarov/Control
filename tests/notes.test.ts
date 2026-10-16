import { describe, expect, it } from 'vitest';
import {
  buildNoteMarkdown,
  dropOrphanNoteFolderIds,
  groupNotesByFolder,
  noteFileName,
  notePreview,
  sanitizeNoteFoldersInput,
} from '../src/services/notes';
import type { Note, NoteFolder } from '../src/types';

function note(id: string, extra: Partial<Note> = {}): Note {
  return {
    id,
    content: `Body of ${id}`,
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: `2026-10-14T10:00:00.000Z`,
    ...extra,
  };
}

function folder(id: string, name: string, modeId?: string): NoteFolder {
  return { id, name, createdAt: '2026-10-14T00:00:00.000Z', ...(modeId ? { modeId } : {}) };
}

describe('sanitizeNoteFoldersInput', () => {
  it('returns [] for non-array input and drops malformed entries', () => {
    expect(sanitizeNoteFoldersInput(undefined)).toEqual([]);
    const out = sanitizeNoteFoldersInput([
      folder('a', '  English  ', 'mode-1'),
      { id: '', name: 'x' },
      { id: 'b' },
      folder('a', 'dup'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', name: 'English', modeId: 'mode-1' });
  });
});

describe('groupNotesByFolder', () => {
  it('groups in folder order, newest first, ungrouped trailing', () => {
    const folders = [folder('f1', 'Math'), folder('f2', 'English')];
    const notes = [
      note('n1', { folderId: 'f1', updatedAt: '2026-10-14T09:00:00.000Z' }),
      note('n2', { folderId: 'f1', updatedAt: '2026-10-14T11:00:00.000Z' }),
      note('n3'),
      note('n4', { folderId: 'gone' }),
    ];
    const groups = groupNotesByFolder(notes, folders);
    expect(groups.map((g) => g.folder?.id ?? null)).toEqual(['f1', 'f2', null]);
    expect(groups[0].notes.map((n) => n.id)).toEqual(['n2', 'n1']);
    expect(groups[1].notes).toEqual([]);
    expect(groups[2].notes.map((n) => n.id)).toEqual(['n3', 'n4']);
  });
});

describe('dropOrphanNoteFolderIds', () => {
  it('clears assignments to missing folders', () => {
    const out = dropOrphanNoteFolderIds(
      [note('a', { folderId: 'f1' }), note('b', { folderId: 'gone' })],
      [folder('f1', 'Math')]
    );
    expect(out[0].folderId).toBe('f1');
    expect(out[1].folderId).toBeUndefined();
  });
});

describe('buildNoteMarkdown', () => {
  it('carries the full origin in YAML frontmatter', () => {
    const md = buildNoteMarkdown(
      note('note-abc123', {
        content: 'Remember the chain rule.',
        taskId: 'task-1',
        taskTitle: 'Do 25 integrals',
        modeId: 'mode-math',
        modeName: '25 English',
      }),
      'Math'
    );
    expect(md).toContain('---');
    expect(md).toContain('type: control/note');
    expect(md).toContain('task: "Do 25 integrals"');
    expect(md).toContain('task_id: "task-1"');
    expect(md).toContain('mode: "25 English"');
    expect(md).toContain('mode_id: "mode-math"');
    expect(md).toContain('folder: "Math"');
    expect(md).toContain('- control/note');
    expect(md).toContain('- mode/25-english');
    expect(md).toContain('Remember the chain rule.');
  });

  it('nulls missing origin fields', () => {
    const md = buildNoteMarkdown(note('x'));
    expect(md).toContain('task: null');
    expect(md).toContain('mode: null');
    expect(md).toContain('folder: null');
  });
});

describe('noteFileName', () => {
  it('builds a stable name from the first line plus id suffix', () => {
    expect(noteFileName(note('note-abc123', { content: 'Chain rule\nsecond line' }))).toBe(
      'Chain rule-abc123.md'
    );
    expect(noteFileName(note('note-xyz', { content: '' }))).toBe('note-te-xyz.md');
  });
});

describe('notePreview', () => {
  it('flattens and truncates', () => {
    expect(notePreview(note('n', { content: 'a\nb  c' }))).toBe('a b c');
    expect(notePreview(note('n', { content: 'x'.repeat(200) }), 20)).toHaveLength(20);
  });
});
