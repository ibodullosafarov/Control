import * as net from 'node:net';
import * as os from 'node:os';

export interface RoomTimerState {
  phase: 'work' | 'break' | 'idle';
  label: string;
  endsAt: number | null;
  updatedAt: number;
}

export interface RoomPeer {
  id: string;
  name: string;
}

const MAX_FRAME_BYTES = 64 * 1024;

function unrefTimer(t: ReturnType<typeof setInterval>): void {
  const maybe = t as unknown as { unref?: () => void };
  if (typeof maybe.unref === 'function') maybe.unref();
}

function sendFrame(socket: net.Socket, msg: unknown): void {
  try {
    socket.write(JSON.stringify(msg) + '\n');
  } catch {
    // Socket already gone; callers treat sends as best-effort.
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isRoomTimerState(v: unknown): v is RoomTimerState {
  if (!isRecord(v)) return false;
  if (typeof v['label'] === 'string' && (v['label'] as string).length > 200) return false;
  if (v['phase'] !== 'work' && v['phase'] !== 'break' && v['phase'] !== 'idle') return false;
  if (typeof v['label'] !== 'string') return false;
  if (typeof v['updatedAt'] !== 'number') return false;
  const endsAt: unknown = v['endsAt'];
  if (endsAt !== null && typeof endsAt !== 'number') return false;
  return true;
}

function isStateOrNull(v: unknown): v is RoomTimerState | null {
  return v === null || isRoomTimerState(v);
}

/** Split newly arrived chunk data into complete newline-delimited lines. */
function appendLines(buffer: string, chunk: string): { lines: string[]; rest: string } {
  const combined = buffer + chunk;
  const parts = combined.split('\n');
  const rest = parts.pop() ?? '';
  return { lines: parts, rest };
}

function frameTooBig(line: string): boolean {
  return Buffer.byteLength(line, 'utf8') > MAX_FRAME_BYTES;
}

function parsePeers(v: unknown): RoomPeer[] {
  if (!Array.isArray(v)) return [];
  const out: RoomPeer[] = [];
  for (const entry of v) {
    if (isRecord(entry) && typeof entry['id'] === 'string' && typeof entry['name'] === 'string') {
      out.push({ id: entry['id'], name: entry['name'] });
    }
  }
  return out;
}

function parseStates(v: unknown): Record<string, RoomTimerState | null> {
  const out: Record<string, RoomTimerState | null> = {};
  if (!isRecord(v)) return out;
  for (const key of Object.keys(v)) {
    const val: unknown = v[key];
    out[key] = isStateOrNull(val) ? val : null;
  }
  return out;
}

export function localAddresses(): string[] {
  const out: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    const addrs = ifaces[name];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.internal) continue;
      if (addr.family !== 'IPv4') continue;
      out.push(addr.address);
    }
  }
  return out;
}

export interface CreateRoomServerOpts {
  port?: number;
  room: string;
  hostName: string;
  getState: () => RoomTimerState | null;
  heartbeatIntervalMs?: number;
  peerTimeoutMs?: number;
  onEvent?: (e: string) => void;
  /** Fired with the full roster every time it is broadcast (join/leave/state). */
  onRoster?: (peers: RoomPeer[], states: Record<string, RoomTimerState | null>) => void;
}

export interface RoomServer {
  port: number;
  peerCount: () => number;
  setHostState: (s: RoomTimerState | null) => void;
  close: () => Promise<void>;
}

interface ServerPeer {
  socket: net.Socket;
  name: string;
  state: RoomTimerState | null;
  lastSeen: number;
}

export function createRoomServer(opts: CreateRoomServerOpts): RoomServer {
  const heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 5000;
  const peerTimeoutMs = opts.peerTimeoutMs ?? 12000;
  const onEvent = opts.onEvent;

  let currentHostState: RoomTimerState | null = null;
  try {
    currentHostState = opts.getState();
  } catch {
    currentHostState = null;
  }

  const peers = new Map<string, ServerPeer>();
  let nextId = 1;
  let closed = false;
  let actualPort = opts.port ?? 0;

  const server = net.createServer();

  function rosterPeers(): RoomPeer[] {
    const list: RoomPeer[] = [{ id: 'host', name: opts.hostName }];
    for (const [id, p] of peers) list.push({ id, name: p.name });
    return list;
  }

  function rosterStates(): Record<string, RoomTimerState | null> {
    const states: Record<string, RoomTimerState | null> = { host: currentHostState };
    for (const [id, p] of peers) states[id] = p.state;
    return states;
  }

  function broadcastRoster(): void {
    if (closed) return;
    const roster = rosterPeers();
    const states = rosterStates();
    try {
      opts.onRoster?.(roster, states);
    } catch {
      // Observer must never break broadcasting.
    }
    const msg = { v: 1, type: 'roster', peers: roster, states };
    for (const p of peers.values()) sendFrame(p.socket, msg);
  }

  function removePeer(peerId: string, reason: string): void {
    const entry = peers.get(peerId);
    if (!entry) return;
    peers.delete(peerId);
    try {
      entry.socket.destroy();
    } catch {
      // Already gone.
    }
    if (!closed) {
      if (onEvent) onEvent(`leave:${peerId}:${reason}`);
      broadcastRoster();
    }
  }

  server.on('error', (err: Error) => {
    if (onEvent) onEvent(`error:${err.message}`);
  });

  server.on('connection', (socket: net.Socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    let peerId: string | null = null;
    let malformed = 0;

    const noteMalformed = (kind: string): void => {
      malformed += 1;
      if (onEvent) onEvent(`malformed:${kind}:${malformed}`);
    };

    const handleLine = (line: string): void => {
      if (line.length === 0) return;
      if (frameTooBig(line)) {
        noteMalformed('oversize');
        return;
      }
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        noteMalformed('json');
        return;
      }
      if (!isRecord(msg) || msg['v'] !== 1 || typeof msg['type'] !== 'string') {
        noteMalformed('shape');
        return;
      }
      const now = Date.now();
      switch (msg['type'] as string) {
        case 'hello': {
          if (peerId !== null) {
            // Reject second hello from the same socket.
            noteMalformed('hello-dup');
            return;
          }
          const name = typeof msg['name'] === 'string' && msg['name'].length > 0 ? msg['name'] : 'peer';
          peerId = `p${nextId++}`;
          peers.set(peerId, { socket, name, state: null, lastSeen: now });
          if (onEvent) onEvent(`join:${peerId}`);
          sendFrame(socket, {
            v: 1,
            type: 'welcome',
            room: opts.room,
            peerId,
            roster: rosterPeers(),
            state: currentHostState,
          });
          broadcastRoster();
          break;
        }
        case 'heartbeat': {
          if (peerId !== null) {
            const entry = peers.get(peerId);
            if (entry) entry.lastSeen = now;
          }
          break;
        }
        case 'state': {
          if (peerId === null) return;
          const entry = peers.get(peerId);
          if (!entry) return;
          if (!isStateOrNull(msg['state'])) {
            noteMalformed('state');
            return;
          }
          entry.state = msg['state'];
          entry.lastSeen = now;
          broadcastRoster();
          break;
        }
        case 'bye': {
          if (peerId !== null) removePeer(peerId, 'bye');
          break;
        }
        default:
          noteMalformed('unknown-type');
          break;
      }
    };

    socket.on('data', (chunk: string) => {
      const { lines, rest } = appendLines(buffer, chunk);
      buffer = rest;
      if (frameTooBig(buffer)) {
        // The in-progress line already exceeds the cap; drop it wholesale.
        buffer = '';
        noteMalformed('oversize-buffer');
      }
      for (const line of lines) {
        if (closed) return;
        handleLine(line);
      }
    });

    socket.on('error', () => {
      // 'close' follows and performs cleanup; nothing to do here.
    });

    socket.on('close', () => {
      if (peerId !== null) removePeer(peerId, 'close');
    });
  });

  const sweep = setInterval(() => {
    if (closed) return;
    const now = Date.now();
    const stale: string[] = [];
    for (const [id, p] of peers) {
      if (now - p.lastSeen > peerTimeoutMs) stale.push(id);
    }
    for (const id of stale) removePeer(id, 'timeout');
    if (!closed) {
      for (const p of peers.values()) sendFrame(p.socket, { v: 1, type: 'heartbeat' });
    }
  }, heartbeatIntervalMs);
  unrefTimer(sweep);

  // Bind all interfaces so other Macs on the LAN can join.
  // (Guests connect to one of localAddresses(); 127.0.0.1 keeps working too.)
  server.listen(opts.port ?? 0, '0.0.0.0', () => {
    const addr = server.address();
    if (addr !== null && typeof addr === 'object') actualPort = addr.port;
  });

  return {
    get port(): number {
      return actualPort;
    },
    peerCount: (): number => peers.size,
    setHostState: (s: RoomTimerState | null): void => {
      currentHostState = s;
      broadcastRoster();
    },
    close: (): Promise<void> => {
      closed = true;
      clearInterval(sweep);
      for (const [, p] of peers) {
        try {
          p.socket.destroy();
        } catch {
          // Ignore.
        }
      }
      peers.clear();
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

export interface JoinRoomOpts {
  host: string;
  port: number;
  name: string;
  onRoster: (peers: RoomPeer[], states: Record<string, RoomTimerState | null>) => void;
  onWelcome?: (room: string) => void;
  onClose?: () => void;
  heartbeatIntervalMs?: number;
}

export interface RoomClient {
  sendState: (s: RoomTimerState | null) => void;
  close: () => void;
}

export function joinRoom(opts: JoinRoomOpts): RoomClient {
  const socket = net.createConnection({ host: opts.host, port: opts.port });
  socket.setEncoding('utf8');
  const heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 5000;
  let buffer = '';
  let closed = false;
  let closeFired = false;

  const fireClose = (): void => {
    if (closeFired) return;
    closeFired = true;
    if (opts.onClose) opts.onClose();
  };

  sendFrame(socket, { v: 1, type: 'hello', name: opts.name });

  const hb = setInterval(() => {
    if (!closed) sendFrame(socket, { v: 1, type: 'heartbeat' });
  }, heartbeatIntervalMs);
  unrefTimer(hb);

  const handleLine = (line: string): void => {
    if (line.length === 0) return;
    if (frameTooBig(line)) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(msg) || msg['v'] !== 1 || typeof msg['type'] !== 'string') return;
    switch (msg['type'] as string) {
      case 'welcome': {
        if (typeof msg['room'] === 'string' && opts.onWelcome) opts.onWelcome(msg['room']);
        const peers = parsePeers(msg['roster']);
        const states: Record<string, RoomTimerState | null> = {};
        for (const p of peers) states[p.id] = null;
        opts.onRoster(peers, states);
        break;
      }
      case 'roster': {
        opts.onRoster(parsePeers(msg['peers']), parseStates(msg['states']));
        break;
      }
      default:
        break;
    }
  };

  socket.on('data', (chunk: string) => {
    const { lines, rest } = appendLines(buffer, chunk);
    buffer = rest;
    if (frameTooBig(buffer)) buffer = '';
    for (const line of lines) {
      if (closed) return;
      handleLine(line);
    }
  });

  socket.on('error', () => {
    // 'close' follows; onClose fires there.
  });

  socket.on('close', () => {
    clearInterval(hb);
    fireClose();
  });

  return {
    sendState: (s: RoomTimerState | null): void => {
      if (!closed) sendFrame(socket, { v: 1, type: 'state', state: s });
    },
    close: (): void => {
      if (closed) return;
      closed = true;
      clearInterval(hb);
      try {
        socket.write(JSON.stringify({ v: 1, type: 'bye' }) + '\n', () => {
          try {
            socket.destroy();
          } catch {
            // Ignore.
          }
        });
      } catch {
        try {
          socket.destroy();
        } catch {
          // Ignore.
        }
      }
    },
  };
}
