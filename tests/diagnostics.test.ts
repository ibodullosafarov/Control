import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendDiagLine,
  diagLogPath,
  readDiagTail,
  redactSecrets,
} from '../electron/google/diagnostics';

const tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'control-gcal-diag-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('redactSecrets', () => {
  it('strips credential-shaped values', () => {
    expect(redactSecrets('a client_secret=GOCSPX-abc123 end')).toBe('a client_secret=*** end');
    expect(redactSecrets('x refresh_token=1//abc end')).toBe('x refresh_token=*** end');
    expect(redactSecrets('cb?code=authcode&state=s')).toBe('cb?code=***&state=s');
    expect(redactSecrets('{"access_token": "sekret"}')).toBe('{"access_token": "***"}');
  });

  it('leaves ordinary messages untouched', () => {
    const msg = 'connect fail code=auth_failed error=Google rejected the OAuth client (invalid_client).';
    expect(redactSecrets(msg)).toBe(msg);
  });
});

describe('appendDiagLine / readDiagTail', () => {
  it('appends timestamped lines and reads them back', () => {
    const dir = tmpDir();
    appendDiagLine(dir, 'connect start', 'hasSecret=false');
    appendDiagLine(dir, 'connect fail', 'code=auth_failed');
    const tail = readDiagTail(dir);
    expect(tail).toMatch(/connect start hasSecret=false/);
    expect(tail).toMatch(/connect fail code=auth_failed/);
    expect(fs.existsSync(diagLogPath(dir))).toBe(true);
  });

  it('redacts secrets written by careless callers', () => {
    const dir = tmpDir();
    appendDiagLine(dir, 'oops', 'client_secret=GOCSPX-zzz');
    expect(readDiagTail(dir)).toContain('client_secret=***');
    expect(readDiagTail(dir)).not.toContain('GOCSPX-zzz');
  });

  it('reports a missing log instead of throwing', () => {
    expect(readDiagTail(tmpDir())).toBe('(no diagnostics recorded yet)');
  });

  it('caps the log size', () => {
    const dir = tmpDir();
    for (let i = 0; i < 5000; i++) {
      appendDiagLine(dir, `event-${i}`, 'x'.repeat(100));
    }
    expect(fs.statSync(diagLogPath(dir)).size).toBeLessThanOrEqual(200 * 1024);
    expect(readDiagTail(dir)).toContain('event-4999');
  });
});
