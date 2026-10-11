import React, { useState, useEffect } from 'react';
import { Shield, ShieldAlert, ShieldCheck, RefreshCw, ArrowLeft, Terminal, Globe, Lock, AppWindow, Ban } from 'lucide-react';
import { ThemeId, BlockerStatus, AppBlockerStatus } from '../types';
import { THEMES } from '../styles/themes';
import { blockerClient } from '../services/blockerClient';
import { DEFAULT_BLOCKLIST, DEFAULT_BLOCKED_APPS } from '../services/defaultData';
import { AppSearchInput } from './AppSearchInput';
import { BrandIcon } from './BrandIcon';

interface BlockerControlProps {
  onBackToTasks: () => void;
  theme: ThemeId;
}

export const BlockerControl: React.FC<BlockerControlProps> = ({
  onBackToTasks,
  theme,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;

  const [status, setStatus] = useState<BlockerStatus>({
    isActive: false,
    strategy: 'dynamic_hosts',
    blockedCount: 0,
    blockedDomains: [],
    selfControlAvailable: true,
    hostsManageable: true,
  });

  const [appStatus, setAppStatus] = useState<AppBlockerStatus>({
    isActive: false,
    blockedApps: [],
    blockedCount: 0,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const fetchStatus = async () => {
    setIsLoading(true);
    try {
      const s = await blockerClient.refreshStatus();
      setStatus(s);
      const a = await blockerClient.refreshAppStatus();
      setAppStatus(a);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleTestBlock = async () => {
    setIsLoading(true);
    setTestResult(null);
    try {
      const res = await blockerClient.startBlocking(DEFAULT_BLOCKLIST.slice(0, 5), 'dynamic_hosts');
      if (res.success) {
        const appRes = await blockerClient.startAppBlocking(DEFAULT_BLOCKED_APPS.slice(0, 5));
        setTestResult(
          appRes.success
            ? 'Blocker active: Websites shielded & native macOS app engine primed.'
            : 'Blocker active: Websites shielded via native macOS engine.'
        );
        await fetchStatus();
      } else {
        setTestResult(`Blocker notice: ${res.error || 'Check permissions'}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTestResult(`Error: ${msg}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnblock = async () => {
    setIsLoading(true);
    setTestResult(null);
    try {
      await blockerClient.stopBlocking();
      await blockerClient.stopAppBlocking();
      setTestResult('Distraction shield disarmed. All websites & apps accessible.');
      await fetchStatus();
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectApp = async (app: string) => {
    const clean = app.trim().replace(/\.app$/i, '');
    if (!clean || appStatus.blockedApps.includes(clean)) return;

    const next = [...appStatus.blockedApps, clean];
    setAppStatus({
      ...appStatus,
      blockedApps: next,
      blockedCount: next.length,
    });
    setTestResult('');

    // Arm immediately so the app is killed right away
    await blockerClient.startAppBlocking(next);
    await fetchStatus();
  };

  const handleSelectDomain = (domain: string) => {
    const d = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!d || status.blockedDomains.includes(d)) return;
    setStatus({
      ...status,
      blockedDomains: [...status.blockedDomains, d],
      blockedCount: status.blockedDomains.length + 1,
    });
  };

  const handleRemoveApp = async (app: string) => {
    const next = appStatus.blockedApps.filter((a) => a !== app);
    setAppStatus({
      ...appStatus,
      blockedApps: next,
      blockedCount: next.length,
    });

    // Re-arm with the remaining apps, or fully disarm
    if (next.length > 0) {
      await blockerClient.startAppBlocking(next);
    } else {
      await blockerClient.stopAppBlocking();
    }
    await fetchStatus();
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
            <h1 
              className="text-2xl font-bold tracking-tight"
              style={{ color: currentTheme.textPrimary }}
            >
              Distraction Shield Control Center
            </h1>
            <p 
              className="text-xs font-medium mt-0.5"
              style={{ color: currentTheme.textSecondary }}
            >
              Hardware, network & application-level distraction blocking engine for macOS
            </p>
          </div>
        </div>

        <button
          onClick={fetchStatus}
          disabled={isLoading}
          className="p-2 rounded-xl liquid-glass border transition-colors cursor-pointer"
          style={{ color: currentTheme.textSecondary }}
          title="Refresh Blocker Status"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Main Status Hero Card */}
      <div 
        className="p-6 rounded-3xl liquid-glass-elevated border flex flex-col sm:flex-row items-center justify-between gap-6 shadow-2xl"
        style={{
          borderColor: status.isActive || appStatus.isActive ? 'rgba(52, 211, 153, 0.4)' : isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0,0,0,0.08)',
        }}
      >
        <div className="flex items-center space-x-4">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-xl"
            style={{
              backgroundColor: status.isActive || appStatus.isActive ? 'rgba(52, 211, 153, 0.15)' : 'rgba(100, 116, 139, 0.15)',
              color: status.isActive || appStatus.isActive ? '#10b981' : currentTheme.textMuted,
            }}
          >
            {status.isActive || appStatus.isActive ? <ShieldCheck className="w-8 h-8" /> : <Shield className="w-8 h-8" />}
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <h2 
                className="text-lg font-bold"
                style={{ color: currentTheme.textPrimary }}
              >
                {status.isActive || appStatus.isActive ? 'Shield Active & Guarding' : 'Shield Inactive (Standby)'}
              </h2>
              <span
                className="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold"
                style={{
                  backgroundColor: status.isActive || appStatus.isActive ? 'rgba(52, 211, 153, 0.2)' : 'rgba(100, 116, 139, 0.2)',
                  color: status.isActive || appStatus.isActive ? '#10b981' : currentTheme.textMuted,
                }}
              >
                {status.isActive || appStatus.isActive ? 'BLOCKING' : 'IDLE'}
              </span>
            </div>
            <p 
              className="text-xs mt-1"
              style={{ color: currentTheme.textSecondary }}
            >
              {status.isActive || appStatus.isActive
                ? `Guarding ${status.blockedCount} websites & ${appStatus.blockedCount} applications`
                : 'Shield activates automatically whenever you start a focus session'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {status.isActive || appStatus.isActive ? (
            <button
              onClick={handleUnblock}
              disabled={isLoading}
              className="px-4 py-2.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-500 hover:bg-rose-500/30 text-xs font-bold transition-all active:scale-95 cursor-pointer"
            >
              Disarm Shield Now
            </button>
          ) : (
            <button
              onClick={handleTestBlock}
              disabled={isLoading}
              className="px-4 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95 shadow-md cursor-pointer"
              style={{
                backgroundColor: currentTheme.accent,
                color: currentTheme.accentText,
              }}
            >
              Test Shield Engine
            </button>
          )}
        </div>
      </div>

      {testResult && (
        <div 
          className="p-4 rounded-2xl liquid-glass text-xs font-semibold flex items-center space-x-2 border"
          style={{
            borderColor: 'rgba(56, 189, 248, 0.3)',
            color: currentTheme.textPrimary,
          }}
        >
          <Terminal className="w-4 h-4 text-sky-500" />
          <span>{testResult}</span>
        </div>
      )}

      {/* Application Blocking Manager */}
      <div 
        className="p-6 rounded-3xl liquid-glass border space-y-4"
        style={{
          borderColor: appStatus.isActive ? 'rgba(52, 211, 153, 0.4)' : undefined,
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div
              className="p-2.5 rounded-2xl"
              style={{
                backgroundColor: appStatus.isActive ? 'rgba(52, 211, 153, 0.15)' : 'rgba(244, 63, 94, 0.12)',
                color: appStatus.isActive ? '#10b981' : '#f43f5e',
              }}
            >
              <AppWindow className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span 
                  className="font-bold text-sm"
                  style={{ color: currentTheme.textPrimary }}
                >
                  macOS App Blocking Engine
                </span>
                <span
                  className="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold"
                  style={{
                    backgroundColor: appStatus.isActive ? 'rgba(52, 211, 153, 0.2)' : 'rgba(100, 116, 139, 0.2)',
                    color: appStatus.isActive ? '#10b981' : currentTheme.textMuted,
                  }}
                >
                  {appStatus.isActive ? 'ENFORCING' : 'ARMED'}
                </span>
              </div>
              <p 
                className="text-xs mt-0.5"
                style={{ color: currentTheme.textSecondary }}
              >
                {appStatus.blockedApps.length} applications will be force-quit & held shut during focus sessions
              </p>
            </div>
          </div>
        </div>

        <AppSearchInput
          theme={theme}
          placeholder="Search apps & websites — e.g. 'discord'"
          buttonLabel="Block"
          onSelectApp={handleSelectApp}
          onSelectDomain={handleSelectDomain}
        />

        {appStatus.blockedApps.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
            {appStatus.blockedApps.map((app) => (
              <span
                key={app}
                className="px-2.5 py-1.5 rounded-lg text-xs font-mono liquid-glass border flex items-center space-x-1.5"
                style={{ color: currentTheme.textPrimary }}
              >
                <BrandIcon name={app} size={13} fallback="globe" fallbackColor="#f43f5e" />
                <span>{app}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveApp(app)}
                  className="hover:text-rose-500 cursor-pointer"
                  style={{ color: currentTheme.textMuted }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p 
            className="text-xs font-mono"
            style={{ color: currentTheme.textMuted }}
          >
            No apps blocked. Search above to force-quit applications during focus sessions.
          </p>
        )}

        {status.blockedDomains.length > 0 && (
          <div 
            className="pt-2 border-t space-y-2"
            style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
          >
            <span
              className="block text-[10px] font-mono font-bold uppercase tracking-wider flex items-center space-x-1"
              style={{ color: currentTheme.textMuted }}
            >
              <Globe className="w-3 h-3" />
              <span>Selected Websites ({status.blockedDomains.length})</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {status.blockedDomains.map((d) => (
                <span
                  key={d}
                  className="px-2.5 py-1 rounded-lg text-xs font-mono liquid-glass border flex items-center space-x-1.5"
                  style={{ color: currentTheme.textPrimary }}
                >
                  <BrandIcon name={d} size={13} fallback="globe" fallbackColor="#10b981" />
                  <span>{d}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = status.blockedDomains.filter((x) => x !== d);
                      setStatus({ ...status, blockedDomains: next, blockedCount: next.length });
                    }}
                    className="hover:text-rose-500 cursor-pointer"
                    style={{ color: currentTheme.textMuted }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Strategy Engine Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-3xl liquid-glass border space-y-3">
          <div className="flex items-center space-x-2 text-xs font-mono font-bold uppercase tracking-wider text-sky-500">
            <Globe className="w-4 h-4" />
            <span>macOS DNS / Hosts Engine</span>
          </div>
          <p 
            className="text-xs leading-relaxed"
            style={{ color: currentTheme.textSecondary }}
          >
            Uses native macOS `/etc/hosts` resolution pointing blacklisted domains to `0.0.0.0` with atomic DNS flushing. Fast, seamless, and completely reversible.
          </p>
        </div>

        <div className="p-5 rounded-3xl liquid-glass border space-y-3">
          <div className="flex items-center space-x-2 text-xs font-mono font-bold uppercase tracking-wider text-rose-500">
            <AppWindow className="w-4 h-4" />
            <span>App Kill Monitor</span>
          </div>
          <p 
            className="text-xs leading-relaxed"
            style={{ color: currentTheme.textSecondary }}
          >
            Continuously watches for blocked applications. Any attempt to launch them during a focus session is terminated instantly via native macOS process control.
          </p>
        </div>

        <div className="p-5 rounded-3xl liquid-glass border space-y-3">
          <div className="flex items-center space-x-2 text-xs font-mono font-bold uppercase tracking-wider text-amber-500">
            <Lock className="w-4 h-4" />
            <span>Fail-Safe Unblocking</span>
          </div>
          <p 
            className="text-xs leading-relaxed"
            style={{ color: currentTheme.textSecondary }}
          >
            Whenever a session finishes or app quits, Control restores all network routes and releases all applications cleanly, ensuring zero leftover restrictions on your Mac.
          </p>
        </div>
      </div>
    </div>
  );
};