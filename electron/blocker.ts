import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec, execFile, execSync } from 'child_process';
import { promisify } from 'util';
import { BlockingStrategy, BlockerStatus, AppBlockerStatus, InstalledAppInfo } from '../src/types';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

// macOS Finder uses .icns containers that embed PNGs of several sizes. Rather
// than app.getFileIcon (which can wedge on some Electron/macOS combos), we
// parse the container and return the largest embedded PNG as a data URL.
function pngFromBundle(bundlePath: string): string | null {
  try {
    const resourcesDir = path.join(bundlePath, 'Contents', 'Resources');
    let iconFiles: string[];
    try {
      iconFiles = fs.readdirSync(resourcesDir).filter((f) => /\.icns$/i.test(f));
    } catch {
      iconFiles = [];
    }
    // { buf, start, end } of the largest valid embedded PNG found across all
    // .icns files in the bundle.
    let best: { buf: Buffer; start: number; end: number; w: number; h: number } | null = null;

    for (const file of iconFiles) {
      let buf: Buffer;
      try {
        buf = fs.readFileSync(path.join(resourcesDir, file));
      } catch {
        continue;
      }

      // Walk the .icns container chunk-by-chunk. Each embedded PNG begins with
      // its signature inside one of these chunks; some icns formats store the
      // PNG raw, but we simply scan for PNG signatures and validate by walking
      // the PNG's own chunks forwards from the IHDR.
      let idx = -1;
      while ((idx = buf.indexOf(PNG_SIGNATURE, idx + 1)) !== -1) {
        let pos = idx + 8; // start of the PNG's first chunk (length field)
        if (buf.toString('ascii', pos + 4, pos + 8) !== 'IHDR') continue;
        const firstLen = buf.readUInt32BE(pos);
        const w = buf.readUInt32BE(pos + 8);
        const h = buf.readUInt32BE(pos + 12);
        if (!w || !h || w > 4096 || h > 4096) continue;
        let cursor = pos + 8 + firstLen + 4; // skip IHDR data + CRC
        let end = 0;
        while (cursor + 8 <= buf.length) {
          const len = buf.readUInt32BE(cursor);
          const type = buf.toString('ascii', cursor + 4, cursor + 8);
          if (type === 'IEND') {
            end = cursor + 8 + len;
            break;
          }
          cursor += 8 + len + 4; // data + CRC
        }
        if (end <= idx) continue;
        if (!best || w * h > best.w * best.h) {
          best = { buf, start: idx, end, w, h };
        }
      }
    }

    if (!best || best.end - best.start <= 8) return null;
    const png = best.buf.subarray(best.start, best.end);
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

const HOSTS_FILE = '/etc/hosts';
export const BLOCK_START_MARKER = '# --- BEGIN CONTROL MANAGED BLOCKLIST ---';
export const BLOCK_END_MARKER = '# --- END CONTROL MANAGED BLOCKLIST ---';
/** Pre-rename markers — still recognized (and cleaned up) so an old managed
 *  section left in /etc/hosts is never orphaned. New sections always use the
 *  markers above. */
export const LEGACY_BLOCK_START_MARKER = '# --- BEGIN FOCUS MANAGED BLOCKLIST ---';
export const LEGACY_BLOCK_END_MARKER = '# --- END FOCUS MANAGED BLOCKLIST ---';
const SELFCONTROL_CLI_PATH = '/Applications/SelfControl.app/Contents/MacOS/selfcontrol-cli';

// ── Pure, unit-tested helpers ──────────────────────────────────────────────
// Privilege policy (verified against Apple behavior on macOS Sonoma+):
// - Every privileged hosts change goes through ONE `runPrivilegedShell`
//   call below, i.e. at most one system password dialog per start/stop.
// - Re-applying identical content is a no-op (no dialog at all). This is what
//   stops the double prompt when the app and the timer view both request
//   blocking at session start, and it self-heals (adopts state, no prompt)
//   when a managed section survived a crash/restart.
// - Touch ID is NOT available in this dialog class: Apple removed Touch ID
//   from AppleScript `with administrator privileges` prompts starting with
//   macOS Sonoma. Only Terminal `sudo` (via /etc/pam.d/sudo_local) still
//   offers Touch ID, and a GUI app has no TTY to use it — so there is no
//   app-side switch that could enable it here. Single password prompt max.

/** The exact osascript invocation (one SecurityAgent dialog by construction). */
export function privilegedCopyCommand(tempPath: string, destPath: string): string {
  return (
    `osascript -e 'do shell script "cp ${tempPath} ${destPath} ` +
    `&& dscacheutil -flushcache && killall -HUP mDNSResponder" with administrator privileges'`
  );
}

/** Run one privileged shell command (see policy note above). */
export async function runPrivilegedShell(
  command: string,
  execFn: (cmd: string) => Promise<unknown> = execAsync
): Promise<void> {
  await execFn(command);
}

/** Shell-escape one argument for /bin/sh double-quote context. */
export function shellQuote(s: string): string {
  return `"${s.replace(/(["$`\\])/g, '\\$1')}"`;
}

/** Managed block section for exactly these domains (normalized). */
export function buildManagedSection(domains: string[]): string {
  const lines: string[] = [
    BLOCK_START_MARKER,
    '# Managed automatically by Control. Do not edit manually.',
  ];
  for (const domain of domains) {
    const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!clean) continue;
    lines.push(`127.0.0.1 ${clean}`);
    lines.push(`::1 ${clean}`);
    if (!clean.startsWith('www.')) {
      lines.push(`127.0.0.1 www.${clean}`);
      lines.push(`::1 www.${clean}`);
    }
  }
  lines.push(BLOCK_END_MARKER);
  return lines.join('\n');
}

/** Matches a managed section written by any app version (current or pre-rename). */
const ANY_MANAGED_SECTION_RE = new RegExp(
  `(?:${BLOCK_START_MARKER}|${LEGACY_BLOCK_START_MARKER})[\\s\\S]*?(?:${BLOCK_END_MARKER}|${LEGACY_BLOCK_END_MARKER})`
);

/** True when a managed section is present at all (stop is a no-op otherwise). */
export function hasManagedSection(hostsContent: string): boolean {
  return ANY_MANAGED_SECTION_RE.test(hostsContent);
}

/** True when the file already blocks exactly these domains (skip, no prompt). */
export function hostsAlreadyBlocked(currentHosts: string, domains: string[]): boolean {
  const match = currentHosts.match(ANY_MANAGED_SECTION_RE);
  if (!match) return false;
  return match[0].trim() === buildManagedSection(domains).trim();
}

/** Full hosts content with the managed section (re)built for these domains. */
export function buildHostsContent(currentHosts: string, domains: string[]): string {
  const cleanHosts = currentHosts
    .replace(new RegExp(ANY_MANAGED_SECTION_RE.source, 'g'), '')
    .trim();
  return `${cleanHosts}\n\n${buildManagedSection(domains)}\n`;
}

/** Hosts content with the managed section removed. */
export function stripManagedSection(currentHosts: string): string {
  return (
    currentHosts
      .replace(new RegExp(ANY_MANAGED_SECTION_RE.source, 'g'), '')
      .trim() + '\n'
  );
}

export class DistractionBlocker {
  private activeDomains: string[] = [];
  private currentStrategy: BlockingStrategy = 'none';
  private isActive = false;

  constructor() {
    // Ensure clean state on startup
    this.cleanupOnExit();
  }

  isSelfControlInstalled(): boolean {
    return fs.existsSync(SELFCONTROL_CLI_PATH);
  }

  async isSelfControlRunning(): Promise<boolean> {
    if (!this.isSelfControlInstalled()) return false;
    try {
      const { stdout } = await execAsync(`"${SELFCONTROL_CLI_PATH}" is-running`);
      return stdout.trim().includes('YES');
    } catch {
      return false;
    }
  }

  async startBlocking(domains: string[], strategy: BlockingStrategy = 'dynamic_hosts'): Promise<{ success: boolean; error?: string }> {
    if (!Array.isArray(domains)) return { success: false, error: 'Invalid blocklist.' };
    domains = domains.filter((d) => typeof d === 'string' && d.trim()).slice(0, 500);
    if (domains.length === 0 || strategy === 'none') {
      await this.stopBlocking();
      return { success: true };
    }

    this.activeDomains = domains;
    this.currentStrategy = strategy;

    if (strategy === 'selfcontrol' && this.isSelfControlInstalled()) {
      return await this.startSelfControl(domains, 25);
    }

    return await this.applyHostsBlock(domains);
  }

  private async applyHostsBlock(domains: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      let currentHosts = '';
      if (fs.existsSync(HOSTS_FILE)) {
        currentHosts = fs.readFileSync(HOSTS_FILE, 'utf-8');
      }

      // Idempotent: identical content needs no privileged write at all, so a
      // second start request (timer view mounting right after session start,
      // restart with a surviving section, …) never shows another dialog.
      if (hostsAlreadyBlocked(currentHosts, domains)) {
        this.isActive = true;
        this.activeDomains = domains;
        return { success: true };
      }

      const newContent = buildHostsContent(currentHosts, domains);

      // Write to temp file first
      const tempPath = path.join('/tmp', `hosts_control_${Date.now()}`);
      fs.writeFileSync(tempPath, newContent, 'utf-8');

      // Try writing directly if permissions allow, else escalate exactly once.
      try {
        fs.writeFileSync(HOSTS_FILE, newContent, 'utf-8');
      } catch {
        // Requires root escalation — one dialog per call by construction.
        await runPrivilegedShell(privilegedCopyCommand(tempPath, HOSTS_FILE));
      }

      // Flush DNS
      try {
        await execAsync('dscacheutil -flushcache; killall -HUP mDNSResponder 2>/dev/null || true');
      } catch {}

      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {}

      this.isActive = true;
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Failed to apply hosts block:', msg);
      return { success: false, error: msg };
    }
  }

  async stopBlocking(): Promise<{ success: boolean; error?: string }> {
    try {
      if (fs.existsSync(HOSTS_FILE)) {
        const currentHosts = fs.readFileSync(HOSTS_FILE, 'utf-8');
        if (hasManagedSection(currentHosts)) {
          const cleanHosts = stripManagedSection(currentHosts);
          const tempPath = path.join('/tmp', `hosts_control_clean_${Date.now()}`);
          fs.writeFileSync(tempPath, cleanHosts, 'utf-8');

          try {
            fs.writeFileSync(HOSTS_FILE, cleanHosts, 'utf-8');
          } catch {
            await runPrivilegedShell(privilegedCopyCommand(tempPath, HOSTS_FILE));
          }

          try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          } catch {}
        }
      }

      try {
        await execAsync('dscacheutil -flushcache; killall -HUP mDNSResponder 2>/dev/null || true');
      } catch {}

      this.isActive = false;
      this.activeDomains = [];
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Failed to stop blocking:', msg);
      return { success: false, error: msg };
    }
  }

  async startSelfControl(domains: string[], minutes: number): Promise<{ success: boolean; error?: string }> {
    if (!Array.isArray(domains)) return { success: false, error: 'Invalid blocklist.' };
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
      return { success: false, error: 'Invalid duration (1–1440 minutes).' };
    }
    domains = domains.filter((d) => typeof d === 'string' && d.trim()).slice(0, 500);
    if (!this.isSelfControlInstalled()) {
      return { success: false, error: 'SelfControl.app is not installed at /Applications/SelfControl.app' };
    }

    try {
      const endDate = new Date(Date.now() + minutes * 60 * 1000).toISOString();
      const blocklistPath = path.join('/tmp', 'control_selfcontrol_blocklist.txt');
      fs.writeFileSync(blocklistPath, domains.join('\n'), 'utf-8');

      const cmd = `"${SELFCONTROL_CLI_PATH}" start --blocklist "${blocklistPath}" --enddate "${endDate}"`;
      await execAsync(cmd);
      this.isActive = true;
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }

  getStatus(): BlockerStatus {
    return {
      isActive: this.isActive,
      strategy: this.currentStrategy,
      blockedCount: this.activeDomains.length,
      blockedDomains: this.activeDomains,
      selfControlAvailable: this.isSelfControlInstalled(),
      hostsManageable: true,
    };
  }

  cleanupOnExit() {
    process.on('exit', () => {
      try {
        if (fs.existsSync(HOSTS_FILE)) {
          const currentHosts = fs.readFileSync(HOSTS_FILE, 'utf-8');
          const regex = new RegExp(`${BLOCK_START_MARKER}[\\s\\S]*?${BLOCK_END_MARKER}\n?`, 'g');
          if (regex.test(currentHosts)) {
            const cleanHosts = currentHosts.replace(regex, '').trim() + '\n';
            fs.writeFileSync(HOSTS_FILE, cleanHosts, 'utf-8');
          }
        }
      } catch {}
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AppBlocker: Native macOS Application Blocking Engine
// Kills running blocked apps and polls to re-kill them during control sessions
// ─────────────────────────────────────────────────────────────────────────────

const APP_SEARCH_DIRS = (): string[] => [
  '/Applications',
  '/Applications/Utilities',
  '/System/Applications',
  '/System/Applications/Utilities',
  path.join(os.homedir(), 'Applications'),
];

function appNameFromBundle(bundlePath: string, fallback: string): string {
  try {
    const plistPath = path.join(bundlePath, 'Contents', 'Info.plist');
    const text = fs.readFileSync(plistPath, 'utf-8');
    for (const key of ['CFBundleDisplayName', 'CFBundleName']) {
      const m = text.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`));
      if (m && m[1]) return m[1];
    }
  } catch {}
  return fallback;
}

export class AppBlocker {
  private activeApps: string[] = [];
  private isActive = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private cachedApps: InstalledAppInfo[] | null = null;
  private cachedAppsIcons = new Map<string, string>();
  private readonly POLL_INTERVAL_MS = 2000;

  async startBlocking(appNames: string[]): Promise<{ success: boolean; error?: string }> {
    if (!Array.isArray(appNames)) return { success: false, error: 'Invalid app list.' };
    appNames = appNames.filter((a) => typeof a === 'string').slice(0, 200);
    if (appNames.length === 0) {
      this.activeApps = [];
      this.isActive = false;
      this.stopPolling();
      return { success: true };
    }

    // Only block apps that actually exist on this laptop to avoid LaunchServices / browser tab search storms
    const installed = await this.listInstalledApps();
    const installedLookup = new Map<string, string>();
    for (const app of installed) {
      installedLookup.set(app.name.toLowerCase(), app.name);
      const baseName = path.basename(app.path).replace(/\.app$/i, '').toLowerCase();
      installedLookup.set(baseName, app.name);
    }

    const existingApps: string[] = [];
    for (const name of appNames) {
      const clean = name.replace(/\.app$/i, '').trim().toLowerCase();
      if (!clean) continue;
      if (installedLookup.has(clean)) {
        existingApps.push(installedLookup.get(clean)!);
      }
    }

    const uniqueApps = Array.from(new Set(existingApps));
    this.activeApps = uniqueApps;
    this.isActive = true;

    if (uniqueApps.length === 0) {
      this.stopPolling();
      return { success: true };
    }

    // Immediately kill any currently running blocked apps
    await this.killAllBlocked();

    // Start polling to catch apps that get relaunched
    this.startPolling();

    return { success: true };
  }

  async stopBlocking(): Promise<{ success: boolean; error?: string }> {
    this.isActive = false;
    this.activeApps = [];
    this.stopPolling();
    return { success: true };
  }

  private startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      if (this.isActive && this.activeApps.length > 0) {
        this.killAllBlocked().catch(() => {});
      }
    }, this.POLL_INTERVAL_MS);
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async killAllBlocked() {
    for (const appName of this.activeApps) {
      await this.killApp(appName).catch(() => {});
    }
  }

  private async killApp(appName: string): Promise<boolean> {
    const cleanName = appName.replace(/\.app$/i, '').trim();
    if (!cleanName || /[\x00-\x1f]/.test(cleanName) || cleanName.length > 120) return false;
    if (!/^[A-Za-z0-9 _+.\-]+$/.test(cleanName)) return false;

    // Safety check: is the app actually running right now? If not, do NOT touch it!
    const isRunning = await this.isAppRunning(cleanName);
    if (!isRunning) return true;

    try {
      // Use clean UNIX signals directly on the running process.
      // NEVER use `osascript -e 'quit app ...'` which triggers macOS LaunchServices
      // to resolve unknown/missing apps and open browser tabs.
      // NEVER use broad -fi pattern matching that can match browser tab URLs.
      const q = shellQuote(cleanName);
      const script =
        `killall -15 ${q} >/dev/null 2>&1 || ` +
        `pkill -15 -x ${q} >/dev/null 2>&1 || ` +
        `pkill -15 -f ${shellQuote(`/${cleanName}.app/Contents/MacOS/`)} >/dev/null 2>&1 || ` +
        `killall -9 ${q} >/dev/null 2>&1 || ` +
        `pkill -9 -x ${q} >/dev/null 2>&1 || ` +
        `pkill -9 -f ${shellQuote(`/${cleanName}.app/Contents/MacOS/`)} >/dev/null 2>&1 || ` +
        `true`;
      await execAsync(script);
      this.emitKill(cleanName);
      return true;
    } catch {
      return false;
    }
  };

  // ── Distraction-autopsy hook ──────────────────────────────────────────
  // Called once per app actually terminated while blocking is active, so the
  // main process can log what tried to pull the user away (see rooms/activity
  // note: site blocks are DNS-level and cannot observe attempts).
  private killListener: ((appName: string) => void) | null = null;

  /** Register (or clear with null) the kill listener. Rendered harmless when unset. */
  setKillListener(listener: ((appName: string) => void) | null): void {
    this.killListener = listener;
  }

  private emitKill(appName: string): void {
    if (!this.isActive) return;
    try {
      this.killListener?.(appName);
    } catch {
      /* listener must never break enforcement */
    }
  }

  async isAppRunning(appName: string): Promise<boolean> {
    const cleanName = appName.replace(/\.app$/i, '').trim();
    if (!cleanName || cleanName.length > 120 || !/^[A-Za-z0-9 _+.\-]+$/.test(cleanName)) return false;

    try {
      const { stdout } = await execAsync(
        `pgrep -x ${shellQuote(cleanName)} 2>/dev/null || pgrep -f ${shellQuote(`/${cleanName}.app/Contents/MacOS/`)} 2>/dev/null || true`
      );
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  async getRunningApps(): Promise<string[]> {
    const running: string[] = [];
    for (const app of this.activeApps) {
      if (await this.isAppRunning(app)) {
        running.push(app);
      }
    }
    return running;
  }

  // ── Installed app discovery (Spotlight-powered + filesystem merge) ──────

  async listInstalledApps(): Promise<InstalledAppInfo[]> {
    if (this.cachedApps) return this.cachedApps;

    let apps: InstalledAppInfo[] = [];

    // 1. Filesystem scan of standard app directories
    for (const dir of APP_SEARCH_DIRS()) {
      try {
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir)) {
          if (entry.endsWith('.app')) {
            const appPath = path.join(dir, entry);
            const fallback = entry.replace(/\.app$/i, '');
            apps.push({
              name: appNameFromBundle(appPath, fallback),
              path: appPath,
            });
          }
        }
      } catch {}
    }

    // 2. Spotlight search merge
    try {
      const { stdout } = await withTimeout(
        execAsync(`mdfind "kMDItemContentType == 'com.apple.application-bundle'" 2>/dev/null`),
        5000
      );
      const paths = stdout.split('\n').filter((p) => p.trim().endsWith('.app'));
      for (const appPath of paths) {
        const fallback = path.basename(appPath).replace(/\.app$/i, '');
        apps.push({
          name: appNameFromBundle(appPath, fallback),
          path: appPath,
        });
      }
    } catch {}

    // Deduplicate and sort
    const seen = new Set<string>();
    apps = apps
      .filter((a) => {
        if (seen.has(a.path)) return false;
        seen.add(a.path);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    this.cachedApps = apps;
    return apps;
  }

  async searchInstalledApps(query: string): Promise<InstalledAppInfo[]> {
    if (typeof query !== 'string') query = '';
    const apps = await this.listInstalledApps();
    const q = query.trim().toLowerCase();
    const results = q ? apps.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 10) : apps.slice(0, 10);

    // Attach real app icons (data URLs) by extracting the embedded PNG from
    // each bundle's .icns. Reuse cached icons where possible to keep the
    // search snappy.
    await Promise.all(
      results.map(async (result) => {
        try {
          const cached = this.cachedAppsIcons.get(result.path);
          if (cached !== undefined) {
            result.icon = cached;
            return;
          }
          const icon = pngFromBundle(result.path);
          result.icon = icon || '';
          this.cachedAppsIcons.set(result.path, result.icon);
        } catch {
          this.cachedAppsIcons.set(result.path, '');
        }
      })
    );

    return results;
  }

  getStatus(): AppBlockerStatus {
    return {
      isActive: this.isActive,
      blockedApps: this.activeApps,
      blockedCount: this.activeApps.length,
    };
  }
}

export const appBlocker = new AppBlocker();
export const blocker = new DistractionBlocker();
