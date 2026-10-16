import { useEffect, useState } from 'react';
import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { RoomPeer, RoomTimerState } from '../types';

// ── Configuration ─────────────────────────────────────────────────────────
// Build-time (Vite): VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
// Packaged Electron apps bake env at build time, so the UI also allows a
// runtime override stored in localStorage (Settings → Account → Advanced).

const OVERRIDE_KEY = 'control-supabase-config';
const LEGACY_OVERRIDE_KEY = 'focus-supabase-config';

export interface SupabaseOverride {
  url: string;
  anonKey: string;
}

export function loadSupabaseOverride(): SupabaseOverride | null {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY) || localStorage.getItem(LEGACY_OVERRIDE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SupabaseOverride>;
    if (typeof parsed.url === 'string' && typeof parsed.anonKey === 'string'
      && parsed.url.startsWith('http') && parsed.anonKey.length > 20) {
      return { url: parsed.url.trim(), anonKey: parsed.anonKey.trim() };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function saveSupabaseOverride(cfg: SupabaseOverride | null): void {
  try {
    if (!cfg) localStorage.removeItem(OVERRIDE_KEY);
    else localStorage.setItem(OVERRIDE_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
  // Force a fresh client on next access.
  clientSingleton = null;
}

export function resolveSupabaseConfig(): { url: string; anonKey: string } | null {
  const override = loadSupabaseOverride();
  if (override) return override;
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  if (url && anonKey) return { url, anonKey };
  return null;
}

export function isCloudConfigured(): boolean {
  return resolveSupabaseConfig() !== null;
}

let clientSingleton: SupabaseClient | null = null;

/** Shared Supabase client, or null when the app isn't configured yet. */
export function getSupabase(): SupabaseClient | null {
  if (clientSingleton) return clientSingleton;
  const cfg = resolveSupabaseConfig();
  if (!cfg) return null;
  clientSingleton = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'control-supabase-auth',
    },
  });
  return clientSingleton;
}

// ── Auth ──────────────────────────────────────────────────────────────────

export interface AuthResult {
  success: boolean;
  error?: string;
  needsConfirmation?: boolean;
}

function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'Wrong email or password.';
  if (/user already registered|already exists/i.test(message)) return 'That email is already registered — sign in instead.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email first (check your inbox), then sign in.';
  if (/password/i.test(message) && /short|length|weak/i.test(message)) return 'Password is too short — use at least 6 characters.';
  return message;
}

export async function signUp(email: string, password: string, displayName: string): Promise<AuthResult> {
  const sb = getSupabase();
  if (!sb) return { success: false, error: 'Online accounts are not configured yet. See docs/CLOUD_SETUP.md.' };
  const { data, error } = await sb.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { display_name: displayName.trim() || 'Guest' } },
  });
  if (error) return { success: false, error: friendlyAuthError(error.message) };
  // When email confirmation is on, there is no session yet.
  if (data.session) return { success: true };
  return { success: true, needsConfirmation: true };
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const sb = getSupabase();
  if (!sb) return { success: false, error: 'Online accounts are not configured yet. See docs/CLOUD_SETUP.md.' };
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return { success: false, error: friendlyAuthError(error.message) };
  return { success: true };
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut().catch(() => undefined);
}

export async function sendPasswordReset(email: string): Promise<AuthResult> {
  const sb = getSupabase();
  if (!sb) return { success: false, error: 'Online accounts are not configured yet.' };
  const { error } = await sb.auth.resetPasswordForEmail(email.trim());
  if (error) return { success: false, error: friendlyAuthError(error.message) };
  return { success: true };
}

export async function updateDisplayName(displayName: string): Promise<AuthResult> {
  const sb = getSupabase();
  if (!sb) return { success: false, error: 'Online accounts are not configured yet.' };
  const name = displayName.trim() || 'Guest';
  const { error } = await sb.auth.updateUser({ data: { display_name: name } });
  if (error) return { success: false, error: friendlyAuthError(error.message) };
  // Best-effort profile row upsert (schema.sql trigger covers signup).
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (user) await sb.from('profiles').upsert({ id: user.id, display_name: name });
  } catch {
    /* profiles table is optional */
  }
  return { success: true };
}

export function displayNameOf(user: User | null | undefined, fallback = 'Guest'): string {
  const meta = (user?.user_metadata || {}) as Record<string, unknown>;
  const name = typeof meta.display_name === 'string' ? meta.display_name.trim() : '';
  return name || fallback;
}

/** Reactive auth session for React components. */
export function useCloudSession(): { session: Session | null; user: User | null; ready: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setReady(true);
      return;
    }
    let mounted = true;
    sb.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setReady(true);
      }
    }).catch(() => {
      if (mounted) setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, next) => {
      if (mounted) setSession(next);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return { session, user: session?.user ?? null, ready };
}

// ── Online rooms (Supabase Realtime: Presence + Broadcast) ────────────────
// No custom server: peers subscribe to `online-room:<CODE>`, publish their
// timer via broadcast, and read the roster from presence. Works from the
// desktop app and the browser alike.

export function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no confusables
  let code = '';
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 6; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

export function sanitizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export interface CloudPeer extends RoomPeer {
  userId: string;
}

export type CloudRoster = {
  peers: CloudPeer[]; // everyone else in the room
  states: Record<string, RoomTimerState | null>;
};

interface TimerBroadcast {
  peerId: string;
  name: string;
  userId: string;
  state: RoomTimerState | null;
}

export class CloudRoomSession {
  readonly code: string;
  readonly peerId: string;
  private channel: ReturnType<SupabaseClient['channel']> | null = null;
  private name = 'Guest';
  private userId = '';
  private listeners = new Set<(roster: CloudRoster) => void>();
  private states = new Map<string, { state: RoomTimerState | null; name: string; userId: string }>();
  private selfId: string;

  constructor(code: string) {
    this.code = sanitizeRoomCode(code);
    this.selfId = `me-${Math.random().toString(36).slice(2, 9)}`;
    this.peerId = this.selfId;
  }

  onRoster(cb: (roster: CloudRoster) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(): void {
    const peers: CloudPeer[] = [];
    const states: Record<string, RoomTimerState | null> = {};
    for (const [id, entry] of this.states) {
      if (id === this.selfId) continue;
      peers.push({ id, name: entry.name, userId: entry.userId });
      states[id] = entry.state;
    }
    // Deterministic order keeps the roster from jumping around.
    peers.sort((a, b) => a.name.localeCompare(b.name));
    const roster = { peers, states };
    for (const cb of this.listeners) {
      try {
        cb(roster);
      } catch {
        /* listener must never break the channel */
      }
    }
  }

  private syncPresence(): void {
    const ch = this.channel;
    if (!ch) return;
    const presence = ch.presenceState() as Record<string, Array<{ name?: string; user_id?: string }>>;
    const seen = new Set<string>();
    for (const [key, metas] of Object.entries(presence)) {
      const meta = metas[0];
      if (!meta || key === this.selfId) continue;
      seen.add(key);
      const prev = this.states.get(key);
      this.states.set(key, {
        state: prev?.state ?? null,
        name: typeof meta.name === 'string' && meta.name ? meta.name : 'Guest',
        userId: typeof meta.user_id === 'string' ? meta.user_id : '',
      });
    }
    for (const id of [...this.states.keys()]) {
      if (id !== this.selfId && !seen.has(id)) this.states.delete(id);
    }
    this.emit();
  }

  async join(displayName: string): Promise<{ success: boolean; error?: string }> {
    const sb = getSupabase();
    if (!sb) return { success: false, error: 'Online rooms are not configured yet.' };
    const { data: { session } } = await sb.auth.getSession().catch(() => ({ data: { session: null } }));
    if (!session?.user) return { success: false, error: 'Sign in to join online rooms.' };
    if (!this.code) return { success: false, error: 'Enter a room code.' };

    this.name = displayName.trim() || displayNameOf(session.user);
    this.userId = session.user.id;
    await this.leave().catch(() => undefined);

    const channel = sb.channel(`online-room:${this.code}`, {
      config: { presence: { key: this.selfId }, broadcast: { self: true } },
    });
    this.channel = channel;

    channel
      .on('broadcast', { event: 'timer' }, ({ payload }) => {
        const msg = payload as Partial<TimerBroadcast>;
        if (!msg || typeof msg.peerId !== 'string' || msg.peerId === this.selfId) return;
        const prev = this.states.get(msg.peerId);
        this.states.set(msg.peerId, {
          state: (msg.state ?? null) as RoomTimerState | null,
          name: typeof msg.name === 'string' && msg.name ? msg.name : (prev?.name ?? 'Guest'),
          userId: typeof msg.userId === 'string' ? msg.userId : (prev?.userId ?? ''),
        });
        this.emit();
      })
      .on('presence', { event: 'sync' }, () => this.syncPresence())
      .on('presence', { event: 'join' }, () => this.syncPresence())
      .on('presence', { event: 'leave' }, () => this.syncPresence());

    const status = await new Promise<string>((resolve) => {
      channel.subscribe((s) => resolve(s));
      // Safety net: never hang the UI if realtime is unreachable.
      setTimeout(() => resolve('TIMEOUT'), 15000);
    });
    if (status !== 'SUBSCRIBED') {
      this.channel = null;
      return { success: false, error: `Could not join room (${status}). Check your connection.` };
    }
    await channel.track({ name: this.name, user_id: this.userId }).catch(() => undefined);
    this.syncPresence();
    return { success: true };
  }

  async broadcast(state: RoomTimerState | null): Promise<void> {
    const ch = this.channel;
    if (!ch) return;
    await ch.send({
      type: 'broadcast',
      event: 'timer',
      payload: { peerId: this.selfId, name: this.name, userId: this.userId, state } satisfies TimerBroadcast,
    }).catch(() => undefined);
  }

  async setName(displayName: string): Promise<void> {
    this.name = displayName.trim() || this.name;
    await this.channel?.track({ name: this.name, user_id: this.userId }).catch(() => undefined);
  }

  async leave(): Promise<void> {
    const ch = this.channel;
    this.channel = null;
    this.states.clear();
    if (ch) {
      try {
        await ch.untrack().catch(() => undefined);
        await getSupabase()?.removeChannel(ch).catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
    this.emit();
  }

  get joined(): boolean {
    return this.channel !== null;
  }
}
