import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  Clock,
  X,
} from 'lucide-react';
import {
  DayPlan,
  ScheduleBlock,
  StudyMode,
  ThemeId,
} from '../types';
import { THEMES } from '../styles/themes';
import {
  GenerationConfig,
  ScheduleTemplate,
  SessionOverride,
  TemplateParseError,
  generateSchedule,
  validateSingleBlockDurations,
} from '../services/scheduleTemplates';

interface TemplateScheduleModalProps {
  template: ScheduleTemplate;
  parseErrors: TemplateParseError[];
  initialDate: string;
  modes: StudyMode[];
  plans: Record<string, DayPlan>;
  theme: ThemeId;
  onClose: () => void;
  /**
   * Persist the generated blocks (and record the daily note). Resolves with
   * an error message on failure, or null on success. The modal disables
   * itself while this runs so double-clicks can never duplicate sessions.
   */
  onConfirm: (
    date: string,
    blocks: ScheduleBlock[],
    meta: { templateName: string; templateTitle: string }
  ) => Promise<string | null>;
}

function cardBorder(isDark: boolean): string {
  return isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
}

export const TemplateScheduleModal: React.FC<TemplateScheduleModalProps> = ({
  template,
  parseErrors,
  initialDate,
  modes,
  plans,
  theme,
  onClose,
  onConfirm,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;

  const [date, setDate] = useState(initialDate);
  const [startTime, setStartTime] = useState(template.defaultStart || '09:00');
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<number, SessionOverride>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const setOverride = (order: number, patch: Partial<SessionOverride>) => {
    setOverrides((prev) => ({ ...prev, [order]: { ...(prev[order] || {}), ...patch } }));
  };

  const config: GenerationConfig = useMemo(
    () => ({ date, startTime, variables, overrides }),
    [date, startTime, variables, overrides]
  );

  const result = useMemo(() => {
    const existingBlocks = plans[date]?.blocks || [];
    return generateSchedule(template, config, { modes, existingBlocks });
  }, [template, config, modes, plans, date]);

  const blocked = parseErrors.length > 0 || result.errors.length > 0 || isSubmitting;
  const hasConflicts = result.conflicts.length > 0;

  // Single-block modes should match their focus length (multi-cycle exempt).
  // Warning only — fix by editing Minutes above or snapping here.
  const mismatches = useMemo(
    () => validateSingleBlockDurations(result.blocks, modes),
    [result.blocks, modes]
  );
  const snapMismatch = (mismatchIndex: number) => {
    const mismatch = mismatches.find((m) => m.index === mismatchIndex);
    const session = template.sessions[mismatchIndex];
    if (!mismatch || !session) return;
    setOverride(session.order, { durationMinutes: mismatch.focusMinutes });
  };

  const handleConfirm = async () => {
    if (blocked || result.blocks.length === 0) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const error = await onConfirm(date, result.blocks, {
        templateName: template.name,
        templateTitle: template.title,
      });
      if (error) {
        setSubmitError(error);
        setIsSubmitting(false);
      } else {
        onClose();
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setIsSubmitting(false);
    }
  };

  const effectiveDuration = (order: number, fallback: number | null): string => {
    const ov = overrides[order]?.durationMinutes;
    if (ov !== undefined) return String(ov);
    return fallback === null ? '' : String(fallback);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => !isSubmitting && onClose()} />
      <div
        className="relative w-full max-w-2xl max-h-[88vh] overflow-y-auto p-6 rounded-3xl liquid-glass border space-y-4 animate-modal-in"
        style={{ borderColor: cardBorder(currentTheme.isDark) }}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold" style={{ color: currentTheme.textPrimary }}>
              Generate schedule — {template.title}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: currentTheme.textSecondary }}>
              {template.sessions.length} session{template.sessions.length === 1 ? '' : 's'} · preview, then confirm.
              Nothing is created until you confirm.
            </p>
          </div>
          <button
            onClick={() => !isSubmitting && onClose()}
            className="p-1.5 rounded-xl hover:bg-white/10 cursor-pointer"
            style={{ color: currentTheme.textSecondary }}
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Template problems block generation until fixed in Obsidian */}
        {parseErrors.length > 0 && (
          <div className="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 space-y-1.5">
            <div className="flex items-center space-x-2 text-xs font-bold text-rose-400">
              <X className="w-4 h-4" />
              <span>This template needs fixes before it can generate a schedule</span>
            </div>
            {parseErrors.map((e, i) => (
              <p key={i} className="text-[11px] leading-relaxed" style={{ color: currentTheme.textSecondary }}>
                {e.section ? `“${e.section}”${e.field ? ` · ${e.field}` : ''}: ` : ''}{e.message}
              </p>
            ))}
            <p className="text-[11px]" style={{ color: currentTheme.textSecondary }}>
              Edit <span className="font-mono">{template.name}.md</span> in Obsidian and come back —
              the file watcher picks up changes automatically.
            </p>
          </div>
        )}

        {/* Target date + start time */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-bold block mb-1" style={{ color: currentTheme.textSecondary }}>
              Target date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-1.5 rounded-xl liquid-glass-input border text-xs outline-none"
              style={{ color: currentTheme.textPrimary }}
            />
          </div>
          <div>
            <label className="text-[11px] font-bold block mb-1" style={{ color: currentTheme.textSecondary }}>
              Start time
            </label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-3 py-1.5 rounded-xl liquid-glass-input border text-xs outline-none"
              style={{ color: currentTheme.textPrimary }}
            />
          </div>
        </div>

        {/* Template variables */}
        {template.variables.length > 0 && (
          <div className="p-4 rounded-2xl liquid-glass-card border space-y-2">
            <span className="text-xs font-bold" style={{ color: currentTheme.textPrimary }}>
              Template values
            </span>
            {template.variables.map((v) => (
              <div key={v} className="flex items-center space-x-2">
                <code className="text-[11px] font-mono w-28 shrink-0" style={{ color: currentTheme.textSecondary }}>
                  {`{{${v}}}`}
                </code>
                <input
                  type="text"
                  value={variables[v] || ''}
                  onChange={(e) => setVariables((prev) => ({ ...prev, [v]: e.target.value }))}
                  placeholder={`Value for ${v}…`}
                  className="flex-1 px-3 py-1.5 rounded-xl liquid-glass-input border text-xs outline-none"
                  style={{ color: currentTheme.textPrimary }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Per-session overrides */}
        <div className="space-y-2">
          <span className="text-xs font-bold" style={{ color: currentTheme.textPrimary }}>
            Sessions <span className="font-medium opacity-60">(overrides apply to this run only)</span>
          </span>
          {template.sessions.map((s, i) => {
            const ov = overrides[s.order] || {};
            const preview = result.blocks[i];
            const effTimer = ov.timer ?? s.timer ?? (s.kind === 'break' ? false : true);
            const effFocus = ov.focusMode !== undefined ? ov.focusMode : s.focusMode;
            return (
              <div key={s.order} className="p-3.5 rounded-2xl liquid-glass-card border space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={ov.title !== undefined ? ov.title : s.title}
                    onChange={(e) => setOverride(s.order, { title: e.target.value })}
                    className="flex-1 min-w-0 px-2.5 py-1 rounded-lg liquid-glass-input border text-xs font-bold outline-none"
                    style={{ color: currentTheme.textPrimary }}
                  />
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border shrink-0 ${
                      s.kind === 'break' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                    }`}
                  >
                    {s.kind}
                  </span>
                  {preview && (
                    <span className="text-[11px] font-mono font-bold shrink-0" style={{ color: currentTheme.textPrimary }}>
                      {preview.startTime}–{preview.endTime}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <label className="block">
                    <span className="text-[10px] opacity-70" style={{ color: currentTheme.textSecondary }}>
                      Minutes
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={effectiveDuration(s.order, s.durationMinutes)}
                      onChange={(e) =>
                        setOverride(s.order, {
                          durationMinutes: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0),
                        })
                      }
                      className="w-full mt-0.5 px-2 py-1 rounded-lg liquid-glass-input border text-xs font-mono outline-none"
                      style={{ color: currentTheme.textPrimary }}
                    />
                  </label>
                  {s.countLabel && (
                    <label className="block">
                      <span className="text-[10px] opacity-70 capitalize" style={{ color: currentTheme.textSecondary }}>
                        {s.countLabel}
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={ov.countValue !== undefined && ov.countValue !== null ? ov.countValue : s.countValue ?? ''}
                        onChange={(e) =>
                          setOverride(s.order, {
                            countValue: e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10) || 0),
                          })
                        }
                        className="w-full mt-0.5 px-2 py-1 rounded-lg liquid-glass-input border text-xs font-mono outline-none"
                        style={{ color: currentTheme.textPrimary }}
                      />
                    </label>
                  )}
                  <label className="flex items-end space-x-1.5 pb-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={effTimer}
                      onChange={(e) => setOverride(s.order, { timer: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-[11px]" style={{ color: currentTheme.textPrimary }}>Timer</span>
                  </label>
                  <label className="block">
                    <span className="text-[10px] opacity-70" style={{ color: currentTheme.textSecondary }}>
                      Focus
                    </span>
                    <select
                      value={effFocus === null || effFocus === undefined ? '' : effFocus ? 'on' : 'off'}
                      onChange={(e) =>
                        setOverride(s.order, {
                          focusMode: e.target.value === '' ? null : e.target.value === 'on',
                        })
                      }
                      className="w-full mt-0.5 px-2 py-1 rounded-lg liquid-glass-input border text-xs outline-none cursor-pointer"
                      style={{ color: currentTheme.textPrimary }}
                    >
                      <option value="">Follow mode</option>
                      <option value="on">On</option>
                      <option value="off">Off</option>
                    </select>
                  </label>
                </div>
                {s.modeName && (
                  <p className="text-[10px] opacity-70" style={{ color: currentTheme.textSecondary }}>
                    Mode: {s.modeName}
                    {s.notes.length > 0 ? ` · ${s.notes.join(' · ')}` : ''}
                  </p>
                )}
                {!s.modeName && s.notes.length > 0 && (
                  <p className="text-[10px] opacity-70" style={{ color: currentTheme.textSecondary }}>
                    {s.notes.join(' · ')}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Generation errors */}
        {result.errors.length > 0 && (
          <div className="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 space-y-1">
            {result.errors.map((msg, i) => (
              <p key={i} className="text-[11px] text-rose-400">{msg}</p>
            ))}
          </div>
        )}

        {/* Already applied */}
        {result.alreadyApplied && result.errors.length === 0 && (
          <div className="flex items-start space-x-2 text-[11px] text-amber-500">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              This template was already applied to {date}. Generating again will add duplicate-titled
              sessions unless that was your intent.
            </span>
          </div>
        )}

        {/* Conflicts */}
        {hasConflicts && result.errors.length === 0 && (
          <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 space-y-1.5">
            <div className="flex items-center space-x-2 text-xs font-bold text-amber-500">
              <AlertTriangle className="w-4 h-4" />
              <span>Overlaps with existing events on {date}</span>
            </div>
            {result.conflicts.map((c) => (
              <p key={c.sessionIndex} className="text-[11px] leading-relaxed" style={{ color: currentTheme.textSecondary }}>
                <span className="font-mono font-bold">{c.startTime}–{c.endTime}</span> {c.sessionTitle} overlaps{' '}
                {c.overlapping.map((o) => `${o.title} (${o.startTime}–${o.endTime})`).join(', ')}
              </p>
            ))}
            <p className="text-[11px]" style={{ color: currentTheme.textSecondary }}>
              Existing events are never moved or deleted — new sessions are added alongside them.
            </p>
          </div>
        )}

        {mismatches.length > 0 && result.errors.length === 0 && (
          <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 space-y-2">
            <div className="flex items-center space-x-2 text-xs font-bold text-amber-500">
              <AlertTriangle className="w-4 h-4" />
              <span>Session length differs from focus length</span>
            </div>
            {mismatches.map((m) => (
              <div key={m.index} className="flex items-center justify-between gap-2 text-[11px]">
                <p className="leading-relaxed" style={{ color: currentTheme.textSecondary }}>
                  “{m.title}” is scheduled {m.eventMinutes}m, but single-block mode {m.modeName}{' '}
                  focuses {m.focusMinutes}m. Adjust Minutes above, or snap:
                </p>
                <button
                  onClick={() => snapMismatch(m.index)}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-500 text-[11px] font-bold hover:bg-amber-500/30 transition-all cursor-pointer shrink-0"
                >
                  Snap to {m.focusMinutes}m
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Summary */}
        {result.errors.length === 0 && result.blocks.length > 0 && (
          <div className="flex items-center space-x-2 text-[11px]" style={{ color: currentTheme.textSecondary }}>
            <Clock className="w-3.5 h-3.5" />
            <span>
              {result.blocks.length} session{result.blocks.length === 1 ? '' : 's'} · {result.totalMinutes} min
              total · {result.blocks[0].startTime} → {result.endTime} on {date}
            </span>
          </div>
        )}

        {submitError && (
          <div className="px-3.5 py-2 rounded-xl text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
            {submitError}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end space-x-2 pt-1">
          <button
            onClick={() => !isSubmitting && onClose()}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-xl liquid-glass border text-xs font-bold hover:bg-white/10 transition-all cursor-pointer disabled:opacity-50"
            style={{ color: currentTheme.textSecondary }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={blocked || result.blocks.length === 0}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white transition-all active:scale-95 shadow-md cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: hasConflicts ? '#d97706' : currentTheme.accent }}
            title={hasConflicts ? 'Add the generated sessions alongside existing events' : 'Create these calendar events'}
          >
            {isSubmitting ? (
              <span>Generating…</span>
            ) : (
              <>
                {hasConflicts ? <AlertTriangle className="w-3.5 h-3.5" /> : result.alreadyApplied ? <AlertTriangle className="w-3.5 h-3.5" /> : <CalendarPlus className="w-3.5 h-3.5" />}
                <span>
                  {hasConflicts || result.alreadyApplied
                    ? `Add ${result.blocks.length} sessions anyway`
                    : `Generate ${result.blocks.length} session${result.blocks.length === 1 ? '' : 's'}`}
                </span>
              </>
            )}
          </button>
        </div>

        <p className="text-[10px] opacity-60 text-center" style={{ color: currentTheme.textSecondary }}>
          <CheckCircle2 className="w-3 h-3 inline mr-1" />
          Sessions become ordinary Day Planner events — editable, startable, and synced like any other.
        </p>
      </div>
    </div>
  );
};
