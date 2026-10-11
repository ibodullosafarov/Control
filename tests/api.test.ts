import { describe, expect, it, vi } from 'vitest';
import { GoogleCalendarApi, GoogleApiError } from '../electron/google/api';
import { CalendarApiPort, GoogleEventResource } from '../electron/google/types';
import { AuthTokens, OAuthClientConfig } from '../electron/google/credentials';

const FIXED_NOW = 1_000_000_000;

function makeTokens(): AuthTokens {
  return {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: FIXED_NOW + 3600 * 1000,
    obtainedAt: new Date(FIXED_NOW).toISOString(),
  };
}

function makeConfig(): OAuthClientConfig {
  return { clientId: 'client.apps.googleusercontent.com' };
}

function apiWithFetch(
  responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>,
  opts: {
    getToken?: () => AuthTokens | null;
    saveToken?: (t: AuthTokens) => void;
    onAuthLost?: (r: string) => void;
    getClientConfig?: () => OAuthClientConfig | null;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): GoogleCalendarApi {
  let idx = 0;
  const fetchFn = vi.fn(async () => {
    const r = responses[idx++] || { status: 500, body: { error: { message: 'boom' } } };
    // Null-body statuses (204) cannot carry a payload in undici.
    const payload = r.body === '' || r.body == null ? null : JSON.stringify(r.body);
    return new Response(payload, { status: r.status, headers: r.headers });
  });
  return new GoogleCalendarApi({
    fetchFn: fetchFn as unknown as typeof fetch,
    sleep: opts.sleep ?? (async () => undefined),
    now: opts.now ?? (() => FIXED_NOW),
    getToken: opts.getToken ?? (() => makeTokens()),
    saveToken: opts.saveToken ?? (() => undefined),
    getClientConfig: opts.getClientConfig ?? (() => makeConfig()),
    onAuthLost: opts.onAuthLost ?? (() => undefined),
  });
}

describe('GoogleCalendarApi', () => {
  it('attaches Authorization header and parses successful responses', async () => {
    const api = apiWithFetch([
      { status: 200, body: { items: [{ id: 'cal1', summary: 'Primary', primary: true }] } },
    ]);
    const cals = await api.listCalendars();
    expect(cals).toHaveLength(1);
    expect(cals[0].summary).toBe('Primary');
  });

  it('filters reader/hidden calendars and paginates', async () => {
    const api = apiWithFetch([
      {
        status: 200,
        body: {
          items: [
            { id: 'w1', summary: 'W', accessRole: 'writer', hidden: false },
            { id: 'r1', summary: 'R', accessRole: 'reader' },
            { id: 'h1', summary: 'H', hidden: true },
          ],
          nextPageToken: 'p2',
        },
      },
      { status: 200, body: { items: [{ id: 'w2', summary: 'W2', accessRole: 'owner' }] } },
    ]);
    const cals = await api.listCalendars();
    expect(cals.map((c) => c.id)).toEqual(['w1', 'w2']);
  });

  it('returns empty list on 204', async () => {
    const api = apiWithFetch([{ status: 204, body: '' }]);
    const res = await api.listEvents('cal', { singleEvents: true, showDeleted: true, maxResults: 250 });
    expect(res.items).toEqual([]);
    expect(res.nextSyncToken).toBeUndefined();
  });

  it('drops timeMin when using a syncToken (incremental sync)', async () => {
    const fetchFn = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ items: [], nextSyncToken: 'tok1' }), { status: 200 })
    );
    const api = new GoogleCalendarApi({
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => undefined,
      now: () => FIXED_NOW,
      getToken: () => makeTokens(),
      saveToken: () => undefined,
      getClientConfig: () => makeConfig(),
      onAuthLost: () => undefined,
    });
    await api.listEvents('cal', { syncToken: 'tok0', timeMin: '2026-10-01T00:00:00Z', singleEvents: true, showDeleted: true });
    const url = String(fetchFn.mock.calls[0][0]);
    const u = new URL(url);
    expect(u.searchParams.get('syncToken')).toBe('tok0');
    expect(u.searchParams.has('timeMin')).toBe(false);
  });

  it('exposes paging tokens so callers can collect all pages', async () => {
    const api = apiWithFetch([
      { status: 200, body: { items: [{ id: 'e1' }], nextPageToken: 'p' } },
      { status: 200, body: { items: [{ id: 'e2' }], nextSyncToken: 'tok' } },
    ]);
    const first = await api.listEvents('c', { singleEvents: true, showDeleted: true, maxResults: 250 });
    expect(first.items.map((x) => x.id)).toEqual(['e1']);
    expect(first.nextPageToken).toBe('p');
    const second = await api.listEvents('c', {
      singleEvents: true,
      showDeleted: true,
      maxResults: 250,
      pageToken: 'p',
    });
    expect(second.items.map((x) => x.id)).toEqual(['e2']);
    expect(second.nextSyncToken).toBe('tok');
  });

  it('findEventByControlBlockId searches by privateExtendedProperty and excludes cancelled', async () => {
    const api = apiWithFetch([
      {
        status: 200,
        body: {
          items: [
            { id: 'x', status: 'cancelled', extendedProperties: { private: { controlBlockId: 'b1' } } },
            { id: 'y', status: 'confirmed', extendedProperties: { private: { controlBlockId: 'b1' } } },
          ],
        },
      },
    ]);
    const found = await api.findEventByControlBlockId('c', 'b1');
    expect(found?.id).toBe('y');
  });

  it('retries on transient errors with exponential backoff and jitter', async () => {
    const sleep = vi.fn(async (_ms: number): Promise<void> => undefined);
    const api = apiWithFetch(
      [
        { status: 500, body: { error: { message: 'boom' } } },
        { status: 500, body: { error: { message: 'boom2' } } },
        { status: 200, body: { items: [] } },
      ],
      { sleep }
    );
    const res = await api.listCalendars();
    expect(res).toEqual([]);
    expect(sleep).toHaveBeenCalledTimes(2);
    const d1 = sleep.mock.calls[0][0];
    const d2 = sleep.mock.calls[1][0];
    expect(d1).toBeGreaterThanOrEqual(800);
    expect(d2).toBeGreaterThanOrEqual(1600);
  });

  it('honors Retry-After header for rate limits', async () => {
    const sleep = vi.fn(async (_ms: number): Promise<void> => undefined);
    const api = apiWithFetch(
      [
        { status: 429, body: { error: { message: 'too fast' } }, headers: { 'retry-after': '2' } },
        { status: 200, body: { items: [] } },
      ],
      { sleep }
    );
    await api.listCalendars();
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('refreshes the token and retries once for 401', async () => {
    // Unexpired token: no pre-refresh, so exactly one refresh happens (on 401).
    let current = makeTokens();
    const saveToken = vi.fn((t: AuthTokens) => {
      current = t;
    });
    const fetchFn = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'new-access', expires_in: 3600 }),
          { status: 200 }
        );
      }
      const apiCalls = fetchFn.mock.calls.filter(
        (c) => !String(c[0]).includes('oauth2')
      ).length;
      if (apiCalls === 1)
        return new Response(JSON.stringify({ error: { message: 'auth' } }), { status: 401 });
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    const api = new GoogleCalendarApi({
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => undefined,
      now: () => FIXED_NOW,
      getToken: () => current,
      saveToken,
      getClientConfig: () => makeConfig(),
      onAuthLost: vi.fn(),
    });
    const res = await api.listCalendars();
    expect(res).toEqual([]);
    expect(saveToken).toHaveBeenCalledTimes(1);
    expect(current.accessToken).toBe('new-access');
  });

  it('treats 403 with authError reason as auth and not transient', async () => {
    const forbidden = {
      status: 403,
      body: { error: { message: 'Forbidden', errors: [{ reason: 'authError' }] } },
    };
    // No client config: the auth retry path bails out without consuming fetches.
    const api = apiWithFetch([forbidden, { ...forbidden }], {
      getClientConfig: () => null,
    });
    await expect(api.listCalendars()).rejects.toBeInstanceOf(GoogleApiError);
    try {
      await api.listCalendars();
    } catch (e) {
      const err = e as GoogleApiError;
      expect(err.kind).toBe('auth');
      expect(err.status).toBe(403);
    }
  });

  it('treats 403 accessNotConfigured as permanent (enable the API, not re-auth)', async () => {
    const body = {
      error: {
        message: 'Google Calendar API has not been used in project 1 before or it is disabled.',
        errors: [{ reason: 'accessNotConfigured' }],
      },
    };
    const api = apiWithFetch([{ status: 403, body }]);
    await expect(api.listCalendars()).rejects.toMatchObject({ kind: 'permanent', status: 403 });
  });

  it('treats 410 as gone', async () => {
    const api = apiWithFetch([{ status: 410, body: { error: { message: 'Gone' } } }]);
    try {
      await api.getEvent('c', 'e');
      throw new Error('expected');
    } catch (e) {
      expect((e as GoogleApiError).kind).toBe('gone');
      expect((e as GoogleApiError).status).toBe(410);
    }
  });

  it('passes If-Match header on patchEvent', async () => {
    const api = apiWithFetch([{ status: 200, body: { id: 'e1' } }]);
    await api.patchEvent('c', 'e1', { summary: 'x' }, '"etag123"');
    const call = (api as any).fetchFn.mock.calls[0];
    const u = String(call[0]);
    const init = call[1];
    expect(init.headers['If-Match']).toBe('"etag123"');
  });

  it('classifies network errors as transient', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const api = new GoogleCalendarApi({
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => undefined,
      now: () => FIXED_NOW,
      getToken: () => makeTokens(),
      saveToken: () => undefined,
      getClientConfig: () => makeConfig(),
      onAuthLost: () => undefined,
      maxAttempts: 2,
    });
    await expect(api.listCalendars()).rejects.toBeInstanceOf(GoogleApiError);
    try {
      await api.listCalendars();
    } catch (e) {
      expect((e as GoogleApiError).kind).toBe('transient');
    }
  });
});
