import React, { useState } from 'react';
import { Plus, Trash2, Copy, Edit2, ArrowLeft, X } from 'lucide-react';
import { StudyMode, ThemeId } from '../types';
import { THEMES } from '../styles/themes';
import { DynamicIcon } from './DynamicIcon';
import { AppSearchInput } from './AppSearchInput';
import { BrandIcon } from './BrandIcon';
import { DEFAULT_BLOCKLIST } from '../services/defaultData';

interface ModesManagerProps {
  modes: StudyMode[];
  onSaveModes: (modes: StudyMode[]) => void;
  onSelectMode: (modeId: string) => void;
  onBackToLauncher: () => void;
  theme: ThemeId;
}

const PRESET_COLORS = [
  '#38bdf8', // Sky
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#8b5cf6', // Violet
  '#f43f5e', // Rose
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#84cc16', // Lime
  '#64748b', // Slate
];

export const ModesManager: React.FC<ModesManagerProps> = ({
  modes,
  onSaveModes,
  onSelectMode,
  onBackToLauncher,
  theme,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;

const [editingMode, setEditingMode] = useState<StudyMode | null>(null);

  const handleCreateNew = () => {
    const newMode: StudyMode = {
      id: `mode-custom-${Date.now()}`,
      name: 'Custom Sprint',
      description: 'Custom focus session tailored for specific tasks',
      icon: 'Target',
      color: '#38bdf8',
      workDuration: 50,
      breakDuration: 10,
      cycles: 3,
      longBreakDuration: 20,
      longBreakInterval: 3,
      blocklist: [...DEFAULT_BLOCKLIST],
      blockedApps: [],
      allowlist: [],
      allowBreakWebsites: true,
      countTowardStats: true,
      isChillMode: false,
      blockingStrategy: 'dynamic_hosts',
      order: modes.length,
      createdAt: new Date().toISOString(),
    };
    const updated = [...modes, newMode];
    onSaveModes(updated);
    setEditingMode(newMode);
  };

  const handleDuplicate = (mode: StudyMode) => {
    const dupe: StudyMode = {
      ...mode,
      id: `mode-copy-${Date.now()}`,
      name: `${mode.name} (Copy)`,
      order: modes.length,
      createdAt: new Date().toISOString(),
    };
    const updated = [...modes, dupe];
    onSaveModes(updated);
  };

  const handleDelete = (modeId: string) => {
    if (modes.length <= 1) {
      alert('You must have at least one study mode.');
      return;
    }
    if (confirm('Delete this mode?')) {
      const updated = modes.filter((m) => m.id !== modeId);
      onSaveModes(updated);
      if (editingMode?.id === modeId) {
        setEditingMode(null);
      }
    }
  };

  const handleSaveEdit = () => {
    if (!editingMode) return;
    const updated = modes.map((m) => (m.id === editingMode.id ? editingMode : m));
    onSaveModes(updated);
    setEditingMode(null);
  };

  const handleAddDomain = (domain: string) => {
    if (!editingMode) return;
    const d = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (d && !editingMode.blocklist.includes(d)) {
      setEditingMode({
        ...editingMode,
        blocklist: [...editingMode.blocklist, d],
      });
    }
  };

  const handleRemoveDomain = (domain: string) => {
    if (!editingMode) return;
    setEditingMode({
      ...editingMode,
      blocklist: editingMode.blocklist.filter((d) => d !== domain),
    });
  };

  const handleAddApp = (app: string) => {
    if (!editingMode) return;
    const a = app.trim().replace(/\.app$/i, '');
    if (a && !editingMode.blockedApps.includes(a)) {
      setEditingMode({
        ...editingMode,
        blockedApps: [...(editingMode.blockedApps || []), a],
      });
    }
  };

  const handleRemoveApp = (app: string) => {
    if (!editingMode) return;
    setEditingMode({
      ...editingMode,
      blockedApps: (editingMode.blockedApps || []).filter((a) => a !== app),
    });
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
            onClick={onBackToLauncher}
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
              Study Modes & Durations
            </h1>
            <p 
              className="text-xs font-medium mt-0.5"
              style={{ color: currentTheme.textSecondary }}
            >
              Customize focus intervals, rest periods, cycle counts, and restriction blocklists
            </p>
          </div>
        </div>

        <button
          onClick={handleCreateNew}
          className="flex items-center space-x-1.5 px-4 py-2.5 rounded-2xl font-bold text-xs transition-all active:scale-95 shadow-md cursor-pointer"
          style={{
            backgroundColor: currentTheme.accent,
            color: currentTheme.accentText,
          }}
        >
          <Plus className="w-4 h-4" />
          <span>Create Mode</span>
        </button>
      </div>

      {/* Modes Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {modes.map((m) => (
          <div
            key={m.id}
            className="p-5 rounded-3xl liquid-glass-card border flex flex-col justify-between space-y-4 shadow-xl transition-all"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2.5">
                  <div
                    className="p-2 rounded-xl liquid-glass"
                    style={{ color: m.color || '#38bdf8' }}
                  >
                    <DynamicIcon name={m.icon} className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 
                      className="font-bold text-sm"
                      style={{ color: currentTheme.textPrimary }}
                    >
                      {m.name}
                    </h3>
                    <span 
                      className="text-[11px] font-medium"
                      style={{ color: currentTheme.textSecondary }}
                    >
                      {m.isChillMode ? 'Open Chill Mode' : `${m.workDuration}m Focus · ${m.breakDuration}m Rest`}
                    </span>
                  </div>
                </div>

                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: m.color || '#38bdf8', boxShadow: `0 0 8px ${m.color || '#38bdf8'}` }}
                />
              </div>

              <p 
                className="text-xs line-clamp-2 leading-relaxed"
                style={{ color: currentTheme.textSecondary }}
              >
                {m.description}
              </p>

              {/* Badges */}
              <div className="flex flex-wrap gap-1.5 mt-3">
                <span 
                  className="px-2 py-0.5 rounded-full text-[10px] font-mono liquid-glass"
                  style={{ color: currentTheme.textSecondary }}
                >
                  {m.cycles} {m.cycles === 1 ? 'Cycle' : 'Cycles'}
                </span>
                <span 
                  className="px-2 py-0.5 rounded-full text-[10px] font-mono liquid-glass"
                  style={{ color: currentTheme.textSecondary }}
                >
                  {m.blocklist.length} Websites
                </span>
                <span 
                  className="px-2 py-0.5 rounded-full text-[10px] font-mono liquid-glass"
                  style={{ color: currentTheme.textSecondary }}
                >
                  {(m.blockedApps || []).length} Apps
                </span>
              </div>
            </div>

            {/* Actions */}
            <div 
              className="flex items-center justify-between pt-3 border-t text-xs"
              style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
            >
              <button
                onClick={() => setEditingMode(m)}
                className="px-3 py-1.5 rounded-xl liquid-glass border font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
                style={{ color: currentTheme.textPrimary }}
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Configure</span>
              </button>

              <div className="flex items-center space-x-1">
                <button
                  onClick={() => handleDuplicate(m)}
                  className="p-1.5 transition-colors cursor-pointer"
                  style={{ color: currentTheme.textMuted }}
                  title="Duplicate Mode"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(m.id)}
                  className="p-1.5 hover:text-rose-500 transition-colors cursor-pointer"
                  style={{ color: currentTheme.textMuted }}
                  title="Delete Mode"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Mode Edit Modal */}
      {editingMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
          <div
            onClick={() => setEditingMode(null)}
            className="absolute inset-0 bg-black/75 transition-opacity"
          />

          <div
            className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto p-7 rounded-3xl border animate-modal-in shadow-2xl z-10 space-y-6"
            style={{ 
              backgroundColor: isDark ? '#0c0e16' : '#ffffff',
              borderColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.12)',
            }}
          >
            <div 
              className="flex items-center justify-between pb-4 border-b"
              style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
            >
              <h2 
                className="text-xl font-bold tracking-tight"
                style={{ color: currentTheme.textPrimary }}
              >
                Configure Mode: {editingMode.name}
              </h2>
              <button
                onClick={() => setEditingMode(null)}
                className="p-1.5 cursor-pointer"
                style={{ color: currentTheme.textSecondary }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label 
                  className="block text-xs font-mono mb-1.5"
                  style={{ color: currentTheme.textSecondary }}
                >
                  Mode Name
                </label>
                <input
                  type="text"
                  value={editingMode.name}
                  onChange={(e) => setEditingMode({ ...editingMode, name: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-2xl liquid-glass-input text-sm outline-none"
                  style={{ color: currentTheme.textPrimary }}
                />
              </div>

              <div>
                <label 
                  className="block text-xs font-mono mb-1.5"
                  style={{ color: currentTheme.textSecondary }}
                >
                  Description
                </label>
                <input
                  type="text"
                  value={editingMode.description}
                  onChange={(e) => setEditingMode({ ...editingMode, description: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-2xl liquid-glass-input text-sm outline-none"
                  style={{ color: currentTheme.textPrimary }}
                />
              </div>

              {/* Durations */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label 
                    className="block text-xs font-mono mb-1.5"
                    style={{ color: currentTheme.textSecondary }}
                  >
                    Focus (min)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="180"
                    value={editingMode.workDuration}
                    onChange={(e) => setEditingMode({ ...editingMode, workDuration: parseInt(e.target.value, 10) || 25 })}
                    className="w-full px-3 py-2 rounded-xl liquid-glass-input text-sm outline-none"
                    style={{ color: currentTheme.textPrimary }}
                  />
                </div>

                <div>
                  <label 
                    className="block text-xs font-mono mb-1.5"
                    style={{ color: currentTheme.textSecondary }}
                  >
                    Break (min)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="60"
                    value={editingMode.breakDuration}
                    onChange={(e) => setEditingMode({ ...editingMode, breakDuration: parseInt(e.target.value, 10) || 5 })}
                    className="w-full px-3 py-2 rounded-xl liquid-glass-input text-sm outline-none"
                    style={{ color: currentTheme.textPrimary }}
                  />
                </div>

                <div>
                  <label 
                    className="block text-xs font-mono mb-1.5"
                    style={{ color: currentTheme.textSecondary }}
                  >
                    Cycles
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={editingMode.cycles}
                    onChange={(e) => setEditingMode({ ...editingMode, cycles: parseInt(e.target.value, 10) || 1 })}
                    className="w-full px-3 py-2 rounded-xl liquid-glass-input text-sm outline-none"
                    style={{ color: currentTheme.textPrimary }}
                  />
                  <p className="text-[10px] mt-1 opacity-70" style={{ color: currentTheme.textSecondary }}>
                    1 cycle = one focus block that ends cleanly (ideal for scheduled template sessions).
                  </p>
                </div>
              </div>

              {/* Color Preset Palette */}
              <div>
                <label 
                  className="block text-xs font-mono mb-1.5"
                  style={{ color: currentTheme.textSecondary }}
                >
                  Accent Color
                </label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditingMode({ ...editingMode, color: c })}
                      className={`w-7 h-7 rounded-full border transition-all cursor-pointer ${
                        editingMode.color === c ? 'scale-110 border-white ring-2 ring-white/40' : 'border-transparent opacity-70 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Unified Blocklist & Blocked Apps Editor */}
              <div 
                className="space-y-2 pt-2 border-t"
                style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
              >
                <label 
                  className="block text-xs font-mono"
                  style={{ color: currentTheme.textSecondary }}
                >
                  Block Apps & Websites ({editingMode.blocklist.length} sites · {(editingMode.blockedApps || []).length} apps)
                </label>

                <AppSearchInput
                  theme={theme}
                  placeholder="Search apps & websites — e.g. 'discord'"
                  buttonLabel="Block"
                  onSelectApp={handleAddApp}
                  onSelectDomain={handleAddDomain}
                />

                {editingMode.blocklist.length > 0 || (editingMode.blockedApps || []).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pt-1">
                    {(editingMode.blockedApps || []).map((app) => (
                      <span
                        key={`app-${app}`}
                        className="px-2.5 py-1 rounded-lg text-xs font-mono liquid-glass border flex items-center space-x-1.5"
                        style={{ color: currentTheme.textPrimary }}
                      >
                        <BrandIcon name={app} size={13} fallback="globe" />
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
                    {editingMode.blocklist.map((d) => (
                      <span
                        key={`site-${d}`}
                        className="px-2.5 py-1 rounded-lg text-xs font-mono liquid-glass border flex items-center space-x-1.5"
                        style={{ color: currentTheme.textPrimary }}
                      >
                        <BrandIcon name={d} size={13} fallback="globe" fallbackColor="#10b981" />
                        <span>{d}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveDomain(d)}
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
                    className="text-xs font-mono pt-0.5"
                    style={{ color: currentTheme.textMuted }}
                  >
                    No apps or sites blocked. Search above to block both instantly — e.g. "discord" shows the Discord app and discord.com.
                  </p>
                )}
              </div>
            </div>

            {/* Save Actions */}
            <div 
              className="flex items-center justify-end space-x-2 pt-4 border-t"
              style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
            >
              <button
                type="button"
                onClick={() => setEditingMode(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                style={{ color: currentTheme.textSecondary }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="px-6 py-2.5 rounded-xl font-bold text-xs shadow-lg cursor-pointer"
                style={{
                  backgroundColor: currentTheme.accent,
                  color: currentTheme.accentText,
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
