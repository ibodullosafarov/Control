import * as os from 'os';
import * as path from 'path';

/**
 * External Companion commands.
 *
 * Relay (or another trusted companion) sends these through the `control://`
 * URL scheme. The main process queues the command in a small request file and
 * the renderer applies it to the authoritative in-memory store. Control never
 * accepts direct writes to data.json.
 */
export type CompanionCommandAction = 'note.upsert' | 'note.delete';

export interface CompanionCommand {
  version: 1;
  id: string;
  createdAt: string;
  action: CompanionCommandAction;
  note?: {
    id?: string;
    content?: string;
    folderId?: string;
  };
}

export const COMPANION_REQUEST_FILE = path.join(
  os.homedir(),
  '.control-app',
  'companion-request.json'
);

const MAX_NOTE_LENGTH = 20_000;
const MAX_ID_LENGTH = 160;
const MAX_FOLDER_ID_LENGTH = 160;
const VALID_ACTIONS = new Set<CompanionCommandAction>(['note.upsert', 'note.delete']);

/**
 * Parse `control://companion?action=note.upsert&id=...&content=...`.
 * Returns null for malformed or unsupported commands.
 */
export function parseCompanionUrl(raw: string): CompanionCommand | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'control:') return null;
  const action = (url.hostname || url.pathname.replace(/^\/+/, '')).trim();
  if (action !== 'companion') return null;

  const commandAction = (url.searchParams.get('action') || '').trim() as CompanionCommandAction;
  if (!VALID_ACTIONS.has(commandAction)) return null;

  const rawId = (url.searchParams.get('id') || '').trim();
  const noteId = rawId ? rawId.slice(0, MAX_ID_LENGTH) : undefined;
  if (commandAction === 'note.delete' && !noteId) return null;

  const rawContent = url.searchParams.get('content');
  if (commandAction === 'note.upsert') {
    if (rawContent === null) return null;
    if (rawContent.length > MAX_NOTE_LENGTH) return null;
    if (!rawContent.trim()) return null;
  }

  const hasFolder = url.searchParams.has('folder');
  const rawFolder = (url.searchParams.get('folder') || '').trim();
  const folderId = hasFolder ? rawFolder.slice(0, MAX_FOLDER_ID_LENGTH) : undefined;

  return {
    version: 1,
    id: `relay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    action: commandAction,
    note: {
      ...(noteId ? { id: noteId } : {}),
      ...(rawContent !== null ? { content: rawContent } : {}),
      ...(hasFolder && folderId !== undefined ? { folderId } : {}),
    },
  };
}

export function isValidCompanionCommand(value: unknown): value is CompanionCommand {
  if (!value || typeof value !== 'object') return false;
  const command = value as Partial<CompanionCommand>;
  if (command.version !== 1) return false;
  if (typeof command.id !== 'string' || !command.id) return false;
  if (typeof command.createdAt !== 'string' || !command.createdAt) return false;
  if (!command.action || !VALID_ACTIONS.has(command.action)) return false;
  if (!command.note || typeof command.note !== 'object') return false;
  if (command.action === 'note.delete' && !command.note.id) return false;
  if (command.action === 'note.upsert') {
    if (typeof command.note.content !== 'string') return false;
    if (!command.note.content.trim()) return false;
    if (command.note.content.length > MAX_NOTE_LENGTH) return false;
  }
  return true;
}
