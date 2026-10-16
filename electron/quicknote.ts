import { BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import type { ControlAppData, Note } from '../src/types';

export interface CaptureTarget {
  preloadPath: string;
  /** Packaged renderer file; when absent the dev server URL is used. */
  filePath?: string;
  devUrl?: string;
}

export interface QuickNoteStore {
  get: () => ControlAppData;
  save: (data: ControlAppData) => boolean;
}

const MAX_NOTES = 2000;
const ACCELERATORS = ['CommandOrControl+Shift+N', 'Alt+Shift+N'];

let captureWindow: BrowserWindow | null = null;

/** Build a note from raw text, attributing the store's active session + task. */
export function buildQuickNote(store: QuickNoteStore, content: string): Note | null {
  const text = content.trim().slice(0, 20000);
  if (!text) return null;
  const data = store.get();
  const active = data.activeSession;
  const task = active?.activeTaskId
    ? (data.tasks || []).find((t) => t.id === active.activeTaskId)
    : undefined;
  const folders = data.noteFolders || [];
  const folderId = active
    ? folders.find((f) => f.modeId && f.modeId === active.modeId)?.id
    : undefined;
  const now = new Date().toISOString();
  return {
    id: `note-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    content: text,
    ...(task ? { taskId: task.id, taskTitle: task.title } : {}),
    ...(active ? { modeId: active.modeId, modeName: active.modeName } : {}),
    ...(folderId ? { folderId } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

export function openQuickNote(target: CaptureTarget, theme?: string): void {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.show();
    captureWindow.focus();
    return;
  }
  captureWindow = new BrowserWindow({
    width: 400,
    height: 330,
    minWidth: 320,
    minHeight: 260,
    title: 'Quick Note',
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: target.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  captureWindow.on('closed', () => {
    captureWindow = null;
  });
  // Center on the display with the cursor so capture feels "from anywhere".
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    captureWindow.setPosition(
      Math.round(display.bounds.x + (display.bounds.width - 400) / 2),
      Math.round(display.bounds.y + (display.bounds.height - 330) / 2)
    );
  } catch {
    // Fall back to the default position.
  }
  if (target.devUrl) {
    const sep = target.devUrl.includes('?') ? '&' : '?';
    const themeQuery = theme ? `&theme=${encodeURIComponent(theme)}` : '';
    void captureWindow.loadURL(`${target.devUrl}${sep}capture=1${themeQuery}`);
  } else if (target.filePath) {
    void captureWindow.loadFile(target.filePath, {
      query: theme ? { capture: '1', theme } : { capture: '1' },
    });
  }
  captureWindow.show();
  captureWindow.focus();
}

export function closeQuickNote(): void {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.close();
  }
}

export function registerQuickNoteShortcut(opener: () => void): string | null {
  for (const accelerator of ACCELERATORS) {
    try {
      if (globalShortcut.register(accelerator, opener)) return accelerator;
    } catch {
      // Taken by another app — try the fallback.
    }
  }
  return null;
}

export function unregisterQuickNoteShortcut(): void {
  try {
    globalShortcut.unregisterAll();
  } catch {
    // Ignore.
  }
}

export interface QuickNoteIpcDeps {
  store: QuickNoteStore;
  target: () => CaptureTarget;
  notifyNotesChanged: (notes: Note[]) => void;
}

export function registerQuickNoteIpc(deps: QuickNoteIpcDeps): void {
  ipcMain.handle('control:openQuickNote', async () => {
    try {
      openQuickNote(deps.target());
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('control:saveQuickNote', async (_, content: string) => {
    try {
      const note = buildQuickNote(deps.store, typeof content === 'string' ? content : '');
      if (!note) return { success: false, error: 'Empty note.' };
      const data = deps.store.get();
      deps.store.save({ ...data, notes: [...(data.notes || []), note].slice(-MAX_NOTES) });
      deps.notifyNotesChanged([note]);
      closeQuickNote();
      return { success: true, note };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
