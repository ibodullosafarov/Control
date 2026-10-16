import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { ControlAppData, StudyMode, ActiveSessionState } from '../src/types';
import { INITIAL_APP_DATA } from '../src/services/defaultData';
import { migrateLegacyFieldNames } from '../src/services/legacyFields';

const STORE_DIR = path.join(os.homedir(), '.control-app');
const STORE_FILE = path.join(STORE_DIR, 'data.json');
/** Pre-rename data dir — copied over once for migration, never written again. */
const LEGACY_STORE_DIR = path.join(os.homedir(), '.focus-app');

function migrateModes(modes: StudyMode[]): StudyMode[] {
  return modes.map((m) => ({
    ...m,
    blockedApps: Array.isArray(m.blockedApps) ? m.blockedApps : [],
  }));
}

function migrateActiveSession(session: ActiveSessionState | null | undefined): ActiveSessionState | null | undefined {
  if (!session) return session ?? null;
  return {
    ...session,
    blockedApps: Array.isArray(session.blockedApps) ? session.blockedApps : [],
  };
}

function copyDirRecursive(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(from, to);
    } else if (!fs.existsSync(to)) {
      fs.copyFileSync(from, to);
    }
  }
}

export class LocalStore {
  private cache: ControlAppData = INITIAL_APP_DATA;

  constructor() {
    this.ensureDir();
    this.load();
  }

  private ensureDir() {
    if (!fs.existsSync(STORE_DIR)) {
      try {
        fs.mkdirSync(STORE_DIR, { recursive: true });
      } catch (err) {
        console.error('Failed to create store directory:', err);
      }
      // One-time migration from the pre-rename data dir (data.json,
      // google-sync state, oauth, …). The legacy dir is left in place as a
      // backup and never read again once the new dir exists.
      try {
        if (fs.existsSync(LEGACY_STORE_DIR)) {
          copyDirRecursive(LEGACY_STORE_DIR, STORE_DIR);
          console.info('Migrated data directory from', LEGACY_STORE_DIR);
        }
      } catch (err) {
        console.warn('Failed to migrate legacy store directory:', err);
      }
    }
  }

  load(): ControlAppData {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        // Pre-rename persisted field names (focusMinutes → controlMinutes, …).
        migrateLegacyFieldNames(parsed);
        this.cache = {
          ...INITIAL_APP_DATA,
          ...parsed,
          settings: { ...INITIAL_APP_DATA.settings, ...(parsed.settings || {}) },
          modes: parsed.modes && parsed.modes.length ? migrateModes(parsed.modes) : INITIAL_APP_DATA.modes,
          tasks: parsed.tasks && Array.isArray(parsed.tasks) ? parsed.tasks : INITIAL_APP_DATA.tasks,
          activeSession: migrateActiveSession(parsed.activeSession),
        };
        return this.cache;
      }
    } catch (err) {
      console.warn('Failed to load store file, using defaults:', err);
    }
    this.cache = structuredClone(INITIAL_APP_DATA);
    this.save(this.cache);
    return this.cache;
  }

  save(data: ControlAppData): boolean {
    this.cache = structuredClone(data);
    try {
      this.ensureDir();
      const tempPath = `${STORE_FILE}.tmp.${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
      fs.writeFileSync(tempPath, JSON.stringify(this.cache, null, 2), 'utf-8');
      fs.renameSync(tempPath, STORE_FILE);
      return true;
    } catch (err) {
      console.error('Failed to save store file:', err);
      return false;
    }
  }

  get(): ControlAppData {
    return structuredClone(this.cache);
  }
}

export const localStore = new LocalStore();
