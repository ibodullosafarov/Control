import React, { useState } from 'react';
import { Plus, Trash2, Copy, Edit2, ArrowLeft, X, FolderPlus, Folder, ChevronDown, Pencil, Play, Palette } from 'lucide-react';
import { ModeFolder, StudyMode, ThemeId } from '../types';
import { THEMES } from '../styles/themes';
import { DynamicIcon } from './DynamicIcon';
import { AppSearchInput } from './AppSearchInput';
import { BrandIcon } from './BrandIcon';
import { DEFAULT_BLOCKLIST } from '../services/defaultData';
import { isValidDomain } from '../services/domains';
import { groupModesByFolder } from '../services/modeFolders';
import { ModeViewToggle, useModeViewPref } from './ModeViewToggle';

const FOLDER_COLORS = [
  '#38bdf8',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#f43f5e',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
  '#64748b',
];

const FOLDER_ICONS = ['Folder', 'BookOpen', 'GraduationCap', 'Code', 'Brain', 'Target', 'Briefcase', 'Home', 'Heart', 'Zap'];

interface ModesManagerProps {
  modes: StudyMode[];
  modeFolders?: ModeFolder[];
  onSaveModes: (modes: StudyMode[]) => void;
  onSaveFolders?: (folders: ModeFolder[]) => void;
  onSaveModesAndFolders?: (modes: StudyMode[], folders: ModeFolder[]) => void;
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

const UNGROUPED_KEY = '__ungrouped__';
const DRAG_MIME = 'text/mode-id';

export const ModesManager: React.FC<ModesManagerProps> = ({
  modes,
  modeFolders,
  onSaveModes,
  onSaveFolders,
  onSaveModesAndFolders,
  onSelectMode,
  onBackToLauncher,
  theme,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;
  const folders = modeFolders || [];

  const persistFolders = (next: ModeFolder[]) => {
    onSaveFolders?.(next);
  };

const [editingMode, setEditingMode] = useState<StudyMode | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [view, setView] = useModeViewPref();
  const [draggingModeId, setDraggingModeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const handleCreateNew = () => {
    const newMode: StudyMode = {
      id: `mode-custom-${Date.now()}`,
      name: 'Custom Sprint',
      description: 'Custom control session tailored for specific tasks',
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
      folderId: undefined,
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
    // B-03: warn when tasks, planner blocks, or the active session
    // still reference this mode — deleting silently re-routes their timers.
    const refs: string[] = [];
    try {
      const raw = localStorage.getItem('control-app-data') || localStorage.getItem('focus-app-data');
      if (raw) {
        const parsed = JSON.parse(raw);
        const t = (parsed.tasks || []).filter((x: { modeId?: string }) => x.modeId === modeId).length;
        if (t) refs.push(`${t} task${t === 1 ? '' : 's'}`);
        const b = Object.values(parsed.plans || {}).flatMap((p: unknown) => (p as { blocks?: unknown[] }).blocks || []).filter((x) => (x as { modeId?: string }).modeId === modeId).length;
        if (b) refs.push(`${b} planner event${b === 1 ? '' : 's'}`);
        if (parsed.activeSession?.modeId === modeId) refs.push('the active session');
        if (parsed.settings?.defaultModeId === modeId) refs.push('the default mode');
      }
    } catch { /* best-effort warning only */ }
    const suffix = refs.length ? `\n\nStill referenced by: ${refs.join(', ')}. Those timers will fall back to another mode — remap them after deleting.` : '';
    if (confirm(`Delete this mode?${suffix}`)) {
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

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    persistFolders([
      ...folders,
      { id: `folder-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`, name, createdAt: new Date().toISOString(), color: '#38bdf8', icon: 'Folder' },
    ]);
    setNewFolderName('');
    setIsCreatingFolder(false);
  };

  const handleRenameFolder = () => {
    if (!renamingFolderId) return;
    const name = renameValue.trim();
    if (name) {
      persistFolders(folders.map((f) => (f.id === renamingFolderId ? { ...f, name } : f)));
    }
    setRenamingFolderId(null);
  };

  const updateFolder = (folderId: string, updates: Partial<ModeFolder>) => {
    persistFolders(folders.map((f) => (f.id === folderId ? { ...f, ...updates } : f)));
  };

  const handleDeleteFolder = (folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    const contained = modes.filter((m) => m.folderId === folderId).length;
    if (!confirm(`Delete folder "${folder.name}"?${contained > 0 ? ` Its ${contained} ${contained === 1 ? 'mode' : 'modes'} will move to Ungrouped.` : ''}`)) {
      return;
    }
    const nextModes = modes.map((m) => (m.folderId === folderId ? { ...m, folderId: undefined } : m));
    const nextFolders = folders.filter((f) => f.id !== folderId);
    if (onSaveModesAndFolders) {
      onSaveModesAndFolders(nextModes, nextFolders);
    } else {
      onSaveModes(nextModes);
      persistFolders(nextFolders);
    }
    if (renamingFolderId === folderId) setRenamingFolderId(null);
  };

  const moveModeToFolder = (modeId: string, folderId: string | undefined) => {
    const mode = modes.find((m) => m.id === modeId);
    if (!mode || mode.folderId === folderId) return;
    onSaveModes(modes.map((m) => (m.id === modeId ? { ...m, folderId } : m)));
  };

  const dragHandlers = (modeId: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DRAG_MIME, modeId);
      e.dataTransfer.effectAllowed = 'move';
      setDraggingModeId(modeId);
    },
    onDragEnd: () => {
      setDraggingModeId(null);
      setDropTarget(null);
    },
  });

  const dropHandlers = (groupKey: string, folderId: string | undefined) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dropTarget !== groupKey) setDropTarget(groupKey);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
        setDropTarget((prev) => (prev === groupKey ? null : prev));
      }
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData(DRAG_MIME);
      if (id) moveModeToFolder(id, folderId);
      setDraggingModeId(null);
      setDropTarget(null);
    },
  });

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

  const groups = groupModesByFolder(modes, folders);
  const showGroupHeaders = folders.length > 0;
  const dimmed = (id: string) => (draggingModeId === id ? { opacity: 0.4 } : undefined);

  const renderModeCard = (m: StudyMode) => (
    <div
      key={m.id}
      {...dragHandlers(m.id)}
      style={dimmed(m.id)}
      className="p-5 rounded-3xl liquid-glass-card border flex flex-col justify-between space-y-4 shadow-xl transition-all cursor-grab active:cursor-grabbing"
      title="Drag onto a folder to organize"
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
                {m.isChillMode ? 'Open Chill Mode' : `${m.workDuration}m Control · ${m.breakDuration}m Rest`}
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
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onSelectMode(m.id)}
            className="px-3 py-1.5 rounded-xl font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
            style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
            title="Use this mode"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>Use</span>
          </button>
          <button
            onClick={() => setEditingMode(m)}
            className="px-3 py-1.5 rounded-xl liquid-glass border font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
            style={{ color: currentTheme.textPrimary }}
          >
            <Edit2 className="w-3.5 h-3.5" />
            <span>Configure</span>
          </button>
        </div>

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
  );

  const renderModeRow = (m: StudyMode) => (
    <div
      key={m.id}
      {...dragHandlers(m.id)}
      style={dimmed(m.id)}
      className="group px-4 py-3 rounded-2xl liquid-glass-card border flex items-center gap-3 transition-all cursor-grab active:cursor-grabbing"
      title="Drag onto a folder to organize"
    >
      <div
        className="p-2 rounded-xl shrink-0"
        style={{ backgroundColor: `${m.color || '#38bdf8'}1a`, color: m.color || '#38bdf8' }}
      >
        <DynamicIcon name={m.icon} className="w-4 h-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h3
            className="font-bold text-sm truncate"
            style={{ color: currentTheme.textPrimary }}
          >
            {m.name}
          </h3>
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: m.color || '#38bdf8' }}
          />
        </div>
        <p
          className="text-[11px] font-mono truncate mt-0.5"
          style={{ color: currentTheme.textSecondary }}
        >
          {m.isChillMode
            ? 'Open chill · no blocking'
            : `${m.workDuration}m control · ${m.breakDuration}m rest`}
          {'  ·  '}{m.blocklist.length} sites · {(m.blockedApps || []).length} apps
        </p>
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={() => onSelectMode(m.id)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer"
          style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
          title="Use this mode"
        >
          <Play className="w-3 h-3 fill-current" />
          <span className="hidden sm:inline">Use</span>
        </button>
        <button
          onClick={() => setEditingMode(m)}
          className="p-2 rounded-lg transition-colors cursor-pointer"
          style={{ color: currentTheme.textSecondary }}
          title="Configure mode"
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => handleDuplicate(m)}
          className="p-2 rounded-lg transition-colors cursor-pointer"
          style={{ color: currentTheme.textMuted }}
          title="Duplicate mode"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => handleDelete(m.id)}
          className="p-2 rounded-lg hover:text-rose-500 transition-colors cursor-pointer"
          style={{ color: currentTheme.textMuted }}
          title="Delete mode"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

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
              Customize control intervals, rest periods, and restriction blocklists
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ModeViewToggle view={view} onChange={setView} theme={theme} />
          <button
            onClick={() => setIsCreatingFolder(true)}
            className="flex items-center space-x-1.5 px-4 py-2.5 rounded-2xl liquid-glass border font-bold text-xs transition-all active:scale-95 cursor-pointer"
            style={{ color: currentTheme.textSecondary }}
            title="Create a folder to organize modes — drag modes onto it"
          >
            <FolderPlus className="w-4 h-4" />
            <span className="hidden sm:inline">New Folder</span>
          </button>
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
      </div>

      {/* Inline folder creation */}
      {isCreatingFolder && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-2xl liquid-glass border">
          <Folder className="w-4 h-4 shrink-0" style={{ color: currentTheme.textSecondary }} />
          <input
            autoFocus
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFolder();
              if (e.key === 'Escape') { setIsCreatingFolder(false); setNewFolderName(''); }
            }}
            placeholder="Folder name — e.g. School, Languages…"
            className="flex-1 bg-transparent text-sm font-semibold outline-none min-w-0"
            style={{ color: currentTheme.textPrimary }}
          />
          <button
            onClick={handleCreateFolder}
            disabled={!newFolderName.trim()}
            className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-40"
            style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
          >
            Add
          </button>
          <button
            onClick={() => { setIsCreatingFolder(false); setNewFolderName(''); }}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer"
            style={{ color: currentTheme.textSecondary }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Grouped modes */}
      <div className="space-y-5">
        {groups.map((group) => {
          const groupKey = group.folder ? group.folder.id : UNGROUPED_KEY;
          const isCollapsed = !!collapsed[groupKey];
          const isDropTarget = dropTarget === groupKey && draggingModeId;
          return (
            <div
              key={groupKey}
              {...dropHandlers(groupKey, group.folder?.id)}
              className="space-y-2 rounded-2xl transition-shadow p-1 -m-1"
              style={isDropTarget ? { boxShadow: `0 0 0 2px ${currentTheme.accent}` } : undefined}
              title={showGroupHeaders ? 'Drop a mode here to move it into this folder' : undefined}
            >
              {showGroupHeaders && (
                <div className="flex items-center gap-1.5 px-1">
                  <button
                    onClick={() => setCollapsed((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }))}
                    className="flex items-center gap-2 min-w-0 cursor-pointer group/header"
                    title={isCollapsed ? 'Expand' : 'Collapse'}
                  >
                    <ChevronDown
                      className={`w-3.5 h-3.5 shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                      style={{ color: currentTheme.textMuted }}
                    />
                    {group.folder ? (
                      <div
                        className="p-1 rounded-lg"
                        style={{ backgroundColor: `${group.folder.color || currentTheme.accent}1a`, color: group.folder.color || currentTheme.accent }}
                      >
                        <DynamicIcon name={group.folder.icon || 'Folder'} className="w-3.5 h-3.5" />
                      </div>
                    ) : null}
                    {renamingFolderId === group.folder?.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') handleRenameFolder();
                          if (e.key === 'Escape') setRenamingFolderId(null);
                        }}
                        onBlur={handleRenameFolder}
                        className="text-xs font-mono font-bold uppercase tracking-widest bg-transparent outline-none border-b min-w-0 w-40"
                        style={{ color: currentTheme.textPrimary, borderColor: currentTheme.accent }}
                      />
                    ) : (
                      <span
                        className="text-xs font-mono font-bold uppercase tracking-widest truncate"
                        style={{ color: currentTheme.textSecondary }}
                      >
                        {group.folder ? group.folder.name : 'Ungrouped'}
                      </span>
                    )}
                    <span
                      className="text-[11px] font-mono shrink-0"
                      style={{ color: currentTheme.textMuted }}
                    >
                      {group.modes.length}
                    </span>
                  </button>
                    <span className="flex-1" />
                    {group.folder && (
                      <span className="flex items-center opacity-0 group-hover/header:opacity-100 control-within:opacity-100 transition-opacity">
                        <button
                          onClick={() => setEditingFolderId(group.folder!.id)}
                          className="p-1.5 rounded-lg cursor-pointer"
                          style={{ color: currentTheme.textMuted }}
                          title="Customize folder"
                        >
                          <Palette className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => {
                            setRenamingFolderId(group.folder!.id);
                            setRenameValue(group.folder!.name);
                          }}
                          className="p-1.5 rounded-lg cursor-pointer"
                          style={{ color: currentTheme.textMuted }}
                          title="Rename folder"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDeleteFolder(group.folder!.id)}
                          className="p-1.5 rounded-lg hover:text-rose-500 cursor-pointer"
                          style={{ color: currentTheme.textMuted }}
                          title="Delete folder"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </span>
                    )}
                </div>
              )}
              {!isCollapsed && (
                group.modes.length > 0 ? (
                  view === 'grid' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {group.modes.map(renderModeCard)}
                    </div>
                  ) : (
                    <div className="space-y-2">{group.modes.map(renderModeRow)}</div>
                  )
                ) : (
                  <div
                    className="px-4 py-3 rounded-2xl border border-dashed text-xs font-mono"
                    style={{
                      borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
                      color: currentTheme.textMuted,
                    }}
                  >
                    {draggingModeId ? 'Drop a mode here to move it into this folder.' : 'No modes here yet — drag one in, or edit a mode to move it.'}
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Folder Customize Modal */}
      {editingFolderId && (() => {
        const folder = folders.find((f) => f.id === editingFolderId);
        if (!folder) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
            <div onClick={() => setEditingFolderId(null)} className="absolute inset-0 bg-transparent transition-opacity" />
            <div
              className="relative w-full max-w-md p-6 rounded-3xl border animate-modal-in shadow-2xl z-10 space-y-5"
              style={{
                backgroundColor: isDark ? '#0c0e16' : '#ffffff',
                borderColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.12)',
              }}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold tracking-tight" style={{ color: currentTheme.textPrimary }}>
                  Customize Folder
                </h2>
                <button onClick={() => setEditingFolderId(null)} className="p-1.5 cursor-pointer" style={{ color: currentTheme.textSecondary }}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-2xl liquid-glass border">
                <div
                  className="p-2 rounded-xl"
                  style={{ backgroundColor: `${folder.color || '#38bdf8'}1a`, color: folder.color || '#38bdf8' }}
                >
                  <DynamicIcon name={folder.icon || 'Folder'} className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold" style={{ color: currentTheme.textPrimary }}>{folder.name}</div>
                  <div className="text-xs" style={{ color: currentTheme.textSecondary }}>Preview</div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono mb-2" style={{ color: currentTheme.textSecondary }}>Color</label>
                <div className="flex flex-wrap gap-2">
                  {FOLDER_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => updateFolder(folder.id, { color: c })}
                      className={`w-7 h-7 rounded-full border transition-all cursor-pointer ${folder.color === c ? 'scale-110 border-white ring-2 ring-white/40' : 'border-transparent opacity-70 hover:opacity-100'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono mb-2" style={{ color: currentTheme.textSecondary }}>Icon</label>
                <div className="flex flex-wrap gap-1.5">
                  {FOLDER_ICONS.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => updateFolder(folder.id, { icon })}
                      className={`p-2 rounded-xl border transition-all cursor-pointer ${folder.icon === icon ? 'ring-2' : 'opacity-70 hover:opacity-100'}`}
                      style={{ borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)', color: folder.icon === icon ? (folder.color || currentTheme.accent) : currentTheme.textSecondary }}
                    >
                      <DynamicIcon name={icon} className="w-4 h-4" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setEditingFolderId(null)}
                  className="px-5 py-2 rounded-xl font-bold text-xs"
                  style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Mode Edit Modal */}
      {editingMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
          <div
            onClick={() => setEditingMode(null)}
            className="absolute inset-0 bg-transparent transition-opacity"
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

              <div>
                <label
                  className="block text-xs font-mono mb-1.5"
                  style={{ color: currentTheme.textSecondary }}
                >
                  Folder
                </label>
                <select
                  value={editingMode.folderId || ''}
                  onChange={(e) =>
                    setEditingMode({ ...editingMode, folderId: e.target.value || undefined })
                  }
                  className="w-full px-4 py-2.5 rounded-2xl liquid-glass-input text-sm outline-none cursor-pointer"
                  style={{ color: currentTheme.textPrimary }}
                >
                  <option value="">Ungrouped</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Durations */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label
                    className="block text-xs font-mono mb-1.5"
                    style={{ color: currentTheme.textSecondary }}
                  >
                    Control (min)
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
                  {/* B-22: single-cycle modes end after one control block — a
                  configured break never runs, so say so instead of implying it. */}
                  {(editingMode.cycles ?? 1) <= 1 && !editingMode.isChillMode && (
                    <p className="text-[11px] mt-1" style={{ color: currentTheme.textMuted }}>
                      1-cycle modes stop after one control block (no trailing break runs — breaks are the gaps between events).
                    </p>
                  )}
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
                    onChange={(e) => setEditingMode({ ...editingMode, cycles: Math.min(12, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
                    className="w-full px-3 py-2 rounded-xl liquid-glass-input text-sm outline-none"
                    style={{ color: currentTheme.textPrimary }}
                  />
                </div>

              </div>

              {/* Break shielding */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold" style={{ color: currentTheme.textPrimary }}>
                    Keep Shield on during breaks
                  </div>
                  <div className="text-xs" style={{ color: currentTheme.textSecondary }}>
                    Off = breaks unblock (default for most modes).
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={editingMode.allowBreakWebsites === false}
                  onChange={(e) =>
                    setEditingMode({ ...editingMode, allowBreakWebsites: e.target.checked ? false : true })
                  }
                />
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
                {/* B-15: a mistyped domain looks blocked but matches nothing
                (e.g. chatgpt.com.com vs chatgpt.com). Flag rather than guess. */}
                {editingMode.blocklist.filter((d) => !isValidDomain(d)).length > 0 && (
                  <p className="text-[11px] font-medium text-amber-500">
                    These don't look like domains and will never match anything:{' '}
                    {editingMode.blocklist.filter((d) => !isValidDomain(d)).join(', ')}. Remove or correct them.
                  </p>
                )}
                <p className="text-[11px]" style={{ color: currentTheme.textMuted }}>
                  Apps are process names as shown in Activity Monitor (e.g. Discord, Telegram) — web services like Google Docs are not apps and won't match.
                </p>

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
