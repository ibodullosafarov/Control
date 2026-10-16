import { describe, expect, it } from 'vitest';
import {
  dropOrphanFolderIds,
  groupModesByFolder,
  sanitizeModeFolders,
} from '../src/services/modeFolders';
import type { ModeFolder, StudyMode } from '../src/types';

function mode(id: string, folderId?: string): StudyMode {
  return {
    id,
    name: id,
    description: '',
    icon: 'Target',
    color: '#38bdf8',
    workDuration: 25,
    breakDuration: 5,
    cycles: 1,
    longBreakDuration: 0,
    longBreakInterval: 1,
    blocklist: [],
    blockedApps: [],
    allowlist: [],
    allowBreakWebsites: true,
    countTowardStats: true,
    isChillMode: false,
    blockingStrategy: 'dynamic_hosts',
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...(folderId ? { folderId } : {}),
  };
}

function folder(id: string, name: string): ModeFolder {
  return { id, name, createdAt: '2026-01-01T00:00:00.000Z' };
}

describe('sanitizeModeFolders', () => {
  it('returns [] for non-array input', () => {
    expect(sanitizeModeFolders(undefined)).toEqual([]);
    expect(sanitizeModeFolders(null)).toEqual([]);
    expect(sanitizeModeFolders({})).toEqual([]);
  });

  it('drops malformed entries and dedupes by id', () => {
    const out = sanitizeModeFolders([
      folder('a', '  School  '),
      { id: '', name: 'blank id' },
      { id: 'b' },
      null,
      folder('a', 'duplicate'),
      folder('c', 'ok'),
    ]);
    expect(out.map((f) => f.id)).toEqual(['a', 'c']);
    expect(out[0].name).toBe('School');
  });
});

describe('groupModesByFolder', () => {
  it('groups by folder order and trails ungrouped modes', () => {
    const folders = [folder('f1', 'School'), folder('f2', 'Fun')];
    const modes = [mode('m1', 'f2'), mode('m2'), mode('m3', 'f1'), mode('m4', 'gone')];
    const groups = groupModesByFolder(modes, folders);
    expect(groups.map((g) => g.folder?.id ?? null)).toEqual(['f1', 'f2', null]);
    expect(groups[0].modes.map((m) => m.id)).toEqual(['m3']);
    expect(groups[1].modes.map((m) => m.id)).toEqual(['m1']);
    // Unknown folderId falls back to ungrouped.
    expect(groups[2].modes.map((m) => m.id)).toEqual(['m2', 'm4']);
  });

  it('keeps empty folders but omits an empty ungrouped group', () => {
    const groups = groupModesByFolder([mode('m1', 'f1')], [folder('f1', 'A'), folder('f2', 'B')]);
    expect(groups).toHaveLength(2);
    expect(groups[1].modes).toEqual([]);
  });
});

describe('dropOrphanFolderIds', () => {
  it('clears folderId values with no matching folder', () => {
    const modes = [mode('m1', 'f1'), mode('m2', 'gone'), mode('m3')];
    const out = dropOrphanFolderIds(modes, [folder('f1', 'A')]);
    expect(out[0].folderId).toBe('f1');
    expect(out[1].folderId).toBeUndefined();
    expect(out[2].folderId).toBeUndefined();
  });
});
