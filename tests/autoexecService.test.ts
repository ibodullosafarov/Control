import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface HoistedMocks {
  notifications: Array<{
    opts: { title: string; body: string };
    shown: boolean;
    handlers: Record<string, Array<() => void>>;
  }>;
  ipcHandlers: Map<string, (...args: Array<unknown>) => unknown>;
  sentMessages: Array<{ channel: string; payload: unknown }>;
}

const { notifications, ipcHandlers, sentMessages } = vi.hoisted<HoistedMocks>(() => ({
  notifications: [],
  ipcHandlers: new Map(),
  sentMessages: [],
}));

vi.mock('electron', () => {
  class MockNotification {
    static isSupported = () => true;
    opts: { title: string; body: string };
    shown = false;
    handlers: Record<string, Array<() => void>> = {};
    constructor(opts: { title: string; body: string }) {
      this.opts = opts;
      notifications.push(this as unknown as (typeof notifications)[number]);
    }
    show() {
      this.shown = true;
    }
    on(evt: string, cb: () => void) {
      (this.handlers[evt] = this.handlers[evt] || []).push(cb);
    }
  }
  return {
    BrowserWindow: class {},
    Notification: MockNotification,
    ipcMain: {
      handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
        ipcHandlers.set(channel, fn);
      }),
    },
    powerMonitor: { on: vi.fn() },
  };
});

import { AutoExecService } from '../electron/autoexec';
import { ControlAppData, ScheduleBlock, StudyMode } from '../src/types';

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'control-autoexec-svc-'));
  tmpDirs.push(dir);
  return dir;
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function atToday(h: number, m: number): number {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function makeMode(): StudyMode {
  return {
    id: 'm1', name: 'Deep Work', description: 'd', icon: 'target', color: '#38bdf8',
    workDuration: 50, breakDuration: 10, cycles: 1, longBreakDuration: 20, longBreakInterval: 4,
    blocklist: [], blockedApps: [], allowlist: [], allowBreakWebsites: true, countTowardStats: true,
    isChillMode: false, blockingStrategy: 'none', order: 0, createdAt: '',
  };
}

function makeBlock(id: string, start: string, end: string): ScheduleBlock {
  return {
    id, date: localToday(), startTime: start, endTime: end,
    modeId: 'm1', modeName: `Block ${id}`, modeIcon: 'target', modeColor: '#38bdf8',
    workDuration: 50, breakDuration: 10, cycles: 1, status: 'approved',
  };
}

function makeData(blocks: ScheduleBlock[], enabled = true): ControlAppData {
  return {
    modes: [makeMode()],
    sessions: [],
    tasks: [],
    activeSession: null,
    settings: {
      theme: 'serika', soundEnabled: true, soundVolume: 0.5, launchAtLogin: false,
      autoStartBreaks: true, autoStartWork: true, defaultModeId: 'm1',
      blockingEnabled: false, blockingStrategy: 'none',
      googleCalendar: { connected: false, calendarId: 'primary' },
      minimalModeOnControl: false,
      autoExecute: { enabled, notifyLeadMinutes: 5 },
    } as ControlAppData['settings'],
    plans: {
      [localToday()]: {
        date: localToday(), goals: [], timeWindows: [], blocks,
        isApproved: true, updatedAt: '',
      },
    },
  };
}

interface Harness {
  service: AutoExecService;
  dir: string;
  data: { current: ControlAppData };
  ackStart: (started?: boolean, reason?: string) => Promise<void>;
  ackEnd: (ended?: boolean) => Promise<void>;
  records: () => Record<string, Record<string, unknown>>;
}

function setup(blocks: ScheduleBlock[], enabled = true): Harness {
  const dir = tmpDir();
  const data = { current: makeData(blocks, enabled) };
  const webContents = {
    send: vi.fn((channel: string, payload: unknown) => {
      sentMessages.push({ channel, payload });
    }),
  };
  const service = new AutoExecService({
    dataDir: dir,
    getData: () => data.current,
    getWindow: () => ({ isDestroyed: () => false, webContents }) as unknown as import('electron').BrowserWindow,
    showWindow: vi.fn(),
  });
  service.registerIpc();
  service.start();

  const lastPayload = (channel: string) =>
    [...sentMessages].reverse().find((m) => m.channel === channel)?.payload as
      | { requestId: string; blockId: string; date: string }
      | undefined;

  return {
    service,
    dir,
    data,
    ackStart: async (started = true, reason?: string) => {
      const payload = lastPayload('control:autoExec:start');
      expect(payload).toBeDefined();
      const fn = ipcHandlers.get('control:autoExec:startResult');
      expect(fn).toBeDefined();
      await fn!(undefined, { success: true, started, ...(reason ? { reason } : {}) }, payload!.requestId);
      await vi.advanceTimersByTimeAsync(0);
    },
    ackEnd: async (ended = true) => {
      const payload = lastPayload('control:autoExec:end');
      expect(payload).toBeDefined();
      const fn = ipcHandlers.get('control:autoExec:endResult');
      expect(fn).toBeDefined();
      await fn!(undefined, { success: true, ended }, payload!.requestId);
      await vi.advanceTimersByTimeAsync(0);
    },
    records: () => {
      const file = path.join(dir, 'autoexec', 'state.json');
      if (!fs.existsSync(file)) return {};
      return (JSON.parse(fs.readFileSync(file, 'utf-8')) as { records: Record<string, Record<string, unknown>> }).records;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  notifications.length = 0;
  ipcHandlers.clear();
  sentMessages.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('AutoExecService scheduling', () => {
  it('notifies once at lead time and starts at the scheduled time', async () => {
    vi.setSystemTime(atToday(13, 0));
    const h = setup([makeBlock('b1', '14:00', '15:00')]);
    await vi.advanceTimersByTimeAsync(4000); // startup reconcile

    // 13:55 — the reminder fires exactly once through the real mechanism.
    await vi.advanceTimersByTimeAsync(55 * 60_000);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].shown).toBe(true);
    expect(notifications[0].opts.body).toContain('Block b1');
    expect(notifications[0].opts.body).toContain('5 minutes');
    expect(h.records()['b1|' + localToday() + '|14:00'].notifiedAt).toBeDefined();

    // No duplicate while the window is still open.
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(notifications).toHaveLength(1);

    // 14:00 — start request carries block identity + request id.
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    const start = sentMessages.filter((m) => m.channel === 'control:autoExec:start');
    expect(start).toHaveLength(1);
    const payload = start[0].payload as { blockId: string; date: string; requestId: string };
    expect(payload.blockId).toBe('b1');
    expect(payload.date).toBe(localToday());
    expect(payload.requestId).toMatch(/^start-/);

    await h.ackStart(true);
    expect(h.records()['b1|' + localToday() + '|14:00'].startedAt).toBeDefined();

    // No second start while running.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(sentMessages.filter((m) => m.channel === 'control:autoExec:start')).toHaveLength(1);

    // 15:00 — end request; ack completes the occurrence.
    await vi.advanceTimersByTimeAsync(50 * 60_000);
    expect(sentMessages.filter((m) => m.channel === 'control:autoExec:end')).toHaveLength(1);
    await h.ackEnd(true);
    expect(h.records()['b1|' + localToday() + '|14:00'].endedAt).toBeDefined();
    h.service.stop();
  });

  it('does nothing while disabled', async () => {
    vi.setSystemTime(atToday(13, 0));
    const h = setup([makeBlock('b1', '14:00', '15:00')], false);
    await vi.advanceTimersByTimeAsync(3 * 3600_000);
    expect(notifications).toHaveLength(0);
    expect(sentMessages).toHaveLength(0);
    expect(h.records()).toEqual({});
    h.service.stop();
  });

  it('records a renderer decline as skipped (manual session wins)', async () => {
    vi.setSystemTime(atToday(13, 59));
    const h = setup([makeBlock('b1', '14:00', '15:00')]);
    await vi.advanceTimersByTimeAsync(4000 + 60_000 + 1000);
    await h.ackStart(false, 'session-active');
    const rec = h.records()['b1|' + localToday() + '|14:00'];
    expect(rec.skippedAt).toBeDefined();
    expect(rec.skipReason).toBe('session-active');
    // Terminal: no retries later.
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(sentMessages.filter((m) => m.channel === 'control:autoExec:start')).toHaveLength(1);
    h.service.stop();
  });

  it('invalidates a rescheduled event and never fires the old time', async () => {
    vi.setSystemTime(atToday(13, 0));
    const h = setup([makeBlock('b1', '14:00', '15:00')]);
    await vi.advanceTimersByTimeAsync(4000);
    // Move the event to 16:00 before anything fires.
    h.data.current = makeData([makeBlock('b1', '16:00', '17:00')]);
    h.service.onLocalDataSaved();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.records()[`b1|${localToday()}|14:00`]).toBeUndefined();
    // Old slot passes silently; new slot notifies + starts.
    await vi.advanceTimersByTimeAsync(61 * 60_000);
    expect(notifications).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2 * 3600_000);
    const starts = sentMessages.filter((m) => m.channel === 'control:autoExec:start');
    expect(starts).toHaveLength(1);
    h.service.stop();
  });

  it('recovers across restarts without duplicates or stale fires', async () => {
    vi.setSystemTime(atToday(13, 0));
    // Simulate: notify fired, then app quit before the start.
    const h1 = setup([makeBlock('b1', '14:00', '15:00')]);
    await vi.advanceTimersByTimeAsync(4000 + 55 * 60_000);
    expect(notifications).toHaveLength(1);
    const before = { ...h1.records() };
    h1.service.stop();

    // "Restart": brand-new service, same state file, clock past start+grace.
    notifications.length = 0;
    sentMessages.length = 0;
    const data = { current: makeData([makeBlock('b1', '14:00', '15:00')]) };
    const webContents = { send: vi.fn((c: string, p: unknown) => sentMessages.push({ channel: c, payload: p })) };
    const second = new AutoExecService({
      dataDir: h1.dir,
      getData: () => data.current,
      getWindow: () => ({ isDestroyed: () => false, webContents }) as unknown as import('electron').BrowserWindow,
      showWindow: vi.fn(),
    });
    second.registerIpc();
    second.start();
    vi.setSystemTime(atToday(14, 30));
    await vi.advanceTimersByTimeAsync(4000 + 65_000);
    // No duplicate notification, no late start — terminal skip instead.
    expect(notifications).toHaveLength(0);
    expect(sentMessages.filter((m) => m.channel === 'control:autoExec:start')).toHaveLength(0);
    const recs = JSON.parse(
      fs.readFileSync(path.join(h1.dir, 'autoexec', 'state.json'), 'utf-8')
    ) as { records: Record<string, { skippedAt?: string; skipReason?: string }> };
    const rec = recs.records[`b1|${localToday()}|14:00`];
    expect(rec.skippedAt).toBeDefined();
    expect(rec.skipReason).toBe('missed');
    expect(before[`b1|${localToday()}|14:00`].notifiedAt).toBeDefined();
    second.stop();
  });
});
