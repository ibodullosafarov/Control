import * as http from 'http';
import { AddressInfo } from 'net';
import * as crypto from 'crypto';
import { AuthTokens, GOOGLE_SCOPES, OAuthClientConfig } from './credentials';

/**
 * System-browser OAuth 2.0 flow for a desktop (installed) application.
 *
 * - Authorization happens in the user's default browser (never in a webview).
 * - Redirect target is a short-lived HTTP server bound to 127.0.0.1 on an
 *   ephemeral port (loopback redirect, the pattern Google recommends for
 *   installed apps).
 * - PKCE (S256) + random state protect the callback against code interception
 *   and CSRF. The state/code_verifier never leave this process.
 * - Tokens are returned to the caller (TokenStore) and never exposed over IPC.
 */

export interface OAuthFlowOptions {
  getClientConfig(): OAuthClientConfig | null;
  /** Opens the authorization URL in the system browser. */
  openUrl(url: string): Promise<void> | void;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  /** Fixed loopback port; 0 (default) picks an ephemeral one. */
  port?: number;
  now?: () => number;
}

export type OAuthErrorCode = 'auth_failed' | 'auth_denied' | 'auth_timeout' | 'not_configured' | 'connection_in_progress';

export class OAuthError extends Error {
  constructor(
    public readonly code: OAuthErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

export interface OAuthFlowResult {
  tokens: AuthTokens;
  /** Email claim from the id_token/userinfo, when available. */
  email?: string;
}

function base64Url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(bytes = 32): string {
  return base64Url(crypto.randomBytes(bytes));
}

function sha256Base64Url(input: string): string {
  return base64Url(crypto.createHash('sha256').update(input).digest());
}

const CALLBACK_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Control — sign in</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0b0d14;color:#e5e7eb;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{padding:2rem 2.5rem;border-radius:1rem;background:#12151f;border:1px solid rgba(255,255,255,.1);text-align:center}
h1{font-size:1rem;margin:0 0 .5rem}p{font-size:.85rem;color:#9ca3af;margin:0}</style></head>
<body><div class="card"><h1>Sign-in complete</h1><p>You can close this tab and return to Control.</p></div></body></html>`;

function errorPage(title: string, detail: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Control — sign-in error</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0b0d14;color:#fca5a5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{padding:2rem 2.5rem;border-radius:1rem;background:#12151f;border:1px solid rgba(252,165,165,.3);text-align:center;max-width:480px}
h1{font-size:1rem;margin:0 0 .5rem}p{font-size:.85rem;color:#9ca3af;margin:.5rem 0 0}</style></head>
<body><div class="card"><h1>${title}</h1><p>${detail}</p></div></body></html>`;
}

export class OAuthFlow {
  private pending: Promise<OAuthFlowResult> | null = null;

  constructor(private readonly opts: OAuthFlowOptions) {}

  get inProgress(): boolean {
    return this.pending !== null;
  }

  /**
   * Run the full authorization flow. Rejects with OAuthError carrying a
   * user-presentable code.
   */
  authorize(): Promise<OAuthFlowResult> {
    if (this.pending) {
      return Promise.reject(
        new OAuthError('connection_in_progress', 'A Google sign-in is already in progress.')
      );
    }
    this.pending = this.run().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async run(): Promise<OAuthFlowResult> {
    const client = this.opts.getClientConfig();
    if (!client) {
      throw new OAuthError(
        'not_configured',
        'Google OAuth client credentials are not configured. Add your Client ID in Preferences → Google Calendar.'
      );
    }

    const fetchFn = this.opts.fetchFn ?? fetch;
    const timeoutMs = this.opts.timeoutMs ?? 5 * 60 * 1000;
    const now = this.opts.now ?? (() => Date.now());

    const codeVerifier = randomToken(48);
    const codeChallenge = sha256Base64Url(codeVerifier);
    const state = randomToken(32);

    // Held in an object so the async cleanup below sees the assigned values
    // (assignments made inside the executor closure are not tracked by CFA).
    const ctx: {
      server: http.Server | null;
      timer: ReturnType<typeof setTimeout> | null;
    } = { server: null, timer: null };

    const redirectUriPromise = new Promise<{ redirectUri: string; wait: Promise<{ code: string; state: string }> }>(
      (resolve, reject) => {
        let settled = false;
        let resolveCb: (v: { code: string; state: string }) => void;
        let rejectCb: (e: Error) => void;
        const wait = new Promise<{ code: string; state: string }>((res, rej) => {
          resolveCb = res;
          rejectCb = rej;
        });

        const srv = http.createServer((req, res) => {
          const url = new URL(req.url || '/', `http://127.0.0.1`);
          if (url.pathname !== '/callback') {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end(errorPage('Not found', 'Unexpected request on the sign-in port.'));
            return;
          }
          const err = url.searchParams.get('error');
          const code = url.searchParams.get('code');
          const gotState = url.searchParams.get('state');
          if (err) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(errorPage('Sign-in was not completed', 'You can close this tab and return to Control.'));
            if (!settled) {
              settled = true;
              rejectCb(
                new OAuthError(
                  err === 'access_denied' ? 'auth_denied' : 'auth_failed',
                  err === 'access_denied'
                    ? 'Google sign-in was cancelled or denied.'
                    : `Google returned an error: ${err}`
                )
              );
            }
            return;
          }
          if (!code || !gotState || gotState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(errorPage('Invalid sign-in response', 'State mismatch — please retry the sign-in.'));
            if (!settled) {
              settled = true;
              rejectCb(new OAuthError('auth_failed', 'OAuth callback failed state validation.'));
            }
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(CALLBACK_PAGE);
          if (!settled) {
            settled = true;
            resolveCb({ code, state: gotState });
          }
        });

        ctx.server = srv;

        srv.on('error', (e) => {
          if (!settled) {
            settled = true;
            reject(e);
          }
        });

        srv.listen(this.opts.port ?? 0, '127.0.0.1', () => {
          const addr = srv.address() as AddressInfo;
          const redirectUri = `http://127.0.0.1:${addr.port}/callback`;
          resolve({ redirectUri, wait });
        });

        // Rejections from the request handler must surface on the wait promise.
        wait.catch(() => undefined);

        ctx.timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            rejectCb(new OAuthError('auth_timeout', 'Google sign-in timed out. Please try again.'));
          }
          try {
            srv.close();
          } catch {
            /* ignore */
          }
        }, timeoutMs);
      }
    );

    try {
      const { redirectUri, wait } = await redirectUriPromise;

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', client.clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', GOOGLE_SCOPES);
      authUrl.searchParams.set('access_type', 'offline');
      // Guarantees a refresh_token on first authorization.
      authUrl.searchParams.set('prompt', 'consent');
      authUrl.searchParams.set('include_granted_scopes', 'true');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');

      await this.opts.openUrl(authUrl.toString());

      const { code } = await wait;

      const body = new URLSearchParams({
        code,
        client_id: client.clientId,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      });
      if (client.clientSecret) body.set('client_secret', client.clientSecret);

      const res = await fetchFn('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok || typeof json.access_token !== 'string') {
        const errCode = typeof json.error === 'string' ? json.error : '';
        const desc = typeof json.error_description === 'string' ? json.error_description : String(json.error || '');
        const denied = errCode === 'access_denied';
        if (errCode === 'invalid_client') {
          throw new OAuthError(
            'auth_failed',
            'Google rejected the OAuth client (invalid_client). ' +
              'If your client is a Web application, paste its Client Secret in Settings → Google Calendar ' +
              '(or switch to a Desktop-type client ID, which needs no secret).'
          );
        }
        throw new OAuthError(
          denied ? 'auth_denied' : 'auth_failed',
          denied ? 'Google denied access to your calendars.' : `Token exchange failed: ${desc || res.status}`
        );
      }

      const nowMs = now();
      const tokens: AuthTokens = {
        accessToken: json.access_token as string,
        refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
        expiresAt: nowMs + (typeof json.expires_in === 'number' ? json.expires_in : 3600) * 1000,
        scope: typeof json.scope === 'string' ? json.scope : undefined,
        tokenType: typeof json.token_type === 'string' ? json.token_type : undefined,
        obtainedAt: new Date(nowMs).toISOString(),
      };

      let email: string | undefined;
      if (typeof json.id_token === 'string') {
        email = emailFromIdToken(json.id_token);
      }
      if (!email) {
        email = await this.fetchUserInfoEmail(tokens.accessToken, fetchFn).catch(() => undefined);
      }

      return { tokens, email };
    } finally {
      if (ctx.timer) clearTimeout(ctx.timer);
      if (ctx.server) {
        try {
          ctx.server.close();
        } catch {
          /* ignore */
        }
      }
    }
  }

  private async fetchUserInfoEmail(accessToken: string, fetchFn: typeof fetch): Promise<string | undefined> {
    const res = await fetchFn('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { email?: string };
    return typeof json.email === 'string' ? json.email : undefined;
  }
}

function emailFromIdToken(idToken: string): string | undefined {
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return undefined;
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8')) as { email?: string };
    return typeof json.email === 'string' ? json.email : undefined;
  } catch {
    return undefined;
  }
}

/** Refresh the access token (single-use helper; callers serialize access). */
export async function refreshTokens(
  client: OAuthClientConfig,
  refreshToken: string,
  fetchFn: typeof fetch = fetch
): Promise<AuthTokens> {
  const body = new URLSearchParams({
    client_id: client.clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (client.clientSecret) body.set('client_secret', client.clientSecret);

  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== 'string') {
    const err = typeof json.error === 'string' ? json.error : String(res.status);
    const desc = typeof json.error_description === 'string' ? json.error_description : '';
    const e = new Error(`Token refresh failed: ${err}${desc ? ` (${desc})` : ''}`) as Error & {
      code?: string;
      permanent?: boolean;
    };
    // invalid_grant ⇒ refresh token revoked/expired — requires re-authorization.
    e.code = err;
    e.permanent = err === 'invalid_grant' || err === 'unauthorized_client';
    throw e;
  }
  const now = Date.now();
  return {
    accessToken: json.access_token as string,
    // Google does not rotate refresh tokens here; keep the original.
    refreshToken,
    expiresAt: now + (typeof json.expires_in === 'number' ? json.expires_in : 3600) * 1000,
    scope: typeof json.scope === 'string' ? json.scope : undefined,
    tokenType: typeof json.token_type === 'string' ? json.token_type : undefined,
    obtainedAt: new Date(now).toISOString(),
  };
}

/** Revoke a token (access or refresh) at Google. Best-effort. */
export async function revokeToken(token: string, fetchFn: typeof fetch = fetch): Promise<void> {
  try {
    await fetchFn('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    /* best effort — local credentials are cleared regardless */
  }
}
