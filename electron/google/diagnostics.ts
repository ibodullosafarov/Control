import * as fs from 'fs';
import * as path from 'path';

/**
 * Sanitized diagnostics log (~/.control-app/google-sync/diagnostics.log).
 *
 * Records sync/connect events with error codes and messages so a failing
 * setup can be diagnosed from the log alone. NEVER writes tokens, secrets,
 * authorization codes or credential values — everything is redacted both on
 * write and on read (defense in depth). This module has no `electron` import
 * so it stays unit-testable; service.ts calls into it.
 */

const MAX_BYTES = 200 * 1024;

export function diagLogPath(dataDir: string): string {
  return path.join(dataDir, 'google-sync', 'diagnostics.log');
}

/** Strip anything credential-shaped before it can reach the log. */
export function redactSecrets(text: string): string {
  return text
    .replace(/client_secret=[^&\s'"]+/gi, 'client_secret=***')
    .replace(/refresh_token=[^&\s'"]+/gi, 'refresh_token=***')
    .replace(/([?&]code=)[^&\s'"]+/gi, '$1***')
    .replace(/("access_token"\s*:\s*")[^"]+/gi, '$1***')
    .replace(/('access_token'\s*:\s*')[^']+/gi, '$1***');
}

export function appendDiagLine(dataDir: string, event: string, detail = ''): void {
  try {
    const file = diagLogPath(dataDir);
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const line = `[${new Date().toISOString()}] ${event}${detail ? ` ${redactSecrets(detail)}` : ''}\n`;
    fs.appendFileSync(file, line.slice(0, 2000));
    if (fs.statSync(file).size > MAX_BYTES) {
      // Keep the newest half; may cut mid-line at the boundary (cosmetic only).
      const content = fs.readFileSync(file, 'utf-8');
      fs.writeFileSync(file, content.slice(-Math.floor(MAX_BYTES / 2)));
    }
  } catch {
    /* diagnostics must never break sync */
  }
}

export function readDiagTail(dataDir: string, maxLines = 200): string {
  try {
    const file = diagLogPath(dataDir);
    if (!fs.existsSync(file)) return '(no diagnostics recorded yet)';
    const tail = fs.readFileSync(file, 'utf-8').split('\n').slice(-maxLines).join('\n');
    return redactSecrets(tail);
  } catch {
    return '(unreadable diagnostics log)';
  }
}
