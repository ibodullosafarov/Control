import React, { useState, useEffect, useCallback } from 'react';
import { 
  Volume2, Moon, Power, ArrowLeft, Download, Upload, Sun, Sparkles, Check,
  FolderOpen, RefreshCw, FileText, CheckCircle2, AlertCircle, ExternalLink,
  Layers, FolderSync, CalendarCheck, Trash2, Link2Off, Zap, Bell
} from 'lucide-react';
import {
  UserSettings, ThemeId, StudyMode, ControlAppData, TaskItem, ObsidianConfig,
  GoogleCalendarConfig, GoogleCalendarOption, AutoExecuteConfig, AutoExecStatus,
  AutoExecOccurrence,
} from '../types';
import { THEMES } from '../styles/themes';
import { sound } from '../services/sound';
import { AuthPanel } from './AuthPanel';
import { obsidianService, resolveTasksFolder } from '../services/obsidian';
import { stripDateSuffix } from '../services/taskTitles';
import { useGoogleSyncStatus } from '../services/googleSync';

interface SettingsViewProps {
  settings: UserSettings;
  modes: StudyMode[];
  tasks?: TaskItem[];
  onSaveSettings: (settings: UserSettings) => void;
  onExportBackup: () => void;
  onImportBackup: (data: ControlAppData) => void;
  onBackToTasks: () => void;
  theme: ThemeId;
  onChangeTheme: (themeId: ThemeId) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  modes,
  tasks = [],
  onSaveSettings,
  onExportBackup,
  onImportBackup,
  onBackToTasks,
  theme,
  onChangeTheme,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;

  const [isSyncingObsidian, setIsSyncingObsidian] = useState(false);
  const [obsidianFeedback, setObsidianFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const obsidianConfig: ObsidianConfig = settings.obsidian || {
    enabled: false,
    vaultPath: '',
    folderName: 'Tasks',
    syncFormat: 'both',
    autoSync: true,
    includeCompleted: true,
  };

  const handleUpdateObsidian = (updates: Partial<ObsidianConfig>) => {
    const updated: ObsidianConfig = {
      ...obsidianConfig,
      ...updates,
    };
    handleUpdate({ obsidian: updated });
  };

  const handleChooseObsidianFolder = async () => {
    const res = await obsidianService.selectDirectory();
    if (!res.canceled && res.filePaths.length > 0) {
      handleUpdateObsidian({ vaultPath: res.filePaths[0] });
      setObsidianFeedback({
        type: 'success',
        message: `Selected folder: ${res.filePaths[0]}`,
      });
    }
  };

  const handleManualSyncObsidian = async () => {
    if (!obsidianConfig.vaultPath) {
      setObsidianFeedback({
        type: 'error',
        message: 'Please select an Obsidian folder first.',
      });
      return;
    }
    setIsSyncingObsidian(true);
    setObsidianFeedback(null);
    try {
      const res = await obsidianService.syncTasks(tasks, modes, obsidianConfig);
      if (res.success) {
        handleUpdateObsidian({ lastSyncedAt: new Date().toISOString() });
        setObsidianFeedback({
          type: 'success',
          message: `Synced ${res.syncedCount} tasks (${res.createdCount} new, ${res.updatedCount} updated) to "${res.folder}"`,
        });
      } else {
        setObsidianFeedback({
          type: 'error',
          message: res.error || 'Failed to sync with Obsidian.',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setObsidianFeedback({ type: 'error', message: msg });
    } finally {
      setIsSyncingObsidian(false);
    }
  };

  const handleRevealObsidianFolder = async () => {
    const target = resolveTasksFolder(obsidianConfig) || obsidianConfig.vaultPath;
    await obsidianService.openFolder(target || obsidianConfig.vaultPath);
  };

  const handleUpdate = (updates: Partial<UserSettings>) => {
    onSaveSettings({ ...settings, ...updates });
  };

  // ── Automatic study-day execution ────────────────────────────────────────
  const autoExecute: AutoExecuteConfig = settings.autoExecute ?? {
    enabled: false,
    notifyLeadMinutes: 5,
  };
  const [execStatus, setExecStatus] = useState<AutoExecStatus | null>(null);
  const loadExecStatus = useCallback(async () => {
    if (!window.controlAPI?.autoExecGetStatus) return;
    try {
      const status = await window.controlAPI.autoExecGetStatus();
      let supported = status.notificationsSupported;
      try {
        supported = (await window.controlAPI.autoExecNotifyStatus()).supported;
      } catch {
        /* keep the scheduler-reported value */
      }
      setExecStatus({ ...status, notificationsSupported: supported });
    } catch {
      /* scheduler unavailable (browser mode) */
    }
  }, []);
  useEffect(() => {
    loadExecStatus();
  }, [loadExecStatus]);

  const handleUpdateAutoExecute = (updates: Partial<AutoExecuteConfig>) => {
    handleUpdate({ autoExecute: { ...autoExecute, ...updates } });
    // The scheduler reconciles on save; refresh the visible status after it lands.
    setTimeout(() => {
      loadExecStatus();
    }, 1500);
  };

  const execStateLabel = (o: AutoExecOccurrence): string => {
    switch (o.state) {
      case 'pending': return 'Scheduled';
      case 'notified': return 'Reminder sent';
      case 'starting': return 'Starting…';
      case 'running': return 'In session';
      case 'completed': return 'Done';
      case 'failed': return o.error || 'Failed';
      case 'skipped': {
        const reasons: Record<string, string> = {
          missed: 'missed the window',
          'multiple-missed': 'several due at once',
          'session-active': 'another session was running',
          'event-deleted': 'event removed',
          'event-completed': 'already completed',
          'mode-missing': 'mode missing',
          declined: 'declined',
          'session-differs': 'session changed',
        };
        return `Skipped (${reasons[o.skipReason || ''] || o.skipReason || 'no longer due'})`;
      }
    }
  };

  // ── Google Calendar sync controls ────────────────────────────────────────
  const gcalApi = typeof window !== 'undefined' ? window.controlAPI?.googleCalendar : undefined;
  const googleStatus = useGoogleSyncStatus();
  const googleCalendarConfig: GoogleCalendarConfig = settings.googleCalendar || {
    connected: false,
    calendarId: 'primary',
    autoColorEvents: false,
    defaultReminderMinutes: 10,
  };

  const [gcalClient, setGcalClient] = useState<{
    configured: boolean;
    source?: string;
    hasSecret?: boolean;
  }>({
    configured: false,
  });
  const [gcalCalendars, setGcalCalendars] = useState<GoogleCalendarOption[]>([]);
  const [gcalBusy, setGcalBusy] = useState<
    'connect' | 'sync' | 'full' | 'disconnect' | 'list' | null
  >(null);
  const [gcalFeedback, setGcalFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [showClientIdForm, setShowClientIdForm] = useState(false);
  const [clientIdValue, setClientIdValue] = useState('');
  const [clientSecretValue, setClientSecretValue] = useState('');
  const [confirmClearClient, setConfirmClearClient] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [removeRemoteOnDisconnect, setRemoveRemoteOnDisconnect] = useState(false);

  React.useEffect(() => {
    if (!gcalApi) return;
    gcalApi
      .getClientState()
      .then(setGcalClient)
      .catch(() => undefined);
  }, [gcalApi]);

  React.useEffect(() => {
    if (!gcalApi || !googleStatus.connected) {
      setGcalCalendars([]);
      return;
    }
    let cancelled = false;
    gcalApi
      .listCalendars()
      .then((res) => {
        if (!cancelled && res.success) setGcalCalendars(res.calendars);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [gcalApi, googleStatus.connected]);

  const handleGcalFeedback = (type: 'success' | 'error', message: string) => {
    setGcalFeedback({ type, message });
  };

  const handleGcalConnect = async () => {
    if (!gcalApi) return;
    setGcalBusy('connect');
    setGcalFeedback(null);
    try {
      const res = await gcalApi.connect();
      if (res.success) {
        handleGcalFeedback('success', 'Connected. Initial sync has started.');
        const client = await gcalApi.getClientState().catch(() => null);
        if (client) setGcalClient(client);
        setShowClientIdForm(false);
      } else {
        const message = res.error || res.code || 'Could not connect to Google Calendar.';
        handleGcalFeedback('error', message);
        // A secret problem is fixable right here: open the credentials form
        // instead of leaving the user with a bare error toast.
        if (/secret|invalid_client/i.test(message)) {
          const client = await gcalApi.getClientState().catch(() => null);
          if (client) {
            setGcalClient(client);
            if (!client.hasSecret) setShowClientIdForm(true);
          } else {
            setShowClientIdForm(true);
          }
        }
      }
    } catch (err) {
      handleGcalFeedback('error', err instanceof Error ? err.message : String(err));
    } finally {
      setGcalBusy(null);
      setConfirmDisconnect(false);
      setRemoveRemoteOnDisconnect(false);
    }
  };

  const handleGcalDisconnect = async () => {
    if (!gcalApi) return;
    setGcalBusy('disconnect');
    setGcalFeedback(null);
    try {
      const res = await gcalApi.disconnect({ removeSyncedEvents: removeRemoteOnDisconnect });
      if (res.success) {
        const removed = res.removedRemote || 0;
        handleGcalFeedback(
          'success',
          removed > 0
            ? `Disconnected. ${removed} synced event${removed === 1 ? '' : 's'} removed from Google Calendar.`
            : 'Disconnected from Google Calendar. Your planner data was kept.'
        );
      } else {
        handleGcalFeedback('error', res.error || 'Could not disconnect.');
      }
    } catch (err) {
      handleGcalFeedback('error', err instanceof Error ? err.message : String(err));
    } finally {
      setGcalBusy(null);
      setConfirmDisconnect(false);
      setRemoveRemoteOnDisconnect(false);
    }
  };

  const handleGcalSync = async (full: boolean) => {
    if (!gcalApi) return;
    setGcalBusy(full ? 'full' : 'sync');
    setGcalFeedback(null);
    try {
      const res = await gcalApi.syncNow({ full });
      if (res.success) {
        const parts: string[] = [];
        if (res.created) parts.push(`${res.created} created`);
        if (res.updated) parts.push(`${res.updated} updated`);
        if (res.deleted) parts.push(`${res.deleted} deleted`);
        if (res.imported) parts.push(`${res.imported} imported`);
        handleGcalFeedback(
          'success',
          parts.length ? `Sync complete — ${parts.join(', ')}.` : 'Sync complete — everything is up to date.'
        );
      } else {
        handleGcalFeedback('error', res.error || res.code || 'Sync failed.');
      }
    } catch (err) {
      handleGcalFeedback('error', err instanceof Error ? err.message : String(err));
    } finally {
      setGcalBusy(null);
    }
  };

  const handleSelectGcalCalendar = async (calendarId: string) => {
    if (!gcalApi || !calendarId) return;
    const res = await gcalApi.selectCalendar(calendarId).catch(() => ({ success: false, error: 'Failed to select calendar.' }));
    if (res.success) {
      handleGcalFeedback('success', 'Target calendar updated — syncing.');
      setGcalCalendars((prev) => prev.map((c) => ({ ...c, selected: c.id === calendarId })));
    } else {
      handleGcalFeedback('error', res.error || 'Failed to select calendar.');
    }
  };

  const handleSaveClientId = async () => {
    if (!gcalApi) return;
    const secret = clientSecretValue.trim();
    const res = await gcalApi.setClientId(clientIdValue.trim(), secret || undefined);
    if (res.success) {
      const client = await gcalApi.getClientState().catch(() => null);
      if (client) setGcalClient(client);
      handleGcalFeedback(
        'success',
        secret ? 'OAuth Client ID and secret saved.' : 'OAuth Client ID saved.'
      );
      setShowClientIdForm(false);
      setClientIdValue('');
      setClientSecretValue('');
      setConfirmClearClient(false);
    } else {
      handleGcalFeedback('error', res.error || 'Invalid Client ID.');
    }
  };

  const handleClearClientId = async () => {
    if (!gcalApi) return;
    const res = await gcalApi.clearClientId().catch(() => ({ success: false as const, error: 'Failed to remove Client ID.' }));
    if (res.success) {
      const client = await gcalApi.getClientState().catch(() => null);
      if (client) setGcalClient(client);
      handleGcalFeedback(
        'success',
        res.removed ? 'OAuth Client ID and secret removed.' : 'Nothing stored — already cleared.'
      );
    } else {
      handleGcalFeedback('error', res.error || 'Could not remove Client ID.');
    }
    setConfirmClearClient(false);
  };

  const handleToggleAutoSync = (enabled: boolean) => {
    handleUpdate({
      googleCalendar: { ...googleCalendarConfig, autoSync: enabled },
    });
  };

  const handleCopyDiagnostics = async () => {
    if (!gcalApi) return;
    try {
      const d = await gcalApi.getDiagnostics();
      const text = [
        `Control Google Sync diagnostics (${d.generatedAt})`,
        `client: configured=${d.client.configured} source=${d.client.source || '-'} hasSecret=${!!d.client.hasSecret}`,
        `status: phase=${d.status.phase} connected=${d.status.connected} needsReauth=${d.status.needsReauth} pendingOps=${d.status.pendingOps} lastError=${d.status.lastError || '-'} lastErrorCode=${d.status.lastErrorCode || '-'}`,
        '--- log ---',
        d.log,
      ].join('\n');
      await navigator.clipboard.writeText(text);
      handleGcalFeedback('success', 'Diagnostics copied — paste them into chat.');
    } catch (err) {
      handleGcalFeedback('error', err instanceof Error ? err.message : String(err));
    }
  };

  // OAuth Client ID + secret form, shared by the disconnected panel and the
  // expired-authorization banner (stored values are never shown back).
  const clientIdForm = (
    <div className="p-4 rounded-2xl liquid-glass-card border space-y-2.5">
      <label className="text-xs font-bold block" style={{ color: currentTheme.textPrimary }}>
        OAuth Client ID
      </label>
      {gcalClient.configured && (
        <p className="text-[10px] opacity-70" style={{ color: currentTheme.textSecondary }}>
          Re-enter your Client ID together with the secret (stored values are never shown back).
        </p>
      )}
      {googleStatus.connected && (
        <p className="text-[10px] text-amber-500">
          Changing the Client ID signs out the current connection — you'll need to reconnect afterwards.
        </p>
      )}
      <div className="flex items-center space-x-2">
        <input
          type="text"
          value={clientIdValue}
          onChange={(e) => setClientIdValue(e.target.value)}
          placeholder="xxxxxxxx.apps.googleusercontent.com"
          className="flex-1 px-3 py-1.5 rounded-xl liquid-glass-input border text-xs font-mono outline-none"
          style={{ color: currentTheme.textPrimary }}
        />
        <button
          onClick={handleSaveClientId}
          disabled={!clientIdValue.trim()}
          className="px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold transition-all active:scale-95 cursor-pointer"
        >
          Save
        </button>
      </div>
      <label className="text-xs font-bold block pt-1" style={{ color: currentTheme.textPrimary }}>
        Client Secret{' '}
        <span className="font-medium opacity-60">
          (required for Web-application clients; leave empty for Desktop clients)
        </span>
      </label>
      <input
        type="password"
        value={clientSecretValue}
        onChange={(e) => setClientSecretValue(e.target.value)}
        placeholder={gcalClient.hasSecret ? '•••••••• (saved — enter a new one to replace)' : 'GOCSPX-…'}
        autoComplete="off"
        className="w-full px-3 py-1.5 rounded-xl liquid-glass-input border text-xs font-mono outline-none"
        style={{ color: currentTheme.textPrimary }}
      />
      <p className="text-[10px] opacity-70" style={{ color: currentTheme.textSecondary }}>
        Stored locally in ~/.control-app/google-oauth.json (never leaves this Mac).
        A missing secret is the usual cause of “client_secret is missing” at sign-in — but
        Desktop-type OAuth clients don't need one at all.
      </p>
    </div>
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.modes && parsed.settings) {
          onImportBackup(parsed);
          alert('Backup restored successfully!');
        } else {
          alert('Invalid backup file format.');
        }
      } catch (err) {
        alert('Failed to read backup JSON file.');
      }
    };
    reader.readAsText(file);
  };

  const lightThemes = Object.values(THEMES).filter((t) => !t.isDark);
  const darkThemes = Object.values(THEMES).filter((t) => t.isDark);

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
              Preferences & Themes
            </h1>
            <p 
              className="text-xs font-medium mt-0.5"
              style={{ color: currentTheme.textSecondary }}
            >
              Customize liquid glass themes, audio cues, macOS login startup, and data backup
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Section 1: Visual Themes (Light & Dark Suites) */}
        <div className="p-6 rounded-3xl liquid-glass border space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-sky-500" />
              <span 
                className="font-bold text-sm"
                style={{ color: currentTheme.textPrimary }}
              >
                Liquid Glass Theme Gallery ({Object.keys(THEMES).length} Themes)
              </span>
            </div>
          </div>

          {/* Light Themes Collection */}
          <div className="space-y-2.5">
            <div className="flex items-center space-x-1.5 text-xs font-mono font-bold uppercase tracking-wider text-amber-500">
              <Sun className="w-3.5 h-3.5" />
              <span>Light & Frosted Glass Themes</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {lightThemes.map((t) => {
                const isSelected = theme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      onChangeTheme(t.id);
                      handleUpdate({ theme: t.id });
                    }}
                    className={`p-3.5 rounded-2xl border flex flex-col justify-between text-left transition-all cursor-pointer relative shadow-sm ${
                      isSelected ? 'ring-2 ring-sky-500 scale-[1.03] shadow-md' : 'hover:scale-[1.01]'
                    }`}
                    style={{
                      backgroundColor: t.bgPrimary,
                      borderColor: isSelected ? t.accent : 'rgba(0,0,0,0.1)',
                    }}
                  >
                    {isSelected && (
                      <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-sky-500 text-white flex items-center justify-center text-[10px]">
                        <Check className="w-2.5 h-2.5" />
                      </span>
                    )}

                    <div>
                      <span className="text-xs font-bold block" style={{ color: t.textPrimary }}>
                        {t.name}
                      </span>
                      <span className="text-[10px] font-mono opacity-70 block mt-0.5" style={{ color: t.textSecondary }}>
                        Light
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5 mt-3 pt-2 border-t border-black/5">
                      <span className="w-3.5 h-2 rounded-full border border-black/10" style={{ backgroundColor: t.bgCard }} />
                      <span className="w-3.5 h-2 rounded-full" style={{ backgroundColor: t.accent }} />
                      <span className="w-3.5 h-2 rounded-full" style={{ backgroundColor: t.success }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dark Themes Collection */}
          <div className="space-y-2.5 pt-2">
            <div className="flex items-center space-x-1.5 text-xs font-mono font-bold uppercase tracking-wider text-sky-400">
              <Moon className="w-3.5 h-3.5" />
              <span>Dark & Obsidian Cyber Themes</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-3">
              {darkThemes.map((t) => {
                const isSelected = theme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      onChangeTheme(t.id);
                      handleUpdate({ theme: t.id });
                    }}
                    className={`p-3.5 rounded-2xl border flex flex-col justify-between text-left transition-all cursor-pointer relative shadow-sm ${
                      isSelected ? 'ring-2 ring-sky-400 scale-[1.03] shadow-md' : 'hover:scale-[1.01]'
                    }`}
                    style={{
                      backgroundColor: t.bgSecondary,
                      borderColor: isSelected ? t.accent : 'rgba(255,255,255,0.1)',
                    }}
                  >
                    {isSelected && (
                      <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-sky-400 text-black flex items-center justify-center text-[10px] font-bold">
                        <Check className="w-2.5 h-2.5" />
                      </span>
                    )}

                    <div>
                      <span className="text-xs font-bold block" style={{ color: t.textPrimary }}>
                        {t.name}
                      </span>
                      <span className="text-[10px] font-mono opacity-70 block mt-0.5" style={{ color: t.textSecondary }}>
                        Dark
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5 mt-3 pt-2 border-t border-white/5">
                      <span className="w-3.5 h-2 rounded-full border border-white/10" style={{ backgroundColor: t.bgCard }} />
                      <span className="w-3.5 h-2 rounded-full" style={{ backgroundColor: t.accent }} />
                      <span className="w-3.5 h-2 rounded-full" style={{ backgroundColor: t.success }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Section 2: Personalization & Greeting */}
        <div className="p-6 rounded-3xl liquid-glass border space-y-4">
          <span
            className="font-bold text-sm"
            style={{ color: currentTheme.textPrimary }}
          >
            Online Account — internet rooms
          </span>
          <AuthPanel
            theme={theme}
            displayName={settings.userName || ''}
            onDisplayNameChange={(name) => handleUpdate({ userName: name })}
            compact
          />
        </div>

        {/* Section 2b: Personalization & Greeting */}
        <div className="p-6 rounded-3xl liquid-glass border space-y-4">
          <span 
            className="font-bold text-sm"
            style={{ color: currentTheme.textPrimary }}
          >
            User Profile
          </span>

          <div className="space-y-3">
            <div>
              <label 
                className="block text-xs font-mono mb-1.5"
                style={{ color: currentTheme.textSecondary }}
              >
                Your Name
              </label>
              <input
                type="text"
                value={settings.userName || ''}
                onChange={(e) => handleUpdate({ userName: e.target.value })}
                placeholder="Ibodullo"
                className="w-full max-w-sm px-4 py-2.5 rounded-2xl liquid-glass-input text-sm outline-none"
                style={{ color: currentTheme.textPrimary }}
              />
            </div>

            <div>
              <label
                className="block text-xs font-mono mb-1.5"
                style={{ color: currentTheme.textSecondary }}
              >
                Daily Control Goal (minutes)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="15"
                  max="720"
                  step="15"
                  value={settings.dailyGoalMinutes || 120}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (Number.isFinite(v)) {
                      handleUpdate({ dailyGoalMinutes: Math.min(720, Math.max(15, v)) });
                    }
                  }}
                  className="w-28 px-4 py-2.5 rounded-2xl liquid-glass-input text-sm font-mono outline-none"
                  style={{ color: currentTheme.textPrimary }}
                />
                <span
                  className="text-[11px]"
                  style={{ color: currentTheme.textSecondary }}
                >
                  Powers the goal ring in Tasks and the goal-based streak
                </span>
              </div>
            </div>

            <div
              className="p-4 rounded-2xl liquid-glass-card border flex items-center justify-between cursor-pointer"
              onClick={() => handleUpdate({ reducedMotion: !settings.reducedMotion })}
            >
              <div>
                <span 
                  className="font-bold text-xs block"
                  style={{ color: currentTheme.textPrimary }}
                >
                  Reduce Animations & Motion
                </span>
                <span 
                  className="text-[11px]"
                  style={{ color: currentTheme.textSecondary }}
                >
                  Instantly reveal states and disable motion blur effects
                </span>
              </div>
              <input
                type="checkbox"
                checked={!!settings.reducedMotion}
                onChange={() => {}}
                className="accent-sky-500 w-4 h-4 cursor-pointer"
              />
            </div>

            <div
              className="p-4 rounded-2xl liquid-glass-card border flex items-center justify-between cursor-pointer"
              onClick={() => handleUpdate({ dyslexicFont: !settings.dyslexicFont })}
            >
              <div>
                <span 
                  className="font-bold text-xs block"
                  style={{ color: currentTheme.textPrimary }}
                >
                  Dyslexia-Friendly Typography
                </span>
                <span 
                  className="text-[11px]"
                  style={{ color: currentTheme.textSecondary }}
                >
                  Switches to a high-legibility typeface designed for easier reading
                </span>
              </div>
              <input
                type="checkbox"
                checked={!!settings.dyslexicFont}
                onChange={() => {}}
                className="accent-sky-500 w-4 h-4 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Section 3: macOS Startup Integration */}
        <div className="p-6 rounded-3xl liquid-glass border space-y-4">
          <div className="flex items-center space-x-2">
            <Power className="w-4 h-4 text-emerald-500" />
            <span 
              className="font-bold text-sm"
              style={{ color: currentTheme.textPrimary }}
            >
              macOS System Startup
            </span>
          </div>

          <div
            className="p-4 rounded-2xl liquid-glass-card border flex items-center justify-between cursor-pointer"
            onClick={() => {
              const newVal = !settings.launchAtLogin;
              handleUpdate({ launchAtLogin: newVal });
              if (window.controlAPI) {
                window.controlAPI.setLaunchAtLogin(newVal);
              }
            }}
          >
            <div>
              <span 
                className="font-bold text-xs block"
                style={{ color: currentTheme.textPrimary }}
              >
                Launch Control Automatically at macOS Login
              </span>
              <span 
                className="text-[11px]"
                style={{ color: currentTheme.textSecondary }}
              >
                Ready to organize your day as soon as you open your Mac
              </span>
            </div>
            <input
              type="checkbox"
              checked={settings.launchAtLogin}
              onChange={() => {}}
              className="accent-sky-500 w-4 h-4 cursor-pointer"
            />
          </div>

          <div className="p-4 rounded-2xl liquid-glass-card border flex items-center justify-between">
            <div>
              <span 
                className="font-bold text-xs block text-emerald-500"
              >
                Instant Exit & Window Management (Zero Lockout Delay)
              </span>
              <span 
                className="text-[11px]"
                style={{ color: currentTheme.textSecondary }}
              >
                No waiting periods or forced timers when closing. Exit immediately or minimize to macOS menu bar tray.
              </span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 font-bold">
              Active
            </span>
          </div>
        </div>

        {/* Section 4: Obsidian Markdown Tasks Sync */}
        <div className="p-6 rounded-3xl liquid-glass border space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-7 h-7 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
                <FolderSync className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span 
                    className="font-bold text-sm"
                    style={{ color: currentTheme.textPrimary }}
                  >
                    Obsidian Markdown Tasks Sync
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 font-bold border border-purple-500/30">
                    Vault Sync
                  </span>
                </div>
                <p 
                  className="text-xs font-medium mt-0.5"
                  style={{ color: currentTheme.textSecondary }}
                >
                  Create and sync markdown (.md) notes directly in your Obsidian vault or chosen folder
                </p>
              </div>
            </div>

            {/* Main Enable Switch */}
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={obsidianConfig.enabled}
                onChange={(e) => handleUpdateObsidian({ enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
            </label>
          </div>

          {obsidianConfig.enabled && (
            <div className="space-y-4 pt-2 border-t border-white/5 animate-modal-in">
              {/* Folder Picker Card */}
              <div className="p-4 rounded-2xl liquid-glass-card border space-y-3">
                <div className="flex items-center justify-between">
                  <label 
                    className="text-xs font-bold flex items-center space-x-1.5"
                    style={{ color: currentTheme.textPrimary }}
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-purple-400" />
                    <span>Obsidian Vault / Destination Folder</span>
                  </label>
                  <div className="flex items-center space-x-2">
                    {obsidianConfig.vaultPath && (
                      <button
                        onClick={handleRevealObsidianFolder}
                        className="px-2.5 py-1 rounded-lg liquid-glass border text-[11px] font-medium flex items-center space-x-1 hover:bg-white/10 cursor-pointer"
                        style={{ color: currentTheme.textSecondary }}
                        title="Reveal in macOS Finder"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Reveal in Finder</span>
                      </button>
                    )}
                    <button
                      onClick={handleChooseObsidianFolder}
                      className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all active:scale-95 shadow-sm cursor-pointer flex items-center space-x-1.5"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>{obsidianConfig.vaultPath ? 'Change Folder...' : 'Choose Folder...'}</span>
                    </button>
                  </div>
                </div>

                <div 
                  className="px-3.5 py-2.5 rounded-xl font-mono text-xs break-all border"
                  style={{
                    backgroundColor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.04)',
                    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                    color: obsidianConfig.vaultPath ? currentTheme.textPrimary : currentTheme.textMuted,
                  }}
                >
                  {obsidianConfig.vaultPath || 'No folder selected. Click "Choose Folder..." to select your Obsidian vault directory.'}
                </div>

                {/* Subfolder Name Option */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label 
                      className="text-[11px] font-mono block mb-1 opacity-80"
                      style={{ color: currentTheme.textSecondary }}
                    >
                      Tasks subfolder within Control/ (optional)
                    </label>
                    <input
                      type="text"
                      value={obsidianConfig.folderName || ''}
                      onChange={(e) => handleUpdateObsidian({ folderName: e.target.value })}
                      placeholder="e.g. Tasks"
                      className="w-full px-3 py-1.5 rounded-xl liquid-glass-input border text-xs font-mono outline-none"
                      style={{ color: currentTheme.textPrimary }}
                    />
                  </div>

                  <div className="flex flex-col justify-end">
                    <span 
                      className="text-[11px] opacity-70 leading-relaxed"
                      style={{ color: currentTheme.textSecondary }}
                    >
                      Notes will be created with Obsidian-compatible YAML frontmatter, tags, and interactive checkboxes (<code>- [ ] #task</code>).
                    </span>
                  </div>
                </div>
              </div>

              {/* Sync Format Selector */}
              <div className="p-4 rounded-2xl liquid-glass-card border space-y-2.5">
                <label 
                  className="text-xs font-bold block"
                  style={{ color: currentTheme.textPrimary }}
                >
                  Markdown File Structure
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleUpdateObsidian({ syncFormat: 'both' })}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      obsidianConfig.syncFormat === 'both'
                        ? 'bg-purple-500/20 border-purple-500/60 shadow-sm'
                        : 'liquid-glass border hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5">
                      <Layers className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-xs font-bold" style={{ color: currentTheme.textPrimary }}>Both (Recommended)</span>
                    </div>
                    <p className="text-[10px] mt-1 opacity-70 leading-normal" style={{ color: currentTheme.textSecondary }}>
                      Individual <code>.md</code> note per task + consolidated <code>Control Tasks.md</code> index.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleUpdateObsidian({ syncFormat: 'individual' })}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      obsidianConfig.syncFormat === 'individual'
                        ? 'bg-purple-500/20 border-purple-500/60 shadow-sm'
                        : 'liquid-glass border hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5">
                      <FileText className="w-3.5 h-3.5 text-sky-400" />
                      <span className="text-xs font-bold" style={{ color: currentTheme.textPrimary }}>Individual Notes</span>
                    </div>
                    <p className="text-[10px] mt-1 opacity-70 leading-normal" style={{ color: currentTheme.textSecondary }}>
                      One dedicated markdown file for every task with full details & personal notes section.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleUpdateObsidian({ syncFormat: 'consolidated' })}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      obsidianConfig.syncFormat === 'consolidated'
                        ? 'bg-purple-500/20 border-purple-500/60 shadow-sm'
                        : 'liquid-glass border hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5">
                      <FileText className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-xs font-bold" style={{ color: currentTheme.textPrimary }}>Single Backlog</span>
                    </div>
                    <p className="text-[10px] mt-1 opacity-70 leading-normal" style={{ color: currentTheme.textSecondary }}>
                      All tasks organized in a single <code>Control Tasks.md</code> note with pending & completed lists.
                    </p>
                  </button>
                </div>
              </div>

              {/* Automation & Options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div
                  className="p-3.5 rounded-2xl liquid-glass-card border flex items-center justify-between cursor-pointer"
                  onClick={() => handleUpdateObsidian({ autoSync: !obsidianConfig.autoSync })}
                >
                  <div>
                    <span className="text-xs font-bold block" style={{ color: currentTheme.textPrimary }}>
                      Live Auto-Sync
                    </span>
                    <span className="text-[10px]" style={{ color: currentTheme.textSecondary }}>
                      Sync automatically on task add, edit, or complete
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={obsidianConfig.autoSync}
                    onChange={(e) => {
                      e.stopPropagation();
                      handleUpdateObsidian({ autoSync: e.target.checked });
                    }}
                    className="accent-purple-500 w-4 h-4 cursor-pointer"
                  />
                </div>

                <div
                  className="p-3.5 rounded-2xl liquid-glass-card border flex items-center justify-between cursor-pointer"
                  onClick={() => handleUpdateObsidian({ includeCompleted: !obsidianConfig.includeCompleted })}
                >
                  <div>
                    <span className="text-xs font-bold block" style={{ color: currentTheme.textPrimary }}>
                      Include Completed Tasks
                    </span>
                    <span className="text-[10px]" style={{ color: currentTheme.textSecondary }}>
                      Keep completed tasks updated with <code>- [x]</code> in Obsidian
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={obsidianConfig.includeCompleted}
                    onChange={(e) => {
                      e.stopPropagation();
                      handleUpdateObsidian({ includeCompleted: e.target.checked });
                    }}
                    className="accent-purple-500 w-4 h-4 cursor-pointer"
                  />
                </div>
              </div>

              {/* Sync Actions & Status */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleManualSyncObsidian}
                    disabled={isSyncingObsidian || !obsidianConfig.vaultPath}
                    className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 transition-all active:scale-95 shadow-sm cursor-pointer ${
                      !obsidianConfig.vaultPath
                        ? 'opacity-50 cursor-not-allowed bg-purple-600/50 text-white'
                        : 'bg-purple-600 hover:bg-purple-500 text-white'
                    }`}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingObsidian ? 'animate-spin' : ''}`} />
                    <span>{isSyncingObsidian ? 'Syncing to Obsidian...' : 'Sync Tasks Now'}</span>
                  </button>

                  {obsidianConfig.lastSyncedAt && (
                    <span className="text-[11px] font-mono opacity-70" style={{ color: currentTheme.textSecondary }}>
                      Last synced: {new Date(obsidianConfig.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>

                {obsidianFeedback && (
                  <div className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center space-x-1.5 ${
                    obsidianFeedback.type === 'success'
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                  }`}>
                    {obsidianFeedback.type === 'success' ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5" />
                    )}
                    <span>{obsidianFeedback.message}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Section 5: Audio & Acoustic Feedback */}
        <div className="p-6 rounded-3xl liquid-glass border space-y-4">
          <div className="flex items-center space-x-2">
            <Volume2 className="w-4 h-4 text-amber-500" />
            <span 
              className="font-bold text-sm"
              style={{ color: currentTheme.textPrimary }}
            >
              Audio & Acoustic Feedback
            </span>
          </div>

          <div className="space-y-3">
            <div
              className="p-4 rounded-2xl liquid-glass-card border flex items-center justify-between cursor-pointer"
              onClick={() => handleUpdate({ soundEnabled: !settings.soundEnabled })}
            >
              <div>
                <span 
                  className="font-bold text-xs block"
                  style={{ color: currentTheme.textPrimary }}
                >
                  Enable Calm Ambient Bells
                </span>
                <span 
                  className="text-[11px]"
                  style={{ color: currentTheme.textSecondary }}
                >
                  Synthesized harmonic Tibetan bowl on control and break transitions
                </span>
              </div>
              <input
                type="checkbox"
                checked={settings.soundEnabled}
                onChange={(e) => {
                  e.stopPropagation();
                  handleUpdate({ soundEnabled: e.target.checked });
                }}
                className="accent-sky-500 w-4 h-4 cursor-pointer"
              />
            </div>

            {settings.soundEnabled && (
              <div className="p-4 rounded-2xl liquid-glass-card border space-y-3">
                <div className="flex justify-between text-xs font-semibold">
                  <span style={{ color: currentTheme.textSecondary }}>Audio Volume</span>
                  <span className="font-bold" style={{ color: currentTheme.accent }}>
                    {Math.round(settings.soundVolume * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={settings.soundVolume}
                  onChange={(e) => handleUpdate({ soundVolume: Number(e.target.value) })}
                  className="w-full accent-sky-500 cursor-pointer"
                />

                <div className="flex items-center space-x-2 pt-1">
                  <span className="text-xs font-medium" style={{ color: currentTheme.textSecondary }}>Test cues:</span>
                  <button
                    onClick={() => sound.playChime(settings.soundVolume)}
                    className="px-3 py-1 rounded-xl liquid-glass border text-xs font-semibold hover:opacity-80 cursor-pointer"
                    style={{ color: currentTheme.textPrimary }}
                  >
                    Chime
                  </button>
                  <button
                    onClick={() => sound.playBowl(settings.soundVolume)}
                    className="px-3 py-1 rounded-xl liquid-glass border text-xs font-semibold hover:opacity-80 cursor-pointer"
                    style={{ color: currentTheme.textPrimary }}
                  >
                    Tibetan Bowl
                  </button>
                  <button
                    onClick={() => sound.playComplete(settings.soundVolume)}
                    className="px-3 py-1 rounded-xl liquid-glass border text-xs font-semibold hover:opacity-80 cursor-pointer"
                    style={{ color: currentTheme.textPrimary }}
                  >
                    Fanfare
                  </button>
                  <button
                    onClick={() => sound.playTick(settings.soundVolume)}
                    className="px-3 py-1 rounded-xl liquid-glass border text-xs font-semibold hover:opacity-80 cursor-pointer"
                    style={{ color: currentTheme.textPrimary }}
                  >
                    Click
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section: Activity Tracking & Automations */}
        <div className="p-6 rounded-3xl liquid-glass border space-y-4">
          <span
            className="font-bold text-sm"
            style={{ color: currentTheme.textPrimary }}
          >
            Activity Tracking & Automations
          </span>

          <div className="space-y-3">
            <div
              className="p-4 rounded-2xl liquid-glass-card border flex items-center justify-between cursor-pointer"
              onClick={() => handleUpdate({ activityTracking: { enabled: !(settings.activityTracking?.enabled === true) } })}
            >
              <div>
                <span
                  className="font-bold text-xs block"
                  style={{ color: currentTheme.textPrimary }}
                >
                  Track Active Apps
                </span>
                <span
                  className="text-[11px]"
                  style={{ color: currentTheme.textSecondary }}
                >
                  Samples the frontmost app every 30s, on this Mac only. May ask for Automation permission once.
                </span>
              </div>
              <input
                type="checkbox"
                checked={settings.activityTracking?.enabled === true}
                onChange={() => {}}
                className="accent-sky-500 w-4 h-4 cursor-pointer"
              />
            </div>

            <div className="p-4 rounded-2xl liquid-glass-card border space-y-2">
              <span
                className="font-bold text-xs block font-mono"
                style={{ color: currentTheme.textPrimary }}
              >
                control://control?mode=&lt;mode&gt;&amp;task=&lt;text&gt;
              </span>
              <span
                className="text-[11px] leading-relaxed block"
                style={{ color: currentTheme.textSecondary }}
              >
                Start a control session from anywhere: Shortcuts.app (Open URLs action), Raycast,
                Alfred, or the terminal with <span className="font-mono">open "control://control?mode=Deep Work&amp;task=Read ch.5"</span>.
                Mode accepts an id or a name. Requires the installed app build.
              </span>
            </div>

            <div className="p-4 rounded-2xl liquid-glass-card border space-y-2">
              <span
                className="font-bold text-xs block font-mono"
                style={{ color: currentTheme.textPrimary }}
              >
                Quick Note — global shortcut + menu bar
              </span>
              <span
                className="text-[11px] leading-relaxed block"
                style={{ color: currentTheme.textSecondary }}
              >
                Press <span className="font-mono">⌘⇧N</span> from any app (falls back to{' '}
                <span className="font-mono">⌥⇧N</span> if taken) or choose Quick Note… in the
                menu-bar icon. Captures file into your current task and mode automatically —
                link a notes folder to a mode to auto-file them.
              </span>
            </div>
          </div>
        </div>

        {/* Section 5: Google Calendar Two-Way Sync */}
        <div className="p-6 rounded-3xl liquid-glass border space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-7 h-7 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
                <CalendarCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span
                    className="font-bold text-sm"
                    style={{ color: currentTheme.textPrimary }}
                  >
                    Google Calendar
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 font-bold border border-sky-500/30">
                    Two-way
                  </span>
                </div>
                <p
                  className="text-xs font-medium mt-0.5"
                  style={{ color: currentTheme.textSecondary }}
                >
                  Mirror Day Planner events both ways with automatic background sync
                </p>
              </div>
            </div>

            {/* Connect / Disconnect actions */}
            {!gcalApi ? (
              <span className="text-[11px] font-semibold opacity-60" style={{ color: currentTheme.textSecondary }}>
                Not available in this build
              </span>
            ) : !googleStatus.connected ? (
              <button
                onClick={handleGcalConnect}
                disabled={gcalBusy === 'connect' || googleStatus.phase === 'connecting'}
                className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-bold transition-all active:scale-95 shadow-sm cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${gcalBusy === 'connect' ? 'animate-spin' : ''}`} />
                <span>{gcalBusy === 'connect' ? 'Waiting for Google…' : 'Connect Google Calendar'}</span>
              </button>
            ) : confirmDisconnect ? (
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleGcalDisconnect}
                  disabled={gcalBusy === 'disconnect'}
                  className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-xs font-bold transition-all active:scale-95 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{gcalBusy === 'disconnect' ? 'Disconnecting…' : 'Confirm'}</span>
                </button>
                <button
                  onClick={() => {
                    setConfirmDisconnect(false);
                    setRemoveRemoteOnDisconnect(false);
                  }}
                  className="px-3 py-2 rounded-xl liquid-glass border text-xs font-bold transition-all hover:bg-white/10 cursor-pointer"
                  style={{ color: currentTheme.textSecondary }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDisconnect(true)}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-xl liquid-glass border text-xs font-bold transition-all hover:bg-rose-500/15 hover:text-rose-400 active:scale-95 cursor-pointer"
                style={{ color: currentTheme.textSecondary }}
              >
                <Link2Off className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            )}
          </div>

          {/* Disconnect confirmation */}
          {gcalApi && googleStatus.connected && confirmDisconnect && (
            <div className="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 space-y-2.5 animate-modal-in">
              <span className="text-xs font-bold text-rose-400">
                Disconnect Google Calendar?
              </span>
              <p className="text-[11px] leading-relaxed" style={{ color: currentTheme.textSecondary }}>
                Your planner keeps all its data. Choose whether events Control created in
                Google Calendar should be removed there as well.
              </p>
              <label className="flex items-center space-x-2 text-[11px] cursor-pointer" style={{ color: currentTheme.textPrimary }}>
                <input
                  type="checkbox"
                  checked={removeRemoteOnDisconnect}
                  onChange={(e) => setRemoveRemoteOnDisconnect(e.target.checked)}
                  className="rounded"
                />
                <span>Also remove synced events from Google Calendar</span>
              </label>
            </div>
          )}

          {/* Status panel */}
          {gcalApi && googleStatus.connected && !confirmDisconnect && (
            <div className="p-4 rounded-2xl liquid-glass-card border space-y-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
                <span className="font-semibold" style={{ color: currentTheme.textPrimary }}>
                  {googleStatus.userEmail || 'Connected'}
                </span>
                <span className="flex items-center space-x-1.5" style={{ color: currentTheme.textSecondary }}>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${googleStatus.syncing ? 'animate-pulse bg-sky-400' : googleStatus.phase === 'error' ? 'bg-rose-400' : googleStatus.phase === 'auth_required' ? 'bg-amber-400' : 'bg-emerald-400'}`}
                  />
                  <span>
                    {googleStatus.syncing
                      ? 'Syncing…'
                      : googleStatus.phase === 'auth_required'
                        ? 'Authorization expired — reconnect'
                        : googleStatus.phase === 'offline'
                          ? 'Offline (will sync when back online)'
                          : googleStatus.phase === 'error'
                            ? googleStatus.lastError || 'Error'
                            : 'Idle'}
                  </span>
                </span>
                {googleStatus.lastSyncedAt && (
                  <span style={{ color: currentTheme.textSecondary }}>
                    Last sync {new Date(googleStatus.lastSyncedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                <span style={{ color: currentTheme.textSecondary }}>
                  {googleStatus.pendingOps} pending
                </span>
                <span style={{ color: currentTheme.textSecondary }}>
                  {googleStatus.conflictCount || 0} conflicts
                </span>
              </div>

              {(googleStatus.needsReauth || googleStatus.phase === 'auth_required') && (
                <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 space-y-2.5 animate-modal-in">
                  <div className="flex items-center space-x-2 text-xs font-bold text-amber-500">
                    <AlertCircle className="w-4 h-4" />
                    <span>Authorization expired</span>
                  </div>
                  <p className="text-[11px] leading-relaxed" style={{ color: currentTheme.textSecondary }}>
                    Google rejected the stored credentials (this happens if the token was revoked,
                    or if the OAuth Client ID was changed — tokens are bound to the client).
                    Reconnect to continue syncing; your planner data and mappings are kept.
                  </p>
                  <div className="flex items-center space-x-2 flex-wrap gap-y-2">
                    <button
                      onClick={handleGcalConnect}
                      disabled={gcalBusy === 'connect'}
                      className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-bold transition-all active:scale-95 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${gcalBusy === 'connect' ? 'animate-spin' : ''}`} />
                      <span>{gcalBusy === 'connect' ? 'Waiting for Google…' : 'Reconnect'}</span>
                    </button>
                    {!gcalClient.hasSecret && !showClientIdForm && (
                      <button
                        onClick={() => setShowClientIdForm(true)}
                        className="px-3 py-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-500 text-xs font-bold hover:bg-amber-500/30 transition-all cursor-pointer"
                      >
                        Add Client Secret first
                      </button>
                    )}
                  </div>
                  {showClientIdForm && clientIdForm}
                </div>
              )}

              {googleStatus.insecureStorage && (
                <div className="flex items-start space-x-2 text-[11px] text-amber-500">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    Credentials are stored without OS-level encryption on this machine.
                  </span>
                </div>
              )}

              {googleStatus.lastError && googleStatus.phase !== 'auth_required' && googleStatus.phase !== 'error' && (
                <div className="text-[11px] text-amber-500">{googleStatus.lastError}</div>
              )}

              {/* Target calendar */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label
                    className="text-[11px] font-mono block mb-1 opacity-80"
                    style={{ color: currentTheme.textSecondary }}
                  >
                    Calendar for new events
                  </label>
                  <select
                    value={googleStatus.calendarId || 'primary'}
                    onChange={(e) => handleSelectGcalCalendar(e.target.value)}
                    disabled={gcalBusy === 'list'}
                    className="w-full px-3 py-1.5 rounded-xl liquid-glass-input border text-xs font-mono outline-none cursor-pointer"
                    style={{ color: currentTheme.textPrimary }}
                  >
                    {gcalCalendars.length === 0 && (
                      <option value={googleStatus.calendarId || 'primary'}>
                        {googleStatus.calendarId || 'primary'}
                      </option>
                    )}
                    {gcalCalendars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.summary}
                        {c.primary ? ' (primary)' : ''}
                        {c.accessRole === 'reader' || c.accessRole === 'freeBusyReader' ? ' — read only' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end">
                  <label className="flex items-center justify-between w-full px-1 pb-1.5 text-[11px] cursor-pointer" style={{ color: currentTheme.textPrimary }}>
                    <span>Background auto-sync (every 5 min, on control &amp; edits)</span>
                    <input
                      type="checkbox"
                      checked={googleCalendarConfig.autoSync !== false}
                      onChange={(e) => handleToggleAutoSync(e.target.checked)}
                      className="rounded"
                    />
                  </label>
                </div>
              </div>

              {/* Sync actions */}
              <div className="flex items-center space-x-2 pt-1">
                <button
                  onClick={() => handleGcalSync(false)}
                  disabled={gcalBusy !== null}
                  className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-bold transition-all active:scale-95 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${gcalBusy === 'sync' ? 'animate-spin' : ''}`} />
                  <span>Sync Now</span>
                </button>
                <button
                  onClick={() => handleGcalSync(true)}
                  disabled={gcalBusy !== null}
                  className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl liquid-glass border disabled:opacity-60 text-xs font-bold transition-all hover:bg-white/10 active:scale-95 cursor-pointer"
                  style={{ color: currentTheme.textPrimary }}
                  title="Full re-sync from Google (rebuilds sync token, re-imports everything)"
                >
                  <CalendarCheck className="w-3.5 h-3.5 text-sky-400" />
                  <span>Full Resync</span>
                </button>
              </div>
            </div>
          )}

          {/* Not connected: explanation + OAuth client setup */}
          {gcalApi && !googleStatus.connected && (
            <div className="space-y-4 pt-2 border-t border-white/5">
              <p className="text-[11px] leading-relaxed" style={{ color: currentTheme.textSecondary }}>
                Control connects through Google OAuth in your browser. Events you plan for today
                and the next 45 days are pushed to Google, and events created or edited in
                Google appear in your Day Planner. Sync tokens keep changes incremental —
                your token never leaves this computer.
              </p>

              {!gcalClient.configured && !showClientIdForm && (
                <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 space-y-2">
                  <div className="flex items-center space-x-2 text-xs font-bold text-amber-500">
                    <AlertCircle className="w-4 h-4" />
                    <span>Google OAuth Client ID not configured</span>
                  </div>
                  <p className="text-[11px] leading-relaxed" style={{ color: currentTheme.textSecondary }}>
                    Create an OAuth client in Google Cloud Console (Web application, redirect URI
                    <code className="font-mono"> http://127.0.0.1:*&#47;callback</code>) and paste
                    the Client ID below. See <code className="font-mono">docs/google-calendar-setup.md</code>{' '}
                    for a step-by-step guide.
                  </p>
                  <button
                    onClick={() => setShowClientIdForm(true)}
                    className="px-3 py-1.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-500 text-xs font-bold hover:bg-amber-500/30 transition-all cursor-pointer"
                  >
                    Enter Client ID
                  </button>
                </div>
              )}

              {showClientIdForm && clientIdForm}

              {gcalClient.configured && (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-[11px] flex items-center space-x-1.5 text-emerald-500">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      OAuth client ready
                      {gcalClient.source ? ` (${gcalClient.source})` : ''}
                      {gcalClient.hasSecret ? ' + secret' : ''} — click Connect above.
                    </span>
                  </p>
                  {gcalClient.source === 'environment' ? (
                    <span className="text-[10px] opacity-70" style={{ color: currentTheme.textSecondary }}>
                      Managed via GOOGLE_OAUTH_CLIENT_ID — unset it and restart to use stored values.
                    </span>
                  ) : !showClientIdForm && !confirmClearClient ? (
                    <div className="flex items-center space-x-1.5">
                      <button
                        onClick={() => setShowClientIdForm(true)}
                        className="px-2.5 py-1 rounded-lg liquid-glass border text-[11px] font-bold hover:bg-white/10 transition-all cursor-pointer"
                        style={{ color: currentTheme.textSecondary }}
                      >
                        Replace…
                      </button>
                      <button
                        onClick={() => setConfirmClearClient(true)}
                        className="px-2.5 py-1 rounded-lg liquid-glass border text-[11px] font-bold hover:bg-rose-500/15 hover:text-rose-400 transition-all cursor-pointer"
                        style={{ color: currentTheme.textSecondary }}
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                </div>
              )}

              {confirmClearClient && (
                <div className="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 space-y-2.5 animate-modal-in">
                  <span className="text-xs font-bold text-rose-400">
                    Remove the stored OAuth Client ID{gcalClient.hasSecret ? ' and secret' : ''}?
                  </span>
                  <p className="text-[11px] leading-relaxed" style={{ color: currentTheme.textSecondary }}>
                    You'll need to enter a Client ID again before connecting. This does not
                    sign you out of an active connection.
                  </p>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleClearClientId}
                      className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all active:scale-95 cursor-pointer"
                    >
                      Remove
                    </button>
                    <button
                      onClick={() => setConfirmClearClient(false)}
                      className="px-3 py-1.5 rounded-xl liquid-glass border text-xs font-bold transition-all hover:bg-white/10 cursor-pointer"
                      style={{ color: currentTheme.textSecondary }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {gcalClient.configured && !gcalClient.hasSecret && !showClientIdForm && !confirmClearClient && (
                <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 space-y-2">
                  <div className="flex items-center space-x-2 text-xs font-bold text-amber-500">
                    <AlertCircle className="w-4 h-4" />
                    <span>No Client Secret stored</span>
                  </div>
                  <p className="text-[11px] leading-relaxed" style={{ color: currentTheme.textSecondary }}>
                    If your OAuth client is a <span className="font-semibold">Web application</span> in
                    Google Cloud Console, sign-in fails with “client_secret is missing” until you add
                    its secret. Desktop-type clients don't need one.
                  </p>
                  <button
                    onClick={() => setShowClientIdForm(true)}
                    className="px-3 py-1.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-500 text-xs font-bold hover:bg-amber-500/30 transition-all cursor-pointer"
                  >
                    Add Client Secret
                  </button>
                </div>
              )}
            </div>
          )}

          {!gcalApi && (
            <p className="text-[11px] pt-2 border-t border-white/5" style={{ color: currentTheme.textSecondary }}>
              Google Calendar sync requires the desktop app. Open Control in Electron to connect.
            </p>
          )}

          {gcalApi && (
            <div className="pt-2 border-t border-white/5">
              <button
                onClick={handleCopyDiagnostics}
                className="px-2.5 py-1 rounded-lg liquid-glass border text-[11px] font-medium hover:bg-white/10 transition-all cursor-pointer"
                style={{ color: currentTheme.textSecondary }}
                title="Copy sanitized sync diagnostics (no tokens or secrets) for troubleshooting"
              >
                Copy diagnostics
              </button>
            </div>
          )}

          {/* Feedback */}
          {gcalFeedback && (
            <div
              className={`px-3.5 py-2 rounded-xl text-[11px] font-semibold flex items-center justify-between ${
                gcalFeedback.type === 'success'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
              }`}
            >
              <div className="flex items-center space-x-2">
                {gcalFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5" />
                )}
                <span>{gcalFeedback.message}</span>
              </div>
              <button onClick={() => setGcalFeedback(null)} className="hover:opacity-70 cursor-pointer">
                <span className="font-bold">×</span>
              </button>
            </div>
          )}
        </div>

        {/* Section 6: Data Backup & Restore */}
        <div className="p-6 rounded-3xl liquid-glass border space-y-4">
          <span 
            className="font-bold text-sm"
            style={{ color: currentTheme.textPrimary }}
          >
            Local Data Backup & Restore
          </span>

          <div className="flex items-center space-x-3 text-xs">
            <button
              onClick={onExportBackup}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-2xl liquid-glass border font-bold hover:opacity-80 transition-colors cursor-pointer"
              style={{ color: currentTheme.textPrimary }}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Backup (.json)</span>
            </button>

            <label 
              className="flex items-center space-x-2 px-4 py-2.5 rounded-2xl liquid-glass border font-bold hover:opacity-80 transition-colors cursor-pointer"
              style={{ color: currentTheme.textPrimary }}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Restore Backup</span>
              <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>
        </div>

        {/* Section 7: Automatic Control Execution */}
        <div className="p-6 rounded-3xl liquid-glass border space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-7 h-7 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-sm" style={{ color: currentTheme.textPrimary }}>
                    Automatic Control Execution
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-bold border border-amber-500/30">
                    Scheduler
                  </span>
                </div>
                <p className="text-xs font-medium mt-0.5" style={{ color: currentTheme.textSecondary }}>
                  Remind before each planned session and start its control timer automatically
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={autoExecute.enabled}
                onChange={(e) => handleUpdateAutoExecute({ enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>

          {autoExecute.enabled && (
            <div className="space-y-4 pt-2 border-t border-white/5 animate-modal-in">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <label className="flex items-center space-x-2 text-xs" style={{ color: currentTheme.textPrimary }}>
                  <Bell className="w-3.5 h-3.5 text-amber-400" />
                  <span className="font-bold">Remind me</span>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={autoExecute.notifyLeadMinutes}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      handleUpdateAutoExecute({
                        notifyLeadMinutes: Number.isFinite(v)
                          ? Math.max(1, Math.min(120, v))
                          : autoExecute.notifyLeadMinutes,
                      });
                    }}
                    className="w-16 px-2 py-1 rounded-lg liquid-glass-input border text-xs font-mono text-center outline-none"
                    style={{ color: currentTheme.textPrimary }}
                  />
                  <span style={{ color: currentTheme.textSecondary }}>min before each session</span>
                </label>
                <button
                  onClick={loadExecStatus}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl liquid-glass border text-[11px] font-bold hover:bg-white/10 transition-all cursor-pointer"
                  style={{ color: currentTheme.textSecondary }}
                  title="Reload today's execution status"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Refresh</span>
                </button>
              </div>

              {execStatus && !execStatus.notificationsSupported && (
                <div className="flex items-start space-x-2 text-[11px] text-amber-500">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    Native notifications are unavailable here — reminders can't be delivered.
                    On macOS, enable them in System Settings → Notifications → Control.
                  </span>
                </div>
              )}

              <div className="p-4 rounded-2xl liquid-glass-card border space-y-2">
                <span className="text-[11px] font-mono uppercase tracking-wider font-bold opacity-70" style={{ color: currentTheme.textSecondary }}>
                  Today{execStatus ? '' : ' (open the desktop app to load status)'}
                </span>
                {!execStatus && (
                  <p className="text-[11px]" style={{ color: currentTheme.textSecondary }}>
                    Execution status needs the desktop app. Your toggle and lead time are saved regardless.
                  </p>
                )}
                {execStatus && execStatus.occurrences.length === 0 && (
                  <p className="text-[11px]" style={{ color: currentTheme.textSecondary }}>
                    No eligible sessions today. Sessions need a start time, a valid mode, and an
                    enabled timer to be picked up.
                  </p>
                )}
                {execStatus?.occurrences.map((o) => (
                  <div key={o.key} className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center space-x-2 min-w-0">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          o.state === 'running' || o.state === 'starting'
                            ? 'animate-pulse bg-emerald-400'
                            : o.state === 'completed'
                              ? 'bg-slate-400'
                              : o.state === 'failed'
                                ? 'bg-rose-400'
                                : o.state === 'skipped'
                                  ? 'bg-amber-400'
                                  : o.state === 'notified'
                                    ? 'bg-violet-400'
                                    : 'bg-sky-400'
                        }`}
                      />
                      <span className="font-mono font-bold shrink-0" style={{ color: currentTheme.textSecondary }}>
                        {o.startTime}
                      </span>
                      <span className="font-semibold truncate" style={{ color: currentTheme.textPrimary }}>
                        {stripDateSuffix(o.title)}
                      </span>
                    </div>
                    <span className="shrink-0 opacity-80" style={{ color: currentTheme.textSecondary }}>
                      {execStateLabel(o)}
                      {(o.state === 'running' || o.state === 'starting' || o.state === 'completed') &&
                        o.blockingEnforced === false && (
                          <span className="text-amber-500" title={o.blockingError || 'This mode enforces no blocklists'}>
                            {' '}· {o.blockingError ? 'blocking failed' : 'no blocking'}
                          </span>
                        )}
                    </span>
                  </div>
                ))}
              </div>

              <p className="text-[10px] leading-relaxed opacity-70" style={{ color: currentTheme.textSecondary }}>
                The scheduler runs in the background while Control is open (even minimized to the
                menu bar) and reconciles on sleep/wake and every minute. A running manual session
                always wins over a scheduled start; missed starts older than 10 minutes are skipped,
                never launched late. Fully quitting the app stops execution — enable macOS login
                startup above to cover restarts.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
