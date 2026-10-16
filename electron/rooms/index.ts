import {
  createRoomServer,
  joinRoom,
  localAddresses,
  RoomClient,
  RoomPeer,
  RoomServer,
  RoomTimerState,
} from './net';

export type { RoomPeer, RoomTimerState };

export interface RoomsStatus {
  hosting: boolean;
  room: string | null;
  port: number | null;
  connected: boolean;
  joinedRoom: string | null;
  peers: RoomPeer[];
  states: Record<string, RoomTimerState | null>;
  localIps: string[];
}

export type RoomsEvent =
  | { kind: 'roster'; peers: RoomPeer[]; states: Record<string, RoomTimerState | null> }
  | { kind: 'status' }
  | { kind: 'error'; error: string };

const DEFAULT_PORT = 47291;

/**
 * Owns at most one room role at a time (host XOR guest). The renderer's
 * published timer state is pushed into whichever role is active.
 */
export class RoomsCoordinator {
  private server: RoomServer | null = null;
  private client: RoomClient | null = null;
  private emit: (e: RoomsEvent) => void;
  private peers: RoomPeer[] = [];
  private states: Record<string, RoomTimerState | null> = {};
  private hostState: RoomTimerState | null = null;
  private guestState: RoomTimerState | null = null;
  private roomName = '';
  private port: number | null = null;
  private joinedRoom: string | null = null;
  private lastError: string | null = null;

  constructor(emit: (e: RoomsEvent) => void) {
    this.emit = emit;
  }

  status(): RoomsStatus {
    return {
      hosting: this.server !== null,
      room: this.server ? this.roomName : null,
      port: this.port,
      connected: this.client !== null,
      joinedRoom: this.joinedRoom,
      peers: this.peers,
      states: this.states,
      localIps: localAddresses(),
    };
  }

  private pushStatus(): void {
    try {
      this.emit({ kind: 'status' });
    } catch {
      // Renderer gone; harmless.
    }
  }

  private setRoster(peers: RoomPeer[], states: Record<string, RoomTimerState | null>): void {
    this.peers = peers;
    this.states = states;
    try {
      this.emit({ kind: 'roster', peers, states });
    } catch {
      // Ignore.
    }
    this.pushStatus();
  }

  async startHosting(room: string, hostName: string): Promise<{ port: number }> {
    const cleanRoom = room.trim() || 'Control Room';
    const cleanName = hostName.trim() || 'Host';
    await this.stopAll();
    this.lastError = null;
    const server = createRoomServer({
      port: DEFAULT_PORT,
      room: cleanRoom,
      hostName: cleanName,
      getState: () => this.hostState,
      onRoster: (peers, states) => this.setRoster(peers, states),
      onEvent: (e) => {
        if (e.startsWith('error:')) {
          this.lastError = e.slice('error:'.length);
          try {
            this.emit({ kind: 'error', error: this.lastError });
          } catch {
            // Ignore.
          }
          this.pushStatus();
        }
      },
    });
    this.server = server;
    this.roomName = cleanRoom;
    // Wait briefly for the listen socket so we can report the real port
    // (falls back to DEFAULT_PORT when the getter hasn't updated yet).
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 150);
    });
    this.port = server.port || DEFAULT_PORT;
    this.setRoster(
      [{ id: 'host', name: cleanName }],
      { host: this.hostState }
    );
    this.pushStatus();
    return { port: this.port };
  }

  async stopHosting(): Promise<void> {
    if (this.server) {
      const s = this.server;
      this.server = null;
      await s.close().catch(() => undefined);
    }
    this.roomName = '';
    this.port = null;
    if (!this.client) {
      this.peers = [];
      this.states = {};
    }
    this.pushStatus();
  }

  async join(host: string, port: number, name: string): Promise<void> {
    const cleanHost = (typeof host === 'string' ? host : '').trim();
    const cleanName = name.trim() || 'Guest';
    if (!cleanHost || !port) {
      throw new Error('Enter a host address and port.');
    }
    await this.stopAll();
    this.lastError = null;
    const client = joinRoom({
      host: cleanHost,
      port,
      name: cleanName,
      onWelcome: (room) => {
        this.joinedRoom = room;
        this.pushStatus();
      },
      onRoster: (peers, states) => this.setRoster(peers, states),
      onClose: () => {
        if (this.client === client) {
          this.client = null;
          this.joinedRoom = null;
          this.peers = [];
          this.states = {};
          this.pushStatus();
        }
      },
    });
    this.client = client;
    if (this.guestState) {
      try {
        client.sendState(this.guestState);
      } catch {
        // Best effort.
      }
    }
    this.pushStatus();
  }

  async leave(): Promise<void> {
    if (this.client) {
      const c = this.client;
      this.client = null;
      try {
        c.close();
      } catch {
        // Ignore.
      }
    }
    this.joinedRoom = null;
    if (!this.server) {
      this.peers = [];
      this.states = {};
    }
    this.pushStatus();
  }

  /** Publish our current timer state into the active role (host or guest). */
  publish(state: RoomTimerState | null): void {
    this.hostState = state;
    this.guestState = state;
    try {
      this.server?.setHostState(state);
    } catch {
      // Ignore.
    }
    try {
      this.client?.sendState(state);
    } catch {
      // Ignore.
    }
  }

  lastErrorMessage(): string | null {
    return this.lastError;
  }

  async shutdown(): Promise<void> {
    await this.stopAll();
  }

  private async stopAll(): Promise<void> {
    await this.stopHosting().catch(() => undefined);
    await this.leave().catch(() => undefined);
  }
}
