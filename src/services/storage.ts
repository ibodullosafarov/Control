import { ControlAppData, BlockerStatus, AppBlockerStatus, ScheduleBlock, GoogleCalendarConfig, BlockingStrategy, TraySessionInfo, StudyMode, ActiveSessionState } from '../types';
import { INITIAL_APP_DATA } from './defaultData';
import { dropOrphanFolderIds, sanitizeModeFolders } from './modeFolders';
import { repairBlocklist } from './domains';
import { isBreakTitle } from './scheduleTemplates';
import type { ActivitySample, DistractionEvent, ControlSession, Note, NoteFolder } from '../types';
import { migrateLegacyFieldNames } from './legacyFields';

const ACTIVITY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ACTIVITY_SAMPLES = 3000;
const MAX_DISTRACTIONS = 1000;
const MAX_NOTES = 2000;

/** Keep well-formed recent samples; the tracker logs change-points only. */
function sanitizeActivitySamples(raw: unknown): ActivitySample[] {
  if (!Array.isArray(raw)) return [];
  const cutoff = Date.now() - ACTIVITY_RETENTION_MS;
  const out: ActivitySample[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { t, app } = item as Record<string, unknown>;
    if (typeof t !== 'number' || !Number.isFinite(t) || t < cutoff) continue;
    if (typeof app !== 'string' || !app.trim()) continue;
    out.push({ t, app: app.trim().slice(0, 120) });
  }
  return out.slice(-MAX_ACTIVITY_SAMPLES);
}

function sanitizeDistractions(raw: unknown): DistractionEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: DistractionEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.t !== 'number' || !Number.isFinite(rec.t)) continue;
    if (rec.kind !== 'app' && rec.kind !== 'site') continue;
    if (typeof rec.name !== 'string' || !rec.name.trim()) continue;
    const event: DistractionEvent = { t: rec.t, kind: rec.kind, name: rec.name.trim().slice(0, 160) };
    if (typeof rec.modeId === 'string') event.modeId = rec.modeId;
    if (typeof rec.modeName === 'string') event.modeName = rec.modeName;
    out.push(event);
  }
  return out.slice(-MAX_DISTRACTIONS);
}

function sanitizeNoteFolders(raw: unknown): NoteFolder[] {
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
      name: rec.name.trim().slice(0, 80),
      ...(typeof rec.modeId === 'string' && rec.modeId ? { modeId: rec.modeId } : {}),
      ...(typeof rec.color === 'string' && rec.color ? { color: rec.color } : {}),
      ...(typeof rec.icon === 'string' && rec.icon ? { icon: rec.icon } : {}),
      createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : new Date().toISOString(),
    });
  }
  return out;
}

function sanitizeNotes(raw: unknown): Note[] {
  if (!Array.isArray(raw)) return [];
  const out: Note[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== 'string' || !rec.id) continue;
    if (typeof rec.content !== 'string') continue;
    const note: Note = {
      id: rec.id,
      content: rec.content.slice(0, 20000),
      createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : new Date().toISOString(),
      updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : new Date().toISOString(),
    };
    if (typeof rec.taskId === 'string') note.taskId = rec.taskId;
    if (typeof rec.taskTitle === 'string') note.taskTitle = rec.taskTitle.slice(0, 200);
    if (typeof rec.modeId === 'string') note.modeId = rec.modeId;
    if (typeof rec.modeName === 'string') note.modeName = rec.modeName.slice(0, 120);
    if (typeof rec.folderId === 'string') note.folderId = rec.folderId;
    out.push(note);
  }
  return out.slice(-MAX_NOTES);
}

function migrateModes(modes: StudyMode[]): StudyMode[] {
  return modes.map((m) => {
    // B-15: repair mistyped domains (`chatgpt.com.com` never matches the
    // real host — a silent blocking bypass). Never drops entries.
    const repaired = repairBlocklist(m.blocklist);
    if (repaired.fixed.length > 0) {
      console.info(
        '[Modes] Repaired blocklist domains:',
        repaired.fixed.map((f) => `${f.before} -> ${f.after}`).join(', ')
      );
    }
    const out: StudyMode = {
      ...m,
      blocklist: repaired.list,
      blockedApps: Array.isArray(m.blockedApps) ? m.blockedApps : [],
    };
    // B-16: a mode NAMED Break/Rest with no blocking configured is rest,
    // not control — it must never accrue control minutes in History/Stats.
    // (Modes with real blocklists are deliberate control variants: untouched.)
    if (
      out.countTowardStats &&
      !out.isChillMode &&
      out.blocklist.length === 0 &&
      out.blockedApps.length === 0 &&
      isBreakTitle(out.name)
    ) {
      out.countTowardStats = false;
    }
    return out;
  });
}

/** Wall minutes between two HH:mm stamps, or null when unparseable. */
function wallMinutesBetween(startTime: string, endTime: string): number | null {
  const m1 = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(startTime || '');
  const m2 = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(endTime || '');
  if (!m1 || !m2) return null;
  const wall = Number(m2[1]) * 60 + Number(m2[2]) - (Number(m1[1]) * 60 + Number(m1[2]));
  return wall > 0 ? wall : null;
}

function migratePlans(
  plans: ControlAppData['plans'],
  modes: StudyMode[]
): ControlAppData['plans'] {
  if (!plans || typeof plans !== 'object') return plans;
  const byId = new Map(modes.map((m) => [m.id, m]));
  let changed = false;
  const out: ControlAppData['plans'] = {};
  for (const [date, plan] of Object.entries(plans)) {
    if (!plan || !Array.isArray(plan.blocks)) {
      out[date] = plan;
      continue;
    }
    const blocks = plan.blocks.map((b) => {
      // B-16: break-mode events stored as control (work = wall, timer on —
      // the old start-anchored regex missed "Long Break") become honest
      // rest: zero work, timer off. Only when the LINKED MODE is also
      // break-like, so "Lunch with team" on a control mode is untouched.
      const mode = byId.get(b.modeId);
      if (
        b.timerEnabled !== false &&
        (b.workDuration || 0) > 0 &&
        (b.breakDuration || 0) === 0 &&
        isBreakTitle(b.modeName || '') &&
        mode &&
        isBreakTitle(mode.name)
      ) {
        const wall = wallMinutesBetween(b.startTime, b.endTime);
        if (wall !== null) {
          changed = true;
          return { ...b, workDuration: 0, breakDuration: wall, timerEnabled: false };
        }
      }
      return b;
    });
    out[date] = blocks === plan.blocks ? plan : { ...plan, blocks };
  }
  if (changed) console.info('[Planner] Converted break-mode control blocks to rest.');
  return out;
}

function migrateSessions(sessions: ControlSession[]): ControlSession[] {
  if (!Array.isArray(sessions)) return sessions;
  return sessions.map((s) => {
    // B-18: sub-30 s sessions must record 0 actual minutes (B-05 rule).
    // Repairs records written before that rule existed.
    if ((s.actualWorkMinutes || 0) > 0 && s.startTime && s.endTime) {
      const dur = Date.parse(s.endTime) - Date.parse(s.startTime);
      if (Number.isFinite(dur) && dur >= 0 && dur < 30 * 1000) {
        return { ...s, actualWorkMinutes: 0 };
      }
    }
    return s;
  });
}

function migrateActiveSession(session: ActiveSessionState | null | undefined): ActiveSessionState | null {
  if (!session) return null;
  return {
    ...session,
    blockedApps: Array.isArray(session.blockedApps) ? session.blockedApps : [],
  };
}

export interface ControlElectronAPI {
  getData: () => Promise<ControlAppData>;
  saveData: (data: ControlAppData) => Promise<boolean>;
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

const LOCAL_STORAGE_KEY = 'control_system_app_data_v1';
/** Pre-rename key — read once for migration, never written again. */
const LEGACY_LOCAL_STORAGE_KEY = 'focus_system_app_data_v1';

/** Normalize + migrate a raw store. Exported for testing. */
export function normalizeData(raw: ControlAppData): ControlAppData {
  // Pre-rename persisted field names (focusMinutes → controlMinutes, …).
  migrateLegacyFieldNames(raw);
  const modeFolders = sanitizeModeFolders((raw as { modeFolders?: unknown }).modeFolders);
  const rawModes = raw.modes && raw.modes.length ? migrateModes(raw.modes) : INITIAL_APP_DATA.modes;
  const normalized: ControlAppData = {
    ...INITIAL_APP_DATA,
    ...raw,
    settings: { ...INITIAL_APP_DATA.settings, ...(raw.settings || {}) },
    modes: dropOrphanFolderIds(rawModes, modeFolders),
    modeFolders,
    activitySamples: sanitizeActivitySamples(
      (raw as { activitySamples?: unknown }).activitySamples
    ),
    distractions: sanitizeDistractions((raw as { distractions?: unknown }).distractions),
    notes: sanitizeNotes((raw as { notes?: unknown }).notes),
    noteFolders: sanitizeNoteFolders((raw as { noteFolders?: unknown }).noteFolders),
    tasks: raw.tasks && Array.isArray(raw.tasks) ? raw.tasks : INITIAL_APP_DATA.tasks,
    activeSession: migrateActiveSession(raw.activeSession),
  };
  // The exams feature was removed — drop any persisted countdowns on load so
  // they don't linger in saved data forever.
  delete (normalized as { exams?: unknown }).exams;
  // Migration: task notes moved from <vault>/Control Tasks/ into
  // <vault>/Control/Tasks/ — the old default folder name is no longer valid.
  if (normalized.settings.obsidian && normalized.settings.obsidian.folderName === 'Control Tasks') {
    normalized.settings.obsidian = { ...normalized.settings.obsidian, folderName: 'Tasks' };
  }
  // B-17: the default mode was deleted (dangling id) — repair to the first
  // surviving mode instead of resolving an arbitrary fallback per call site.
  if (!normalized.modes.some((m) => m.id === normalized.settings.defaultModeId)) {
    normalized.settings = {
      ...normalized.settings,
      defaultModeId: normalized.modes[0]?.id || 'mode-deep-work',
    };
  }
  // B-15/B-16/B-18 data repairs (idempotent — safe to run on every load).
  normalized.plans = migratePlans(
    (raw.plans || {}) as ControlAppData['plans'],
    normalized.modes
  );
  if (Array.isArray(raw.sessions)) {
    normalized.sessions = migrateSessions(raw.sessions as ControlSession[]);
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
function richness(d: ControlAppData | null): number {
  if (!d || !d.modes) return -1;
  let r = 0;
  if (d.sessions && d.sessions.length) r += 4;
  if (d.plans && Object.keys(d.plans).length) r += 2;
  if (d.tasks && d.tasks.length) r += 1;
  const notes = (d as { notes?: unknown }).notes;
  if (Array.isArray(notes) && notes.length) r += 2;
  if (d.settings && d.settings.obsidian && d.settings.obsidian.enabled) r += 4;
  if (d.settings && d.settings.googleCalendar && d.settings.googleCalendar.connected) r += 1;
  return r;
}

export class StorageService {
  private inMemoryData: ControlAppData = INITIAL_APP_DATA;
  private isLoaded = false;
  private saveQueue: Promise<boolean> = Promise.resolve(true);

  async loadData(): Promise<ControlAppData> {
    let apiData: ControlAppData | null = null;
    if (window.controlAPI) {
      try {
        const data = await window.controlAPI.getData();
        if (data && data.modes) apiData = data;
      } catch (err) {
        console.warn('Error loading from controlAPI', err);
      }
    }

    let lsData: ControlAppData | null = null;
    try {
      // Prefer the new key; fall back to the pre-rename key exactly once for
      // migration (normalize + save below converge everything onto the new key).
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY) || localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
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
    }

    const normalized = chosen ? normalizeData(chosen) : INITIAL_APP_DATA;
    // Persist the normalized (not raw) form so disk and memory converge.
    if (chosen === lsData && window.controlAPI) {
      try {
        await window.controlAPI.saveData(normalized);
      } catch (err) {
        console.warn('Failed to migrate localStorage data to file store', err);
      }
    }
    this.inMemoryData = normalized;
    this.isLoaded = true;
    return this.inMemoryData;
  }

  async saveData(data: ControlAppData): Promise<boolean> {
    this.inMemoryData = data;
    const task = this.saveQueue.then(async () => {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        console.warn('Failed to save to localStorage', e);
      }

      if (window.controlAPI) {
        try {
          return await window.controlAPI.saveData(data);
        } catch (err) {
          console.warn('Error saving through controlAPI', err);
        }
      }

      return true;
    });
    this.saveQueue = task.then(() => true, () => true);
    return task;
  }

  getCachedData(): ControlAppData {
    return this.inMemoryData;
  }
}

export const storage = new StorageService();
