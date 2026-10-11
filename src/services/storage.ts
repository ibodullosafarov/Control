import { FocusAppData, BlockerStatus, AppBlockerStatus, ScheduleBlock, GoogleCalendarConfig, BlockingStrategy, TraySessionInfo, StudyMode, ActiveSessionState } from '../types';
import { INITIAL_APP_DATA } from './defaultData';

function migrateModes(modes: StudyMode[]): StudyMode[] {
  return modes.map((m) => ({
    ...m,
    blockedApps: Array.isArray(m.blockedApps) ? m.blockedApps : [],
  }));
}

function migrateActiveSession(session: ActiveSessionState | null | undefined): ActiveSessionState | null {
  if (!session) return null;
  return {
    ...session,
    blockedApps: Array.isArray(session.blockedApps) ? session.blockedApps : [],
  };
}

export interface FocusElectronAPI {
  getData: () => Promise<FocusAppData>;
  saveData: (data: FocusAppData) => Promise<boolean>;
  startBlocking: (domains: string[], strategy: BlockingStrategy) => Promise<{ success: boolean; error?: string }>;
  stopBlocking: () => Promise<{ success: boolean; error?: string }>;
  getBlockerStatus: () => Promise<BlockerStatus>;
  startAppBlocking: (apps: string[]) => Promise<{ success: boolean; error?: string }>;
  stopAppBlocking: () => Promise<{ success: boolean; error?: string }>;
  getAppBlockerStatus: () => Promise<AppBlockerStatus>;
  updateTraySession: (info: TraySessionInfo) => Promise<void>;
  updateTray: (text: string, title?: string, tooltip?: string) => Promise<void>;
  sendNotification: (title: string, body: string) => Promise<void>;
  setMinimalWindow: (isMinimal: boolean) => Promise<void>;
  syncToGoogleCalendar: (blocks: ScheduleBlock[], config: GoogleCalendarConfig) => Promise<{ success: boolean; syncedCount: number; error?: string }>;
  exportToIcs: (blocks: ScheduleBlock[]) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  setLaunchAtLogin: (enabled: boolean) => Promise<boolean>;
  openSelfControl: (blocklist: string[], minutes: number) => Promise<{ success: boolean; error?: string }>;
  getPurposeSessionRequest?: () => Promise<import('../types').PurposeSessionRequest | null>;
  acknowledgePurposeSessionRequest?: (id: string) => Promise<boolean>;
  onPurposeSessionRequested?: (callback: () => void) => () => void;
  onTrayAction?: (callback: (action: string) => void) => () => void;
}

const LOCAL_STORAGE_KEY = 'focus_system_app_data_v1';

function normalizeData(raw: FocusAppData): FocusAppData {
  const normalized: FocusAppData = {
    ...INITIAL_APP_DATA,
    ...raw,
    settings: { ...INITIAL_APP_DATA.settings, ...(raw.settings || {}) },
    modes: raw.modes && raw.modes.length ? migrateModes(raw.modes) : INITIAL_APP_DATA.modes,
    tasks: raw.tasks && Array.isArray(raw.tasks) ? raw.tasks : INITIAL_APP_DATA.tasks,
    activeSession: migrateActiveSession(raw.activeSession),
  };
  // Migration: task notes moved from <vault>/Control Tasks/ into
  // <vault>/Control/Tasks/ — the old default folder name is no longer valid.
  if (normalized.settings.obsidian && normalized.settings.obsidian.folderName === 'Control Tasks') {
    normalized.settings.obsidian = { ...normalized.settings.obsidian, folderName: 'Tasks' };
  }
  // First-run gate: fresh installs start with setupCompleted=false and are sent
  // to the setup wizard. Any store that already carries real user history
  // (sessions or a chosen name) predates the wizard — mark it complete so
  // existing users are never prompted. (Deliberately not checking tasks:
  // every store ships with the starter task seeds.)
  if (normalized.settings.setupCompleted === false) {
    const hasHistory =
      (raw.sessions && raw.sessions.length > 0) ||
      Boolean((raw.settings || {}).userName);
    if (hasHistory) normalized.settings.setupCompleted = true;
  }
  return normalized;
}

/**
 * Rough "amount of real user history" score. Used to reconcile the two storage
 * backends: older builds only wrote localStorage, newer builds only read the
 * file store — if one side is virgin defaults and the other has real data,
 * the richer side wins and is migrated back to the file store.
 */
function richness(d: FocusAppData | null): number {
  if (!d || !d.modes) return -1;
  let r = 0;
  if (d.sessions && d.sessions.length) r += 4;
  if (d.plans && Object.keys(d.plans).length) r += 2;
  if (d.tasks && d.tasks.length) r += 1;
  if (d.settings && d.settings.obsidian && d.settings.obsidian.enabled) r += 4;
  if (d.settings && d.settings.googleCalendar && d.settings.googleCalendar.connected) r += 1;
  return r;
}

export class StorageService {
  private inMemoryData: FocusAppData = INITIAL_APP_DATA;
  private isLoaded = false;

  async loadData(): Promise<FocusAppData> {
    let apiData: FocusAppData | null = null;
    if (window.focusAPI) {
      try {
        const data = await window.focusAPI.getData();
        if (data && data.modes) apiData = data;
      } catch (err) {
        console.warn('Error loading from focusAPI', err);
      }
    }

    let lsData: FocusAppData | null = null;
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.modes) lsData = parsed;
      }
    } catch (e) {
      console.warn('Failed to load from localStorage', e);
    }

    let chosen = apiData;
    if (lsData && richness(lsData) > richness(apiData)) {
      chosen = lsData;
      // One-time migration: push the richer localStorage copy back into the
      // file store so both backends converge again.
      if (window.focusAPI) {
        try {
          await window.focusAPI.saveData(lsData);
        } catch (err) {
          console.warn('Failed to migrate localStorage data to file store', err);
        }
      }
    }

    this.inMemoryData = chosen ? normalizeData(chosen) : INITIAL_APP_DATA;
    this.isLoaded = true;
    return this.inMemoryData;
  }

  async saveData(data: FocusAppData): Promise<boolean> {
    this.inMemoryData = data;

    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save to localStorage', e);
    }

    if (window.focusAPI) {
      try {
        return await window.focusAPI.saveData(data);
      } catch (err) {
        console.warn('Error saving through focusAPI', err);
      }
    }

    return true;
  }

  getCachedData(): FocusAppData {
    return this.inMemoryData;
  }
}

export const storage = new StorageService();
