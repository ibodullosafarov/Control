import React from 'react';
import { Clock, CheckCircle2, Flame, ArrowLeft, Trash2, Calendar, Sparkles } from 'lucide-react';
import { FocusSession, StudyMode, ThemeId } from '../types';
import { THEMES } from '../styles/themes';
import { DynamicIcon } from './DynamicIcon';

interface HistoryViewProps {
  sessions: FocusSession[];
  modes: StudyMode[];
  onDeleteSession: (sessionId: string) => void;
  onClearAllSessions: () => void;
  onBackToTasks: () => void;
  theme: ThemeId;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  sessions,
  modes,
  onDeleteSession,
  onClearAllSessions,
  onBackToTasks,
  theme,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;

  const validSessions = sessions.filter((s) => s.countTowardStats && s.status === 'completed');

  const totalMinutesAllTime = validSessions.reduce((acc, s) => acc + (s.actualWorkMinutes || 0), 0);

  const todayDateStr = new Date().toISOString().split('T')[0];
  const todayMinutes = validSessions
    .filter((s) => s.startTime.startsWith(todayDateStr))
    .reduce((acc, s) => acc + (s.actualWorkMinutes || 0), 0);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const weekMinutes = validSessions
    .filter((s) => new Date(s.startTime) >= sevenDaysAgo)
    .reduce((acc, s) => acc + (s.actualWorkMinutes || 0), 0);

  // Compute Streak
  const daysWithSessions = new Set(
    validSessions.map((s) => s.startTime.split('T')[0])
  );
  let streak = 0;
  const checkDate = new Date();
  while (true) {
    const dStr = checkDate.toISOString().split('T')[0];
    if (daysWithSessions.has(dStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      if (streak === 0) {
        checkDate.setDate(checkDate.getDate() - 1);
        const yStr = checkDate.toISOString().split('T')[0];
        if (daysWithSessions.has(yStr)) {
          streak++;
          checkDate.setDate(checkDate.getDate() - 1);
          continue;
        }
      }
      break;
    }
  }

  // Format Hours & Minutes
  const formatHoursMins = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
  };

  // ── Focus Insights ────────────────────────────────────────────────────────
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
      title: `Peak Focus Hour — ${formatHour(bestHour)}`,
      body: `${formatHoursMins(bestHourMinutes)} of deep work accumulated in this hour across your history.`,
      accent: 'text-sky-500',
    });
  }
  if (bestWeekday !== null) {
    insights.push({
      title: `Strongest Day — ${WEEKDAYS[bestWeekday]}`,
      body: `${formatHoursMins(bestWeekdayMinutes)} of focus logged on this weekday. Plan high-stakes work then.`,
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
      body: `Focus in the past 7 days is under half of the prior week. It’s normal to ebb — protect tomorrow with a small session.`,
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
              Analytics & Focus History
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
            Today's Focus
          </span>
          <div className="text-3xl font-bold text-sky-500 font-mono tracking-tight">
            {formatHoursMins(todayMinutes)}
          </div>
          <span 
            className="text-[11px] block"
            style={{ color: currentTheme.textMuted }}
          >
            Completed today
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
            Consecutive study streak
          </span>
        </div>
      </div>

      {/* Focus Insights */}
      {insights.length > 0 && (
        <div className="p-6 rounded-3xl liquid-glass border space-y-4">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-sky-500" />
            <span 
              className="font-bold text-sm"
              style={{ color: currentTheme.textPrimary }}
            >
              Focus Insights
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
                      {dateStr} · {s.actualWorkMinutes}m focused
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
              No focus sessions recorded yet. Start your first session to build your streak!
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
