import React, { useEffect, useState } from 'react';
import {
  Plus, Trash2, ArrowLeft, X, FolderPlus, Folder, ChevronDown, Pencil,
  StickyNote, Link2, Zap, Check, FolderSync, Palette,
} from 'lucide-react';
import { Note, NoteFolder, ObsidianConfig, StudyMode, ThemeId } from '../types';
import { THEMES } from '../styles/themes';
import { dropOrphanNoteFolderIds, groupNotesByFolder, notePreview } from '../services/notes';
import { ModeViewToggle, useModeViewPref } from './ModeViewToggle';
import { DynamicIcon } from './DynamicIcon';

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

interface NotesViewProps {
  notes: Note[];
  noteFolders: NoteFolder[];
  modes: StudyMode[];
  obsidianConfig?: ObsidianConfig;
  onSaveNotes: (notes: Note[]) => void;
  onSaveFolders: (folders: NoteFolder[]) => void;
  onSaveNotesAndFolders: (notes: Note[], folders: NoteFolder[]) => void;
  onBackToTasks: () => void;
  theme: ThemeId;
}

const UNGROUPED_KEY = '__ungrouped__';
const DRAG_MIME = 'text/note-id';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const NotesView: React.FC<NotesViewProps> = ({
  notes,
  noteFolders,
  modes,
  obsidianConfig,
  onSaveNotes,
  onSaveFolders,
  onSaveNotesAndFolders,
  onBackToTasks,
  theme,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;
  const folders = noteFolders || [];
  const modeNameById = new Map(modes.map((m) => [m.id, m.name]));
  const modeColorById = new Map(modes.map((m) => [m.id, m.color]));

  const [view, setView] = useModeViewPref('control-notes-view');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [linkingFolderId, setLinkingFolderId] = useState<string | null>(null);
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Edit modal draft (null = closed). `noteId` null means creating.
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [draftFolderId, setDraftFolderId] = useState('');

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  useEffect(() => {
    if (!syncFeedback) return;
    const id = window.setTimeout(() => setSyncFeedback(null), 4000);
    return () => window.clearTimeout(id);
  }, [syncFeedback]);

  const openCreate = () => {
    setIsCreating(true);
    setEditingNoteId('__new__');
    setDraftContent('');
    setDraftFolderId('');
  };

  const openEdit = (note: Note) => {
    setIsCreating(false);
    setEditingNoteId(note.id);
    setDraftContent(note.content);
    setDraftFolderId(note.folderId || '');
  };

  const closeEditor = () => {
    setEditingNoteId(null);
    setIsCreating(false);
  };

  const saveEditor = () => {
    const content = draftContent.trim();
    if (!content) return;
    const now = new Date().toISOString();
    if (isCreating) {
      const note: Note = {
        id: `note-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        content: content.slice(0, 20000),
        ...(draftFolderId ? { folderId: draftFolderId } : {}),
        createdAt: now,
        updatedAt: now,
      };
      onSaveNotes([...notes, note]);
    } else {
      onSaveNotes(
        notes.map((n) =>
          n.id === editingNoteId
            ? {
                ...n,
                content: content.slice(0, 20000),
                folderId: draftFolderId || undefined,
                updatedAt: now,
              }
            : n
        )
      );
    }
    closeEditor();
  };

  const handleDeleteNote = (noteId: string) => {
    if (!confirm('Delete this note?')) return;
    onSaveNotes(notes.filter((n) => n.id !== noteId));
    if (editingNoteId === noteId) closeEditor();
  };

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    onSaveFolders([
      ...folders,
      { id: `note-folder-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`, name, createdAt: new Date().toISOString(), color: '#38bdf8', icon: 'Folder' },
    ]);
    setNewFolderName('');
    setIsCreatingFolder(false);
  };

  const handleRenameFolder = () => {
    if (!renamingFolderId) return;
    const name = renameValue.trim();
    if (name) {
      onSaveFolders(folders.map((f) => (f.id === renamingFolderId ? { ...f, name } : f)));
    }
    setRenamingFolderId(null);
  };

  const updateFolder = (folderId: string, updates: Partial<NoteFolder>) => {
    onSaveFolders(folders.map((f) => (f.id === folderId ? { ...f, ...updates } : f)));
  };

  const handleDeleteFolder = (folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    const contained = notes.filter((n) => n.folderId === folderId).length;
    if (!confirm(`Delete folder "${folder.name}"?${contained > 0 ? ` Its ${contained} ${contained === 1 ? 'note' : 'notes'} will move to Ungrouped.` : ''}`)) {
      return;
    }
    const nextNotes = dropOrphanNoteFolderIds(
      notes.map((n) => (n.folderId === folderId ? { ...n, folderId: undefined } : n)),
      folders.filter((f) => f.id !== folderId)
    );
    onSaveNotesAndFolders(nextNotes, folders.filter((f) => f.id !== folderId));
    if (renamingFolderId === folderId) setRenamingFolderId(null);
  };

  const handleLinkMode = (folderId: string, modeId: string) => {
    onSaveFolders(
      folders.map((f) => (f.id === folderId ? { ...f, modeId: modeId || undefined } : f))
    );
    setLinkingFolderId?.(null);
  };

  const moveNoteToFolder = (noteId: string, folderId: string | undefined) => {
    const note = notes.find((n) => n.id === noteId);
    if (!note || note.folderId === folderId) return;
    onSaveNotes(notes.map((n) => (n.id === noteId ? { ...n, folderId, updatedAt: new Date().toISOString() } : n)));
  };

  const dragHandlers = (noteId: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DRAG_MIME, noteId);
      e.dataTransfer.effectAllowed = 'move';
      setDraggingNoteId(noteId);
    },
    onDragEnd: () => {
      setDraggingNoteId(null);
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
      if (id) moveNoteToFolder(id, folderId);
      setDraggingNoteId(null);
      setDropTarget(null);
    },
  });

  const handleSyncObsidian = async () => {
    if (!obsidianConfig?.vaultPath) {
      setSyncFeedback('Select an Obsidian vault in Settings first.');
      return;
    }
    if (!window.controlAPI?.syncNotesToObsidian) {
      setSyncFeedback('Notes sync needs the desktop app.');
      return;
    }
    setIsSyncing(true);
    try {
      const res = await window.controlAPI.syncNotesToObsidian(notes, folders, obsidianConfig);
      setSyncFeedback(
        res.success
          ? `Synced ${res.syncedCount} notes (${res.createdCount} new, ${res.updatedCount} updated) → Control/Notes`
          : `Sync failed: ${res.error || 'unknown error'}`
      );
    } catch (err) {
      setSyncFeedback(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const openQuickCapture = () => {
    window.controlAPI?.openQuickNote().catch(() => undefined);
  };

  const groups = groupNotesByFolder(notes, folders);
  const showGroupHeaders = folders.length > 0;
  const dimmed = (id: string) => (draggingNoteId === id ? { opacity: 0.4 } : undefined);

  const renderOriginChips = (note: Note) => (
    <span className="flex items-center gap-1.5 min-w-0">
      {note.modeName && (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-mono shrink-0"
          style={{ color: modeColorById.get(note.modeId || '') || currentTheme.accent }}
          title={note.modeId ? `Mode: ${note.modeName}` : note.modeName}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: modeColorById.get(note.modeId || '') || currentTheme.accent }}
          />
          {note.modeName}
        </span>
      )}
      {note.taskTitle && (
        <span
          className="text-[10px] font-mono truncate"
          style={{ color: currentTheme.textMuted }}
          title={`Task: ${note.taskTitle}`}
        >
          · {note.taskTitle}
        </span>
      )}
    </span>
  );

  const renderNoteCard = (note: Note) => (
    <div
      key={note.id}
      {...dragHandlers(note.id)}
      style={dimmed(note.id)}
      onClick={() => openEdit(note)}
      className="p-4 rounded-3xl liquid-glass-card border flex flex-col justify-between gap-3 shadow-xl transition-all cursor-grab active:cursor-grabbing min-h-[140px]"
      title="Click to edit · drag onto a folder to organize"
    >
      <p className="text-xs leading-relaxed line-clamp-4 whitespace-pre-wrap" style={{ color: currentTheme.textPrimary }}>
        {note.content}
      </p>
      <div
        className="flex items-center justify-between gap-2 pt-2 border-t"
        style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
      >
        {renderOriginChips(note)}
        <span className="text-[10px] font-mono shrink-0" style={{ color: currentTheme.textMuted }}>
          {formatDateTime(note.updatedAt)}
        </span>
      </div>
    </div>
  );

  const renderNoteRow = (note: Note) => (
    <div
      key={note.id}
      {...dragHandlers(note.id)}
      style={dimmed(note.id)}
      className="group px-4 py-2.5 rounded-2xl liquid-glass-card border flex items-center gap-3 transition-all cursor-grab active:cursor-grabbing"
      title="Drag onto a folder to organize"
    >
      <StickyNote className="w-4 h-4 shrink-0" style={{ color: currentTheme.textMuted }} />
      <div className="flex-1 min-w-0" onClick={() => openEdit(note)}>
        <p className="text-xs font-semibold truncate cursor-pointer" style={{ color: currentTheme.textPrimary }}>
          {notePreview(note, 140)}
        </p>
        <div className="mt-0.5">{renderOriginChips(note)}</div>
      </div>
      <span className="text-[10px] font-mono shrink-0" style={{ color: currentTheme.textMuted }}>
        {formatDateTime(note.updatedAt)}
      </span>
      <span className="flex items-center shrink-0">
        <button
          onClick={() => openEdit(note)}
          className="p-1.5 rounded-lg cursor-pointer"
          style={{ color: currentTheme.textSecondary }}
          title="Edit note"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => handleDeleteNote(note.id)}
          className="p-1.5 rounded-lg hover:text-rose-500 cursor-pointer"
          style={{ color: currentTheme.textMuted }}
          title="Delete note"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </span>
    </div>
  );

  const editingNote = editingNoteId && !isCreating ? notes.find((n) => n.id === editingNoteId) : null;

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
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: currentTheme.textPrimary }}>
              Notes
            </h1>
            <p className="text-xs font-medium mt-0.5" style={{ color: currentTheme.textSecondary }}>
              Quick captures, filed by task, mode, and folder
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ModeViewToggle view={view} onChange={setView} theme={theme} />
          <button
            onClick={() => setIsCreatingFolder(true)}
            className="flex items-center space-x-1.5 px-4 py-2.5 rounded-2xl liquid-glass border font-bold text-xs transition-all active:scale-95 cursor-pointer"
            style={{ color: currentTheme.textSecondary }}
            title="Create a folder — optionally linked to a mode for auto-filing"
          >
            <FolderPlus className="w-4 h-4" />
            <span className="hidden sm:inline">New Folder</span>
          </button>
          <button
            onClick={openQuickCapture}
            className="flex items-center space-x-1.5 px-4 py-2.5 rounded-2xl liquid-glass border font-bold text-xs transition-all active:scale-95 cursor-pointer"
            style={{ color: currentTheme.textSecondary }}
            title="Capture from anywhere (global shortcut or menu bar)"
          >
            <Zap className="w-4 h-4 text-amber-500" />
            <span className="hidden sm:inline">Quick Note</span>
          </button>
          <button
            onClick={openCreate}
            className="flex items-center space-x-1.5 px-4 py-2.5 rounded-2xl font-bold text-xs transition-all active:scale-95 shadow-md cursor-pointer"
            style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
          >
            <Plus className="w-4 h-4" />
            <span>New Note</span>
          </button>
        </div>
      </div>

      {/* Obsidian sync row */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleSyncObsidian}
          disabled={isSyncing || notes.length === 0}
          className="px-3 py-1.5 rounded-full liquid-glass border text-xs font-semibold flex items-center space-x-1.5 text-purple-400 hover:bg-purple-500/15 transition-all cursor-pointer disabled:opacity-40"
          title="Export notes to Control/Notes in your vault with YAML origin frontmatter"
        >
          <FolderSync className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{syncFeedback || (isSyncing ? 'Syncing…' : `Sync ${notes.length} to Obsidian`)}</span>
        </button>
        <span className="text-[11px] font-mono" style={{ color: currentTheme.textMuted }}>
          one-way export · YAML carries task / mode / folder
        </span>
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
            placeholder="Folder name — e.g. 25 English…"
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

      {/* Grouped notes */}
      {notes.length === 0 ? (
        <div className="py-12 text-center text-xs font-mono" style={{ color: currentTheme.textMuted }}>
          No notes yet. Hit the global shortcut from anywhere — they land here, linked to your current task.
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => {
            const groupKey = group.folder ? group.folder.id : UNGROUPED_KEY;
            const isCollapsed = !!collapsed[groupKey];
            const isDropTarget = dropTarget === groupKey && draggingNoteId;
            return (
              <div
                key={groupKey}
                {...dropHandlers(groupKey, group.folder?.id)}
                className="space-y-2 rounded-2xl transition-shadow p-1 -m-1"
                style={isDropTarget ? { boxShadow: `0 0 0 2px ${currentTheme.accent}` } : undefined}
                title={showGroupHeaders ? 'Drop a note here to move it into this folder' : undefined}
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
                          style={{ backgroundColor: `${group.folder.color || (group.folder.modeId ? currentTheme.accent : currentTheme.textMuted)}1a`, color: group.folder.color || (group.folder.modeId ? currentTheme.accent : currentTheme.textMuted) }}
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
                      {group.folder?.modeId && modeNameById.get(group.folder.modeId) && (
                        <span
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded-md shrink-0"
                          style={{
                            backgroundColor: `${modeColorById.get(group.folder.modeId) || currentTheme.accent}1a`,
                            color: modeColorById.get(group.folder.modeId) || currentTheme.accent,
                          }}
                          title="Quick notes captured in this mode file here automatically"
                        >
                          ⤷ {modeNameById.get(group.folder.modeId)}
                        </span>
                      )}
                      <span className="text-[11px] font-mono shrink-0" style={{ color: currentTheme.textMuted }}>
                        {group.notes.length}
                      </span>
                    </button>
                    <span className="flex-1" />
                    {group.folder && (
                      linkingFolderId === group.folder.id ? (
                        <select
                          autoFocus
                          value={group.folder.modeId || ''}
                          onChange={(e) => handleLinkMode(group.folder!.id, e.target.value)}
                          onBlur={() => setLinkingFolderId(null)}
                          className="px-2 py-1 rounded-lg liquid-glass-input text-[11px] outline-none cursor-pointer max-w-[150px]"
                          style={{ color: currentTheme.textPrimary }}
                          title="Link a mode for auto-filing"
                        >
                          <option value="">No linked mode</option>
                          {modes.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      ) : (
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
                            onClick={() => setLinkingFolderId(group.folder!.id)}
                            className="p-1.5 rounded-lg cursor-pointer"
                            style={{ color: group.folder!.modeId ? currentTheme.accent : currentTheme.textMuted }}
                            title="Link a mode — its quick notes file here automatically"
                          >
                            <Link2 className="w-3 h-3" />
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
                      )
                    )}
                  </div>
                )}
                {!isCollapsed && (
                  group.notes.length > 0 ? (
                    view === 'grid' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {group.notes.map(renderNoteCard)}
                      </div>
                    ) : (
                      <div className="space-y-2">{group.notes.map(renderNoteRow)}</div>
                    )
                  ) : (
                    <div
                      className="px-4 py-3 rounded-2xl border border-dashed text-xs font-mono"
                      style={{
                        borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
                        color: currentTheme.textMuted,
                      }}
                    >
                      {draggingNoteId ? 'Drop a note here to move it into this folder.' : 'No notes here yet — drag one in.'}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

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

      {/* Note editor modal */}
      {editingNoteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
          <div onClick={closeEditor} className="absolute inset-0 bg-transparent transition-opacity" />
          <div
            className="relative w-full max-w-xl max-h-[85vh] overflow-y-auto p-6 rounded-3xl border animate-modal-in shadow-2xl z-10 space-y-4"
            style={{
              backgroundColor: isDark ? '#0c0e16' : '#ffffff',
              borderColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.12)',
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-sky-500">
                {isCreating ? 'New note' : 'Edit note'}
              </span>
              <button onClick={closeEditor} className="p-1.5 cursor-pointer" style={{ color: currentTheme.textSecondary }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {!isCreating && editingNote && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono" style={{ color: currentTheme.textMuted }}>
                <span>Created {formatDateTime(editingNote.createdAt)}</span>
                {editingNote.taskTitle && <span title={`Task id: ${editingNote.taskId || '—'}`}>Task: {editingNote.taskTitle}</span>}
                {editingNote.modeName && <span>Mode: {editingNote.modeName}</span>}
              </div>
            )}

            <textarea
              autoFocus
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveEditor();
                if (e.key === 'Escape') closeEditor();
              }}
              placeholder="Write it down… (Markdown supported)"
              rows={10}
              className="w-full px-4 py-3 rounded-2xl liquid-glass-input text-sm outline-none resize-y"
              style={{ color: currentTheme.textPrimary }}
            />

            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-mono" style={{ color: currentTheme.textSecondary }}>
                Folder
              </label>
              <select
                value={draftFolderId}
                onChange={(e) => setDraftFolderId(e.target.value)}
                className="px-3 py-2 rounded-xl liquid-glass-input text-xs outline-none cursor-pointer"
                style={{ color: currentTheme.textPrimary }}
              >
                <option value="">Ungrouped</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <span className="flex-1" />
              {!isCreating && (
                <button
                  onClick={() => handleDeleteNote(editingNoteId)}
                  className="px-3 py-2 rounded-xl text-xs font-semibold hover:text-rose-500 cursor-pointer flex items-center gap-1.5"
                  style={{ color: currentTheme.textMuted }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              )}
              <button
                onClick={closeEditor}
                className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                style={{ color: currentTheme.textSecondary }}
              >
                Cancel
              </button>
              <button
                onClick={saveEditor}
                disabled={!draftContent.trim()}
                className="px-5 py-2 rounded-xl font-bold text-xs cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save ⌘↵</span>
              </button>
            </div>
            <p className="text-[10px] font-mono" style={{ color: currentTheme.textMuted }}>
              ⌘↵ saves · markdown supported · origin YAML is added on Obsidian export
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
