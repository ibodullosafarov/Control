import * as net from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  createRoomServer,
  joinRoom,
  localAddresses,
  type RoomPeer,
  type RoomTimerState,
} from '../electron/rooms/net';

type States = Record<string, RoomTimerState | null>;

function pollUntil(cond: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      let ok = false;
      try {
        ok = cond();
      } catch (e) {
        reject(e);
        return;
      }
      if (ok) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`timed out waiting for: ${label}`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function makeState(label: string): RoomTimerState {
  return { phase: 'work', label, endsAt: null, updatedAt: Date.now() };
}

interface RosterCapture {
  peers: RoomPeer[];
  states: States;
}

function capture(): { list: RosterCapture[]; latest: () => RosterCapture | undefined; fn: (peers: RoomPeer[], states: States) => void } {
  const list: RosterCapture[] = [];
  return {
    list,
    latest: () => list[list.length - 1],
    fn: (peers: RoomPeer[], states: States) => {
      list.push({ peers, states });
    },
  };
}

describe('rooms net', () => {
  it('welcomes two clients and tracks peerCount', async () => {
    const server = createRoomServer({
      port: 0,
      room: 'room-1',
      hostName: 'Host',
      getState: () => null,
      heartbeatIntervalMs: 100,
      peerTimeoutMs: 400,
    });
    await pollUntil(() => server.port > 0, 5000, 'server port');
    const welcomes: string[] = [];
    const c1cap = capture();
    const c2cap = capture();
    const c1 = joinRoom({
      host: '127.0.0.1',
      port: server.port,
      name: 'Alice',
      onRoster: c1cap.fn,
      onWelcome: (room) => welcomes.push(room),
      heartbeatIntervalMs: 100,
    });
    const c2 = joinRoom({
      host: '127.0.0.1',
      port: server.port,
      name: 'Bob',
      onRoster: c2cap.fn,
      onWelcome: (room) => welcomes.push(room),
      heartbeatIntervalMs: 100,
    });
    try {
      await pollUntil(() => welcomes.length === 2, 10000, 'both welcomes');
      expect(welcomes).toEqual(['room-1', 'room-1']);
      await pollUntil(() => server.peerCount() === 2, 10000, 'peerCount 2');
      expect(server.peerCount()).toBe(2);
      expect(Array.isArray(localAddresses())).toBe(true);
    } finally {
      c1.close();
      c2.close();
      await server.close();
    }
  }, 10000);

  it('propagates host setHostState to both clients', async () => {
    const server = createRoomServer({
      port: 0,
      room: 'room-2',
      hostName: 'Host',
      getState: () => null,
      heartbeatIntervalMs: 100,
      peerTimeoutMs: 400,
    });
    await pollUntil(() => server.port > 0, 5000, 'server port');
    const c1cap = capture();
    const c2cap = capture();
    const c1 = joinRoom({
      host: '127.0.0.1',
      port: server.port,
      name: 'Alice',
      onRoster: c1cap.fn,
      heartbeatIntervalMs: 100,
    });
    const c2 = joinRoom({
      host: '127.0.0.1',
      port: server.port,
      name: 'Bob',
      onRoster: c2cap.fn,
      heartbeatIntervalMs: 100,
    });
    try {
      await pollUntil(() => server.peerCount() === 2, 10000, 'peerCount 2');
      server.setHostState(makeState('host-control'));
      await pollUntil(() => c1cap.latest()?.states['host']?.label === 'host-control', 10000, 'c1 sees host state');
      await pollUntil(() => c2cap.latest()?.states['host']?.label === 'host-control', 10000, 'c2 sees host state');
      expect(c1cap.latest()?.states['host']?.phase).toBe('work');
      expect(c2cap.latest()?.states['host']?.phase).toBe('work');
    } finally {
      c1.close();
      c2.close();
      await server.close();
    }
  }, 10000);

  it('propagates one client sendState to the other client', async () => {
    const server = createRoomServer({
      port: 0,
      room: 'room-3',
      hostName: 'Host',
      getState: () => null,
      heartbeatIntervalMs: 100,
      peerTimeoutMs: 400,
    });
    await pollUntil(() => server.port > 0, 5000, 'server port');
    const c2cap = capture();
    const c1 = joinRoom({
      host: '127.0.0.1',
      port: server.port,
      name: 'Alice',
      onRoster: () => {},
      heartbeatIntervalMs: 100,
    });
    const c2 = joinRoom({
      host: '127.0.0.1',
      port: server.port,
      name: 'Bob',
      onRoster: c2cap.fn,
      heartbeatIntervalMs: 100,
    });
    try {
      await pollUntil(() => server.peerCount() === 2, 10000, 'peerCount 2');
      c1.sendState(makeState('alice-control'));
      await pollUntil(
        () =>
          Object.entries(c2cap.latest()?.states ?? {}).some(
            ([id, s]) => id !== 'host' && s?.label === 'alice-control',
          ),
        10000,
        'c2 sees alice state',
      );
    } finally {
      c1.close();
      c2.close();
      await server.close();
    }
  }, 10000);

  it('graceful close decrements peers and fires onClose', async () => {
    const server = createRoomServer({
      port: 0,
      room: 'room-4',
      hostName: 'Host',
      getState: () => null,
      heartbeatIntervalMs: 100,
      peerTimeoutMs: 400,
    });
    await pollUntil(() => server.port > 0, 5000, 'server port');
    let c1Closed = false;
    const c1 = joinRoom({
      host: '127.0.0.1',
      port: server.port,
      name: 'Alice',
      onRoster: () => {},
      onClose: () => {
        c1Closed = true;
      },
      heartbeatIntervalMs: 100,
    });
    const c2 = joinRoom({
      host: '127.0.0.1',
      port: server.port,
      name: 'Bob',
      onRoster: () => {},
      heartbeatIntervalMs: 100,
    });
    try {
      await pollUntil(() => server.peerCount() === 2, 10000, 'peerCount 2');
      c1.close();
      await pollUntil(() => server.peerCount() === 1, 10000, 'peerCount 1 after bye');
      expect(server.peerCount()).toBe(1);
      await pollUntil(() => c1Closed, 10000, 'c1 onClose');
      expect(c1Closed).toBe(true);
    } finally {
      c2.close();
      await server.close();
    }
  }, 10000);

  it('survives a malformed frame and still welcomes', async () => {
    const events: string[] = [];
    const server = createRoomServer({
      port: 0,
      room: 'room-5',
      hostName: 'Host',
      getState: () => null,
      heartbeatIntervalMs: 100,
      peerTimeoutMs: 400,
      onEvent: (e) => events.push(e),
    });
    await pollUntil(() => server.port > 0, 5000, 'server port');
    const raw = net.createConnection({ host: '127.0.0.1', port: server.port });
    raw.setEncoding('utf8');
    let received = '';
    raw.on('data', (chunk: string) => {
      received += chunk;
    });
    const rawClosed = new Promise<void>((resolve) => raw.on('close', () => resolve()));
    try {
      await new Promise<void>((resolve, reject) => {
        raw.on('connect', () => resolve());
        raw.on('error', (e) => reject(e));
      });
      raw.write('this is not json{{{\n');
      raw.write(JSON.stringify({ v: 1, type: 'hello', name: 'Raw' }) + '\n');
      await pollUntil(() => received.includes('"welcome"'), 10000, 'welcome after garbage');
      expect(received).toContain('room-5');
      await pollUntil(() => server.peerCount() === 1, 10000, 'peerCount 1');
      // Server still healthy: a normal client can join afterwards.
      const welcomes: string[] = [];
      const c = joinRoom({
        host: '127.0.0.1',
        port: server.port,
        name: 'After',
        onRoster: () => {},
        onWelcome: (room) => welcomes.push(room),
        heartbeatIntervalMs: 100,
      });
      try {
        await pollUntil(() => welcomes.length === 1, 10000, 'post-garbage welcome');
        expect(welcomes[0]).toBe('room-5');
      } finally {
        c.close();
      }
    } finally {
      raw.destroy();
      await rawClosed.catch(() => {});
      await server.close();
    }
  }, 10000);
});
