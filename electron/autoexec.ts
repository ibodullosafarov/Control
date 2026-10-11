import { BrowserWindow, Notification, ipcMain, powerMonitor } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  AutoExecEndRequest,
  AutoExecEndResult,
  AutoExecOccurrence,
  AutoExecStartRequest,
  AutoExecStartResult,
  AutoExecStatus,
  FocusAppData,
} from '../src/types';
import {
  DEFAULT_NOTIFY_LEAD_MINUTES,
  RECONCILE_INTERVAL_MS,
  RECORD_TTL_MS,
  computeOccurrences,
  dayStrOf,
  dueActions,
  getAutoExecSettings,
  missedSkipReason,
  pruneKeys,
  reminderBody,
  type PolicyOccurrence,
  type StoredOccurrence,
} from '../src/services/autoExecPolicy';

export const AUTOEXEC_CHANNELS = {
  getStatus: 'focus:autoExec:getStatus',
  notifyStatus: 'focus:autoExec:notifyStatus',
  startPush: 'focus:autoExec:start',
  startReply: 'focus:autoExec:startResult',
  endPush: 'focus:autoExec:end',
  endReply: 'focus:autoExec:endResult',
} as const;

const ROUND_TRIP_TIMEOUT_MS = 20_000;
const STATE_VERSION = 1;

interface AutoExecStateFile {
  version: number;
  records: Record<string, StoredOccurrence>;
}

export interface AutoExecServiceOptions {
  /** Currently focused app window (source of renderer round-trips). */
  getWindow(): BrowserWindow | null;
  /** Fresh persisted app data (plans, modes, settings). */
  getData(): FocusAppData;
  /** Directory for the execution state file. Defaults to ~/.focus-app. */
  dataDir?: string;
  /** Bring the app to the foreground (notification click). */
  showWindow(): void;
}

const log = {
  info: (msg: string, meta?: unknown) => console.log(`[autoexec] ${msg}`, meta ?? ''),
  warn: (msg: string, meta?: unknown) => console.warn(`[autoexec] ${msg}`, meta ?? ''),
};

/**
 * Persistent study-day execution scheduler (main process).
 *
 * Survives hidden windows and menu-bar mode: it reads plans/modes/settings
 * straight from the data store, fires absolute-timestamp timers, sends native
 * Notifications, and asks the renderer to start/end focus sessions through a
 * request/reply round-trip (the renderer stays authoritative: an active
 * manual session always wins). Branching rules live in
 * `src/services/autoExecPolicy.ts` (unit-tested); this class only executes.
 *
 * Explicitly NOT covered: fully-terminated execution (macOS cannot wake a
 * quit app without a login item, and even that only launches on login).
 */
export class AutoExecService {
  private readonly dataDir: string;
  private ipcRegistered = false;
  private started = false;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private wakeupTimer: ReturnType<typeof setTimeout> | null = null;
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private reconciling = false;
  private readonly inflight = new Set<string>();
  private readonly waiters = new Map<
    string,
    { resolve: (r: AutoExecStartResult | AutoExecEndResult) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(private readonly opts: AutoExecServiceOptions) {
    const home = process.env.HOME || process.env.USERPROFILE || '.';
    this.dataDir = opts.dataDir ?? path.join(home, '.focus-app');
  }

  // ── State file ─────────────────────────────────────────────────────────────

  private statePath(): string {
    return path.join(this.dataDir, 'autoexec', 'state.json');
  }

  private loadRecords(): Record<string, StoredOccurrence> {
    try {
      const file = this.statePath();
      if (!fs.existsSync(file)) return {};
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as AutoExecStateFile;
      if (!parsed || typeof parsed !== 'object' || !parsed.records || typeof parsed.records !== 'object') {
        return {};
      }
      return parsed.records as Record<string, StoredOccurrence>;
    } catch (err) {
      log.warn('Failed to read execution state, starting fresh', err instanceof Error ? err.message : err);
      return {};
    }
  }

  private saveRecords(records: Record<string, StoredOccurrence>): void {
    try {
      const dir = path.dirname(this.statePath());
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${this.statePath()}.tmp.${Date.now()}`;
      fs.writeFileSync(tmp, JSON.stringify({ version: STATE_VERSION, records }, null, 2), 'utf-8');
      fs.renameSync(tmp, this.statePath());
    } catch (err) {
      log.warn('Failed to persist execution state', err instanceof Error ? err.message : err);
    }
  }

  // ── IPC ────────────────────────────────────────────────────────────────────

  registerIpc(): void {
    if (this.ipcRegistered) return;
    this.ipcRegistered = true;

    ipcMain.handle(AUTOEXEC_CHANNELS.getStatus, (_e, date?: string) => this.getStatus(date));
    ipcMain.handle(AUTOEXEC_CHANNELS.notifyStatus, () => ({
      supported: Notification.isSupported(),
    }));
    ipcMain.handle(
      AUTOEXEC_CHANNELS.startReply,
      (_e, result: AutoExecStartResult, requestId: string) => {
        const waiter = this.waiters.get(String(requestId));
        if (waiter) {
          this.waiters.delete(String(requestId));
          clearTimeout(waiter.timer);
          waiter.resolve(result ?? { success: false, error: 'Empty start result.' });
        }
        return true;
      }
    );
    ipcMain.handle(
      AUTOEXEC_CHANNELS.endReply,
      (_e, result: AutoExecEndResult, requestId: string) => {
        const waiter = this.waiters.get(String(requestId));
        if (waiter) {
          this.waiters.delete(String(requestId));
          clearTimeout(waiter.timer);
          waiter.resolve(result ?? { success: false, error: 'Empty end result.' });
        }
        return true;
      }
    );
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    if (this.started) return;
    this.started = true;
    try {
      powerMonitor.on('suspend', () => {
        log.info('System suspend — clearing wakeup timer');
        if (this.wakeupTimer) clearTimeout(this.wakeupTimer);
        this.wakeupTimer = null;
      });
      powerMonitor.on('resume', () => {
        log.info('System resume — reconciling');
        this.requestReconcile('resume', 1000);
      });
    } catch (err) {
      log.warn('powerMonitor unavailable', err instanceof Error ? err.message : err);
    }
    this.intervalTimer = setInterval(() => this.requestReconcile('interval', 0), RECONCILE_INTERVAL_MS);
    this.requestReconcile('startup', 4000);
  }

  stop(): void {
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.wakeupTimer) clearTimeout(this.wakeupTimer);
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.intervalTimer = null;
    this.wakeupTimer = null;
    this.reconcileTimer = null;
    for (const [, waiter] of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ success: false, error: 'Application is shutting down.' });
    }
    this.waiters.clear();
    this.inflight.clear();
  }

  /** Renderer saved data (plans/settings may have changed) — reconcile soon. */
  onLocalDataSaved(): void {
    this.requestReconcile('save', 1500);
  }

  private requestReconcile(_reason: string, delayMs: number): void {
    if (!this.started) return;
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      void this.reconcile().catch((err) => {
        log.warn('Reconcile crashed', err instanceof Error ? err.message : err);
      });
    }, Math.max(0, delayMs));
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  getStatus(date?: string): AutoExecStatus {
    const data = this.safeGetData();
    const { enabled, notifyLeadMinutes } = getAutoExecSettings(data);
    const now = Date.now();
    const records = this.loadRecords();
    const target = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : dayStrOf(now);
    const occurrences: AutoExecOccurrence[] = computeOccurrences(data, now)
      .filter((o) => o.date === target)
      .map((o) => this.toPublic(o, records[o.key]));
    return {
      enabled,
      notifyLeadMinutes,
      notificationsSupported: Notification.isSupported(),
      now: new Date(now).toISOString(),
      occurrences,
    };
  }

  private toPublic(occ: PolicyOccurrence, rec: StoredOccurrence | undefined): AutoExecOccurrence {
    let state: AutoExecOccurrence['state'] = 'pending';
    if (rec?.skippedAt) state = 'skipped';
    else if (rec?.error) state = 'failed';
    else if (rec?.startedAt && rec?.endedAt) state = 'completed';
    else if (rec?.startedAt) state = this.inflight.has(`end:${occ.key}`) ? 'completed' : 'running';
    else if (rec?.notifiedAt) state = 'notified';
    else if (this.inflight.has(`start:${occ.key}`)) state = 'starting';
    return {
      key: occ.key,
      blockId: occ.blockId,
      date: occ.date,
      title: occ.title,
      startTime: occ.startTime,
      endTime: occ.endTime,
      modeId: occ.modeId,
      state,
      notifiedAt: rec?.notifiedAt,
      startedAt: rec?.startedAt,
      endedAt: rec?.endedAt,
      skippedAt: rec?.skippedAt,
      skipReason: rec?.skipReason,
      error: rec?.error,
      blockingEnforced: rec?.blockingEnforced,
      blockingError: rec?.blockingError,
    };
  }

  private safeGetData(): FocusAppData {
    try {
      return this.opts.getData();
    } catch (err) {
      log.warn('Failed to read app data', err instanceof Error ? err.message : err);
      return { modes: [], sessions: [], tasks: [], activeSession: null, settings: {} as FocusAppData['settings'], plans: {} };
    }
  }

  // ── Reconcile ──────────────────────────────────────────────────────────────

  private async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const data = this.safeGetData();
      const { enabled, notifyLeadMinutes } = getAutoExecSettings(data);
      const now = Date.now();
      const records = this.loadRecords();

      if (!enabled) {
        if (this.wakeupTimer) clearTimeout(this.wakeupTimer);
        this.wakeupTimer = null;
        return;
      }

      const occs = computeOccurrences(data, now);
      const liveKeys = new Set(occs.map((o) => o.key));

      // Drop records for deleted/rescheduled events + ancient history.
      for (const key of pruneKeys(records, liveKeys, now)) delete records[key];

      // Terminal-skips for occurrences that can never run (sleep/off/quit gaps).
      let dirty = false;
      for (const occ of occs) {
        const rec = records[occ.key];
        if (rec?.skippedAt || rec?.startedAt || rec?.error) continue;
        const reason = missedSkipReason(occ, rec, now);
        if (reason) {
          records[occ.key] = { ...(rec || {}), skippedAt: new Date(now).toISOString(), skipReason: reason };
          dirty = true;
        }
      }

      // Starts: at most one per reconcile — several missed together are all
      // skipped instead of launched in sequence.
      const startable = occs.filter(
        (o) => dueActions(o, records[o.key], now).includes('start') && !this.inflight.has(`start:${o.key}`)
      );
      if (startable.length > 1) {
        const ids = startable.map((o) => o.title).join(', ');
        log.info(`Skipping ${startable.length} simultaneously-due starts (${ids})`);
        for (const occ of startable) {
          records[occ.key] = {
            ...(records[occ.key] || {}),
            skippedAt: new Date(now).toISOString(),
            skipReason: 'multiple-missed',
          };
        }
        dirty = true;
      }

      // Notifications (at most once, never stale).
      for (const occ of occs) {
        const rec = records[occ.key];
        if (!dueActions(occ, rec, now).includes('notify')) continue;
        this.sendNotification(occ, notifyLeadMinutes);
        records[occ.key] = { ...(rec || {}), notifiedAt: new Date(now).toISOString() };
        dirty = true;
      }

      if (dirty) this.saveRecords(records);

      // Exactly one start (recompute after the multi-skip above).
      const current = this.loadRecords();
      const due = occs.filter(
        (o) => dueActions(o, current[o.key], now).includes('start') && !this.inflight.has(`start:${o.key}`)
      );
      if (due.length === 1) {
        await this.executeStart(due[0]);
      }

      // End requests for started sessions whose block time is up.
      const afterStart = this.loadRecords();
      for (const occ of occs) {
        if (!dueActions(occ, afterStart[occ.key], Date.now()).includes('end')) continue;
        if (this.inflight.has(`end:${occ.key}`)) continue;
        await this.executeEnd(occ);
      }

      this.armWakeup();
    } finally {
      this.reconciling = false;
    }
  }

  private armWakeup(): void {
    if (this.wakeupTimer) clearTimeout(this.wakeupTimer);
    this.wakeupTimer = null;
    const data = this.safeGetData();
    const { enabled } = getAutoExecSettings(data);
    if (!enabled) return;
    const now = Date.now();
    const records = this.loadRecords();
    let next: number | null = null;
    for (const occ of computeOccurrences(data, now)) {
      const rec = records[occ.key];
      if (!rec?.notifiedAt && occ.notifyAtMs > now) {
        next = next === null ? occ.notifyAtMs : Math.min(next, occ.notifyAtMs);
      }
      if (!rec?.startedAt && !rec?.skippedAt && occ.startAtMs > now) {
        next = next === null ? occ.startAtMs : Math.min(next, occ.startAtMs);
      }
      if (rec?.startedAt && !rec?.endedAt && occ.endAtMs > now) {
        next = next === null ? occ.endAtMs : Math.min(next, occ.endAtMs);
      }
    }
    if (next === null) return;
    const delay = Math.max(0, Math.min(next - now, 2_147_483_647));
    this.wakeupTimer = setTimeout(() => {
      this.wakeupTimer = null;
      void this.reconcile().catch((err) => {
        log.warn('Wakeup reconcile crashed', err instanceof Error ? err.message : err);
      });
    }, delay);
    if (this.wakeupTimer.unref) this.wakeupTimer.unref();
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  private sendNotification(occ: PolicyOccurrence, leadMinutes: number): void {
    try {
      if (!Notification.isSupported()) {
        log.warn('Notifications not supported on this system — reminder skipped', { key: occ.key });
        return;
      }
      const note = new Notification({
        title: 'Control — upcoming focus session',
        body: reminderBody(occ.title, leadMinutes),
      });
      note.on('click', () => {
        try {
          this.opts.showWindow();
        } catch (err) {
          log.warn('showWindow failed', err instanceof Error ? err.message : err);
        }
      });
      note.show();
    } catch (err) {
      log.warn('Failed to show notification', err instanceof Error ? err.message : err);
    }
  }

  private newRequestId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private roundTrip<T extends { success: boolean }>(
    channel: string,
    payload: { requestId: string },
    timeoutMs: number
  ): Promise<T> {
    const win = this.opts.getWindow();
    if (!win || win.isDestroyed()) {
      return Promise.resolve({ success: false, error: 'The app window is not available.' } as unknown as T);
    }
    return new Promise<T>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(payload.requestId);
        resolve({ success: false, error: 'Timed out waiting for the app window.' } as unknown as T);
      }, timeoutMs);
      this.waiters.set(payload.requestId, {
        resolve: resolve as (r: AutoExecStartResult | AutoExecEndResult) => void,
        timer,
      });
      win.webContents.send(channel, payload);
    });
  }

  private async executeStart(occ: PolicyOccurrence): Promise<void> {
    const key = `start:${occ.key}`;
    this.inflight.add(key);
    try {
      const records = this.loadRecords();
      const payload: AutoExecStartRequest = {
        requestId: this.newRequestId('start'),
        blockId: occ.blockId,
        date: occ.date,
      };
      const result = await this.roundTrip<AutoExecStartResult>(
        AUTOEXEC_CHANNELS.startPush,
        payload,
        ROUND_TRIP_TIMEOUT_MS
      );
      const now = new Date().toISOString();
      if (result.success && result.started) {
        records[occ.key] = {
          ...(records[occ.key] || {}),
          startedAt: now,
          blockingEnforced: result.blockingEnforced,
          blockingError: result.blockingError,
        };
        log.info('Auto-started session', { key: occ.key });
      } else if (!result.success) {
        records[occ.key] = { ...(records[occ.key] || {}), error: result.error || 'Start request failed.' };
        log.warn('Auto-start failed', { key: occ.key, error: result.error });
      } else {
        // Renderer actively declined (e.g. a manual session is running):
        // terminal skip, never a surprise start later.
        records[occ.key] = {
          ...(records[occ.key] || {}),
          skippedAt: now,
          skipReason: result.reason || 'declined',
        };
        log.info('Auto-start declined by app window', { key: occ.key, reason: result.reason });
      }
      this.saveRecords(records);
    } finally {
      this.inflight.delete(key);
    }
  }

  private async executeEnd(occ: PolicyOccurrence): Promise<void> {
    const key = `end:${occ.key}`;
    this.inflight.add(key);
    try {
      const records = this.loadRecords();
      const payload: AutoExecEndRequest = {
        requestId: this.newRequestId('end'),
        blockId: occ.blockId,
        date: occ.date,
      };
      const result = await this.roundTrip<AutoExecEndResult>(
        AUTOEXEC_CHANNELS.endPush,
        payload,
        ROUND_TRIP_TIMEOUT_MS
      );
      const now = new Date().toISOString();
      records[occ.key] = {
        ...(records[occ.key] || {}),
        endedAt: now,
        ...(result.success && result.ended === false && result.reason
          ? { skipReason: result.reason }
          : {}),
      };
      if (!result.success) {
        log.warn('Auto-end unacknowledged (will retry)', { key: occ.key, error: result.error });
        // Retry on the next reconcile: drop the marker so dueActions fires again.
        const rec = records[occ.key];
        if (rec) delete rec.endedAt;
      }
      this.saveRecords(records);
    } finally {
      this.inflight.delete(key);
    }
  }
}
