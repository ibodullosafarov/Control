import React, { useEffect } from 'react';
import { Sparkles, LogOut, ArrowLeft, Minimize2, Compass, Shield } from 'lucide-react';
import { ThemeId } from '../types';
import { THEMES } from '../styles/themes';

interface LeaveLockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmLeave: () => void;
  onMinimizeToTray?: () => void;
  theme: ThemeId;
  activeSessionName?: string;
}

const MINDFUL_QUOTES = [
  'Deep work is rare and valuable. Check in with your intention before breaking momentum.',
  'Most fleeting distractions pass within a moment. You are in control.',
  'Clarity comes from completion. Protect what you started.',
  'Your future self will thank you for the focus you maintain right now.',
  'Take a deep breath and center yourself. Every completed block builds mastery.',
];

export const LeaveLockModal: React.FC<LeaveLockModalProps> = ({
  isOpen,
  onClose,
  onConfirmLeave,
  onMinimizeToTray,
  theme,
  activeSessionName,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;

  // Random quote per opening
  const [quoteIndex, setQuoteIndex] = React.useState(0);

  useEffect(() => {
    if (isOpen) {
      setQuoteIndex(Math.floor(Math.random() * MINDFUL_QUOTES.length));
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onConfirmLeave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onConfirmLeave]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
      {/* Overlay */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/75 transition-opacity duration-200"
      />

      {/* Modal Dialog Card */}
      <div
        className="relative w-full max-w-md p-7 rounded-3xl border text-center animate-modal-in shadow-2xl z-10 space-y-5"
        style={{
          backgroundColor: isDark ? '#0c0e16' : '#ffffff',
          borderColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.12)',
        }}
      >
        {/* Top Header Pill */}
        <div className="inline-flex items-center space-x-2 px-3.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-sky-500/15 border border-sky-500/30 text-sky-400">
          <Shield className="w-3.5 h-3.5" />
          <span>Exit Focus Session</span>
        </div>

        {/* Ambient Center Graphic */}
        <div className="relative flex items-center justify-center w-20 h-20 mx-auto my-1">
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-sky-500/20 to-rose-500/20 blur-xl animate-pulse" />
          <div 
            className="w-16 h-16 rounded-2xl liquid-glass border flex items-center justify-center shadow-lg relative z-10"
            style={{
              borderColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)',
            }}
          >
            <Compass className="w-8 h-8 text-sky-400 animate-spin-slow" />
          </div>
        </div>

        {/* Main Headings */}
        <div className="space-y-2">
          <h2 
            className="text-xl font-bold tracking-tight"
            style={{ color: currentTheme.textPrimary }}
          >
            {activeSessionName ? `Exit ${activeSessionName}?` : 'Exit Control?'}
          </h2>
          <p 
            className="text-xs font-medium leading-relaxed max-w-xs mx-auto px-2"
            style={{ color: currentTheme.textSecondary }}
          >
            "{MINDFUL_QUOTES[quoteIndex]}"
          </p>
        </div>

        {/* Action Buttons: Instant, No Lockouts */}
        <div className="space-y-2.5 pt-2">
          {/* Primary Button: Stay in Flow */}
          <button
            onClick={onClose}
            className="w-full py-3.5 px-5 rounded-2xl font-bold text-sm transition-all active:scale-[0.98] shadow-lg cursor-pointer flex items-center justify-center space-x-2 group"
            style={{
              backgroundColor: currentTheme.accent,
              color: currentTheme.accentText,
            }}
          >
            <Sparkles className="w-4 h-4 fill-current group-hover:scale-110 transition-transform" />
            <span>Stay Focused & Keep Going [Esc]</span>
          </button>

          {/* Minimize to Menu Bar (Run in background) */}
          {onMinimizeToTray && (
            <button
              onClick={() => {
                onMinimizeToTray();
                onClose();
              }}
              className="w-full py-3 px-5 rounded-2xl font-semibold text-xs transition-all flex items-center justify-center space-x-2 liquid-glass border hover:bg-white/10 active:scale-[0.98] cursor-pointer"
              style={{ color: currentTheme.textPrimary }}
            >
              <Minimize2 className="w-3.5 h-3.5 text-sky-400" />
              <span>Minimize to Menu Bar (Keep Timing in Background)</span>
            </button>
          )}

          {/* Instant Exit & End Session Button — No time restriction */}
          <button
            onClick={onConfirmLeave}
            className="w-full py-3 px-5 rounded-2xl font-semibold text-xs transition-all flex items-center justify-center space-x-2 bg-rose-500/15 border border-rose-500/35 text-rose-500 hover:bg-rose-500/25 hover:border-rose-500/50 cursor-pointer shadow-md active:scale-[0.98]"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>End Session & Exit App Immediately</span>
          </button>
        </div>

        <div className="text-[10px] font-mono text-zinc-500 pt-1">
          Distraction blocks & acoustic alarms are safely restored upon exit.
        </div>
      </div>
    </div>
  );
};
