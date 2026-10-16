import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, Users, Play, Square, LogIn, LogOut, Copy, Check,
  Wifi, WifiOff, Circle, Globe, Cloud,
} from 'lucide-react';
import { ActiveSessionState, RoomPeer, RoomsStatus, RoomTimerState, ThemeId } from '../types';
import { THEMES } from '../styles/themes';
import { AuthPanel } from './AuthPanel';
import { CloudRoomsPanel } from './CloudRoomsPanel';
import { isCloudConfigured } from '../services/cloud';

interface RoomsViewProps {
  theme: ThemeId;
  activeSession: ActiveSessionState | null;
  onBackToTasks: () => void;
}

const DEFAULT_PORT = '47291';
const NAME_KEY = 'control-room-name';
const LEGACY_NAME_KEY = 'focus-room-name';

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || localStorage.getItem(LEGACY_NAME_KEY) || '';
  } catch {
    return '';
  }
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

function phaseLabel(state: RoomTimerState | null | undefined): string {
  if (!state) return 'Idle';
  if (state.phase === 'work') return 'Controlling';
  if (state.phase === 'break') return 'On break';
  return 'Idle';
}

function PeerRow({
  peer,
  state,
  now,
  currentTheme,
}: {
  peer: RoomPeer;
  state: RoomTimerState | null | undefined;
  now: number;
  currentTheme: ReturnType<typeof themeOf>;
}) {
  const active = state && state.phase !== 'idle';
  return (
    <div className="px-3.5 py-2.5 rounded-2xl liquid-glass-card border flex items-center gap-2.5">
      <span className="relative flex h-2 w-2 shrink-0">
        {active && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={`relative inline-flex rounded-full h-2 w-2 ${
            active ? 'bg-emerald-400' : 'bg-zinc-500'
          }`}
        />
      </span>
      <span className="text-xs font-bold truncate flex-1" style={{ color: currentTheme.textPrimary }}>
        {peer.name}
      </span>
      <span className="text-[11px] font-mono truncate" style={{ color: currentTheme.textSecondary }}>
        {state?.label ? `${phaseLabel(state)} · ${state.label}` : phaseLabel(state)}
        {state?.endsAt ? ` · ${formatRemaining(state.endsAt, now)}` : ''}
      </span>
    </div>
  );
}

// Helper so PeerRow props stay typed without importing ThemeColors.
function themeOf(theme: ThemeId) {
  return THEMES[theme] || THEMES.serika;
}

export const RoomsView: React.FC<RoomsViewProps> = ({ theme, activeSession, onBackToTasks }) => {
  const currentTheme = themeOf(theme);
  const isDark = currentTheme.isDark;
  const api = typeof window !== 'undefined' ? window.controlAPI?.rooms : undefined;

  const [displayName, setDisplayName] = useState<string>(loadName);
  const [mode, setMode] = useState<'online' | 'lan'>(() => (isCloudConfigured() ? 'online' : 'lan'));
  const [roomName, setRoomName] = useState('Control Room');
  const [joinHost, setJoinHost] = useState('');
  const [joinPort, setJoinPort] = useState(DEFAULT_PORT);
  const [status, setStatus] = useState<RoomsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [, setTick] = useState(0);
  const now = Date.now();

  const refresh = useCallback(() => {
    api?.getStatus().then(setStatus).catch(() => undefined);
  }, [api]);

  useEffect(() => {
    refresh();
    if (!api?.onEvent) return;
    return api.onEvent((event) => {
      if (event.kind === 'error') setError(event.error);
      refresh();
    });
  }, [api, refresh]);

  // Repaint countdowns while mounted.
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 5000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(NAME_KEY, displayName);
    } catch {
      /* ignore */
    }
  }, [displayName]);

  if (!api) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <p className="text-sm font-semibold" style={{ color: currentTheme.textSecondary }}>
          Control Rooms are available in the Control desktop app.
        </p>
      </div>
    );
  }

  const hosting = status?.hosting;
  const connected = status?.connected;

  const doHost = async () => {
    setError(null);
    const res = await api.hostStart(roomName.trim() || 'Control Room', displayName.trim() || 'Host');
    if (!res.success) setError(res.error || 'Could not start hosting.');
    refresh();
  };
  const doJoin = async () => {
    setError(null);
    const port = parseInt(joinPort, 10);
    const res = await api.join(joinHost.trim(), Number.isFinite(port) ? port : 47291, displayName.trim() || 'Guest');
    if (!res.success) setError(res.error || 'Could not join the room.');
    refresh();
  };

  const copyInvite = async () => {
    if (!status?.localIps.length || !status.port) return;
    const text = `${status.localIps[0]}:${status.port}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to clipboard.');
    }
  };

  return (
    <div className="flex-1 flex flex-col p-6 sm:p-8 max-w-5xl mx-auto w-full select-none overflow-y-auto motion-blur-in space-y-6">
      {/* Header */}
      <div
        className="flex items-center justify-between pb-6 border-b"
        style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
      >
        <div className="flex items-center space-x-3">
          <button
            onClick={onBackToTasks}
            className="p-2 rounded-xl liquid-glass border transition-all active:scale-95 cursor-pointer"
            style={{ color: currentTheme.textSecondary }}
            title="Back to Tasks"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: currentTheme.textPrimary }}>
              Control Rooms
            </h1>
            <p className="text-xs font-medium mt-0.5" style={{ color: currentTheme.textSecondary }}>
              Study together over the internet or on your Wi-Fi
            </p>
          </div>
        </div>
        <div
          className="px-3 py-1.5 rounded-full liquid-glass text-xs font-mono font-bold flex items-center space-x-1.5"
          style={{ color: currentTheme.textSecondary }}
        >
          {hosting || connected ? (
            <Wifi className="w-3.5 h-3.5 text-emerald-500" />
          ) : (
            <WifiOff className="w-3.5 h-3.5" />
          )}
          <span>{hosting ? 'Hosting' : connected ? `In ${status?.joinedRoom || 'room'}` : 'Offline'}</span>
        </div>
      </div>

      {/* Online / LAN switch */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setMode('online')}
          className={`flex items-center space-x-1.5 px-4 py-2 rounded-2xl text-xs font-bold transition-all active:scale-95 cursor-pointer border ${
            mode === 'online' ? '' : 'liquid-glass opacity-70'
          }`}
          style={
            mode === 'online'
              ? { backgroundColor: currentTheme.accent, color: currentTheme.accentText, borderColor: 'transparent' }
              : { color: currentTheme.textPrimary }
          }
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Online</span>
        </button>
        <button
          onClick={() => setMode('lan')}
          className={`flex items-center space-x-1.5 px-4 py-2 rounded-2xl text-xs font-bold transition-all active:scale-95 cursor-pointer border ${
            mode === 'lan' ? '' : 'liquid-glass opacity-70'
          }`}
          style={
            mode === 'lan'
              ? { backgroundColor: currentTheme.accent, color: currentTheme.accentText, borderColor: 'transparent' }
              : { color: currentTheme.textPrimary }
          }
        >
          <Wifi className="w-3.5 h-3.5" />
          <span>LAN · Wi-Fi</span>
        </button>
      </div>

      {mode === 'online' && (
        <div className="space-y-4">
          <AuthPanel theme={theme} displayName={displayName} onDisplayNameChange={setDisplayName} />
          <CloudRoomsPanel theme={theme} displayName={displayName} activeSession={activeSession} />
        </div>
      )}

      {mode === 'lan' && (
      <>
      {/* LAN-only explainer */}
      <div className="flex items-center gap-2 text-[11px] font-mono" style={{ color: currentTheme.textMuted }}>
        <Cloud className="w-3.5 h-3.5" />
        <span>LAN rooms stay offline — no accounts, no cloud. Switch to Online for internet rooms.</span>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-xs font-semibold text-rose-500">
          {error}
        </div>
      )}

      {/* Display name */}
      <div>
        <label className="block text-xs font-mono mb-1.5" style={{ color: currentTheme.textSecondary }}>
          Your display name
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Ibodullo"
          className="w-full max-w-sm px-4 py-2.5 rounded-2xl liquid-glass-input text-sm outline-none"
          style={{ color: currentTheme.textPrimary }}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Host a room */}
        <div className="p-5 rounded-3xl liquid-glass border space-y-3">
          <div className="flex items-center space-x-2">
            <Users className="w-4 h-4 text-orange-500" />
            <span className="font-bold text-sm" style={{ color: currentTheme.textPrimary }}>
              Host a room
            </span>
          </div>
          {!hosting ? (
            <>
              <input
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Room name"
                className="w-full px-4 py-2.5 rounded-2xl liquid-glass-input text-sm outline-none"
                style={{ color: currentTheme.textPrimary }}
              />
              <button
                onClick={doHost}
                className="flex items-center space-x-1.5 px-4 py-2.5 rounded-2xl font-bold text-xs transition-all active:scale-95 cursor-pointer"
                style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Start hosting</span>
              </button>
            </>
          ) : (
            <>
              <p className="text-xs" style={{ color: currentTheme.textSecondary }}>
                Share one of these addresses — same Wi-Fi, Control open, join with the port:
              </p>
              <div className="space-y-1.5">
                {(status?.localIps || []).map((ip) => (
                  <div
                    key={ip}
                    className="px-3 py-2 rounded-xl liquid-glass-card border font-mono text-xs font-bold"
                    style={{ color: currentTheme.textPrimary }}
                  >
                    {ip}:{status?.port}
                  </div>
                ))}
                {(!status?.localIps || status.localIps.length === 0) && (
                  <p className="text-[11px] font-mono" style={{ color: currentTheme.textMuted }}>
                    No network address found — are you on Wi-Fi?
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={copyInvite}
                  className="flex items-center space-x-1.5 px-3 py-2 rounded-xl liquid-glass border text-xs font-semibold cursor-pointer"
                  style={{ color: currentTheme.textPrimary }}
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy invite'}</span>
                </button>
                <button
                  onClick={() => { void api.hostStop().then(refresh); }}
                  className="flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-500 text-xs font-semibold cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Join a room */}
        <div className="p-5 rounded-3xl liquid-glass border space-y-3">
          <div className="flex items-center space-x-2">
            <LogIn className="w-4 h-4 text-sky-500" />
            <span className="font-bold text-sm" style={{ color: currentTheme.textPrimary }}>
              Join a room
            </span>
          </div>
          {!connected ? (
            <>
              <div className="grid grid-cols-[1fr_110px] gap-2">
                <input
                  type="text"
                  value={joinHost}
                  onChange={(e) => setJoinHost(e.target.value)}
                  placeholder="Host address, e.g. 192.168.1.42"
                  className="px-4 py-2.5 rounded-2xl liquid-glass-input text-sm font-mono outline-none min-w-0"
                  style={{ color: currentTheme.textPrimary }}
                />
                <input
                  type="number"
                  value={joinPort}
                  onChange={(e) => setJoinPort(e.target.value)}
                  placeholder="Port"
                  className="px-3 py-2.5 rounded-2xl liquid-glass-input text-sm font-mono outline-none min-w-0"
                  style={{ color: currentTheme.textPrimary }}
                />
              </div>
              <button
                onClick={doJoin}
                disabled={!joinHost.trim()}
                className="flex items-center space-x-1.5 px-4 py-2.5 rounded-2xl font-bold text-xs transition-all active:scale-95 cursor-pointer disabled:opacity-40"
                style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Join</span>
              </button>
              <p className="text-[11px] font-mono" style={{ color: currentTheme.textMuted }}>
                Tip: on the same Mac you can join your own room via 127.0.0.1
              </p>
            </>
          ) : (
            <>
              <p className="text-xs" style={{ color: currentTheme.textSecondary }}>
                Connected to <span className="font-bold" style={{ color: currentTheme.textPrimary }}>{status?.joinedRoom}</span>.
                Your timer publishes automatically while you study.
              </p>
              <button
                onClick={() => { void api.leave().then(refresh); }}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-500 text-xs font-semibold cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Leave</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Roster */}
      <div className="p-5 rounded-3xl liquid-glass border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Circle className="w-3 h-3 text-emerald-500 fill-current" />
            <span className="font-bold text-sm" style={{ color: currentTheme.textPrimary }}>
              Who's here
            </span>
          </div>
          <span className="text-[11px] font-mono" style={{ color: currentTheme.textMuted }}>
            {(status?.peers.length || 0) + 1} present
          </span>
        </div>
        <div className="space-y-2">
          <div className="px-3.5 py-2.5 rounded-2xl border border-dashed flex items-center gap-2.5" style={{ borderColor: currentTheme.border }}>
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500" />
            </span>
            <span className="text-xs font-bold truncate flex-1" style={{ color: currentTheme.textPrimary }}>
              You{displayName ? ` · ${displayName}` : ''}
            </span>
            <span className="text-[11px] font-mono" style={{ color: currentTheme.textSecondary }}>
              {activeSession ? `${activeSession.modeName} · ${activeSession.phase === 'work' ? 'controlling' : activeSession.phase === 'short_break' ? 'on break' : activeSession.phase}` : 'Idle'}
            </span>
          </div>
          {(status?.peers || []).map((peer) => (
            <PeerRow key={peer.id} peer={peer} state={status?.states[peer.id]} now={now} currentTheme={currentTheme} />
          ))}
          {(status?.peers.length || 0) === 0 && (
            <p className="text-[11px] font-mono py-2" style={{ color: currentTheme.textMuted }}>
              {hosting || connected ? 'Waiting for others to join…' : 'Host or join a room to study together.'}
            </p>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
};
