import { CalendarApiPort, GoogleCalendarListEntry, GoogleEventResource } from './types';
import { OAuthClientConfig, AuthTokens } from './credentials';
import { refreshTokens } from './oauth';

/**
 * Google Calendar API client for the main process.
 *
 * Responsibilities:
 *  - attach + refresh OAuth access tokens (never sees renderer state)
 *  - classify errors: transient (network/429/5xx) vs auth vs permanent
 *  - exponential backoff with jitter, honoring Retry-After
 *  - expose typed helpers used by the sync engine
 */

export type GoogleApiErrorKind = 'transient' | 'rate_limit' | 'auth' | 'not_found' | 'gone' | 'conflict' | 'permanent';

export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly kind: GoogleApiErrorKind,
    public readonly retryAfterMs?: number,
    public readonly detail?: string
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

export interface GoogleApiOptions {
  getToken(): AuthTokens | null;
  /** Persist a refreshed token set. */
  saveToken(tokens: AuthTokens): void;
  getClientConfig(): OAuthClientConfig | null;
  /** Called when the refresh token is unusable — engine switches to auth_required. */
  onAuthLost(reason: string): void;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Max in-request attempts for transient errors (default 4). */
  maxAttempts?: number;
  /** Base backoff delay in ms (default 800). */
  baseDelayMs?: number;
  baseUrl?: string;
  logger?: { warn(msg: string, meta?: Record<string, unknown>): void };
}

const DEFAULT_BASE_URL = 'https://www.googleapis.com/calendar/v3';

function classifyStatus(status: number, body: { error?: { status?: string; message?: string; errors?: Array<{ reason?: string }> } }): GoogleApiErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) {
    const reasons = (body.error?.errors || []).map((e) => e.reason || '');
    if (
      reasons.includes('rateLimitExceeded') ||
      reasons.includes('userRateLimitExceeded') ||
      reasons.includes('quotaExceeded')
    ) {
      return 'rate_limit';
    }
    // 403 with authError reason ⇒ scope revoked / insufficient permission.
    if (reasons.includes('authError') || reasons.includes('forbidden')) return 'auth';
    // The Cloud project never enabled the Calendar API (or it was disabled):
    // re-authenticating cannot fix this, so never report it as an auth error
    // (which used to trap users in a pointless reconnect loop).
    if (reasons.includes('accessNotConfigured')) return 'permanent';
    return 'auth';
  }
  if (status === 404) return 'not_found';
  if (status === 410) return 'gone';
  if (status === 412) return 'conflict';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'transient';
  return 'permanent';
}

export class GoogleCalendarApi implements CalendarApiPort {
  private refreshing: Promise<boolean> | null = null;
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly nowFn: () => number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly baseUrl: string;

  constructor(private readonly opts: GoogleApiOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.sleepFn = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.nowFn = opts.now ?? (() => Date.now());
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.baseDelayMs = opts.baseDelayMs ?? 800;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  }

  private async getAccessToken(): Promise<string | null> {
    let tokens = this.opts.getToken();
    if (!tokens) return null;
    if (tokens.expiresAt - this.nowFn() < 60_000 && tokens.refreshToken) {
      const ok = await this.refreshOnce();
      if (!ok) return null;
      tokens = this.opts.getToken();
      if (!tokens) return null;
    }
    return tokens.accessToken;
  }

  /** Single-flight token refresh. Returns true when a usable access token exists. */
  private refreshOnce(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const client = this.opts.getClientConfig();
      const current = this.opts.getToken();
      if (!client || !current?.refreshToken) {
        this.opts.onAuthLost('missing_refresh_token');
        return false;
      }
      try {
        const next = await refreshTokens(client, current.refreshToken, this.fetchFn);
        this.opts.saveToken(next);
        return true;
      } catch (err) {
        const e = err as Error & { permanent?: boolean };
        this.opts.logger?.warn('Google token refresh failed', {
          permanent: !!e.permanent,
          error: e.message,
        });
        if (e.permanent) {
          this.opts.onAuthLost('refresh_rejected');
          return false;
        }
        // Transient refresh failure (network / 5xx): keep old token if unexpired.
        return this.nowFn() < (current?.expiresAt ?? 0);
      }
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /**
   * Low-level request with backoff. Throws GoogleApiError.
   * `ifMatch` maps to the HTTP If-Match header (ETag precondition).
   */
  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    opts: {
      query?: Record<string, string | number | boolean | undefined | string[]>;
      body?: unknown;
      ifMatch?: string;
      absoluteUrl?: string;
      /** Skip auth retry (used by endpoints where a 401 means revoked). */
      allowAuthRetry?: boolean;
    } = {}
  ): Promise<T> {
    let attempt = 0;
    let authRetried = false;
    let lastError: GoogleApiError | null = null;

    while (attempt < this.maxAttempts) {
      const token = await this.getAccessToken();
      if (!token) {
        throw new GoogleApiError('Not authenticated with Google Calendar.', 401, 'auth');
      }

      const url = new URL(opts.absoluteUrl ?? `${this.baseUrl}${path}`);
      if (opts.query) {
        for (const [k, v] of Object.entries(opts.query)) {
          if (v === undefined) continue;
          if (Array.isArray(v)) {
            for (const item of v) url.searchParams.append(k, String(item));
          } else {
            url.searchParams.set(k, String(v));
          }
        }
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      if (opts.ifMatch) headers['If-Match'] = opts.ifMatch;

      let res: Response;
      try {
        res = await this.fetchFn(url.toString(), {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        });
      } catch (err) {
        lastError = new GoogleApiError(
          `Network error: ${err instanceof Error ? err.message : String(err)}`,
          0,
          'transient'
        );
        attempt++;
        if (attempt >= this.maxAttempts) throw lastError;
        await this.sleepFn(this.backoffMs(attempt, undefined));
        continue;
      }

      if (res.status === 204 || res.status === 200) {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new GoogleApiError('Malformed JSON from Google API.', res.status, 'permanent');
        }
      }

      let body: { error?: { status?: string; message?: string; errors?: Array<{ reason?: string }> } } = {};
      try {
        body = (await res.json()) as typeof body;
      } catch {
        /* body-less error */
      }
      const kind = classifyStatus(res.status, body);
      const message = body.error?.message || `HTTP ${res.status}`;
      const detail = body.error?.errors?.map((e) => e.reason).join(',');

      if (kind === 'auth' && (opts.allowAuthRetry === undefined || opts.allowAuthRetry) && !authRetried) {
        authRetried = true;
        const ok = await this.refreshOnce();
        if (ok) continue;
        throw new GoogleApiError(message, res.status, 'auth', undefined, detail);
      }

      if (kind === 'transient' || kind === 'rate_limit') {
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        lastError = new GoogleApiError(message, res.status, kind, retryAfter, detail);
        attempt++;
        if (attempt >= this.maxAttempts) throw lastError;
        await this.sleepFn(this.backoffMs(attempt, retryAfter));
        continue;
      }

      throw new GoogleApiError(message, res.status, kind, undefined, detail);
    }

    throw lastError ?? new GoogleApiError('Request failed after retries.', 0, 'transient');
  }

  private backoffMs(attempt: number, retryAfterMs?: number): number {
    if (retryAfterMs !== undefined) return Math.min(retryAfterMs, 60_000);
    const exp = Math.min(this.baseDelayMs * 2 ** (attempt - 1), 30_000);
    return exp + Math.floor(Math.random() * 250);
  }

  // ── Calendar API surface ────────────────────────────────────────────────

  async listCalendars(): Promise<GoogleCalendarListEntry[]> {
    const out: GoogleCalendarListEntry[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.request<{ items?: GoogleCalendarListEntry[]; nextPageToken?: string }>(
        'GET',
        '/users/me/calendarList',
        { query: { maxResults: 250, pageToken, showHidden: false }, allowAuthRetry: true }
      );
      for (const item of res?.items || []) {
        if (item.accessRole === 'reader' || item.hidden) continue;
        out.push(item);
      }
      pageToken = res.nextPageToken;
    } while (pageToken);
    return out;
  }

  async getUserEmail(): Promise<string> {
    const tokens = this.opts.getToken();
    if (!tokens) throw new GoogleApiError('Not signed in.', 401, 'auth');
    const res = await this.fetchFn('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!res.ok) throw new GoogleApiError('Unable to read account info.', res.status, 'auth');
    const json = (await res.json()) as { email?: string };
    if (!json.email) throw new GoogleApiError('Account info has no email claim.', 401, 'auth');
    return json.email;
  }

  async listEvents(
    calendarId: string,
    params: {
      syncToken?: string;
      pageToken?: string;
      timeMin?: string;
      singleEvents?: boolean;
      showDeleted?: boolean;
      maxResults?: number;
    }
  ): Promise<{ items: GoogleEventResource[]; nextPageToken?: string; nextSyncToken?: string }> {
    const query: Record<string, string | number | boolean | undefined> = {
      syncToken: params.syncToken,
      pageToken: params.pageToken,
      timeMin: params.timeMin,
      singleEvents: params.singleEvents,
      showDeleted: params.showDeleted,
      maxResults: params.maxResults,
    };
    // Incremental pages must resend the same base query (syncToken + paging).
    if (params.syncToken) delete query.timeMin;
    const res = (await this.request<{
      items?: GoogleEventResource[];
      nextPageToken?: string;
      nextSyncToken?: string;
    }>(
      'GET',
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      { query, allowAuthRetry: false }
    )) ?? {};
    return {
      items: res.items || [],
      nextPageToken: res.nextPageToken,
      nextSyncToken: res.nextSyncToken,
    };
  }

  async getEvent(calendarId: string, eventId: string): Promise<GoogleEventResource> {
    return this.request<GoogleEventResource>('GET', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  }

  async findEventByControlBlockId(calendarId: string, blockId: string): Promise<GoogleEventResource | null> {
    const res = (await this.request<{ items?: GoogleEventResource[] }>(
      'GET',
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        query: {
          privateExtendedProperty: `controlBlockId=${blockId}`,
          showDeleted: false,
          maxResults: 2,
          singleEvents: false,
        },
      }
    )) ?? {};
    const item = (res.items || []).find((e) => e.status !== 'cancelled');
    return item ?? null;
  }

  async insertEvent(calendarId: string, body: Partial<GoogleEventResource>): Promise<GoogleEventResource> {
    return this.request<GoogleEventResource>('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, {
      body,
      allowAuthRetry: false,
    });
  }

  async patchEvent(
    calendarId: string,
    eventId: string,
    body: Partial<GoogleEventResource>,
    ifMatch?: string
  ): Promise<GoogleEventResource> {
    return this.request<GoogleEventResource>(
      'PATCH',
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { body, ifMatch, allowAuthRetry: false }
    );
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    await this.request<void>(
      'DELETE',
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { allowAuthRetry: false }
    );
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  return undefined;
}

/** True when the error means the sync token is no longer usable (HTTP 410). */
export function isSyncTokenGone(err: unknown): boolean {
  return err instanceof GoogleApiError && err.status === 410;
}

export function isAuthError(err: unknown): boolean {
  return err instanceof GoogleApiError && err.kind === 'auth';
}

export function isNotFoundError(err: unknown): boolean {
  return err instanceof GoogleApiError && (err.status === 404 || err.status === 410);
}

export function isConflictError(err: unknown): boolean {
  return err instanceof GoogleApiError && err.status === 412;
}

export function isTransientError(err: unknown): boolean {
  if (err instanceof GoogleApiError) return err.kind === 'transient' || err.kind === 'rate_limit';
  return err instanceof TypeError || (err instanceof Error && /network|fetch|socket/i.test(err.message));
}
