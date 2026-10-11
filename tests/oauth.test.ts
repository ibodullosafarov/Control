import { describe, expect, it, vi } from 'vitest';
import { OAuthError, OAuthFlow, refreshTokens, revokeToken } from '../electron/google/oauth';

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fakeIdToken(email: string): string {
  return `${b64url({ alg: 'none' })}.${b64url({ email })}.sig`;
}

describe('OAuthFlow', () => {
  it('rejects when no client is configured', async () => {
    const flow = new OAuthFlow({
      getClientConfig: () => null,
      openUrl: () => undefined,
    });
    await expect(flow.authorize()).rejects.toMatchObject({ code: 'not_configured' });
    expect(flow.inProgress).toBe(false);
  });

  it('rejects a second authorize while one is in progress', async () => {
    const flow = new OAuthFlow({
      getClientConfig: () => ({ clientId: 'x.apps.googleusercontent.com' }),
      openUrl: () => undefined, // never completes the callback
      timeoutMs: 250,
    });
    const first = flow.authorize();
    expect(flow.inProgress).toBe(true);
    await expect(flow.authorize()).rejects.toMatchObject({ code: 'connection_in_progress' });
    await expect(first).rejects.toMatchObject({ code: 'auth_timeout' });
    expect(flow.inProgress).toBe(false);
  });

  it('completes the loopback flow with PKCE and returns tokens + email', async () => {
    let authUrl = '';
    const tokenCalls: string[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      tokenCalls.push(String(init?.body ?? ''));
      return new Response(
        JSON.stringify({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
          scope: 'email',
          token_type: 'Bearer',
          id_token: fakeIdToken('user@example.com'),
        }),
        { status: 200 }
      );
    });

    const flow = new OAuthFlow({
      getClientConfig: () => ({ clientId: 'test-id.apps.googleusercontent.com' }),
      fetchFn: fetchFn as unknown as typeof fetch,
      openUrl: async (url: string) => {
        authUrl = url;
      },
      now: () => 1_000_000,
    });

    const pending = flow.authorize();
    await vi.waitFor(() => expect(authUrl).not.toBe(''));

    const u = new URL(authUrl);
    expect(u.origin).toBe('https://accounts.google.com');
    expect(u.searchParams.get('client_id')).toBe('test-id.apps.googleusercontent.com');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(u.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]+$/);

    const redirectUri = new URL(u.searchParams.get('redirect_uri')!);
    expect(redirectUri.hostname).toBe('127.0.0.1');
    expect(redirectUri.pathname).toBe('/callback');

    // Simulate the user approving in the browser.
    const cb = await fetch(
      `${redirectUri.origin}/callback?code=authcode123&state=${u.searchParams.get('state')}`
    );
    expect(cb.status).toBe(200);

    const result = await pending;
    expect(result.tokens.accessToken).toBe('access-1');
    expect(result.tokens.refreshToken).toBe('refresh-1');
    expect(result.tokens.expiresAt).toBe(1_000_000 + 3600 * 1000);
    expect(result.email).toBe('user@example.com');
    // PKCE verifier went to the token endpoint, challenge stayed public.
    expect(tokenCalls[0]).toContain('code_verifier=');
    expect(tokenCalls[0]).not.toContain('code_challenge');
  });

  it('rejects callbacks with a mismatched state', async () => {
    let authUrl = '';
    const flow = new OAuthFlow({
      getClientConfig: () => ({ clientId: 'x.apps.googleusercontent.com' }),
      fetchFn: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
      openUrl: async (url: string) => {
        authUrl = url;
      },
    });
    const pending = flow.authorize();
    // Attach the settlement handler synchronously so the rejection can never
    // land before a handler exists (avoids unhandled-rejection noise).
    const settled = pending.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err })
    );
    await vi.waitFor(() => expect(authUrl).not.toBe(''));
    const u = new URL(authUrl);
    const redirectUri = new URL(u.searchParams.get('redirect_uri')!);
    const cb = await fetch(`${redirectUri.origin}/callback?code=abc&state=tampered`);
    expect(cb.status).toBe(400);
    const outcome = await settled;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.err).toBeInstanceOf(OAuthError);
      expect((outcome.err as OAuthError).code).toBe('auth_failed');
    }
  });

  it('explains invalid_client as a missing client secret', async () => {
    let authUrl = '';
    const flow = new OAuthFlow({
      getClientConfig: () => ({ clientId: 'x.apps.googleusercontent.com' }),
      fetchFn: (async () =>
        new Response(
          JSON.stringify({ error: 'invalid_client', error_description: 'Client secret is missing.' }),
          { status: 401 }
        )) as unknown as typeof fetch,
      openUrl: async (url: string) => {
        authUrl = url;
      },
    });
    const pending = flow.authorize();
    const settled = pending.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err })
    );
    await vi.waitFor(() => expect(authUrl).not.toBe(''));
    const u = new URL(authUrl);
    const redirectUri = new URL(u.searchParams.get('redirect_uri')!);
    await fetch(`${redirectUri.origin}/callback?code=abc&state=${u.searchParams.get('state')}`);
    const outcome = await settled;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.err).toBeInstanceOf(OAuthError);
      expect((outcome.err as OAuthError).code).toBe('auth_failed');
      expect((outcome.err as Error).message).toMatch(/Client Secret/);
    }
  });

  it('maps access_denied to auth_denied', async () => {    let authUrl = '';
    const flow = new OAuthFlow({
      getClientConfig: () => ({ clientId: 'x.apps.googleusercontent.com' }),
      fetchFn: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
      openUrl: async (url: string) => {
        authUrl = url;
      },
    });
    const pending = flow.authorize();
    const settled = pending.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err })
    );
    await vi.waitFor(() => expect(authUrl).not.toBe(''));
    const redirectUri = new URL(new URL(authUrl).searchParams.get('redirect_uri')!);
    await fetch(`${redirectUri.origin}/callback?error=access_denied`);
    const outcome = await settled;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect((outcome.err as OAuthError).code).toBe('auth_denied');
  });
});

describe('refreshTokens', () => {
  it('keeps the original refresh token and computes expiry', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ access_token: 'new', expires_in: 100 }), { status: 200 })) as unknown as typeof fetch;
    const tokens = await refreshTokens(
      { clientId: 'x.apps.googleusercontent.com' },
      'original-refresh',
      fetchFn
    );
    expect(tokens.accessToken).toBe('new');
    expect(tokens.refreshToken).toBe('original-refresh');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it('flags invalid_grant as permanent (re-auth required)', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'revoked' }), {
        status: 400,
      })) as unknown as typeof fetch;
    const err = (await refreshTokens(
      { clientId: 'x.apps.googleusercontent.com' },
      'dead',
      fetchFn
    ).catch((e) => e)) as Error & { permanent?: boolean; code?: string };
    expect(err.permanent).toBe(true);
    expect(err.code).toBe('invalid_grant');
  });
});

describe('revokeToken', () => {
  it('never throws, even when the network fails', async () => {
    const failing = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    await expect(revokeToken('whatever', failing)).resolves.toBeUndefined();
  });
});
