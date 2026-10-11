import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
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
  FlexTemplate,
  FlexParseError,
  applyFlexTemplate,
  partitionForReplace,
  resolveFlexTaskModes,
} from '../services/flexTemplates';
import {
  formatMinutes,
  parseTimeMinutes,
  validateSingleBlockDurations,
} from '../services/scheduleTemplates';

interface AbsoluteScheduleModalProps {
  template: FlexTemplate;
  parseErrors: FlexParseError[];
  initialDate: string;
  modes: StudyMode[];
  plans: Record<string, DayPlan>;
  theme: ThemeId;
  onClose: () => void;
  onConfirm: (
    date: string,
    blocks: ScheduleBlock[],
    opts: { templateName: string; templateTitle: string; mode: 'add' | 'replace' }
  ) => Promise<string | null>;
}

/**
 * Apply an absolute-time flex template: fixed clock times on a target date,
 * real mode resolution (no silent fallback), overlap warnings and an explicit
 * add-alongside vs replace strategy. Generation is atomic — validation
 * failures produce zero blocks.
 */
export const AbsoluteScheduleModal: React.FC<AbsoluteScheduleModalProps> = ({
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
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [modeOverrides, setModeOverrides] = useState<Record<number, string>>({});
  const [timeOverrides, setTimeOverrides] = useState<Record<number, { start?: string; end?: string }>>({});
  const [applyMode, setApplyMode] = useState<'add' | 'replace'>('add');
  const [replaceAck, setReplaceAck] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const resolutions = useMemo(() => resolveFlexTaskModes(template, modes), [template, modes]);

  const result = useMemo(() => {
    const existingBlocks = plans[date]?.blocks || [];
    return applyFlexTemplate(
      template,
      { date, variables, modeOverrides, timeOverrides },
      { modes, existingBlocks }
    );
  }, [template, date, variables, modeOverrides, timeOverrides, modes, plans]);

  // Single-block modes should match their focus length; multi-cycle exempt.
  const mismatches = useMemo(
    () => validateSingleBlockDurations(result.blocks, modes),
    [result.blocks, modes]
  );

  const snapMismatch = (mismatchIndex: number) => {
    const block = result.blocks[mismatchIndex];
    const task = template.tasks[mismatchIndex];
    const mismatch = mismatches.find((m) => m.index === mismatchIndex);
    if (!block || !task || !mismatch) return;
    const mm = parseTimeMinutes(block.startTime);
    if (mm === null) return;
    setTimeOverrides((prev) => ({
      ...prev,
      [task.order]: {
        ...(prev[task.order] || {}),
        start: block.startTime,
        end: formatMinutes(mm + mismatch.focusMinutes),
      },
    }));
  };

  const existingOnDate = plans[date]?.blocks || [];
  const replaceInfo = useMemo(() => partitionForReplace(existingOnDate), [existingOnDate]);

  const unresolved = template.tasks.filter((t) => {
    const res = resolutions[t.order];
    return !modeOverrides[t.order] && !res?.modeId;
  });

  const blocked =
    result.errors.length > 0 || unresolved.length > 0 || isSubmitting || modes.length === 0;
  const needsReplaceAck = applyMode === 'replace' && existingOnDate.length > 0 && !replaceAck;
  const canConfirm =
    !blocked && result.blocks.length > 0 && !(applyMode === 'replace' && existingOnDate.length > 0 && !replaceAck);

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const error = await onConfirm(date, result.blocks, {
        templateName: template.name,
        templateTitle: template.title,
        mode: applyMode,
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

  const border = currentTheme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
  const otherVars = template.variables.filter((v) => v !== 'date');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => !isSubmitting && onClose()} />
      <div
        className="relative w-full max-w-2xl max-h-[88vh] overflow-y-auto p-6 rounded-3xl liquid-glass border space-y-4 animate-modal-in"
        style={{ borderColor: border }}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold" style={{ color: currentTheme.textPrimary }}>
              Apply {template.title}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: currentTheme.textSecondary }}>
              Fixed clock times on the target date
              {template.hasDatePlaceholder ? ' · fills {{date}}' : ''}. Nothing is created until you confirm.
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

        {modes.length === 0 && (
          <div className="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-400">
            No focus modes are defined — create one before applying a template.
          </div>
        )}

        {parseErrors.length > 0 && (
          <div className="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 space-y-1.5">
            <div className="flex items-center space-x-2 text-xs font-bold text-rose-400">
              <X className="w-4 h-4" />
              <span>This template needs fixes before it can be applied</span>
            </div>
            {parseErrors.map((e, i) => (
              <p key={i} className="text-[11px] leading-relaxed" style={{ color: currentTheme.textSecondary }}>
                {e.task ? `“${e.task}”${e.field ? ` · ${e.field}` : ''}: ` : ''}{e.message}
              </p>
            ))}
          </div>
        )}

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
              Events
            </label>
            <p className="text-xs px-1 py-1.5" style={{ color: currentTheme.textPrimary }}>
              {result.blocks.length > 0
                ? `${result.blocks.length} tasks · ${result.totalMinutes} min total`
                : '—'}
            </p>
          </div>
        </div>

        {otherVars.length > 0 && (
          <div className="p-4 rounded-2xl liquid-glass-card border space-y-2">
            <span className="text-xs font-bold" style={{ color: currentTheme.textPrimary }}>
              Template values
            </span>
            {otherVars.map((v) => (
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

        <div className="space-y-2">
          <span className="text-xs font-bold" style={{ color: currentTheme.textPrimary }}>
            Tasks
          </span>
          {template.tasks.map((t) => {
            const res = resolutions[t.order];
            const override = modeOverrides[t.order];
            const effectiveModeId = override || res?.modeId || '';
            const preview = result.blocks[t.order];
            const broken = !effectiveModeId;
            return (
              <div
                key={t.order}
                className={`p-3.5 rounded-2xl liquid-glass-card border space-y-2 ${broken ? 'border-rose-500/40' : ''}`}
                style={broken ? undefined : { borderColor: border }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold truncate" style={{ color: currentTheme.textPrimary }}>
                    {t.title || <span className="opacity-50">(untitled)</span>}
                  </span>
                  <span className="flex items-center space-x-1 shrink-0" title="Fix the event time without editing the file">
                    <input
                      type="time"
                      value={timeOverrides[t.order]?.start ?? t.start ?? ''}
                      onChange={(e) =>
                        setTimeOverrides((prev) => ({
                          ...prev,
                          [t.order]: { ...(prev[t.order] || {}), start: e.target.value },
                        }))
                      }
                      className="px-1.5 py-1 rounded-lg liquid-glass-input border text-[11px] font-mono outline-none"
                      style={{ color: currentTheme.textPrimary }}
                    />
                    <span className="text-[11px] font-mono" style={{ color: currentTheme.textSecondary }}>–</span>
                    <input
                      type="time"
                      value={timeOverrides[t.order]?.end ?? t.end ?? ''}
                      onChange={(e) =>
                        setTimeOverrides((prev) => ({
                          ...prev,
                          [t.order]: { ...(prev[t.order] || {}), end: e.target.value },
                        }))
                      }
                      className="px-1.5 py-1 rounded-lg liquid-glass-input border text-[11px] font-mono outline-none"
                      style={{ color: currentTheme.textPrimary }}
                    />
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-[11px] shrink-0" style={{ color: currentTheme.textSecondary }}>
                    Mode
                  </span>
                  <select
                    value={effectiveModeId}
                    onChange={(e) =>
                      setModeOverrides((prev) => {
                        const next = { ...prev };
                        if (!e.target.value) delete next[t.order];
                        else next[t.order] = e.target.value;
                        return next;
                      })
                    }
                    className={`flex-1 px-2.5 py-1.5 rounded-xl border text-xs outline-none cursor-pointer ${
                      broken ? 'liquid-glass-input border-rose-500/50' : 'liquid-glass-input'
                    }`}
                    style={{ color: currentTheme.textPrimary }}
                  >
                    <option value="">— choose a mode —</option>
                    {modes.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                {broken && (
                  <p className="text-[11px] text-rose-400">
                    {res?.error || `Task "${t.title}" names no mode.`} Pick a valid mode to continue —
                    nothing is silently substituted.
                  </p>
                )}
                {preview && preview.description && (
                  <p className="text-[10px] opacity-70 truncate" style={{ color: currentTheme.textSecondary }}>
                    {preview.description}
                  </p>
                )}
                {t.notes.length > 0 && (
                  <p className="text-[10px] opacity-60 line-clamp-2" style={{ color: currentTheme.textSecondary }}>
                    {t.notes.join(' · ')}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {result.errors.length > 0 && (
          <div className="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 space-y-1">
            {result.errors.map((msg, i) => (
              <p key={i} className="text-[11px] text-rose-400">{msg}</p>
            ))}
          </div>
        )}

        {result.alreadyApplied && result.errors.length === 0 && (
          <div className="flex items-start space-x-2 text-[11px] text-amber-500">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              This template was already applied to {date}. Applying again adds duplicates unless
              that is your intent (or use Replace below).
            </span>
          </div>
        )}

        {result.conflicts.length > 0 && result.errors.length === 0 && (
          <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 space-y-1.5">
            <div className="flex items-center space-x-2 text-xs font-bold text-amber-500">
              <AlertTriangle className="w-4 h-4" />
              <span>Overlaps with existing events on {date}</span>
            </div>
            {result.conflicts.map((c) => (
              <p key={c.taskIndex} className="text-[11px] leading-relaxed" style={{ color: currentTheme.textSecondary }}>
                <span className="font-mono font-bold">{c.startTime}–{c.endTime}</span> {c.taskTitle} overlaps{' '}
                {c.overlapping.map((o) => `${o.title} (${o.startTime}–${o.endTime})`).join(', ')}
              </p>
            ))}
          </div>
        )}

        {mismatches.length > 0 && result.errors.length === 0 && (
          <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 space-y-2">
            <div className="flex items-center space-x-2 text-xs font-bold text-amber-500">
              <AlertTriangle className="w-4 h-4" />
              <span>Event length differs from focus length</span>
            </div>
            {mismatches.map((m) => (
              <div key={m.index} className="flex items-center justify-between gap-2 text-[11px]">
                <p className="leading-relaxed" style={{ color: currentTheme.textSecondary }}>
                  “{m.title}” is scheduled {m.eventMinutes}m, but single-block mode {m.modeName}{' '}
                  focuses {m.focusMinutes}m. Fix the time above, change the mode, or snap:
                </p>
                <button
                  onClick={() => snapMismatch(m.index)}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-500 text-[11px] font-bold hover:bg-amber-500/30 transition-all cursor-pointer shrink-0"
                >
                  Snap to {m.focusMinutes}m
                </button>
              </div>
            ))}
            <p className="text-[10px] opacity-70" style={{ color: currentTheme.textSecondary }}>
              Single-block modes run one focus cycle, so the event should match. Multi-cycle modes
              are never flagged. Nothing is stretched automatically.
            </p>
          </div>
        )}

        {/* Merge / replace strategy */}
        <div className="p-4 rounded-2xl liquid-glass-card border space-y-2.5">
          <span className="text-xs font-bold" style={{ color: currentTheme.textPrimary }}>
            If {date} already has events
          </span>
          <label className="flex items-start space-x-2 cursor-pointer">
            <input
              type="radio"
              name="apply-mode"
              checked={applyMode === 'add'}
              onChange={() => setApplyMode('add')}
              className="mt-0.5 accent-sky-500"
            />
            <span className="text-[11px]" style={{ color: currentTheme.textPrimary }}>
              Add alongside <span className="opacity-60">(existing events are kept untouched)</span>
            </span>
          </label>
          <label className="flex items-start space-x-2 cursor-pointer">
            <input
              type="radio"
              name="apply-mode"
              checked={applyMode === 'replace'}
              onChange={() => setApplyMode('replace')}
              className="mt-0.5 accent-rose-500"
            />
            <span className="text-[11px]" style={{ color: currentTheme.textPrimary }}>
              Replace all events on {date}
            </span>
          </label>
          {applyMode === 'replace' && (
            <div className="pl-6 space-y-2">
              <p className="text-[11px] text-amber-500">
                This removes {replaceInfo.removeIds.length} existing event{replaceInfo.removeIds.length === 1 ? '' : 's'}
                {replaceInfo.googleMapped > 0
                  ? `, including ${replaceInfo.googleMapped} synced with Google Calendar (their remote copies will be deleted on the next sync)`
                  : ''}
                . Only generated events are added back.
              </p>
              {replaceInfo.removeIds.length > 0 && (
                <label className="flex items-start space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={replaceAck}
                    onChange={(e) => setReplaceAck(e.target.checked)}
                    className="mt-0.5 rounded accent-rose-500"
                  />
                  <span className="text-[11px]" style={{ color: currentTheme.textPrimary }}>
                    I understand {replaceInfo.removeIds.length} event{replaceInfo.removeIds.length === 1 ? ' will' : 's will'} be deleted
                  </span>
                </label>
              )}
            </div>
          )}
        </div>

        {submitError && (
          <div className="px-3.5 py-2 rounded-xl text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
            {submitError}
          </div>
        )}

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
            disabled={!canConfirm}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white transition-all active:scale-95 shadow-md cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: applyMode === 'replace' ? '#e11d48' : currentTheme.accent }}
          >
            {isSubmitting ? (
              <span>Applying…</span>
            ) : (
              <>
                <CalendarPlus className="w-3.5 h-3.5" />
                <span>
                  {applyMode === 'replace'
                    ? `Replace with ${result.blocks.length} event${result.blocks.length === 1 ? '' : 's'}`
                    : `Create ${result.blocks.length} event${result.blocks.length === 1 ? '' : 's'}`}
                </span>
              </>
            )}
          </button>
        </div>

        {needsReplaceAck && (
          <p className="text-[11px] text-amber-500 text-right">
            Confirm the replacement above to continue.
          </p>
        )}

        <p className="text-[10px] opacity-60 text-center" style={{ color: currentTheme.textSecondary }}>
          <CheckCircle2 className="w-3 h-3 inline mr-1" />
          Events become ordinary Day Planner entries — editable, startable, and synced like any other.
        </p>
      </div>
    </div>
  );
};
