import { describe, expect, it } from 'vitest';
import { isValidCompanionCommand, parseCompanionUrl } from '../electron/companion';

describe('companion URL command', () => {
  it('parses a note upsert with encoded content', () => {
    const command = parseCompanionUrl(
      'control://companion?action=note.upsert&id=note-1&folder=folder-1&content=Hello%20Control%0Aline%202'
    );
    expect(command).not.toBeNull();
    expect(command?.action).toBe('note.upsert');
    expect(command?.note).toEqual({
      id: 'note-1',
      folderId: 'folder-1',
      content: 'Hello Control\nline 2',
    });
    expect(isValidCompanionCommand(command)).toBe(true);
  });

  it('allows an upsert without an id and creates one in Control', () => {
    const command = parseCompanionUrl('control://companion?action=note.upsert&content=Quick%20note');
    expect(command?.note?.id).toBeUndefined();
    expect(command?.note?.content).toBe('Quick note');
  });

  it('preserves an explicit empty folder when moving a note out of a folder', () => {
    const command = parseCompanionUrl('control://companion?action=note.upsert&id=note-1&content=x&folder=');
    expect(command?.note?.folderId).toBe('');
  });

  it('parses note deletion', () => {
    const command = parseCompanionUrl('control://companion?action=note.delete&id=note-1');
    expect(command?.action).toBe('note.delete');
    expect(command?.note?.id).toBe('note-1');
    expect(isValidCompanionCommand(command)).toBe(true);
  });

  it('rejects unsupported, empty, and malformed commands', () => {
    expect(parseCompanionUrl('control://companion?action=note.delete')).toBeNull();
    expect(parseCompanionUrl('control://companion?action=note.upsert&content=%20%20')).toBeNull();
    expect(parseCompanionUrl('control://companion?action=task.delete&id=1')).toBeNull();
    expect(parseCompanionUrl('control://control?mode=Deep%20Work')).toBeNull();
    expect(parseCompanionUrl('not a url')).toBeNull();
  });

  it('rejects commands that bypass URL parsing', () => {
    expect(isValidCompanionCommand({ version: 1, id: 'x', createdAt: 'now', action: 'note.delete' })).toBe(false);
    expect(
      isValidCompanionCommand({
        version: 1,
        id: 'x',
        createdAt: 'now',
        action: 'note.upsert',
        note: { content: '   ' },
      })
    ).toBe(false);
  });
});
