import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * OAuth credential storage for Google Calendar.
 *
 * - Access/refresh tokens are encrypted with an injected cipher (Electron
 *   safeStorage → OS credential store on macOS) before touching disk.
 * - The OAuth client (client id/secret) is developer-supplied configuration,
 *   never hardcoded. It is resolved from the environment or
 *   ~/.control-app/google-oauth.json and stays in the main process.
 *
 * This module deliberately has no `electron` import so it can be unit tested;
 * service.ts wires in the safeStorage-backed cipher.
 */

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  scope?: string;
  tokenType?: string;
  obtainedAt: string;
}

export interface Cipher {
  /** Returns null when encryption is unavailable (caller falls back safely). */
  encrypt(plain: Buffer): Buffer | null;
  decrypt(data: Buffer): Buffer | null;
  /** True when backed by the OS credential store (safeStorage). */
  secure: boolean;
}

export interface OAuthClientConfig {
  clientId: string;
  clientSecret?: string;
}

export interface ClientConfigResult {
  config: OAuthClientConfig | null;
  source?: 'environment' | 'config-file';
}

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'openid',
  'email',
].join(' ');

const CLIENT_ID_PATTERN = /^[0-9a-zA-Z._\-]+\.apps\.googleusercontent\.com$/;

export function isValidClientId(clientId: string): boolean {
  return typeof clientId === 'string' && CLIENT_ID_PATTERN.test(clientId.trim());
}

/** Cipher fallback used when the OS keychain is unavailable. Not encrypted. */
export const plainCipher: Cipher = {
  encrypt: (plain) => plain,
  decrypt: (data) => data,
  secure: false,
};

export class TokenStore {
  private cache: AuthTokens | null | undefined;

  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher,
    private readonly now: () => number = () => Date.now()
  ) {}

  get usesSecureStorage(): boolean {
    return this.cipher.secure;
  }

  load(): AuthTokens | null {
    if (this.cache !== undefined) return this.cache;
    try {
      if (!fs.existsSync(this.filePath)) {
        this.cache = null;
        return null;
      }
      const raw = fs.readFileSync(this.filePath);
      const envelope = JSON.parse(raw.toString('utf-8')) as {
        v: number;
        secure?: boolean;
        data: string;
      };
      const buf = Buffer.from(envelope.data, 'base64');
      const plain = this.cipher.decrypt(buf);
      if (!plain) {
        this.cache = null;
        return null;
      }
      const tokens = JSON.parse(plain.toString('utf-8')) as AuthTokens;
      if (!tokens || typeof tokens.accessToken !== 'string') {
        this.cache = null;
        return null;
      }
      this.cache = tokens;
      return tokens;
    } catch (err) {
      console.warn('[gcal] Failed to read stored credentials:', err instanceof Error ? err.message : err);
      this.cache = null;
      return null;
    }
  }

  save(tokens: AuthTokens): boolean {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const plain = Buffer.from(JSON.stringify(tokens), 'utf-8');
      const enc = this.cipher.encrypt(plain);
      if (!enc) return false;
      const envelope = JSON.stringify({
        v: 1,
        secure: this.cipher.secure,
        data: enc.toString('base64'),
      });
      const tmp = `${this.filePath}.tmp.${this.now()}`;
      fs.writeFileSync(tmp, envelope, { mode: 0o600 });
      fs.renameSync(tmp, this.filePath);
      this.cache = tokens;
      return true;
    } catch (err) {
      console.warn('[gcal] Failed to store credentials:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  clear(): void {
    this.cache = null;
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
    } catch {
      /* best effort */
    }
  }

  /** In-memory only update (used after refresh to avoid disk churn). */
  setCached(tokens: AuthTokens | null): void {
    this.cache = tokens;
  }
}

/**
 * Resolve developer-supplied OAuth client credentials.
 * Order: environment variables → ~/.control-app/google-oauth.json.
 *
 * The secret may live in either place independently: when the ID comes from
 * the environment but the secret was entered in Settings (or vice versa),
 * the two are merged instead of the file being silently ignored.
 */
export function resolveClientConfig(
  env: NodeJS.ProcessEnv = process.env,
  configDir: string = path.join(os.homedir(), '.control-app')
): ClientConfigResult {
  const fileCfg = readConfigFile(configDir);
  const envId = (env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  if (envId) {
    const envSecret = (env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim() || undefined;
    return {
      config: {
        clientId: envId,
        clientSecret: envSecret ?? fileCfg?.clientSecret,
      },
      source: 'environment',
    };
  }
  if (fileCfg?.clientId) {
    return {
      config: { clientId: fileCfg.clientId, clientSecret: fileCfg.clientSecret },
      source: 'config-file',
    };
  }
  return { config: null };
}

function readConfigFile(configDir: string): { clientId?: string; clientSecret?: string } | null {
  try {
    const file = path.join(configDir, 'google-oauth.json');
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      clientId?: string;
      clientSecret?: string;
    };
    const out: { clientId?: string; clientSecret?: string } = {};
    if ((parsed.clientId || '').trim()) out.clientId = parsed.clientId!.trim();
    if ((parsed.clientSecret || '').trim()) out.clientSecret = parsed.clientSecret!.trim();
    return out.clientId || out.clientSecret ? out : null;
  } catch (err) {
    console.warn('[gcal] Failed to read google-oauth.json:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Remove the stored OAuth client (id + secret). Idempotent; env-provided config is unaffected. */
export function clearClientConfig(
  configDir: string = path.join(os.homedir(), '.control-app')
): { success: boolean; error?: string; removed?: boolean } {
  try {
    const file = path.join(configDir, 'google-oauth.json');
    if (!fs.existsSync(file)) return { success: true, removed: false };
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(fs.readFileSync(file, 'utf-8')) || {};
    } catch {
      existing = {};
    }
    const had = 'clientId' in existing || 'clientSecret' in existing;
    delete existing.clientId;
    delete existing.clientSecret;
    if (Object.keys(existing).length === 0) {
      fs.unlinkSync(file);
    } else {
      fs.writeFileSync(file, JSON.stringify(existing, null, 2), { mode: 0o600 });
    }
    return { success: true, removed: had };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Persist a user-supplied client id (main process only; never sent back to the renderer beyond a boolean). */
export function saveClientConfig(
  clientId: string,
  configDir: string = path.join(os.homedir(), '.control-app'),
  clientSecret?: string
): { success: boolean; error?: string } {
  if (!isValidClientId(clientId)) {
    return { success: false, error: 'Invalid Google OAuth Client ID format.' };
  }
  try {
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    const file = path.join(configDir, 'google-oauth.json');
    let existing: Record<string, unknown> = {};
    try {
      if (fs.existsSync(file)) existing = JSON.parse(fs.readFileSync(file, 'utf-8')) || {};
    } catch {
      existing = {};
    }
    existing.clientId = clientId.trim();
    if (clientSecret !== undefined) {
      // Web-application clients require their secret at the token endpoint;
      // an empty value clears a previously stored one.
      if (clientSecret.trim()) existing.clientSecret = clientSecret.trim();
      else delete existing.clientSecret;
    }
    fs.writeFileSync(file, JSON.stringify(existing, null, 2), { mode: 0o600 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
