import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Check, ClipboardCopy, FileDown, FileText, FolderOpen,
  LayoutTemplate, Loader2, Plus, RefreshCw, Sparkles, Trash2, X, AlertCircle,
  BookOpen, Wand2, CalendarPlus, Pencil,
} from 'lucide-react';
import { ThemeId, DayMarkdownPlan, PlannerTemplate, PlannerMdStatus, DayPlan, ScheduleBlock, StudyMode } from '../types';
import { THEMES } from '../styles/themes';
import { plannerMd } from '../services/plannerMarkdown';
import {
  ScheduleTemplate,
  TemplateParseError,
  parseScheduleTemplate,
} from '../services/scheduleTemplates';
import {
  FlexTemplate,
  FlexParseError,
  parseFlexTemplate,
} from '../services/flexTemplates';
import { TemplateScheduleModal } from './TemplateScheduleModal';
import { AbsoluteScheduleModal } from './AbsoluteScheduleModal';
import { TemplateEditorModal } from './TemplateEditorModal';

interface DayPlanMarkdownViewProps {
  date: string;
  theme: ThemeId;
  vaultPath?: string;
  onOpenSettings?: () => void;
  modes: StudyMode[];
  plans: Record<string, DayPlan>;
  /**
   * Persist generated blocks as ordinary Day Planner events (and record the
   * daily note). Resolves with an error message, or null on success.
   */
  onGenerateSchedule: (
    date: string,
    blocks: ScheduleBlock[],
    meta: { templateName: string; templateTitle: string; mode?: 'add' | 'replace' }
  ) => Promise<string | null>;
}

export const DayPlanMarkdownView: React.FC<DayPlanMarkdownViewProps> = ({
  date,
  theme,
  vaultPath,
  onOpenSettings,
  modes,
  plans,
  onGenerateSchedule,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;

  const [status, setStatus] = useState<PlannerMdStatus | null>(null);
  const [plan, setPlan] = useState<DayMarkdownPlan | null>(null);
  const [templates, setTemplates] = useState<PlannerTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [pendingTaskIndex, setPendingTaskIndex] = useState<number | null>(null);

  // Apply-template modal
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<PlannerTemplate | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  // Templates manager modal
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [saveAsName, setSaveAsName] = useState('');
  const [duplicateTarget, setDuplicateTarget] = useState<string | null>(null);
  const [duplicateNewName, setDuplicateNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Inline task title editing
  const [editingTaskIndex, setEditingTaskIndex] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFeedback = useCallback((message: string, type: 'success' | 'error') => {
    setFeedback({ message, type });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 4000);
  }, []);

  const vaultActive = !!(vaultPath && vaultPath.trim());

  // Schedule-generator modal (duration style)
  const [scheduleTarget, setScheduleTarget] = useState<{
    template: ScheduleTemplate;
    parseErrors: TemplateParseError[];
  } | null>(null);
  // Absolute-time modal (flex format: # tasks with ## Time / ## Blocking)
  const [flexTarget, setFlexTarget] = useState<{
    template: FlexTemplate;
    parseErrors: FlexParseError[];
  } | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState<string | null>(null);

  // Template editor modal
  const [editorTarget, setEditorTarget] = useState<{
    name: string;
    content: string;
  } | null>(null);
  const [editorLoading, setEditorLoading] = useState<string | null>(null);

  /**
   * Open the right generator for a template (reads the file fresh):
   * absolute-time tasks route to the timed modal, otherwise the
   * duration-sequencing modal. Files with neither show their parse errors.
   */
  const handleGenerateClick = useCallback(
    async (t: PlannerTemplate) => {
      setScheduleLoading(t.name);
      try {
        const res = await plannerMd.readTemplate(t.name);
        if (!res.success || res.content === undefined) {
          showFeedback(res.error || `Could not read template "${t.name}".`, 'error');
          return;
        }
        const flex = parseFlexTemplate(t.name, res.content);
        if (flex.template.tasks.length > 0) {
          setFlexTarget({ template: flex.template, parseErrors: flex.errors });
          return;
        }
        const { template, errors } = parseScheduleTemplate(t.name, res.content);
        setScheduleTarget({ template, parseErrors: errors });
      } finally {
        setScheduleLoading(null);
      }
    },
    [showFeedback]
  );

  /** Open the Markdown editor for a template (reads the file fresh). */
  const handleEditClick = useCallback(
    async (t: PlannerTemplate) => {
      setEditorLoading(t.name);
      try {
        const res = await plannerMd.readTemplate(t.name);
        if (!res.success || res.content === undefined) {
          showFeedback(res.error || `Could not read template "${t.name}".`, 'error');
          return;
        }
        setEditorTarget({ name: t.name, content: res.content });
      } finally {
        setEditorLoading(null);
      }
    },
    [showFeedback]
  );

  const loadDay = useCallback(async () => {
    if (!vaultActive) {
      setPlan(null);
      setIsLoading(false);
      return;
    }
    const day = await plannerMd.readDay(date);
    setPlan(day);
  }, [date, vaultActive]);

  const loadAll = useCallback(async () => {
    if (!vaultActive) {
      setStatus(await plannerMd.getStatus());
      setPlan(null);
      setTemplates([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [st, day, tpls] = await Promise.all([
        plannerMd.getStatus(),
        plannerMd.readDay(date),
        plannerMd.listTemplates(),
      ]);
      setStatus(st);
      setPlan(day);
      setTemplates(tpls);
    } finally {
      setIsLoading(false);
    }
  }, [date, vaultActive]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  /** Persist editor content verbatim, then refresh the list. */
  const handleEditorSave = useCallback(
    async (name: string, content: string): Promise<string | null> => {
      const res = await plannerMd.writeTemplate(name, content);
      if (!res.success) return res.error || `Could not save template "${name}".`;
      await loadAll();
      showFeedback(
        res.template ? `Template "${res.template.title}" saved.` : `Template "${name}" saved.`,
        'success'
      );
      return null;
    },
    [loadAll, showFeedback]
  );

  // Two-way sync: refresh when Obsidian (or Control) changes the files
  useEffect(() => {
    const cleanup = plannerMd.onFileChanged((payload) => {
      if (payload.kind === 'day' && payload.fileName === `${date}.md`) {
        loadDay();
      } else if (payload.kind === 'template') {
        plannerMd.listTemplates().then(setTemplates);
      }
    });
    return cleanup;
  }, [date, loadDay]);

  const dateObj = useMemo(() => new Date(date + 'T00:00:00'), [date]);
  const heading = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const totalTasks = plan?.totalTasks || 0;
  const completedTasks = plan?.completedTasks || 0;
  const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const handleToggleTask = async (taskIndex: number, completed: boolean) => {
    if (!vaultActive || pendingTaskIndex !== null) return;
    setPendingTaskIndex(taskIndex);
    const res = await plannerMd.toggleTask(date, taskIndex, completed);
    setPendingTaskIndex(null);
    if (res.success && res.plan) {
      setPlan(res.plan);
    } else if (res.error) {
      showFeedback(res.error, 'error');
    }
  };

  const handleSaveTitle = async (taskIndex: number) => {
    const title = editTitle.trim();
    setEditingTaskIndex(null);
    if (!title) return;
    const res = await plannerMd.updateTaskTitle(date, taskIndex, title);
    if (res.success && res.plan) {
      setPlan(res.plan);
    } else if (res.error) {
      showFeedback(res.error, 'error');
    }
  };

  const openApplyModal = (template?: PlannerTemplate) => {
    setSelectedTemplate(template || null);
    setVariableValues({});
    setIsApplyModalOpen(true);
  };

  const handleApplyTemplate = async () => {
    if (!selectedTemplate) return;
    const res = await plannerMd.applyTemplate(selectedTemplate.name, date, variableValues);
    if (res.success && res.plan) {
      setPlan(res.plan);
      setIsApplyModalOpen(false);
      setSelectedTemplate(null);
      await loadAll();
      showFeedback(
        res.replaced
          ? `"${selectedTemplate.name}" applied — existing day file replaced.`
          : `"${selectedTemplate.name}" applied to ${heading}.`,
        'success'
      );
    } else if (res.error) {
      showFeedback(res.error, 'error');
    }
  };

  const handleCreateTemplate = async () => {
    const name = newTemplateName.trim();
    if (!name) return;
    const res = await plannerMd.createTemplate(name, '');
    if (res.success) {
      setNewTemplateName('');
      setTemplates(await plannerMd.listTemplates());
      showFeedback(`Template "${name}" created — opening the editor.`, 'success');
      // Jump straight into authoring: read back the skeleton for editing.
      const created = await plannerMd.readTemplate(name);
      if (created.success && created.content !== undefined) {
        setEditorTarget({ name, content: created.content });
      }
    } else if (res.error) {
      showFeedback(res.error, 'error');
    }
  };

  const handleSaveDayAsTemplate = async () => {
    const name = saveAsName.trim();
    if (!name) return;
    const res = await plannerMd.saveDayAsTemplate(date, name);
    if (res.success) {
      setSaveAsName('');
      setTemplates(await plannerMd.listTemplates());
      showFeedback(`Day saved as template "${name}".`, 'success');
    } else if (res.error) {
      showFeedback(res.error, 'error');
    }
  };

  const handleDuplicate = async () => {
    if (!duplicateTarget || !duplicateNewName.trim()) return;
    const res = await plannerMd.duplicateTemplate(duplicateTarget, duplicateNewName.trim());
    if (res.success) {
      setDuplicateTarget(null);
      setDuplicateNewName('');
      setTemplates(await plannerMd.listTemplates());
      showFeedback('Template duplicated.', 'success');
    } else if (res.error) {
      showFeedback(res.error, 'error');
    }
  };

  const handleDelete = async (name: string) => {
    const res = await plannerMd.deleteTemplate(name);
    if (res.success) {
      setConfirmDelete(null);
      setTemplates(await plannerMd.listTemplates());
      showFeedback(`Template "${name}" deleted.`, 'success');
    } else if (res.error) {
      showFeedback(res.error, 'error');
    }
  };

  const handleOpenDayFile = async () => {
    if (plan?.path) {
      const res = await plannerMd.openFile(plan.path);
      if (!res.success && res.error) showFeedback(res.error, 'error');
    }
  };

  // ── No vault connected ────────────────────────────────────────────────────
  if (!vaultActive) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="p-8 rounded-3xl liquid-glass-elevated border max-w-md text-center space-y-4"
          style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}>
          <BookOpen className="w-10 h-10 mx-auto text-purple-400" />
          <h2 className="text-lg font-bold" style={{ color: currentTheme.textPrimary }}>
            Obsidian Vault Not Connected
          </h2>
          <p className="text-xs font-medium" style={{ color: currentTheme.textSecondary }}>
            Day plans and templates live as plain Markdown inside your Obsidian vault.
            Connect your vault to start planning with reusable templates.
          </p>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-md cursor-pointer transition-all active:scale-95"
              style={{ backgroundColor: '#007aff' }}
            >
              Open Settings
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header toolbar */}
      <div
        className="px-6 py-3 border-b flex items-center justify-between shrink-0"
        style={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)' }}
      >
        <div className="flex items-center space-x-3 min-w-0">
          <div className="flex items-center space-x-2 min-w-0">
            <FileText className="w-4 h-4 text-purple-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-bold truncate" style={{ color: currentTheme.textPrimary }}>
                {heading}
              </div>
              <div className="text-[10px] font-mono truncate" style={{ color: currentTheme.textMuted }}>
                {status?.rootPath ? `${status.rootPath}/Days/${date}.md` : `Days/${date}.md`}
                {plan?.templateName ? ` · from “${plan.templateName}”` : ''}
              </div>
            </div>
          </div>

          {/* Progress meter */}
          {totalTasks > 0 && (
            <div className="hidden md:flex items-center space-x-2 pl-3 ml-1 border-l" style={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)' }}>
              <div className="w-28 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${progressPercent}%`,
                    background: 'linear-gradient(90deg, #38bdf8 0%, #10b981 100%)',
                  }}
                />
              </div>
              <span className="text-[11px] font-mono font-bold text-emerald-500">
                {completedTasks}/{totalTasks} · {progressPercent}%
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={() => plannerMd.readDay(date).then(setPlan)}
            className="p-2 rounded-xl liquid-glass border hover:bg-white/10 transition-all active:scale-95 cursor-pointer"
            style={{ color: currentTheme.textSecondary }}
            title="Reload from disk"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {plan?.exists && (
            <button
              onClick={handleOpenDayFile}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl liquid-glass border text-xs font-semibold transition-all hover:bg-purple-500/15 active:scale-95 cursor-pointer text-purple-400"
              title="Open this day file in Obsidian"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Open in Obsidian</span>
            </button>
          )}

          <button
            onClick={() => setIsManagerOpen(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl liquid-glass border text-xs font-semibold transition-all hover:bg-white/10 active:scale-95 cursor-pointer"
            style={{ color: currentTheme.textPrimary }}
          >
            <LayoutTemplate className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Templates</span>
          </button>

          <button
            onClick={() => openApplyModal()}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-white shadow-md transition-all hover:brightness-110 active:scale-95 cursor-pointer"
            style={{ backgroundColor: '#007aff' }}
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>Apply Template</span>
          </button>
        </div>
      </div>

      {/* Feedback toast */}
      {feedback && (
        <div
          className={`px-6 py-2 border-b text-xs font-semibold flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
              : 'bg-rose-500/15 border-rose-500/30 text-rose-400'
          }`}
        >
          <div className="flex items-center space-x-2">
            {feedback.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="hover:opacity-70 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Plan body */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {isLoading && !plan && (
            <div className="flex items-center justify-center py-16 space-x-2 text-xs font-semibold" style={{ color: currentTheme.textMuted }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading day plan…</span>
            </div>
          )}

          {!isLoading && plan && !plan.exists && (
            <div className="p-10 rounded-3xl liquid-glass border text-center space-y-4"
              style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}>
              <Sparkles className="w-8 h-8 mx-auto text-amber-400" />
              <h3 className="text-base font-bold" style={{ color: currentTheme.textPrimary }}>
                No Day Plan Yet
              </h3>
              <p className="text-xs font-medium max-w-sm mx-auto" style={{ color: currentTheme.textSecondary }}>
                Apply a template to generate <span className="font-mono">{date}.md</span> — or create
                one in Obsidian and it will appear here automatically.
              </p>
              <button
                onClick={() => openApplyModal()}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-md cursor-pointer transition-all active:scale-95"
                style={{ backgroundColor: '#007aff' }}
              >
                Apply a Template
              </button>
            </div>
          )}

          {plan?.exists && totalTasks === 0 && (
            <div className="p-8 rounded-3xl liquid-glass border text-center text-xs font-medium"
              style={{ color: currentTheme.textMuted, borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}>
              This day file has no checklist tasks yet. Add <span className="font-mono">- [ ] Task</span>{' '}
              lines in Obsidian, or apply a template.
            </div>
          )}

          {/* Sections & tasks */}
          {plan?.exists && plan.sections.map((section, sIdx) => (
            <div key={sIdx} className="space-y-2.5">
              {section.title && (
                <h3
                  className="text-xs font-mono uppercase tracking-widest font-bold pt-1"
                  style={{ color: currentTheme.textSecondary }}
                >
                  {section.title}
                </h3>
              )}

              <div className="space-y-1.5">
                {section.tasks.map((task) => {
                  const isEditing = editingTaskIndex === task.index;
                  const isPending = pendingTaskIndex === task.index;
                  return (
                    <div
                      key={task.index}
                      className="group p-3 rounded-2xl liquid-glass-card border flex items-center space-x-3 transition-all"
                      style={{
                        opacity: task.completed ? 0.6 : 1,
                        borderColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
                      }}
                    >
                      <button
                        onClick={() => handleToggleTask(task.index, !task.completed)}
                        disabled={isPending}
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-all cursor-pointer ${
                          task.completed ? 'bg-emerald-500 border-emerald-500' : ''
                        }`}
                        style={{
                          borderColor: task.completed ? undefined : isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)',
                        }}
                        title={task.completed ? 'Mark as not done' : 'Mark as done'}
                      >
                        {task.completed && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                        {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />}
                      </button>

                      {isEditing ? (
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={() => handleSaveTitle(task.index)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveTitle(task.index);
                            if (e.key === 'Escape') setEditingTaskIndex(null);
                          }}
                          autoFocus
                          className="flex-1 bg-transparent text-sm font-semibold outline-none border-b border-sky-500"
                          style={{ color: currentTheme.textPrimary }}
                        />
                      ) : (
                        <span
                          onDoubleClick={() => {
                            setEditingTaskIndex(task.index);
                            setEditTitle(task.title);
                          }}
                          className={`flex-1 text-sm font-semibold cursor-pointer hover:opacity-80 ${
                            task.completed ? 'line-through' : ''
                          }`}
                          style={{ color: task.completed ? currentTheme.textMuted : currentTheme.textPrimary }}
                          title="Double-click to edit"
                        >
                          {task.title}
                        </span>
                      )}

                      {task.durationMinutes !== undefined && (
                        <span
                          className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold shrink-0"
                          style={{
                            backgroundColor: isDark ? 'rgba(56,189,248,0.12)' : 'rgba(56,189,248,0.1)',
                            color: '#38bdf8',
                          }}
                        >
                          {task.durationMinutes}m
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ APPLY TEMPLATE MODAL ═══════════════════════════════════════════ */}
      {isApplyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
          <div onClick={() => setIsApplyModalOpen(false)} className="absolute inset-0 bg-transparent" />
          <div
            className="relative w-full max-w-lg p-6 rounded-3xl border shadow-2xl z-10 space-y-4 animate-modal-in max-h-[85vh] flex flex-col"
            style={{
              backgroundColor: isDark ? '#0e111a' : '#ffffff',
              borderColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)',
            }}
          >
            <div className="flex items-center justify-between pb-3 border-b shrink-0"
              style={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Wand2 className="w-3.5 h-3.5" />
                </div>
                <h2 className="text-sm font-bold" style={{ color: currentTheme.textPrimary }}>
                  Apply Template → {heading}
                </h2>
              </div>
              <button onClick={() => setIsApplyModalOpen(false)} className="p-1 hover:opacity-70 cursor-pointer" style={{ color: currentTheme.textSecondary }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {templates.length === 0 && (
                <div className="py-8 text-center text-xs font-medium" style={{ color: currentTheme.textMuted }}>
                  No templates found in <span className="font-mono">{status?.templatesDir}</span>.
                  Create one in Obsidian or via the Templates manager.
                </div>
              )}

              {templates.map((t) => {
                const isSelected = selectedTemplate?.name === t.name;
                return (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => {
                      setSelectedTemplate(t);
                      const defaults: Record<string, string> = {};
                      t.variables.forEach((v) => (defaults[v] = variableValues[v] || ''));
                      setVariableValues(defaults);
                    }}
                    className={`w-full p-3.5 rounded-2xl text-left border transition-all cursor-pointer flex items-center justify-between ${
                      isSelected ? 'bg-sky-500/15 border-sky-400/60 shadow-sm' : 'liquid-glass hover:bg-white/5'
                    }`}
                    style={{ borderColor: isSelected ? undefined : isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-bold truncate" style={{ color: currentTheme.textPrimary }}>
                          {t.title}
                        </span>
                        {t.variables.length > 0 && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-violet-500/20 text-violet-400 shrink-0">
                            {t.variables.length} var{t.variables.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-mono" style={{ color: currentTheme.textMuted }}>
                        {t.taskCount} tasks · {t.sectionCount} sections
                      </span>
                    </div>
                    <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                      isSelected ? 'bg-sky-500 border-sky-500 text-white' : ''
                    }`} style={{ borderColor: isSelected ? undefined : isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)' }}>
                      {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                    </span>
                  </button>
                );
              })}

              {/* Variable inputs */}
              {selectedTemplate && selectedTemplate.variables.length > 0 && (
                <div className="p-4 rounded-2xl border space-y-3"
                  style={{
                    backgroundColor: isDark ? 'rgba(139,92,246,0.06)' : 'rgba(139,92,246,0.04)',
                    borderColor: isDark ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.15)',
                  }}
                >
                  <span className="text-[11px] font-mono uppercase tracking-wider font-bold text-violet-400">
                    Template Variables
                  </span>
                  {selectedTemplate.variables.map((v) => (
                    <div key={v}>
                      <label className="text-[11px] font-mono block mb-1 font-semibold" style={{ color: currentTheme.textSecondary }}>
                        {v.replace(/_/g, ' ')}
                      </label>
                      <input
                        type="text"
                        value={variableValues[v] || ''}
                        onChange={(e) => setVariableValues((prev) => ({ ...prev, [v]: e.target.value }))}
                        placeholder={`Enter ${v.replace(/_/g, ' ')}…`}
                        className="w-full px-3 py-2 rounded-xl liquid-glass-input border text-xs font-semibold outline-none"
                        style={{ color: currentTheme.textPrimary }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {plan?.exists && selectedTemplate && (
                <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[11px] font-semibold text-amber-500 flex items-center space-x-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>A day plan already exists for {heading} — applying will replace it.</span>
                </div>
              )}
            </div>

            <div className="pt-2 flex items-center justify-end space-x-2 shrink-0 border-t"
              style={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
              <button
                onClick={() => setIsApplyModalOpen(false)}
                className="px-4 py-2 rounded-xl liquid-glass border text-xs font-semibold hover:bg-white/10 cursor-pointer"
                style={{ color: currentTheme.textSecondary }}
              >
                Cancel
              </button>
              <button
                onClick={handleApplyTemplate}
                disabled={!selectedTemplate}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white shadow-md transition-all hover:brightness-110 active:scale-95 cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
                style={{ backgroundColor: '#007aff' }}
              >
                Apply to {heading}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TEMPLATES MANAGER MODAL ════════════════════════════════════════ */}
      {isManagerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
          <div onClick={() => setIsManagerOpen(false)} className="absolute inset-0 bg-transparent" />
          <div
            className="relative w-full max-w-2xl p-6 rounded-3xl border shadow-2xl z-10 space-y-4 animate-modal-in max-h-[85vh] flex flex-col"
            style={{
              backgroundColor: isDark ? '#0e111a' : '#ffffff',
              borderColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)',
            }}
          >
            <div className="flex items-center justify-between pb-3 border-b shrink-0"
              style={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <LayoutTemplate className="w-3.5 h-3.5" />
                </div>
                <h2 className="text-sm font-bold" style={{ color: currentTheme.textPrimary }}>
                  Day Templates
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full liquid-glass" style={{ color: currentTheme.textMuted }}>
                  {status?.templatesDir}
                </span>
              </div>
              <button onClick={() => setIsManagerOpen(false)} className="p-1 hover:opacity-70 cursor-pointer" style={{ color: currentTheme.textSecondary }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {/* Template list */}
              {templates.length === 0 && (
                <div className="py-6 text-center text-xs font-medium" style={{ color: currentTheme.textMuted }}>
                  No templates yet. Create one below or drop <span className="font-mono">.md</span> files
                  into your vault's Templates folder.
                </div>
              )}

              {templates.map((t) => (
                <div
                  key={t.name}
                  className="p-3.5 rounded-2xl liquid-glass-card border space-y-2.5"
                  style={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-bold truncate" style={{ color: currentTheme.textPrimary }}>
                          {t.title}
                        </span>
                        {t.variables.length > 0 && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-violet-500/20 text-violet-400 shrink-0">
                            {t.variables.length} var{t.variables.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-mono" style={{ color: currentTheme.textMuted }}>
                        {t.taskCount} tasks · {t.sectionCount} sections ·{' '}
                        {new Date(t.updatedAt).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1 shrink-0">
                      <button
                        onClick={() => {
                          setIsManagerOpen(false);
                          openApplyModal(t);
                        }}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-white cursor-pointer transition-all active:scale-95"
                        style={{ backgroundColor: '#007aff' }}
                        title="Apply to selected date"
                      >
                        Apply
                      </button>
                      <button
                        onClick={() => handleGenerateClick(t)}
                        disabled={scheduleLoading === t.name}
                        className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-white cursor-pointer transition-all active:scale-95 disabled:opacity-50"
                        style={{ backgroundColor: '#10b981' }}
                        title="Generate timed calendar events from this template"
                      >
                        {scheduleLoading === t.name ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <CalendarPlus className="w-3 h-3" />
                        )}
                        <span>Schedule</span>
                      </button>
                      <button
                        onClick={() => plannerMd.openFile(t.path)}
                        className="p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                        style={{ color: currentTheme.textSecondary }}
                        title="Open in Obsidian"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleEditClick(t)}
                        disabled={editorLoading === t.name}
                        className="p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50"
                        style={{ color: currentTheme.textSecondary }}
                        title="Edit template Markdown in Control"
                      >
                        {editorLoading === t.name ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Pencil className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setDuplicateTarget(duplicateTarget === t.name ? null : t.name);
                          setDuplicateNewName(`${t.name} copy`);
                          setConfirmDelete(null);
                        }}
                        className="p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                        style={{ color: currentTheme.textSecondary }}
                        title="Duplicate"
                      >
                        <ClipboardCopy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setConfirmDelete(confirmDelete === t.name ? null : t.name);
                          setDuplicateTarget(null);
                        }}
                        className="p-1.5 rounded-lg hover:bg-rose-500/15 text-rose-400 transition-colors cursor-pointer"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Duplicate inline row */}
                  {duplicateTarget === t.name && (
                    <div className="flex items-center space-x-2 pt-1 border-t" style={{ borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }}>
                      <input
                        type="text"
                        value={duplicateNewName}
                        onChange={(e) => setDuplicateNewName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleDuplicate()}
                        autoFocus
                        className="flex-1 px-3 py-1.5 rounded-xl liquid-glass-input border text-xs font-semibold outline-none"
                        style={{ color: currentTheme.textPrimary }}
                        placeholder="New template name…"
                      />
                      <button
                        onClick={handleDuplicate}
                        className="px-3 py-1.5 rounded-xl text-[11px] font-bold text-white cursor-pointer"
                        style={{ backgroundColor: '#007aff' }}
                      >
                        Duplicate
                      </button>
                    </div>
                  )}

                  {/* Delete confirm inline row */}
                  {confirmDelete === t.name && (
                    <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }}>
                      <span className="text-[11px] font-semibold text-rose-400">
                        Delete “{t.title}” permanently?
                      </span>
                      <div className="flex items-center space-x-2">
                        <button onClick={() => setConfirmDelete(null)} className="text-[11px] font-semibold cursor-pointer" style={{ color: currentTheme.textMuted }}>
                          Cancel
                        </button>
                        <button
                          onClick={() => handleDelete(t.name)}
                          className="px-3 py-1.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-[11px] font-bold text-rose-400 cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Create new template */}
              <div className="p-4 rounded-2xl border space-y-2"
                style={{
                  backgroundColor: isDark ? 'rgba(56,189,248,0.05)' : 'rgba(56,189,248,0.04)',
                  borderColor: isDark ? 'rgba(56,189,248,0.15)' : 'rgba(56,189,248,0.12)',
                }}>
                <span className="text-[11px] font-mono uppercase tracking-wider font-bold text-sky-400">
                  New Template
                </span>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateTemplate()}
                    className="flex-1 px-3 py-2 rounded-xl liquid-glass-input border text-xs font-semibold outline-none"
                    style={{ color: currentTheme.textPrimary }}
                    placeholder="e.g. SAT Grind…"
                  />
                  <button
                    onClick={handleCreateTemplate}
                    disabled={!newTemplateName.trim()}
                    className="flex items-center space-x-1 px-3.5 py-2 rounded-xl text-xs font-bold text-white cursor-pointer disabled:opacity-30 transition-all active:scale-95"
                    style={{ backgroundColor: '#007aff' }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create</span>
                  </button>
                </div>
              </div>

              {/* Save current day as template */}
              <div className="p-4 rounded-2xl border space-y-2"
                style={{
                  backgroundColor: isDark ? 'rgba(16,185,129,0.05)' : 'rgba(16,185,129,0.04)',
                  borderColor: isDark ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.12)',
                }}>
                <span className="text-[11px] font-mono uppercase tracking-wider font-bold text-emerald-500">
                  Save {heading} as Template
                </span>
                <p className="text-[11px] font-medium" style={{ color: currentTheme.textMuted }}>
                  Checkboxes are reset so the saved template always starts fresh.
                </p>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={saveAsName}
                    onChange={(e) => setSaveAsName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveDayAsTemplate()}
                    className="flex-1 px-3 py-2 rounded-xl liquid-glass-input border text-xs font-semibold outline-none"
                    style={{ color: currentTheme.textPrimary }}
                    placeholder="e.g. My Perfect SAT Day…"
                    disabled={!plan?.exists || totalTasks === 0}
                  />
                  <button
                    onClick={handleSaveDayAsTemplate}
                    disabled={!saveAsName.trim() || !plan?.exists || totalTasks === 0}
                    className="flex items-center space-x-1 px-3.5 py-2 rounded-xl text-xs font-bold text-white cursor-pointer disabled:opacity-30 transition-all active:scale-95"
                    style={{ backgroundColor: '#10b981' }}
                    title={totalTasks === 0 ? 'This day has no tasks to save' : 'Save as template'}
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    <span>Save as Template</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Schedule generator modal */}
      {scheduleTarget && (
        <TemplateScheduleModal
          template={scheduleTarget.template}
          parseErrors={scheduleTarget.parseErrors}
          initialDate={date}
          modes={modes}
          plans={plans}
          theme={theme}
          onClose={() => setScheduleTarget(null)}
          onConfirm={onGenerateSchedule}
        />
      )}

      {/* Absolute-time template modal */}
      {flexTarget && (
        <AbsoluteScheduleModal
          template={flexTarget.template}
          parseErrors={flexTarget.parseErrors}
          initialDate={date}
          modes={modes}
          plans={plans}
          theme={theme}
          onClose={() => setFlexTarget(null)}
          onConfirm={onGenerateSchedule}
        />
      )}

      {/* Template editor modal */}
      {editorTarget && (
        <TemplateEditorModal
          initialName={editorTarget.name}
          initialContent={editorTarget.content}
          theme={theme}
          existingNames={templates.map((t) => t.name)}
          onClose={() => setEditorTarget(null)}
          onSave={handleEditorSave}
        />
      )}
    </div>
  );
};

export default DayPlanMarkdownView;
