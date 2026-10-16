import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Check, LogOut, RefreshCw, Globe, Circle } from 'lucide-react';
import { THEMES } from '../styles/themes';
import type { ActiveSessionState, RoomTimerState, ThemeId } from '../types';
import {
  CloudRoomSession,
  displayNameOf,
  generateRoomCode,
  isCloudConfigured,
  sanitizeRoomCode,
  useCloudSession,
  type CloudRoster,
} from '../services/cloud';

interface CloudRoomsPanelProps {
  theme: ThemeId;
  displayName: string;
  activeSession: ActiveSessionState | null;
}

function toRoomState(active: ActiveSessionState | null): RoomTimerState | null {
  if (!active) return null;
  const phase = active.phase === 'work' ? 'work' : active.phase === 'short_break' ? 'break' : 'idle';
  if (phase === 'idle') return null;
  return {
    phase,
    label: `${active.modeName}${active.phase === 'work' ? '' : ' · break'}`,
    endsAt: active.phaseStartTime + active.phaseDurationSeconds * 1000,
    updatedAt: Date.now(),
  };
}

function formatRemaining(endsAt: number | null, now: number): string {
  if (!endsAt) return '';
  const ms = Math.max(0, endsAt - now);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m left`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')} left`;
  return `${s}s left`;
}

export const CloudRoomsPanel: React.FC<CloudRoomsPanelProps> = ({ theme, displayName, activeSession }) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const { user } = useCloudSession();
  const [codeInput, setCodeInput] = useState('');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [roster, setRoster] = useState<CloudRoster>({ peers: [], states: {} });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, setTick] = useState(0);
  const sessionRef = useRef<CloudRoomSession | null>(null);
  const now = Date.now();

  const configured = isCloudConfigured();
  const effectiveName = displayName.trim() || (user ? displayNameOf(user) : 'Guest');

  // Keep the room subscription alive across renders; tear down on unmount.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session || !roomCode) return;
    const off = session.onRoster(setRoster);
    return () => {
      off();
    };
  }, [roomCode]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 5000);
    return () => window.clearInterval(id);
  }, []);

  // Publish our timer into the online room (throttled to changes + 20s).
  const lastPublished = useRef<string>('');
  useEffect(() => {
    const session = sessionRef.current;
    if (!session || !roomCode) return;
    const state = toRoomState(activeSession);
    const key = JSON.stringify(state);
    lastPublished.current = key;
    void session.broadcast(state);
    const id = window.setInterval(() => {
      const current = JSON.stringify(toRoomState(activeSession));
      if (current !== lastPublished.current) {
        lastPublished.current = current;
        void sessionRef.current?.broadcast(toRoomState(activeSession));
      } else {
        // Heartbeat so joiners immediately see us even without changes.
        void sessionRef.current?.broadcast(toRoomState(activeSession));
      }
    }, 20000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, activeSession?.phase, activeSession?.modeName, activeSession?.phaseStartTime]);

  // Signed out mid-room → leave.
  useEffect(() => {
    if (!user && roomCode) {
      void leaveRoom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    return () => {
      void sessionRef.current?.leave().catch(() => undefined);
    };
  }, []);

  const joinRoom = async (code: string) => {
    const clean = sanitizeRoomCode(code);
    if (!clean) {
      setError('Enter a room code.');
      return;
    }
    if (!user) {
      setError('Sign in above first.');
      return;
    }
    setBusy(true);
    setError(null);
    const session = new CloudRoomSession(clean);
    const off = session.onRoster(setRoster);
    const res = await session.join(effectiveName);
    if (!res.success) {
      off();
      await session.leave().catch(() => undefined);
      setError(res.error || 'Could not join the room.');
      setBusy(false);
      return;
    }
    // Fresh subscription for this room lifetime.
    sessionRef.current?.leave().catch(() => undefined);
    sessionRef.current = session;
    setRoomCode(clean);
    setBusy(false);
    // Publish current timer immediately so the roster lights up.
    void session.broadcast(toRoomState(activeSession));
  };

  const hostRoom = async () => {
    setIsHost(true);
    await joinRoom(generateRoomCode());
  };

  const leaveRoom = async () => {
    await sessionRef.current?.leave().catch(() => undefined);
    sessionRef.current = null;
    setRoomCode(null);
    setIsHost(false);
    setRoster({ peers: [], states: {} });
  };

  const copyCode = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to clipboard.');
    }
  };

  const header = useMemo(() => {
    if (!roomCode) return null;
    return isHost ? `Hosting ${roomCode}` : `In ${roomCode}`;
  }, [roomCode, isHost]);

  if (!configured) {
    return (
      <div className="p-5 rounded-3xl liquid-glass border text-xs leading-relaxed" style={{ color: currentTheme.textSecondary }}>
        Online rooms activate once Supabase is configured (sign-in panel above). LAN rooms below keep working with zero setup.
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-5 rounded-3xl liquid-glass border text-xs" style={{ color: currentTheme.textSecondary }}>
        Sign in above to host or join an online room. Your timer publishes automatically while you study.
      </div>
    );
  }

  if (!roomCode) {
    return (
      <div className="p-5 rounded-3xl liquid-glass border space-y-3">
        <div className="flex items-center space-x-2">
          <Globe className="w-4 h-4 text-sky-500" />
          <span className="font-bold text-sm" style={{ color: currentTheme.textPrimary }}>
            Online rooms
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-500 font-bold">
            Internet
          </span>
        </div>
        {error && (
          <div className="px-4 py-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-xs font-semibold text-rose-500">
            {error}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void hostRoom()}
            disabled={busy}
            className="px-4 py-2.5 rounded-2xl font-bold text-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
          >
            {busy ? 'Starting…' : 'Host — new code'}
          </button>
          <span className="text-[11px] font-mono" style={{ color: currentTheme.textMuted }}>or</span>
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(sanitizeRoomCode(e.target.value))}
            placeholder="Enter code, e.g. KQ7XPA"
            maxLength={8}
            className="px-4 py-2.5 rounded-2xl liquid-glass-input text-sm font-mono tracking-widest uppercase outline-none w-48"
            style={{ color: currentTheme.textPrimary }}
          />
          <button
            onClick={() => void joinRoom(codeInput)}
            disabled={busy || !codeInput.trim()}
            className="px-4 py-2.5 rounded-2xl liquid-glass border font-bold text-xs cursor-pointer disabled:opacity-40"
            style={{ color: currentTheme.textPrimary }}
          >
            Join
          </button>
        </div>
        <p className="text-[11px] font-mono" style={{ color: currentTheme.textMuted }}>
          Share the 6-letter code — friends join from anywhere with a Control account.
        </p>
      </div>
    );
  }

  return (
    <div className="p-5 rounded-3xl liquid-glass border space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span className="font-bold text-sm" style={{ color: currentTheme.textPrimary }}>
            {header}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void sessionRef.current?.broadcast(toRoomState(activeSession)).then(() => setTick((n) => n + 1))}
            className="p-2 rounded-xl liquid-glass border cursor-pointer"
            style={{ color: currentTheme.textSecondary }}
            title="Refresh presence"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => void copyCode()}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl liquid-glass border text-xs font-semibold cursor-pointer"
            style={{ color: currentTheme.textPrimary }}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="font-mono font-bold tracking-widest">{roomCode}</span>
          </button>
          <button
            onClick={() => void leaveRoom()}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-500 text-xs font-semibold cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Leave</span>
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="px-3.5 py-2.5 rounded-2xl border border-dashed flex items-center gap-2.5" style={{ borderColor: currentTheme.border }}>
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500" />
          </span>
          <span className="text-xs font-bold truncate flex-1" style={{ color: currentTheme.textPrimary }}>
            You{effectiveName ? ` · ${effectiveName}` : ''}
          </span>
          <span className="text-[11px] font-mono" style={{ color: currentTheme.textSecondary }}>
            {activeSession ? `${activeSession.modeName} · ${activeSession.phase === 'work' ? 'controlling' : activeSession.phase === 'short_break' ? 'on break' : activeSession.phase}` : 'Idle'}
          </span>
        </div>
        {roster.peers.map((peer) => {
          const state = roster.states[peer.id];
          const active = state && state.phase !== 'idle';
          return (
            <div key={peer.id} className="px-3.5 py-2.5 rounded-2xl liquid-glass-card border flex items-center gap-2.5">
              <span className="relative flex h-2 w-2 shrink-0">
                {active && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                )}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${active ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
              </span>
              <span className="text-xs font-bold truncate flex-1" style={{ color: currentTheme.textPrimary }}>
                {peer.name}
              </span>
              <span className="text-[11px] font-mono truncate" style={{ color: currentTheme.textSecondary }}>
                {state?.label ? `${state.phase === 'work' ? 'Controlling' : state.phase === 'break' ? 'On break' : 'Idle'} · ${state.label}` : <span className="flex items-center gap-1"><Circle className="w-2 h-2" /> Idle</span>}
                {state?.endsAt ? ` · ${formatRemaining(state.endsAt, now)}` : ''}
              </span>
            </div>
          );
        })}
        {roster.peers.length === 0 && (
          <p className="text-[11px] font-mono py-1" style={{ color: currentTheme.textMuted }}>
            Share code {roomCode} — waiting for others to join…
          </p>
        )}
      </div>
    </div>
  );
};
