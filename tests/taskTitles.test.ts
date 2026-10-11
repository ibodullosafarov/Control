import { describe, expect, it } from 'vitest';
import {
  formatDateSuffix,
  hasDateSuffix,
  preserveDateSuffix,
  splitDateSuffix,
  stripDateSuffix,
  withDateSuffix,
} from '../src/services/taskTitles';
import { mergeImportedTasks } from '../src/services/obsidian';
import { ObsidianTaskFile } from '../src/types';

describe('splitDateSuffix / stripDateSuffix', () => {
  it('strips a valid trailing DD.MM.YYYY suffix', () => {
    expect(splitDateSuffix('25 Math questions 1 11.10.2026')).toEqual({
      clean: '25 Math questions 1',
      suffix: '11.10.2026',
    });
    expect(stripDateSuffix('25 Math questions 1 11.10.2026')).toBe('25 Math questions 1');
  });

  it('leaves titles without a suffix untouched', () => {
    expect(stripDateSuffix('25 Math questions 1')).toBe('25 Math questions 1');
    expect(stripDateSuffix('  padded  ')).toBe('padded');
    expect(stripDateSuffix('')).toBe('');
  });

  it('rejects impossible dates', () => {
    expect(hasDateSuffix('Task 99.99.2026')).toBe(false);
    expect(hasDateSuffix('Task 30.02.2026')).toBe(false);
    expect(hasDateSuffix('Task 00.10.2026')).toBe(false);
    expect(hasDateSuffix('Task 11.13.2026')).toBe(false);
    expect(hasDateSuffix('Task 11.10.1800')).toBe(false);
    expect(hasDateSuffix('Task 29.02.2024')).toBe(true); // real leap day
    expect(hasDateSuffix('Task 29.02.2025')).toBe(false);
  });

  it('never strips mid-title dates or bare numbers', () => {
    expect(stripDateSuffix('11.10.2026 review session')).toBe('11.10.2026 review session');
    expect(stripDateSuffix('Chapter 11 questions')).toBe('Chapter 11 questions');
    expect(stripDateSuffix('Do 50 pushups')).toBe('Do 50 pushups');
    expect(stripDateSuffix('Meeting 2026-10-11')).toBe('Meeting 2026-10-11');
    expect(stripDateSuffix('11.10.2026')).toBe('11.10.2026'); // nothing left but the date
  });
});

describe('preserveDateSuffix', () => {
  it('re-attaches the original suffix to a clean edit', () => {
    expect(preserveDateSuffix('25 Math questions 1 11.10.2026', '25 Math questions 2')).toBe(
      '25 Math questions 2 11.10.2026'
    );
  });

  it('never double-appends', () => {
    expect(preserveDateSuffix('X 11.10.2026', 'Y 12.10.2026')).toBe('Y 12.10.2026');
  });

  it('leaves suffix-less titles alone and guards empty input', () => {
    expect(preserveDateSuffix('Plain task', 'Renamed')).toBe('Renamed');
    expect(preserveDateSuffix('X 11.10.2026', '   ')).toBe('X 11.10.2026');
  });
});

describe('withDateSuffix / formatDateSuffix', () => {
  it('appends the creation date once', () => {
    expect(withDateSuffix('25 Math questions 1', '2026-10-12T08:00:00.000Z')).toBe(
      '25 Math questions 1 12.10.2026'
    );
    expect(withDateSuffix('Already 11.10.2026', '2026-10-12T08:00:00.000Z')).toBe('Already 11.10.2026');
    expect(withDateSuffix('  spaced  ', '2026-01-05T00:00:00.000Z')).toBe('spaced 05.01.2026');
  });
});

describe('two dated notes, one clean title (regression)', () => {
  function note(fileName: string, id: string, title: string): ObsidianTaskFile {
    return { id, fileName, title, completed: false, order: 0 };
  }

  it('imports both notes as separate tasks with the same display title', () => {
    const imported = [
      note('25 Math questions 1 11.10.2026.md', 'id-aaa', '25 Math questions 1 11.10.2026'),
      note('25 Math questions 1 12.10.2026.md', 'id-bbb', '25 Math questions 1 12.10.2026'),
    ];
    const { tasks, changed } = mergeImportedTasks([], imported, [], []);
    expect(changed).toBe(true);
    expect(tasks).toHaveLength(2);
    // Internal titles keep the full unique note titles (identity-adjacent).
    expect(tasks.map((t) => t.title).sort()).toEqual([
      '25 Math questions 1 11.10.2026',
      '25 Math questions 1 12.10.2026',
    ]);
    // ...while every display site strips to the identical clean title.
    expect(tasks.map((t) => stripDateSuffix(t.title))).toEqual([
      '25 Math questions 1',
      '25 Math questions 1',
    ]);
    // Distinct stable ids — never matched by cleaned title.
    expect(new Set(tasks.map((t) => t.id)).size).toBe(2);
  });

  it('keeps each note linked across re-imports and edits', () => {
    const first = mergeImportedTasks(
      [],
      [note('25 Math questions 1 11.10.2026.md', 'id-aaa', '25 Math questions 1 11.10.2026')],
      [],
      []
    ).tasks;
    // User completes the task in Control; the note still resolves by id.
    const second = mergeImportedTasks(
      [{ ...first[0], completed: true }],
      [note('25 Math questions 1 11.10.2026.md', 'id-aaa', '25 Math questions 1 11.10.2026')],
      ['id-aaa'],
      []
    );
    expect(second.tasks).toHaveLength(1);
    expect(second.tasks[0].id).toBe('id-aaa');
    // A same-clean-title note for another day does not merge into it.
    const third = mergeImportedTasks(
      second.tasks,
      [
        note('25 Math questions 1 11.10.2026.md', 'id-aaa', '25 Math questions 1 11.10.2026'),
        note('25 Math questions 1 12.10.2026.md', 'id-bbb', '25 Math questions 1 12.10.2026'),
      ],
      ['id-aaa'],
      []
    );
    expect(third.tasks).toHaveLength(2);
  });
});
