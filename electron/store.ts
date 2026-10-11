import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FocusAppData, StudyMode, ActiveSessionState } from '../src/types';
import { INITIAL_APP_DATA } from '../src/services/defaultData';

const STORE_DIR = path.join(os.homedir(), '.focus-app');
const STORE_FILE = path.join(STORE_DIR, 'data.json');

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

export class LocalStore {
  private cache: FocusAppData = INITIAL_APP_DATA;

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
    }
  }

  load(): FocusAppData {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
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
    this.cache = INITIAL_APP_DATA;
    this.save(this.cache);
    return this.cache;
  }

  save(data: FocusAppData): boolean {
    this.cache = data;
    try {
      this.ensureDir();
      const tempPath = `${STORE_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tempPath, STORE_FILE);
      return true;
    } catch (err) {
      console.error('Failed to save store file:', err);
      return false;
    }
  }

  get(): FocusAppData {
    return this.cache;
  }
}

export const localStore = new LocalStore();
