import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { CheckCircle2, ArrowRight, BarChart3, ListTodo, Sparkles } from 'lucide-react';
import { ControlSession, ThemeId } from '../types';
import { THEMES } from '../styles/themes';

interface SessionCompletionViewProps {
  session: ControlSession;
  onReturnToLauncher: () => void;
  onViewHistory: () => void;
  onViewTasks: () => void;
  theme?: ThemeId;
}

export const SessionCompletionView: React.FC<SessionCompletionViewProps> = ({
  session,
  onReturnToLauncher,
  onViewHistory,
  onViewTasks,
  theme = 'serika',
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;

  const totalTasks = session.tasksTotal || 0;
  const completedTasks = session.tasksCompleted || 0;
  const remainingTasks = Math.max(0, totalTasks - completedTasks);

  // Mount celebration confetti cascade
  useEffect(() => {
    confetti({
      particleCount: 65,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#38bdf8', '#34d399', '#facc15', '#a855f7', '#f43f5e'],
    });
    const t = setTimeout(() => {
      confetti({
        particleCount: 45,
        angle: 60,
        spread: 55,
        origin: { x: 0.1, y: 0.7 },
      });
      confetti({
        particleCount: 45,
        angle: 120,
        spread: 55,
        origin: { x: 0.9, y: 0.7 },
      });
    }, 280);
    return () => clearTimeout(t);
  }, []);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.code === 'Space') {
        e.preventDefault();
        onReturnToLauncher();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onReturnToLauncher]);

  return (
    <div className="flex-1 flex flex-col justify-center items-center p-8 sm:p-12 max-w-2xl mx-auto w-full select-none text-center motion-blur-in">
      {/* Icon Badge */}
      <div className="w-16 h-16 rounded-3xl liquid-glass-elevated border border-emerald-500/30 flex items-center justify-center text-emerald-500 mb-6 shadow-[0_0_30px_rgba(52,211,153,0.3)]">
        <CheckCircle2 className="w-8 h-8" />
      </div>

      {/* Main Title */}
      <h1 
        className="text-3xl sm:text-4xl font-bold tracking-tight uppercase mb-1"
        style={{ color: currentTheme.textPrimary }}
      >
        SESSION COMPLETE
      </h1>

      <p 
        className="text-xs font-mono mb-8 uppercase tracking-widest"
        style={{ color: currentTheme.textSecondary }}
      >
        {session.modeName} Control Session
      </p>

      {/* Clean Liquid Glass Stat Card */}
      <div className="w-full max-w-md liquid-glass-elevated border rounded-3xl p-6 space-y-4 mb-8 text-left shadow-2xl">
        {/* Minutes Controlled */}
        <div 
          className="flex items-center justify-between border-b pb-3"
          style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
        >
          <span 
            className="text-xs uppercase font-mono"
            style={{ color: currentTheme.textSecondary }}
          >
            Control Time
          </span>
          <span className="text-lg font-bold text-sky-500">
            {session.actualWorkMinutes} MINUTES CONTROLLED
          </span>
        </div>

        {/* Tasks Completed */}
        {totalTasks > 0 && (
          <>
            <div 
              className="flex items-center justify-between border-b pb-3"
              style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
            >
              <span 
                className="text-xs uppercase font-mono"
                style={{ color: currentTheme.textSecondary }}
              >
                Task Completion
              </span>
              <span className="text-sm font-bold text-emerald-500">
                {completedTasks} / {totalTasks} TASKS COMPLETED
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span 
                className="text-xs uppercase font-mono"
                style={{ color: currentTheme.textSecondary }}
              >
                Remaining In Queue
              </span>
              <span 
                className="text-xs font-semibold"
                style={{ color: currentTheme.textPrimary }}
              >
                {remainingTasks} {remainingTasks === 1 ? 'TASK' : 'TASKS'}
              </span>
            </div>
          </>
        )}

        {/* Completed Task Titles list */}
        {session.completedTaskTitles && session.completedTaskTitles.length > 0 && (
          <div className="pt-2">
            <span 
              className="text-[11px] font-mono uppercase block mb-1.5 font-semibold"
              style={{ color: currentTheme.textSecondary }}
            >
              Completed Tasks:
            </span>
            <div className="space-y-1">
              {session.completedTaskTitles.map((t, idx) => (
                <div key={idx} className="flex items-center space-x-2 text-xs font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span 
                    className="truncate"
                    style={{ color: currentTheme.textPrimary }}
                  >
                    {t}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Primary and Secondary Action Buttons */}
      <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-md">
        <button
          onClick={onReturnToLauncher}
          className="w-full flex items-center justify-center space-x-2 py-3.5 px-6 rounded-2xl text-xs font-bold transition-all hover:scale-105 active:scale-95 shadow-xl cursor-pointer group"
          style={{
            backgroundColor: currentTheme.accent,
            color: currentTheme.accentText,
          }}
        >
          <Sparkles className="w-3.5 h-3.5 group-hover:scale-125 transition-transform" />
          <span>Return Home [Enter]</span>
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
        </button>

        <button
          onClick={onViewTasks}
          className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-2xl text-xs font-bold liquid-glass border transition-all hover:scale-105 active:scale-95 cursor-pointer"
          style={{ color: currentTheme.textPrimary }}
        >
          <ListTodo className="w-3.5 h-3.5" />
          <span>Tasks Hub</span>
        </button>

        <button
          onClick={onViewHistory}
          className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-2xl text-xs font-bold liquid-glass border transition-all hover:scale-105 active:scale-95 cursor-pointer"
          style={{ color: currentTheme.textPrimary }}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          <span>History</span>
        </button>
      </div>
    </div>
  );
};
