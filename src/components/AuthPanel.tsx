import React, { useState } from 'react';
import { Cloud, LogIn, LogOut, UserPlus, MailWarning, Settings2, Check } from 'lucide-react';
import { THEMES } from '../styles/themes';
import type { ThemeId } from '../types';
import {
  displayNameOf,
  isCloudConfigured,
  loadSupabaseOverride,
  saveSupabaseOverride,
  sendPasswordReset,
  signIn,
  signOut,
  signUp,
  updateDisplayName,
  useCloudSession,
} from '../services/cloud';

interface AuthPanelProps {
  theme: ThemeId;
  displayName: string;
  onDisplayNameChange: (name: string) => void;
  compact?: boolean;
}

export const AuthPanel: React.FC<AuthPanelProps> = ({ theme, displayName, onDisplayNameChange, compact }) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const { user, ready } = useCloudSession();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [overrideUrl, setOverrideUrl] = useState(() => loadSupabaseOverride()?.url || '');
  const [overrideKey, setOverrideKey] = useState(() => loadSupabaseOverride()?.anonKey || '');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const configured = isCloudConfigured();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = mode === 'signup'
      ? await signUp(email, password, displayName)
      : await signIn(email, password);
    setBusy(false);
    if (!res.success) {
      setError(res.error || 'Something went wrong.');
      return;
    }
    if (res.needsConfirmation) {
      setNotice('Account created — check your email for a confirmation link, then sign in.');
      setMode('signin');
      return;
    }
    setEmail('');
    setPassword('');
  };

  const saveName = async () => {
    const next = nameDraft.trim();
    if (!next) return;
    setBusy(true);
    const res = await updateDisplayName(next);
    setBusy(false);
    if (!res.success) {
      setError(res.error || 'Could not update name.');
      return;
    }
    onDisplayNameChange(next);
    setEditingName(false);
  };

  if (!ready) {
    return (
      <div className="p-5 rounded-3xl liquid-glass border text-xs font-mono" style={{ color: currentTheme.textMuted }}>
        Checking account…
      </div>
    );
  }

  // ── Signed in ────────────────────────────────────────────────────────────
  if (user) {
    const cloudName = displayNameOf(user);
    return (
      <div className="p-5 rounded-3xl liquid-glass border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Cloud className="w-4 h-4 text-emerald-500" />
            <span className="font-bold text-sm" style={{ color: currentTheme.textPrimary }}>
              Online account
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 font-bold">
              Signed in
            </span>
          </div>
          <button
            onClick={() => void signOut()}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl liquid-glass border text-xs font-semibold cursor-pointer"
            style={{ color: currentTheme.textSecondary }}
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </button>
        </div>
        <p className="text-xs font-mono truncate" style={{ color: currentTheme.textSecondary }}>
          {user.email}
        </p>
        <div className="flex items-center gap-2">
          {editingName ? (
            <>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Display name"
                className="flex-1 min-w-0 px-3 py-2 rounded-xl liquid-glass-input text-xs outline-none"
                style={{ color: currentTheme.textPrimary }}
              />
              <button
                onClick={() => void saveName()}
                disabled={busy || !nameDraft.trim()}
                className="px-3 py-2 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-40"
                style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setEditingName(false)}
                className="px-3 py-2 rounded-xl liquid-glass border text-xs cursor-pointer"
                style={{ color: currentTheme.textSecondary }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="text-xs font-bold" style={{ color: currentTheme.textPrimary }}>
                {displayName || cloudName}
              </span>
              <button
                onClick={() => {
                  setNameDraft(displayName || cloudName);
                  setEditingName(true);
                }}
                className="text-[11px] font-mono underline cursor-pointer"
                style={{ color: currentTheme.textSecondary }}
              >
                rename
              </button>
            </>
          )}
        </div>
        {error && <p className="text-xs font-semibold text-rose-500">{error}</p>}
      </div>
    );
  }

  // ── Signed out ───────────────────────────────────────────────────────────
  return (
    <div className="p-5 rounded-3xl liquid-glass border space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Cloud className="w-4 h-4 text-sky-500" />
          <span className="font-bold text-sm" style={{ color: currentTheme.textPrimary }}>
            Online account
          </span>
          {!configured && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 font-bold">
              Setup needed
            </span>
          )}
        </div>
        {!compact && (
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center space-x-1 text-[11px] font-mono cursor-pointer"
            style={{ color: currentTheme.textMuted }}
          >
            <Settings2 className="w-3 h-3" />
            <span>Advanced</span>
          </button>
        )}
      </div>

      {!configured ? (
        <div className="text-xs leading-relaxed space-y-2" style={{ color: currentTheme.textSecondary }}>
          <p>
            Online rooms need a free Supabase project (auth + realtime). It takes ~5 minutes:
          </p>
          <ol className="list-decimal list-inside space-y-1 font-mono text-[11px]">
            <li>Create a project at supabase.com</li>
            <li>Run <span className="font-bold">supabase/schema.sql</span> in the SQL Editor</li>
            <li>Copy URL + anon key into <span className="font-bold">.env</span> (see .env.example)</li>
            <li>Rebuild the app</li>
          </ol>
          <p className="font-mono text-[11px]" style={{ color: currentTheme.textMuted }}>
            Full steps: docs/CLOUD_SETUP.md — or paste keys below to connect without rebuilding.
          </p>
        </div>
      ) : (
        <p className="text-xs" style={{ color: currentTheme.textSecondary }}>
          {mode === 'signup'
            ? 'Create an account to host and join rooms over the internet.'
            : 'Sign in to host and join rooms over the internet.'}
        </p>
      )}

      {showAdvanced && (
        <div className="p-3 rounded-2xl liquid-glass-card border space-y-2">
          <label className="text-[11px] font-mono block" style={{ color: currentTheme.textSecondary }}>
            Supabase URL (runtime override — no rebuild needed)
          </label>
          <input
            value={overrideUrl}
            onChange={(e) => setOverrideUrl(e.target.value)}
            placeholder="https://xyzcompany.supabase.co"
            className="w-full px-3 py-2 rounded-xl liquid-glass-input text-xs font-mono outline-none"
            style={{ color: currentTheme.textPrimary }}
          />
          <label className="text-[11px] font-mono block" style={{ color: currentTheme.textSecondary }}>
            Anon key
          </label>
          <input
            value={overrideKey}
            onChange={(e) => setOverrideKey(e.target.value)}
            placeholder="eyJhbGciOi…"
            type="password"
            autoComplete="off"
            className="w-full px-3 py-2 rounded-xl liquid-glass-input text-xs font-mono outline-none"
            style={{ color: currentTheme.textPrimary }}
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (overrideUrl.trim() && overrideKey.trim()) {
                  saveSupabaseOverride({ url: overrideUrl.trim(), anonKey: overrideKey.trim() });
                  setNotice('Saved — reloading to connect.');
                  setTimeout(() => window.location.reload(), 600);
                }
              }}
              disabled={!overrideUrl.trim() || overrideKey.trim().length < 20}
              className="px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-40"
              style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
            >
              Save & reload
            </button>
            {loadSupabaseOverride() && (
              <button
                onClick={() => {
                  saveSupabaseOverride(null);
                  setOverrideUrl('');
                  setOverrideKey('');
                  setNotice('Override cleared — reloading.');
                  setTimeout(() => window.location.reload(), 600);
                }}
                className="px-3 py-1.5 rounded-xl liquid-glass border text-xs cursor-pointer"
                style={{ color: currentTheme.textSecondary }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {configured && (
        <form onSubmit={submit} className="space-y-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="w-full px-4 py-2.5 rounded-2xl liquid-glass-input text-sm outline-none"
            style={{ color: currentTheme.textPrimary }}
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'signup' ? 'Password (min 6 characters)' : 'Password'}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            className="w-full px-4 py-2.5 rounded-2xl liquid-glass-input text-sm outline-none"
            style={{ color: currentTheme.textPrimary }}
          />
          {mode === 'signup' && (
            <input
              type="text"
              value={displayName}
              onChange={(e) => onDisplayNameChange(e.target.value)}
              placeholder="Display name, e.g. Ibodullo"
              autoComplete="nickname"
              className="w-full px-4 py-2.5 rounded-2xl liquid-glass-input text-sm outline-none"
              style={{ color: currentTheme.textPrimary }}
            />
          )}
          {error && (
            <p className="text-xs font-semibold text-rose-500">{error}</p>
          )}
          {notice && (
            <p className="text-xs font-semibold flex items-center gap-1.5 text-amber-500">
              <MailWarning className="w-3.5 h-3.5" /> {notice}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="flex items-center space-x-1.5 px-4 py-2.5 rounded-2xl font-bold text-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
            >
              {mode === 'signup' ? <UserPlus className="w-3.5 h-3.5" /> : <LogIn className="w-3.5 h-3.5" />}
              <span>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'signup' ? 'signin' : 'signup');
                setError(null);
                setNotice(null);
              }}
              className="text-[11px] font-mono underline cursor-pointer"
              style={{ color: currentTheme.textSecondary }}
            >
              {mode === 'signup' ? 'Have an account? Sign in' : 'New here? Create one'}
            </button>
          </div>
          {mode === 'signin' && email.includes('@') && (
            <button
              type="button"
              onClick={async () => {
                setError(null);
                const res = await sendPasswordReset(email);
                setNotice(res.success ? 'Password reset email sent.' : (res.error || 'Failed.'));
                if (!res.success) setError(res.error || 'Failed.');
              }}
              className="text-[11px] font-mono underline cursor-pointer"
              style={{ color: currentTheme.textMuted }}
            >
              Forgot password?
            </button>
          )}
        </form>
      )}
    </div>
  );
};
