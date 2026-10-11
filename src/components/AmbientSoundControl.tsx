import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, Music, Check, Play, Pause, X } from 'lucide-react';
import { ThemeId } from '../types';
import { THEMES } from '../styles/themes';
import { AMBIENT_SOUNDS, AmbientSoundType, ambientAudio } from '../services/ambientAudio';

interface AmbientSoundControlProps {
  isOpen: boolean;
  onClose: () => void;
  currentSound: AmbientSoundType | null;
  onSelectSound: (type: AmbientSoundType) => void;
  onStopSound: () => void;
  theme: ThemeId;
}

export const AmbientSoundControl: React.FC<AmbientSoundControlProps> = ({
  isOpen,
  onClose,
  currentSound,
  onSelectSound,
  onStopSound,
  theme,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;

  const [volume, setVolume] = useState<number>(ambientAudio.getVolume());

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setVolume(val);
    ambientAudio.setVolume(val);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end pt-16 pr-8 select-none">
      {/* Backdrop */}
      <div onClick={onClose} className="absolute inset-0 bg-black/40 transition-opacity" />

      {/* Popover Card */}
      <div
        className="relative w-80 p-5 rounded-3xl border shadow-2xl z-10 space-y-4 animate-modal-in"
        style={{
          backgroundColor: isDark ? '#0e101a' : '#ffffff',
          borderColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.12)',
        }}
      >
        <div className="flex items-center justify-between pb-3 border-b"
          style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
        >
          <div className="flex items-center space-x-2">
            <Music className="w-4 h-4 text-sky-500" />
            <span 
              className="text-xs font-bold uppercase tracking-wider"
              style={{ color: currentTheme.textPrimary }}
            >
              Zen Focus Audio
            </span>
          </div>
          <button onClick={onClose} className="p-1 hover:opacity-70 cursor-pointer" style={{ color: currentTheme.textSecondary }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Volume Slider */}
        <div className="space-y-1.5 p-3 rounded-2xl liquid-glass border"
          style={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
        >
          <div className="flex justify-between text-xs font-semibold">
            <span style={{ color: currentTheme.textSecondary }}>Soundscape Volume</span>
            <span className="font-bold text-sky-500">{Math.round(volume * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={handleVolumeChange}
            className="w-full accent-sky-500 cursor-pointer"
          />
        </div>

        {/* Soundscapes List */}
        <div className="space-y-1.5">
          {AMBIENT_SOUNDS.map((s) => {
            const isPlayingThis = currentSound === s.id;
            return (
              <button
                key={s.id}
                onClick={() => {
                  if (isPlayingThis) {
                    onStopSound();
                  } else {
                    onSelectSound(s.id);
                  }
                }}
                className={`w-full p-2.5 rounded-2xl flex items-center justify-between text-left transition-all cursor-pointer ${
                  isPlayingThis
                    ? isDark
                      ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40 shadow-sm'
                      : 'bg-sky-100 text-sky-900 border border-sky-300 shadow-sm'
                    : 'liquid-glass border hover:scale-[1.01]'
                }`}
                style={{
                  borderColor: isPlayingThis ? undefined : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                }}
              >
                <div className="flex items-center space-x-2.5">
                  <span className="text-base">{s.emoji}</span>
                  <div>
                    <span 
                      className="text-xs font-bold block"
                      style={{ color: isPlayingThis ? undefined : currentTheme.textPrimary }}
                    >
                      {s.name}
                    </span>
                    <span 
                      className="text-[10px] block opacity-70"
                      style={{ color: isPlayingThis ? undefined : currentTheme.textSecondary }}
                    >
                      {s.description}
                    </span>
                  </div>
                </div>

                <div className="shrink-0 pl-2">
                  {isPlayingThis ? (
                    <div className="flex items-center space-x-2">
                      <div className="flex items-end space-x-[2px] h-3.5 w-3 px-[1px]">
                        <span className="w-[2px] bg-sky-400 rounded-full animate-eq-1" />
                        <span className="w-[2px] bg-sky-400 rounded-full animate-eq-2" />
                        <span className="w-[2px] bg-sky-400 rounded-full animate-eq-3" />
                      </div>
                      <span className="w-6 h-6 rounded-full bg-sky-500 text-white flex items-center justify-center shadow-md">
                        <Pause className="w-3 h-3 fill-current" />
                      </span>
                    </div>
                  ) : (
                    <span className="w-6 h-6 rounded-full liquid-glass flex items-center justify-center opacity-70">
                      <Play className="w-2.5 h-2.5 fill-current" style={{ color: currentTheme.textPrimary }} />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {currentSound && (
          <button
            onClick={onStopSound}
            className="w-full py-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-500 hover:bg-rose-500/25 text-xs font-bold transition-all cursor-pointer"
          >
            Mute Soundscape
          </button>
        )}
      </div>
    </div>
  );
};
