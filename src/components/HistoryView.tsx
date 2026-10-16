import React, { useState } from 'react';
import { Clock, CheckCircle2, Flame, ArrowLeft, Trash2, Calendar, Sparkles, MonitorSmartphone, ShieldAlert } from 'lucide-react';
import { ActivitySample, DistractionEvent, ControlSession, StudyMode, TaskItem, ThemeId } from '../types';
import { THEMES } from '../styles/themes';
import { DynamicIcon } from './DynamicIcon';
import { computeStreak, computeWeeklyDigest, localDayKey } from '../services/progress';
import { attributeApp, timelineByDay, usageByApp } from '../services/activity';

interface HistoryViewProps {
  sessions: ControlSession[];
  modes: StudyMode[];
  tasks?: TaskItem[];
  dailyGoalMinutes?: number;
  activitySamples?: ActivitySample[];
  activityTrackingEnabled?: boolean;
  distractions?: DistractionEvent[];
  onSaveModes?: (modes: StudyMode[]) => void;
  onDeleteSession: (sessionId: string) => void;
  onClearAllSessions: () => void;
  onBackToTasks: () => void;
  theme: ThemeId;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  sessions,
  modes,
  tasks = [],
  dailyGoalMinutes,
  activitySamples,
  activityTrackingEnabled,
  distractions,
  onSaveModes,
  onDeleteSession,
  onClearAllSessions,
  onBackToTasks,
  theme,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;
  const goalMinutes = dailyGoalMinutes && dailyGoalMinutes > 0 ? dailyGoalMinutes : 120;

  const validSessions = sessions.filter((s) => s.countTowardStats && (s.status === 'completed' || s.status === 'cancelled'));

  const totalMinutesAllTime = validSessions.reduce((acc, s) => acc + (s.actualWorkMinutes || 0), 0);

  const todayDateStr = localDayKey(new Date());
  const todayMinutes = validSessions
    .filter((s) => localDayKey(new Date(s.startTime)) === todayDateStr)
    .reduce((acc, s) => acc + (s.actualWorkMinutes || 0), 0);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const weekMinutes = validSessions
    .filter((s) => new Date(s.startTime) >= sevenDaysAgo)
    .reduce((acc, s) => acc + (s.actualWorkMinutes || 0), 0);

  // Goal-based streak: consecutive days meeting the daily control goal.
  const streak = computeStreak(validSessions, goalMinutes);

  // Monday-to-Sunday review of the current week.
  const digest = computeWeeklyDigest(validSessions);

  // ── App activity (optional frontmost-app tracker) ──────────────────────
  const samples = activitySamples || [];
  const todayKey = localDayKey(new Date());
  const todayTimeline = timelineByDay(samples, todayKey);
  const todayUsage = usageByApp(samples, todayKey);
  const todayTrackedMins = todayUsage.reduce((acc, u) => acc + u.minutes, 0);
  // Compress the per-minute timeline into same-app runs for one clean strip.
  const todayRuns: { app: string; start: string; end: string; minutes: number }[] = [];
  for (const b of todayTimeline) {
    const last = todayRuns[todayRuns.length - 1];
    if (last && last.app === b.app) {
      last.end = b.start;
      last.minutes += 1;
    } else {
      todayRuns.push({ app: b.app, start: b.start, end: b.start, minutes: 1 });
    }
  }
  const appHue = (app: string) => {
    let h = 0;
    for (let i = 0; i < app.length; i++) h = (h * 31 + app.charCodeAt(i)) % 360;
    return h;
  };

  // ── Distraction autopsy (past 7 days) ──────────────────────────────────
  const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentDistractions = (distractions || []).filter((d) => d.t >= weekAgoMs);
  const offenders = (() => {
    const map = new Map<string, { name: string; count: number; lastT: number; modeId?: string; modeName?: string }>();
    for (const d of recentDistractions) {
      const entry = map.get(d.name) || { name: d.name, count: 0, lastT: 0 };
      entry.count += 1;
      if (d.t >= entry.lastT) {
        entry.lastT = d.t;
        entry.modeId = d.modeId;
        entry.modeName = d.modeName;
      }
      map.set(d.name, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 8);
  })();
  const [blockTargets, setBlockTargets] = useState<Record<string, string>>({});
  const timeAgo = (t: number) => {
    const mins = Math.max(1, Math.round((Date.now() - t) / 60000));
    if (mins < 60) return `${mins}m ago`;
    const h = Math.floor(mins / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  // Format Hours & Minutes
  const formatHoursMins = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
  };

  // ── Control Insights ────────────────────────────────────────────────────────
  const hourMap = new Map<number, number>();
  const weekdayMap = new Map<number, number>();
  let longestUnbroken = 0;
  for (const s of validSessions) {
    const d = new Date(s.startTime);
    const hour = d.getHours();
    hourMap.set(hour, (hourMap.get(hour) || 0) + (s.actualWorkMinutes || 0));
    const wd = d.getDay();
    weekdayMap.set(wd, (weekdayMap.get(wd) || 0) + (s.actualWorkMinutes || 0));
    longestUnbroken = Math.max(longestUnbroken, s.actualWorkMinutes || 0);
  }

  let bestHour: number | null = null;
  let bestHourMinutes = 0;
  hourMap.forEach((mins, hour) => {
    if (mins > bestHourMinutes) {
      bestHourMinutes = mins;
      bestHour = hour;
    }
  });

  let bestWeekday: number | null = null;
  let bestWeekdayMinutes = 0;
  weekdayMap.forEach((mins, wd) => {
    if (mins > bestWeekdayMinutes) {
      bestWeekdayMinutes = mins;
      bestWeekday = wd;
    }
  });

  const formatHour = (h: number) => {
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${h < 12 ? 'AM' : 'PM'}`;
  };

  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Gentle burnout/decline signal: volume in the last 7 days drops below half
  // of the previous 7 days, or a single unbroken session ran very long.
  const prevSevenStart = new Date();
  prevSevenStart.setDate(prevSevenStart.getDate() - 14);
  const prev7Minutes = validSessions
    .filter((s) => {
      const t = new Date(s.startTime);
      return t >= prevSevenStart && t < sevenDaysAgo;
    })
    .reduce((acc, s) => acc + (s.actualWorkMinutes || 0), 0);

  const volumeDipped = prev7Minutes >= 60 && weekMinutes < prev7Minutes * 0.5;
  const marathonSessions = longestUnbroken >= 210;
  const insights: { title: string; body: string; accent: string }[] = [];

  if (totalMinutesAllTime > 0 && bestHour !== null) {
    insights.push({
      title: `Peak Control Hour — ${formatHour(bestHour)}`,
      body: `${formatHoursMins(bestHourMinutes)} of deep work accumulated in this hour across your history.`,
      accent: 'text-sky-500',
    });
  }
  if (bestWeekday !== null) {
    insights.push({
      title: `Strongest Day — ${WEEKDAYS[bestWeekday]}`,
      body: `${formatHoursMins(bestWeekdayMinutes)} of control logged on this weekday. Plan high-stakes work then.`,
      accent: 'text-violet-500',
    });
  }
  if (marathonSessions) {
    insights.push({
      title: 'Watch for Overexertion',
      body: `One session ran ${formatHoursMins(longestUnbroken)} without a break. Splitting it with short rests protects long-term consistency.`,
      accent: 'text-amber-500',
    });
  }
  if (volumeDipped) {
    insights.push({
      title: 'Volume Took a Dip',
      body: `Control in the past 7 days is under half of the prior week. It’s normal to ebb — protect tomorrow with a small session.`,
      accent: 'text-amber-500',
    });
  }

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
              Analytics & Control History
            </h1>
            <p 
              className="text-xs font-medium mt-0.5"
              style={{ color: currentTheme.textSecondary }}
            >
              Lifetime deep work metrics, streaks, and completed session archive
            </p>
          </div>
        </div>

        {sessions.length > 0 && (
          <button
            onClick={() => {
              if (confirm('Clear all session history records?')) {
                onClearAllSessions();
              }
            }}
            className="text-xs font-semibold hover:text-rose-500 transition-colors flex items-center space-x-1.5 cursor-pointer"
            style={{ color: currentTheme.textMuted }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear History</span>
          </button>
        )}
      </div>

      {/* 4 Top Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Today */}
        <div className="p-5 rounded-3xl liquid-glass-card border space-y-1 shadow-lg">
          <span 
            className="text-xs font-mono uppercase tracking-wider font-semibold block"
            style={{ color: currentTheme.textSecondary }}
          >
            Today's Control
          </span>
          <div className="text-3xl font-bold text-sky-500 font-mono tracking-tight">
            {formatHoursMins(todayMinutes)}
          </div>
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
            title={`${todayMinutes} of ${goalMinutes}m daily goal`}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.round((todayMinutes / goalMinutes) * 100))}%`,
                backgroundColor: '#38bdf8',
              }}
            />
          </div>
          <span
            className="text-[11px] block"
            style={{ color: currentTheme.textMuted }}
          >
            {todayMinutes >= goalMinutes ? 'Daily goal met' : `${goalMinutes - todayMinutes}m to daily goal`}
          </span>
        </div>

        {/* 7 Days */}
        <div className="p-5 rounded-3xl liquid-glass-card border space-y-1 shadow-lg">
          <span 
            className="text-xs font-mono uppercase tracking-wider font-semibold block"
            style={{ color: currentTheme.textSecondary }}
          >
            Past 7 Days
          </span>
          <div className="text-3xl font-bold text-emerald-500 font-mono tracking-tight">
            {formatHoursMins(weekMinutes)}
          </div>
          <span 
            className="text-[11px] block"
            style={{ color: currentTheme.textMuted }}
          >
            Rolling 7-day volume
          </span>
        </div>

        {/* Total All Time */}
        <div className="p-5 rounded-3xl liquid-glass-card border space-y-1 shadow-lg">
          <span 
            className="text-xs font-mono uppercase tracking-wider font-semibold block"
            style={{ color: currentTheme.textSecondary }}
          >
            Total Deep Work
          </span>
          <div className="text-3xl font-bold text-violet-500 font-mono tracking-tight">
            {formatHoursMins(totalMinutesAllTime)}
          </div>
          <span 
            className="text-[11px] block"
            style={{ color: currentTheme.textMuted }}
          >
            {validSessions.length} total sessions
          </span>
        </div>

        {/* Day Streak */}
        <div className="p-5 rounded-3xl liquid-glass-card border space-y-1 shadow-lg">
          <span 
            className="text-xs font-mono uppercase tracking-wider font-semibold block"
            style={{ color: currentTheme.textSecondary }}
          >
            Day Streak
          </span>
          <div className="text-3xl font-bold text-amber-500 font-mono tracking-tight flex items-center space-x-1.5">
            <Flame className="w-6 h-6 fill-current text-amber-500" />
            <span>{streak} {streak === 1 ? 'Day' : 'Days'}</span>
          </div>
          <span
            className="text-[11px] block"
            style={{ color: currentTheme.textMuted }}
          >
            Consecutive {goalMinutes}m-goal days
          </span>
        </div>
      </div>

      {/* Weekly Review Digest */}
      {validSessions.length > 0 && (
        <div className="p-6 rounded-3xl liquid-glass border space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Calendar className="w-4 h-4 text-violet-500" />
              <span
                className="font-bold text-sm"
                style={{ color: currentTheme.textPrimary }}
              >
                This Week
              </span>
            </div>
            {digest.deltaPct !== null && (
              <span
                className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full ${
                  digest.deltaPct >= 0
                    ? 'bg-emerald-500/15 text-emerald-500'
                    : 'bg-amber-500/15 text-amber-500'
                }`}
              >
                {digest.deltaPct >= 0 ? '+' : ''}{digest.deltaPct}% vs last week
              </span>
            )}
          </div>

          <div className="flex items-end space-x-2">
            <span className="text-4xl font-bold font-mono tracking-tight text-violet-500">
              {formatHoursMins(digest.weekMinutes)}
            </span>
            <span
              className="text-[11px] font-mono pb-1.5"
              style={{ color: currentTheme.textMuted }}
            >
              {digest.sessionsCount} {digest.sessionsCount === 1 ? 'session' : 'sessions'} · {digest.activeDays}/7 days
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              { label: 'Tasks done', value: String(digest.tasksCompleted) },
              { label: 'Daily avg', value: formatHoursMins(digest.dailyAvg) },
              { label: 'Best day', value: digest.bestDay ? `${digest.bestDay.name.split(' ')[0]} · ${formatHoursMins(digest.bestDay.minutes)}` : '—' },
              { label: 'Top mode', value: digest.topMode ? `${digest.topMode.name} · ${formatHoursMins(digest.topMode.minutes)}` : '—' },
            ].map((stat) => (
              <div key={stat.label} className="p-3 rounded-2xl liquid-glass-card border space-y-0.5">
                <span
                  className="text-[10px] font-mono uppercase tracking-wider font-semibold block"
                  style={{ color: currentTheme.textSecondary }}
                >
                  {stat.label}
                </span>
                <span
                  className="text-sm font-bold block truncate"
                  style={{ color: currentTheme.textPrimary }}
                  title={stat.value}
                >
                  {stat.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Control Insights */}
      {insights.length > 0 && (
        <div className="p-6 rounded-3xl liquid-glass border space-y-4">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-sky-500" />
            <span 
              className="font-bold text-sm"
              style={{ color: currentTheme.textPrimary }}
            >
              Control Insights
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {insights.map((insight, i) => (
              <div key={i} className="p-4 rounded-2xl liquid-glass-card border space-y-1">
                <span className={`font-bold text-xs block ${insight.accent}`}>
                  {insight.title}
                </span>
                <span 
                  className="text-[11px] leading-relaxed block"
                  style={{ color: currentTheme.textSecondary }}
                >
                  {insight.body}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* App Activity (automatic time tracking) */}
      <div className="p-6 rounded-3xl liquid-glass border space-y-4">
        <div className="flex items-center space-x-2">
          <MonitorSmartphone className="w-4 h-4 text-sky-500" />
          <span className="font-bold text-sm" style={{ color: currentTheme.textPrimary }}>
            App Activity
          </span>
          <span className="text-[11px] font-mono" style={{ color: currentTheme.textMuted }}>
            {activityTrackingEnabled ? 'tracking on' : 'tracking off'}
          </span>
        </div>

        {!activityTrackingEnabled && todayTrackedMins === 0 ? (
          <p className="text-xs leading-relaxed" style={{ color: currentTheme.textSecondary }}>
            Turn on Activity Tracking in Settings to see which apps your time goes to —
            sampled on-device every 30 seconds, never uploaded.
          </p>
        ) : todayRuns.length === 0 ? (
          <p className="text-xs font-mono" style={{ color: currentTheme.textMuted }}>
            No samples yet today. Keep Control running and switch apps normally.
          </p>
        ) : (
          <>
            <div
              className="flex h-3 rounded-full overflow-hidden gap-px"
              style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
            >
              {todayRuns.map((run, i) => (
                <span
                  key={`${run.start}-${i}`}
                  className="h-full block"
                  style={{
                    flexGrow: run.minutes,
                    flexBasis: 0,
                    backgroundColor: `hsl(${appHue(run.app)} 65% 55%)`,
                  }}
                  title={`${run.app} · ${run.start}–${run.end} (${run.minutes}m)`}
                />
              ))}
            </div>
            <div className="space-y-1.5">
              {todayUsage.slice(0, 6).map((u) => {
                const guess = attributeApp(u.app, tasks, modes);
                const guessName =
                  (guess.taskId && tasks.find((t) => t.id === guess.taskId)?.title) ||
                  (guess.modeId && modes.find((m) => m.id === guess.modeId)?.name) ||
                  null;
                return (
                  <div key={u.app} className="flex items-center gap-2.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: `hsl(${appHue(u.app)} 65% 55%)` }}
                    />
                    <span className="text-xs font-bold truncate w-32 shrink-0" style={{ color: currentTheme.textPrimary }}>
                      {u.app}
                    </span>
                    <span
                      className="text-[11px] font-mono shrink-0 w-12 text-right"
                      style={{ color: currentTheme.textSecondary }}
                    >
                      {u.minutes}m
                    </span>
                    <span className="text-[11px] truncate" style={{ color: currentTheme.textMuted }}>
                      {guessName ? `looks like: ${guessName}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
            <span className="text-[11px] font-mono block" style={{ color: currentTheme.textMuted }}>
              {todayTrackedMins}m tracked today across {todayUsage.length} {todayUsage.length === 1 ? 'app' : 'apps'}
            </span>
          </>
        )}
      </div>

      {/* Distraction Autopsy */}
      <div className="p-6 rounded-3xl liquid-glass border space-y-4">
        <div className="flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-rose-500" />
          <span className="font-bold text-sm" style={{ color: currentTheme.textPrimary }}>
            Distraction Autopsy
          </span>
          <span className="text-[11px] font-mono" style={{ color: currentTheme.textMuted }}>
            past 7 days
          </span>
        </div>

        {offenders.length === 0 ? (
          <p className="text-xs leading-relaxed" style={{ color: currentTheme.textSecondary }}>
            Nothing caught trying to break through Shield in the past 7 days. Website blocks work
            at the DNS level, so only reopened apps can be observed here.
          </p>
        ) : (
          <>
            <p className="text-xs" style={{ color: currentTheme.textSecondary }}>
              Shield terminated <span className="font-bold" style={{ color: currentTheme.textPrimary }}>{recentDistractions.length}</span> app
              {recentDistractions.length === 1 ? '' : 's'} mid-control this week:
            </p>
            <div className="space-y-2">
              {offenders.map((o) => {
                const defaultModeId =
                  (o.modeId && modes.some((m) => m.id === o.modeId) ? o.modeId : null) ||
                  modes.find((m) => !m.isChillMode)?.id ||
                  modes[0]?.id ||
                  '';
                const targetId = blockTargets[o.name] ?? defaultModeId;
                return (
                  <div key={o.name} className="p-3 rounded-2xl liquid-glass-card border flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-bold block truncate" style={{ color: currentTheme.textPrimary }}>
                        {o.name} <span className="font-mono text-rose-500">×{o.count}</span>
                      </span>
                      <span className="text-[11px] font-mono block" style={{ color: currentTheme.textMuted }}>
                        last caught {timeAgo(o.lastT)}{o.modeName ? ` during ${o.modeName}` : ''}
                      </span>
                    </div>
                    {onSaveModes && modes.length > 0 && (
                      <span className="flex items-center gap-1.5 shrink-0">
                        <select
                          value={targetId}
                          onChange={(e) => setBlockTargets((prev) => ({ ...prev, [o.name]: e.target.value }))}
                          className="px-2 py-1.5 rounded-lg liquid-glass-input text-[11px] outline-none cursor-pointer max-w-[110px]"
                          style={{ color: currentTheme.textPrimary }}
                          title="Mode to block this app in"
                        >
                          {modes.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => {
                            const mode = modes.find((m) => m.id === targetId);
                            if (!mode || (mode.blockedApps || []).includes(o.name)) return;
                            onSaveModes(modes.map((m) =>
                              m.id === mode.id ? { ...m, blockedApps: [...(m.blockedApps || []), o.name] } : m
                            ));
                          }}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer"
                          style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
                          title={`Block ${o.name} in the selected mode`}
                        >
                          Block
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Session History Log List */}
      <div className="p-6 rounded-3xl liquid-glass border space-y-4">
        <span 
          className="font-bold text-sm"
          style={{ color: currentTheme.textPrimary }}
        >
          Session Archive ({sessions.length})
        </span>

        <div className="space-y-2">
          {sessions.map((s) => {
            const dateStr = new Date(s.startTime).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={s.id}
                className="p-4 rounded-2xl liquid-glass-card border flex items-center justify-between transition-all"
              >
                <div className="flex items-center space-x-3.5">
                  <div className="p-2 rounded-xl liquid-glass text-sky-500">
                    <DynamicIcon name={s.modeIcon || 'Target'} className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span 
                        className="font-bold text-sm"
                        style={{ color: currentTheme.textPrimary }}
                      >
                        {s.modeName}
                      </span>
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${
                          s.status === 'completed'
                            ? 'bg-emerald-500/20 text-emerald-600'
                            : 'bg-rose-500/20 text-rose-600'
                        }`}
                      >
                        {s.status.toUpperCase()}
                      </span>
                    </div>
                    <span 
                      className="text-xs font-mono"
                      style={{ color: currentTheme.textSecondary }}
                    >
                      {dateStr} · {s.actualWorkMinutes}m controlled
                      {s.plannedWorkMinutes != null && s.actualWorkMinutes < s.plannedWorkMinutes ? ` / ${s.plannedWorkMinutes}m planned` : ''}
                      {s.finishedEarly ? ' · finished early' : ''}
                      {s.skippedPhases ? ` · ${s.skippedPhases} skipped` : ''}
                      {s.wallMinutes != null ? ` · ${s.wallMinutes}m wall` : ''}
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  {s.tasksCompleted !== undefined && s.tasksCompleted > 0 && (
                    <span 
                      className="text-xs font-mono flex items-center space-x-1"
                      style={{ color: currentTheme.textSecondary }}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{s.tasksCompleted} tasks</span>
                    </span>
                  )}

                  <button
                    onClick={() => onDeleteSession(s.id)}
                    className="p-1.5 hover:text-rose-500 transition-colors cursor-pointer"
                    style={{ color: currentTheme.textMuted }}
                    title="Delete session"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}

          {sessions.length === 0 && (
            <div 
              className="py-12 text-center text-xs font-mono"
              style={{ color: currentTheme.textMuted }}
            >
              No control sessions recorded yet. Start your first session to build your streak!
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
