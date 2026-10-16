import { execFile } from 'child_process';

/**
 * Optional frontmost-app tracker (feature 1: automatic time tracking).
 *
 * Off by default. When enabled it samples the frontmost application name
 * every SAMPLE_INTERVAL_MS and reports change-points to a listener. The
 * renderer owns persistence (caps + retention live in storage.ts).
 *
 * Implementation note: reading the frontmost app uses `System Events` via
 * osascript, which prompts for Automation permission on first use — one
 * reason this stays behind an explicit settings toggle.
 */
export interface ActivityPoint {
  /** Epoch ms of the sample. */
  t: number;
  /** Frontmost application name, e.g. "Xcode". */
  app: string;
}

const SAMPLE_INTERVAL_MS = 30_000;
const OSASCRIPT_TIMEOUT_MS = 8_000;

function readFrontmostApp(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'osascript',
      ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'],
      { timeout: OSASCRIPT_TIMEOUT_MS },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const name = String(stdout || '').trim();
        resolve(name || null);
      }
    );
  });
}

export class ActivityTracker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastApp: string | null = null;
  private listener: ((point: ActivityPoint) => void) | null = null;

  get running(): boolean {
    return this.timer !== null;
  }

  setListener(listener: ((point: ActivityPoint) => void) | null): void {
    this.listener = listener;
  }

  start(): void {
    if (this.timer) return;
    void this.sample();
    this.timer = setInterval(() => {
      void this.sample();
    }, SAMPLE_INTERVAL_MS);
    if (typeof this.timer === 'object' && this.timer !== null) {
      (this.timer as unknown as { unref?: () => void }).unref?.();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.lastApp = null;
  }

  private async sample(): Promise<void> {
    const app = await readFrontmostApp().catch(() => null);
    if (!app) return;
    if (app === this.lastApp) return;
    this.lastApp = app;
    try {
      this.listener?.({ t: Date.now(), app });
    } catch {
      /* listener must never break the poller */
    }
  }
}

export const activityTracker = new ActivityTracker();
