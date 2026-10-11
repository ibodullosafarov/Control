import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearClientConfig,
  isValidClientId,
  resolveClientConfig,
  saveClientConfig,
} from '../electron/google/credentials';

const tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-gcal-creds-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function readConfig(dir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, 'google-oauth.json'), 'utf-8'));
}

describe('isValidClientId', () => {
  it('accepts valid Google OAuth client IDs', () => {
    expect(isValidClientId('123456789012-abcd1234.apps.googleusercontent.com')).toBe(true);
    expect(isValidClientId('  123456789012-abcd1234.apps.googleusercontent.com  ')).toBe(true);
  });

  it('rejects obviously invalid formats', () => {
    expect(isValidClientId('')).toBe(false);
    expect(isValidClientId('not-a-client-id')).toBe(false);
    expect(isValidClientId('12345')).toBe(false);
  });
});

describe('saveClientConfig', () => {
  it('writes the client id without a secret by default', () => {
    const dir = tmpDir();
    const res = saveClientConfig('abc-123.apps.googleusercontent.com', dir);
    expect(res.success).toBe(true);
    expect(readConfig(dir)).toEqual({ clientId: 'abc-123.apps.googleusercontent.com' });
  });

  it('stores the client secret alongside the id', () => {
    const dir = tmpDir();
    const res = saveClientConfig('abc-123.apps.googleusercontent.com', dir, 'GOCSPX-secret');
    expect(res.success).toBe(true);
    expect(readConfig(dir)).toEqual({
      clientId: 'abc-123.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-secret',
    });
  });

  it('preserves an existing secret when none is passed', () => {
    const dir = tmpDir();
    saveClientConfig('abc-123.apps.googleusercontent.com', dir, 'keep-me');
    const res = saveClientConfig('abc-123.apps.googleusercontent.com', dir);
    expect(res.success).toBe(true);
    expect(readConfig(dir).clientSecret).toBe('keep-me');
  });

  it('clears the secret when an empty value is passed', () => {
    const dir = tmpDir();
    saveClientConfig('abc-123.apps.googleusercontent.com', dir, 'drop-me');
    const res = saveClientConfig('abc-123.apps.googleusercontent.com', dir, '   ');
    expect(res.success).toBe(true);
    expect('clientSecret' in readConfig(dir)).toBe(false);
  });

  it('rejects invalid client ids without touching disk', () => {
    const dir = tmpDir();
    const res = saveClientConfig('bogus', dir, 'secret');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid/);
    expect(fs.existsSync(path.join(dir, 'google-oauth.json'))).toBe(false);
  });
});

describe('clearClientConfig', () => {
  it('removes the stored id and secret', () => {
    const dir = tmpDir();
    saveClientConfig('abc-123.apps.googleusercontent.com', dir, 'shh');
    const res = clearClientConfig(dir);
    expect(res.success).toBe(true);
    expect(res.removed).toBe(true);
    // Nothing else was in the file, so it is deleted entirely.
    expect(fs.existsSync(path.join(dir, 'google-oauth.json'))).toBe(false);
    expect(resolveClientConfig({}, dir).config).toBeNull();
  });

  it('preserves unrelated fields in the file', () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, 'google-oauth.json'),
      JSON.stringify({ clientId: 'a.apps.googleusercontent.com', custom: 42 }),
      'utf-8'
    );
    const res = clearClientConfig(dir);
    expect(res.success).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'google-oauth.json'), 'utf-8'))).toEqual({
      custom: 42,
    });
  });

  it('is a successful no-op when nothing is stored', () => {
    const dir = tmpDir();
    const res = clearClientConfig(dir);
    expect(res.success).toBe(true);
    expect(res.removed).toBe(false);
  });
});

describe('resolveClientConfig', () => {
  it('reads id and secret from the config file', () => {
    const dir = tmpDir();
    saveClientConfig('file-id.apps.googleusercontent.com', dir, 'file-secret');
    const res = resolveClientConfig({}, dir);
    expect(res.source).toBe('config-file');
    expect(res.config?.clientId).toBe('file-id.apps.googleusercontent.com');
    expect(res.config?.clientSecret).toBe('file-secret');
  });

  it('prefers environment variables over the config file', () => {
    const dir = tmpDir();
    saveClientConfig('file-id.apps.googleusercontent.com', dir, 'file-secret');
    const res = resolveClientConfig(
      { GOOGLE_OAUTH_CLIENT_ID: 'env-id.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: 'env-secret' },
      dir
    );
    expect(res.source).toBe('environment');
    expect(res.config?.clientId).toBe('env-id.apps.googleusercontent.com');
    expect(res.config?.clientSecret).toBe('env-secret');
  });

  it('merges the file secret under an environment client id', () => {
    const dir = tmpDir();
    saveClientConfig('file-id.apps.googleusercontent.com', dir, 'file-secret');
    const res = resolveClientConfig({ GOOGLE_OAUTH_CLIENT_ID: 'env-id.apps.googleusercontent.com' }, dir);
    expect(res.source).toBe('environment');
    expect(res.config?.clientId).toBe('env-id.apps.googleusercontent.com');
    expect(res.config?.clientSecret).toBe('file-secret');
  });

  it('returns null config when nothing is configured', () => {
    const res = resolveClientConfig({}, tmpDir());
    expect(res.config).toBeNull();
  });
});
