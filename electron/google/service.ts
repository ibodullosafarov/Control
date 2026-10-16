import { BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import * as os from 'os';
import * as path from 'path';
import {
  ControlAppData,
  GoogleApplyMutations,
  GoogleApplyResult,
  GoogleCalendarOption,
  GoogleConnectResult,
  GoogleDisconnectResult,
  GoogleListCalendarsResult,
  GoogleSyncNowResult,
  GoogleSyncStatus,
} from '../../src/types';
import {
  AuthTokens,
  Cipher,
  ClientConfigResult,
  TokenStore,
  plainCipher,
  resolveClientConfig,
  saveClientConfig,
  clearClientConfig,
} from './credentials';
import { GoogleCalendarApi } from './api';
import { OAuthError, OAuthFlow, revokeToken } from './oauth';
import { SyncStateStore } from './state';
import { appendDiagLine, readDiagTail } from './diagnostics';
import { SyncEngine } from './syncEngine';
import { EnginePorts, SyncLogger, emptySyncState } from './types';

/**
 * Electron-facing façade for Google Calendar sync.
 *
 * Owns: OAuth flow, token storage (safeStorage cipher), the sync engine,
 * single-flight/debounced triggers, IPC registration and the GoogleSyncStatus
 * projection pushed to renderers. Tokens and credentials never leave this
 * process.
 */

export const GOOGLE_CHANNELS = {
  getStatus: 'control:google:getStatus',
  getClientState: 'control:google:getClientState',
  setClientId: 'control:google:setClientId',
  clearClientId: 'control:google:clearClientId',
  connect: 'control:google:connect',
  disconnect: 'control:google:disconnect',
  listCalendars: 'control:google:listCalendars',
  selectCalendar: 'control:google:selectCalendar',
  getDiagnostics: 'control:google:getDiagnostics',
  syncNow: 'control:google:syncNow',
  applyChanges: 'control:google:applyChanges',
  notifyOnline: 'control:google:notifyOnline',
  statusPush: 'control:google:status',
  applyPush: 'control:google:apply',
} as const;

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_SYNC_DELAY_MS = 4000;
const CONTROL_SYNC_DELAY_MS = 3000;
const LOCAL_SAVE_DEBOUNCE_MS = 1500;
const APPLY_REPLY_TIMEOUT_MS = 20_000;

export interface GoogleSyncServiceOptions {
  /** Currently controlled app window (source of renderer sends). */
  getWindow(): BrowserWindow | null;
  /** Current persisted app data (main-process read cache). */
  getData(): ControlAppData;
  /** Directory for tokens/state/client config. Defaults to ~/.control-app. */
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  /** Opens the OAuth authorization URL in the system browser. */
  openUrl?(url: string): Promise<void> | void;
}

function makeSafeStorageCipher(): Cipher {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return {
        secure: true,
        encrypt: (plain) => safeStorage.encryptString(plain.toString('utf-8')),
        decrypt: (data) => {
          try {
            return Buffer.from(safeStorage.decryptString(data), 'utf-8');
          } catch {
            return null;
          }
        },
      };
    }
  } catch {
    /* fall through to plain storage */
  }
  return plainCipher;
}

const gcalLogger: SyncLogger = {
  info: (msg, meta) => console.log(`[gcal] ${msg}`, meta && Object.keys(meta).length ? meta : ''),
  warn: (msg, meta) => console.warn(`[gcal] ${msg}`, meta && Object.keys(meta).length ? meta : ''),
  error: (msg, meta) => console.error(`[gcal] ${msg}`, meta && Object.keys(meta).length ? meta : ''),
};

export class GoogleSyncService {
  private readonly dataDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly tokenStore: TokenStore;
  private readonly stateStore: SyncStateStore;
  private readonly api: GoogleCalendarApi;
  private readonly oauth: OAuthFlow;
  private readonly engine: SyncEngine;

  private ipcRegistered = false;
  private started = false;
  private running = false;
  private connecting = false;
  private applyingRemote = false;
  private needsReauth = false;
  private offline = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private readonly applyWaiters = new Map<
    string,
    { resolve: (r: GoogleApplyResult) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(private readonly opts: GoogleSyncServiceOptions) {
    this.dataDir = opts.dataDir ?? path.join(os.homedir(), '.control-app');
    this.env = opts.env ?? process.env;
    const cipher = makeSafeStorageCipher();

    this.tokenStore = new TokenStore(path.join(this.dataDir, 'google-tokens.json'), cipher);
    this.stateStore = new SyncStateStore(path.join(this.dataDir, 'google-sync', 'state.json'));

    this.api = new GoogleCalendarApi({
      getToken: () => this.tokenStore.load(),
      saveToken: (tokens) => {
        this.tokenStore.save(tokens);
      },
      getClientConfig: () => this.clientConfig().config,
      onAuthLost: (reason) => {
        gcalLogger.warn('Google auth no longer usable', { reason });
        appendDiagLine(this.dataDir, 'auth lost', `reason=${reason}`);
        this.needsReauth = true;
        this.pushStatus();
      },
      fetchFn: opts.fetchFn,
      logger: gcalLogger,
    });

    this.oauth = new OAuthFlow({
      getClientConfig: () => this.clientConfig().config,
      openUrl: (url) => (opts.openUrl ? opts.openUrl(url) : shell.openExternal(url)),
      fetchFn: opts.fetchFn,
    });

    const ports: EnginePorts = {
      stateStore: this.stateStore,
      localData: {
        getPlans: () => this.opts.getData().plans || {},
        apply: (mutations) => this.applyMutations(mutations),
      },
      api: this.api,
      logger: gcalLogger,
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      get timeZone(): string {
        try {
          return Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch {
          return 'UTC';
        }
      },
      getDefaultMode: () => {
        const mode = this.opts.getData().modes?.[0];
        return mode ? { id: mode.id, name: mode.name, icon: mode.icon, color: mode.color } : null;
      },
      onStateSaved: () => this.pushStatus(),
    };
    this.engine = new SyncEngine(ports);
  }

  // ── Status projection (never contains tokens/credentials) ───────────────

  private clientConfig(): ClientConfigResult {
    return resolveClientConfig(this.env, this.dataDir);
  }

  isConnected(): boolean {
    return !!(this.tokenStore.load() && this.stateStore.load().connectedAt);
  }

  /**
   * True when the stored credentials can no longer be refreshed. Checks the
   * persisted error code too — the in-memory flag alone is lost on restart,
   * which used to trap users in "expired but already_connected" limbo where
   * Reconnect silently did nothing.
   */
  authBroken(): boolean {
    if (this.needsReauth) return true;
    try {
      return this.stateStore.load().lastErrorCode === 'auth_required';
    } catch {
      return false;
    }
  }

  getStatus(): GoogleSyncStatus {
    const cfg = this.clientConfig();
    const tokens = this.tokenStore.load();
    const state = this.stateStore.load();
    const connected = !!(tokens && state.connectedAt);

    let phase: GoogleSyncStatus['phase'];
    if (this.connecting) phase = 'connecting';
    else if (this.running) phase = 'syncing';
    else if (!cfg.config) phase = 'unconfigured';
    else if (!connected) phase = 'disconnected';
    else if (this.needsReauth || state.lastErrorCode === 'auth_required') phase = 'auth_required';
    else if (this.offline) phase = 'offline';
    else if (state.lastError) phase = 'error';
    else phase = 'idle';

    const status: GoogleSyncStatus = {
      available: true,
      configured: !!cfg.config,
      connected,
      needsReauth: this.needsReauth,
      phase,
      syncing: this.running,
      pendingOps: state.ops.length,
      conflictCount: state.counters.conflicts,
      insecureStorage: tokens ? !this.tokenStore.usesSecureStorage : false,
      importedCount: state.counters.imported,
      pushedCount: state.counters.pushed,
    };
    if (cfg.source) status.configSource = cfg.source;
    if (connected) {
      status.userEmail = state.userEmail ?? this.lastKnownEmail;
      status.calendarId = state.targetCalendarId;
    }
    if (state.lastSyncedAt) status.lastSyncedAt = state.lastSyncedAt;
    if (state.lastFullSyncAt) status.lastFullSyncAt = state.lastFullSyncAt;
    if (state.lastError) status.lastError = state.lastError;
    if (state.lastErrorCode) status.lastErrorCode = state.lastErrorCode;
    return status;
  }

  private lastKnownEmail: string | undefined;

  pushStatus(): void {
    const status = this.getStatus();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(GOOGLE_CHANNELS.statusPush, status);
    }
  }

  // ── IPC ──────────────────────────────────────────────────────────────────

  registerIpc(): void {
    if (this.ipcRegistered) return;
    this.ipcRegistered = true;

    ipcMain.handle(GOOGLE_CHANNELS.getStatus, () => this.getStatus());

    ipcMain.handle(GOOGLE_CHANNELS.getClientState, () => {
      const cfg = this.clientConfig();
      const out: { configured: boolean; source?: string; hasSecret?: boolean } = {
        configured: !!cfg.config,
      };
      if (cfg.source) out.source = cfg.source;
      if (cfg.config?.clientSecret) out.hasSecret = true;
      return out;
    });

    ipcMain.handle(GOOGLE_CHANNELS.setClientId, (_e, clientId: string, clientSecret?: string) => {
      const previousId = this.clientConfig().config?.clientId;
      const res = saveClientConfig(
        String(clientId || ''),
        this.dataDir,
        typeof clientSecret === 'string' ? clientSecret : undefined
      );
      if (res.success && previousId && previousId !== String(clientId || '').trim()) {
        // Refresh tokens are bound to the OAuth client: a rotated ID can no
        // longer refresh, so surface re-auth immediately instead of failing
        // background syncs until the user notices.
        this.needsReauth = true;
        appendDiagLine(this.dataDir, 'client id changed (re-auth required)');
      }
      this.pushStatus();
      return res;
    });

    ipcMain.handle(GOOGLE_CHANNELS.clearClientId, () => {
      const res = clearClientConfig(this.dataDir);
      appendDiagLine(this.dataDir, 'client cleared', `removed=${!!res.removed}`);
      this.pushStatus();
      return res;
    });

    ipcMain.handle(GOOGLE_CHANNELS.connect, () => this.connect());

    ipcMain.handle(
      GOOGLE_CHANNELS.disconnect,
      (_e, options?: { removeSyncedEvents?: boolean }) => this.disconnect(options)
    );

    ipcMain.handle(GOOGLE_CHANNELS.listCalendars, () => this.listCalendars());

    ipcMain.handle(GOOGLE_CHANNELS.selectCalendar, (_e, calendarId: string) =>
      this.selectCalendar(String(calendarId || ''))
    );

    ipcMain.handle(GOOGLE_CHANNELS.syncNow, (_e, options?: { full?: boolean }) =>
      this.syncNow(options)
    );

    // Sanitized snapshot for troubleshooting: status + event log, never tokens
    // or credential values (see diagnostics.ts redaction).
    ipcMain.handle(GOOGLE_CHANNELS.getDiagnostics, () => {
      const cfg = this.clientConfig();
      return {
        generatedAt: new Date().toISOString(),
        client: {
          configured: !!cfg.config,
          source: cfg.source,
          hasSecret: !!cfg.config?.clientSecret,
        },
        status: this.getStatus(),
        log: readDiagTail(this.dataDir),
      };
    });

    ipcMain.handle(
      GOOGLE_CHANNELS.applyChanges,
      (_e, result: GoogleApplyResult, requestId: string) => {
        const waiter = this.applyWaiters.get(String(requestId));
        if (waiter) {
          this.applyWaiters.delete(String(requestId));
          clearTimeout(waiter.timer);
          waiter.resolve(result ?? { success: false, error: 'Empty apply result.' });
        }
        return true;
      }
    );

    ipcMain.handle(GOOGLE_CHANNELS.notifyOnline, () => {      if (this.offline) {
        this.offline = false;
        this.pushStatus();
        if (this.isConnected()) this.scheduleSync(500);
      }
      return true;
    });
  }

  // ── Connect / disconnect ─────────────────────────────────────────────────

  async connect(): Promise<GoogleConnectResult> {
    if (this.connecting) return { success: false, code: 'connection_in_progress' };
    if (!this.clientConfig().config) return { success: false, code: 'not_configured' };
    if (this.isConnected() && !this.authBroken()) return { success: false, code: 'already_connected' };

    this.connecting = true;
    this.pushStatus();
    appendDiagLine(this.dataDir, 'connect start', `hasSecret=${!!this.clientConfig().config?.clientSecret}`);
    try {
      const { tokens, email } = await this.oauth.authorize();
      this.tokenStore.save(tokens);
      this.lastKnownEmail = email;

      const state = this.stateStore.load();
      state.connectedAt = new Date().toISOString();
      if (email) state.userEmail = email;
      delete state.lastError;
      delete state.lastErrorCode;
      this.stateStore.save(state);
      this.needsReauth = false;
      this.offline = false;

      if (!email) {
        try {
          this.lastKnownEmail = await this.api.getUserEmail();
          const s = this.stateStore.load();
          if (this.lastKnownEmail) s.userEmail = this.lastKnownEmail;
          this.stateStore.save(s);
        } catch {
          /* email is cosmetic — keep sync working without it */
        }
      }

      this.connecting = false;
      this.pushStatus();
      appendDiagLine(this.dataDir, 'connect ok');

      // First run: full import + push of everything eligible.
      void this.runSync({ full: true }).catch(() => undefined);
      return { success: true };
    } catch (err) {
      this.connecting = false;
      this.pushStatus();
      const code: GoogleConnectResult['code'] =
        err instanceof OAuthError ? err.code : 'auth_failed';
      const message = err instanceof Error ? err.message : String(err);
      appendDiagLine(this.dataDir, 'connect fail', `code=${code} error=${message}`);
      gcalLogger.warn('Google connect failed', {
        code,
        error: message,
      });
      return {
        success: false,
        code,
        error: message,
      };
    }
  }

  async disconnect(options?: { removeSyncedEvents?: boolean }): Promise<GoogleDisconnectResult> {
    if (this.running) {
      return { success: false, error: 'A sync is in progress. Try again in a moment.' };
    }
    const state = this.stateStore.load();
    let removedRemote = 0;

    if (options?.removeSyncedEvents && this.isConnected()) {
      for (const mapping of Object.values(state.mappings)) {
        try {
          await this.api.deleteEvent(mapping.calendarId, mapping.googleEventId);
          removedRemote++;
        } catch {
          /* already gone or inaccessible — keep going */
        }
      }
    }

    const tokens = this.tokenStore.load();
    if (tokens?.refreshToken) await revokeToken(tokens.refreshToken, this.opts.fetchFn ?? fetch);
    else if (tokens?.accessToken) await revokeToken(tokens.accessToken, this.opts.fetchFn ?? fetch);

    this.tokenStore.clear();
    const fresh = emptySyncState();
    fresh.targetCalendarId = state.targetCalendarId;
    this.stateStore.save(fresh);
    this.needsReauth = false;
    this.offline = false;
    this.lastKnownEmail = undefined;
    this.pushStatus();
    return { success: true, removedRemote };
  }

  async listCalendars(): Promise<GoogleListCalendarsResult> {
    if (!this.isConnected()) {
      return { success: false, calendars: [], error: 'Not connected to Google Calendar.' };
    }
    if (this.needsReauth) {
      return { success: false, calendars: [], error: 'Reconnect to Google Calendar first.' };
    }
    try {
      const items = await this.api.listCalendars();
      const selectedId = this.stateStore.load().targetCalendarId;
      return {
        success: true,
        calendars: items.map((c) => {
          const option: GoogleCalendarOption = {
            id: c.id,
            summary: c.summary,
            selected: c.id === selectedId || (!selectedId && !!c.primary),
          };
          if (c.description) option.description = c.description;
          if (c.primary) option.primary = c.primary;
          if (c.accessRole) option.accessRole = c.accessRole;
          if (c.backgroundColor) option.backgroundColor = c.backgroundColor;
          if (c.foregroundColor) option.foregroundColor = c.foregroundColor;
          return option;
        }),
      };
    } catch (err) {
      return {
        success: false,
        calendars: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async selectCalendar(calendarId: string): Promise<{ success: boolean; error?: string }> {
    if (!calendarId.trim()) return { success: false, error: 'Choose a calendar first.' };
    if (!this.isConnected()) {
      return { success: false, error: 'Not connected to Google Calendar.' };
    }
    const state = this.stateStore.load();
    if (state.targetCalendarId === calendarId) return { success: true };
    state.targetCalendarId = calendarId;
    this.stateStore.save(state);
    this.pushStatus();
    this.scheduleSync(500);
    return { success: true };
  }

  // ── Sync runs ────────────────────────────────────────────────────────────

  async syncNow(options?: { full?: boolean }): Promise<GoogleSyncNowResult> {
    if (this.running) return { success: false, code: 'sync_in_progress' };
    if (!this.isConnected()) return { success: false, code: 'not_connected' };
    if (this.authBroken()) return { success: false, code: 'auth_required' };

    const result = await this.runSync({ full: !!options?.full });
    if (result.success) {
      return {
        success: true,
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
        imported: result.imported,
      };
    }
    const code =
      result.errorCode === 'auth_required'
        ? 'auth_required'
        : result.errorCode === 'offline'
          ? 'offline'
          : result.errorCode === 'sync_in_progress'
            ? 'sync_in_progress'
            : undefined;
    const out: GoogleSyncNowResult = { success: false, error: result.error };
    if (code) out.code = code;
    return out;
  }

  private async runSync(opts: { full?: boolean } = {}) {
    this.running = true;
    this.pushStatus();
    try {
      const result = await this.engine.syncOnce(opts);
      if (result.errorCode === 'auth_required') this.needsReauth = true;
      this.offline = result.errorCode === 'offline';
      if (result.success) this.offline = false;
      return result;
    } finally {
      this.running = false;
      this.pushStatus();
    }
  }

  // ── Renderer apply round-trip ────────────────────────────────────────────

  private async applyMutations(mutations: GoogleApplyMutations): Promise<GoogleApplyResult> {
    const win = this.opts.getWindow();
    if (!win || win.isDestroyed()) {
      return { success: false, error: 'The app window is not available.' };
    }
    this.applyingRemote = true;
    try {
      return await new Promise<GoogleApplyResult>((resolve) => {
        const timer = setTimeout(() => {
          this.applyWaiters.delete(mutations.requestId);
          resolve({
            success: false,
            error: 'Timed out waiting for the app to save incoming calendar changes.',
          });
        }, APPLY_REPLY_TIMEOUT_MS);
        this.applyWaiters.set(mutations.requestId, { resolve, timer });
        win.webContents.send(GOOGLE_CHANNELS.applyPush, mutations);
      });
    } finally {
      this.applyingRemote = false;
    }
  }

  // ── Triggers ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.started) return;
    this.started = true;
    this.intervalTimer = setInterval(() => this.scheduleSync(0), SYNC_INTERVAL_MS);
    this.syncTimer = setTimeout(() => this.scheduleSync(0), STARTUP_SYNC_DELAY_MS);
  }

  stop(): void {
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.intervalTimer = null;
    this.syncTimer = null;
    for (const [, waiter] of this.applyWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ success: false, error: 'Application is shutting down.' });
    }
    this.applyWaiters.clear();
  }

  /** Renderer saved data (user edit) — debounce a sync to push it. */
  onLocalDataSaved(): void {
    if (this.applyingRemote) return; // our own apply round-trip, not a user edit
    this.scheduleSync(LOCAL_SAVE_DEBOUNCE_MS);
  }

  onWindowFocus(): void {
    if (!this.isConnected()) return;
    this.scheduleSync(CONTROL_SYNC_DELAY_MS);
  }

  /** Coalescing scheduler: one pending timer, skipped while a run is active. */
  private scheduleSync(delayMs: number): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      if (this.running || this.authBroken() || !this.isConnected()) return;
      void this.runSync().catch((err) => {
        gcalLogger.error('Scheduled sync crashed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, delayMs);
  }
}
