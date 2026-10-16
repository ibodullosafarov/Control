import React, { useState } from 'react';
import { GraduationCap, Plus, Trash2, Pencil, X, Calendar } from 'lucide-react';
import { DayPlan, Exam, ScheduleBlock, StudyMode, ThemeId } from '../types';
import { THEMES } from '../styles/themes';
import { buildExamBlocks, daysUntil, examBurndown, examTotals } from '../services/exams';

interface ExamsViewProps {
  exams: Exam[];
  modes: StudyMode[];
  plans: Record<string, DayPlan>;
  onSaveExams: (exams: Exam[]) => void;
  onSavePlan: (date: string, plan: DayPlan) => void;
  theme: ThemeId;
}

/** Shift an HH:mm time by minutes, clamped to the day. */
function shiftTime(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  let total = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0) + mins;
  total = Math.max(0, Math.min(23 * 60 + 59, total));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatExamDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const ExamsView: React.FC<ExamsViewProps> = ({
  exams,
  modes,
  plans,
  onSaveExams,
  onSavePlan,
  theme,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isDark = currentTheme.isDark;

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newDaily, setNewDaily] = useState('60');
  const [newModeId, setNewModeId] = useState(modes[0]?.id || '');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', date: '', dailyMinutes: '60', modeId: '' });
  const [addingTopicTo, setAddingTopicTo] = useState<string | null>(null);
  const [topicName, setTopicName] = useState('');
  const [topicTarget, setTopicTarget] = useState('120');
  const [startTimes, setStartTimes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const createExam = () => {
    const name = newName.trim();
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;
    const daily = Math.min(720, Math.max(15, parseInt(newDaily, 10) || 60));
    onSaveExams([
      ...exams,
      {
        id: `exam-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        name,
        date: newDate,
        topics: [],
        dailyMinutes: daily,
        modeId: newModeId || modes[0]?.id || '',
        createdAt: new Date().toISOString(),
      },
    ]);
    setNewName('');
    setNewDate('');
    setNewDaily('60');
    setShowCreate(false);
    setNotice(`Countdown to "${name}" started.`);
  };

  const startEdit = (exam: Exam) => {
    setEditingId(exam.id);
    setDraft({
      name: exam.name,
      date: exam.date,
      dailyMinutes: String(exam.dailyMinutes),
      modeId: exam.modeId,
    });
  };

  const saveEdit = () => {
    if (!editingId) return;
    const name = draft.name.trim();
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return;
    onSaveExams(
      exams.map((e) =>
        e.id === editingId
          ? {
              ...e,
              name,
              date: draft.date,
              dailyMinutes: Math.min(720, Math.max(15, parseInt(draft.dailyMinutes, 10) || 60)),
              modeId: draft.modeId,
            }
          : e
      )
    );
    setEditingId(null);
  };

  const updateTopic = (examId: string, topicId: string, patch: Partial<Exam['topics'][number]>) => {
    onSaveExams(
      exams.map((e) =>
        e.id === examId
          ? { ...e, topics: e.topics.map((t) => (t.id === topicId ? { ...t, ...patch } : t)) }
          : e
      )
    );
  };

  const addTopic = (examId: string) => {
    const name = topicName.trim();
    const target = Math.max(15, parseInt(topicTarget, 10) || 120);
    if (!name) return;
    onSaveExams(
      exams.map((e) =>
        e.id === examId
          ? {
              ...e,
              topics: [
                ...e.topics,
                {
                  id: `topic-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                  name,
                  targetMinutes: target,
                  loggedMinutes: 0,
                },
              ],
            }
          : e
      )
    );
    setTopicName('');
    setTopicTarget('120');
    setAddingTopicTo(null);
  };

  const generatePlan = (exam: Exam) => {
    const mode = modes.find((m) => m.id === exam.modeId) || modes[0];
    if (!mode) {
      setNotice('Create a study mode first.');
      return;
    }
    const baseStart = startTimes[exam.id] || '09:00';
    const raw = buildExamBlocks({ exam, modeId: mode.id, modeName: mode.name, startTime: baseStart });
    if (raw.length === 0) {
      setNotice(`Nothing left to schedule for "${exam.name}" — all topics are covered.`);
      return;
    }
    // Chain same-day blocks back-to-back so topics never overlap.
    const staggered: ScheduleBlock[] = [];
    let cursorDay = '';
    let cursor = baseStart;
    for (const b of raw) {
      if (b.date !== cursorDay) {
        cursorDay = b.date;
        cursor = baseStart;
      }
      const start = cursor;
      const end = shiftTime(start, b.workDuration);
      staggered.push({ ...b, startTime: start, endTime: end });
      cursor = end;
    }
    const byDate = new Map<string, ScheduleBlock[]>();
    for (const b of staggered) {
      const list = byDate.get(b.date) || [];
      list.push(b);
      byDate.set(b.date, list);
    }
    byDate.forEach((list, date) => {
      const existing = plans[date];
      const base: DayPlan = existing || {
        date,
        goals: [],
        timeWindows: [],
        blocks: [],
        isApproved: false,
        updatedAt: new Date().toISOString(),
      };
      const ids = new Set(list.map((b) => b.id));
      onSavePlan(date, {
        ...base,
        blocks: [...base.blocks.filter((b) => !ids.has(b.id)), ...list],
        updatedAt: new Date().toISOString(),
      });
    });
    const totalMins = staggered.reduce((acc, b) => acc + b.workDuration, 0);
    setNotice(`Added ${staggered.length} sessions (${totalMins}m) across ${byDate.size} ${byDate.size === 1 ? 'day' : 'days'}.`);
  };

  return (
    <div className="flex-1 flex flex-col p-6 sm:p-8 max-w-5xl mx-auto w-full overflow-y-auto space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <GraduationCap className="w-5 h-5 text-violet-500" />
          <div>
            <h2 className="text-lg font-bold tracking-tight" style={{ color: currentTheme.textPrimary }}>
              Exam Countdowns
            </h2>
            <p className="text-xs" style={{ color: currentTheme.textSecondary }}>
              Syllabi spread across your calendar until exam day
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center space-x-1.5 px-4 py-2.5 rounded-2xl font-bold text-xs transition-all active:scale-95 cursor-pointer"
          style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
        >
          <Plus className="w-4 h-4" />
          <span>New Exam</span>
        </button>
      </div>

      {notice && (
        <div
          className="px-4 py-2.5 rounded-2xl liquid-glass border text-xs font-semibold"
          style={{ color: currentTheme.textPrimary }}
        >
          {notice}
        </div>
      )}

      {showCreate && (
        <div className="p-5 rounded-3xl liquid-glass border space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-mono mb-1.5" style={{ color: currentTheme.textSecondary }}>
                Exam name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. SAT Math"
                className="w-full px-4 py-2.5 rounded-2xl liquid-glass-input text-sm outline-none"
                style={{ color: currentTheme.textPrimary }}
              />
            </div>
            <div>
              <label className="block text-xs font-mono mb-1.5" style={{ color: currentTheme.textSecondary }}>
                Exam date
              </label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full px-4 py-2.5 rounded-2xl liquid-glass-input text-sm outline-none"
                style={{ color: currentTheme.textPrimary }}
              />
            </div>
            <div>
              <label className="block text-xs font-mono mb-1.5" style={{ color: currentTheme.textSecondary }}>
                Minutes per day
              </label>
              <input
                type="number"
                min="15"
                max="720"
                step="15"
                value={newDaily}
                onChange={(e) => setNewDaily(e.target.value)}
                className="w-full px-4 py-2.5 rounded-2xl liquid-glass-input text-sm font-mono outline-none"
                style={{ color: currentTheme.textPrimary }}
              />
            </div>
            <div>
              <label className="block text-xs font-mono mb-1.5" style={{ color: currentTheme.textSecondary }}>
                Default mode
              </label>
              <select
                value={newModeId}
                onChange={(e) => setNewModeId(e.target.value)}
                className="w-full px-4 py-2.5 rounded-2xl liquid-glass-input text-sm outline-none cursor-pointer"
                style={{ color: currentTheme.textPrimary }}
              >
                {modes.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={createExam}
              disabled={!newName.trim() || !newDate}
              className="px-5 py-2.5 rounded-xl font-bold text-xs cursor-pointer disabled:opacity-40"
              style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
            >
              Start countdown
            </button>
          </div>
        </div>
      )}

      {exams.length === 0 && !showCreate && (
        <div className="py-12 text-center text-xs font-mono" style={{ color: currentTheme.textMuted }}>
          No countdowns yet. Add your next exam and break it into topics.
        </div>
      )}

      <div className="space-y-4">
        {exams.map((exam) => {
          const left = daysUntil(exam.date);
          const totals = examTotals(exam);
          const burn = examBurndown(exam);
          const pct = totals.target > 0 ? Math.min(100, Math.round((totals.logged / totals.target) * 100)) : 0;
          const isEditing = editingId === exam.id;
          return (
            <div key={exam.id} className="p-5 rounded-3xl liquid-glass border space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        className="px-3 py-2 rounded-xl liquid-glass-input text-sm outline-none"
                        style={{ color: currentTheme.textPrimary }}
                      />
                      <input
                        type="date"
                        value={draft.date}
                        onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                        className="px-3 py-2 rounded-xl liquid-glass-input text-sm outline-none"
                        style={{ color: currentTheme.textPrimary }}
                      />
                      <input
                        type="number"
                        min="15"
                        max="720"
                        step="15"
                        value={draft.dailyMinutes}
                        onChange={(e) => setDraft({ ...draft, dailyMinutes: e.target.value })}
                        className="px-3 py-2 rounded-xl liquid-glass-input text-sm font-mono outline-none"
                        style={{ color: currentTheme.textPrimary }}
                      />
                      <select
                        value={draft.modeId}
                        onChange={(e) => setDraft({ ...draft, modeId: e.target.value })}
                        className="px-3 py-2 rounded-xl liquid-glass-input text-sm outline-none cursor-pointer"
                        style={{ color: currentTheme.textPrimary }}
                      >
                        {modes.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base font-bold truncate" style={{ color: currentTheme.textPrimary }}>
                          {exam.name}
                        </span>
                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full shrink-0 ${
                            left < 0
                              ? 'bg-zinc-500/15 text-zinc-500'
                              : left <= 7
                                ? 'bg-rose-500/15 text-rose-500'
                                : 'bg-violet-500/15 text-violet-500'
                          }`}
                        >
                          {left < 0 ? 'passed' : left === 0 ? 'today' : `${left}d left`}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono" style={{ color: currentTheme.textSecondary }}>
                        {formatExamDate(exam.date)} · {exam.dailyMinutes}m/day ·{' '}
                        {burn.onTrack ? 'on track' : `needs ~${burn.perDayNeeded}m/day`}
                      </span>
                    </>
                  )}
                </div>
                <span className="flex items-center gap-1 shrink-0">
                  {isEditing ? (
                    <>
                      <button
                        onClick={saveEdit}
                        className="px-3 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer"
                        style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="p-1.5 cursor-pointer"
                        style={{ color: currentTheme.textSecondary }}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startEdit(exam)}
                        className="p-1.5 cursor-pointer"
                        style={{ color: currentTheme.textMuted }}
                        title="Edit exam"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${exam.name}" and its topics?`)) {
                            onSaveExams(exams.filter((e) => e.id !== exam.id));
                          }
                        }}
                        className="p-1.5 hover:text-rose-500 cursor-pointer"
                        style={{ color: currentTheme.textMuted }}
                        title="Delete exam"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </span>
              </div>

              {/* Burndown */}
              <div>
                <div
                  className="h-2 rounded-full overflow-hidden"
                  style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: burn.onTrack ? '#8b5cf6' : '#f59e0b' }}
                  />
                </div>
                <div className="flex justify-between mt-1 text-[11px] font-mono" style={{ color: currentTheme.textSecondary }}>
                  <span>{totals.logged}/{totals.target}m logged</span>
                  <span>{burn.totalRemaining}m to go</span>
                </div>
              </div>

              {/* Topics */}
              <div className="space-y-1.5">
                {exam.topics.map((t) => {
                  const done = t.targetMinutes > 0 && t.loggedMinutes >= t.targetMinutes;
                  const tpct = t.targetMinutes > 0 ? Math.min(100, Math.round((t.loggedMinutes / t.targetMinutes) * 100)) : 0;
                  return (
                    <div key={t.id} className="p-3 rounded-2xl liquid-glass-card border">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold truncate flex-1" style={{ color: currentTheme.textPrimary }}>
                          {t.name}
                        </span>
                        <span className="text-[11px] font-mono shrink-0" style={{ color: currentTheme.textSecondary }}>
                          {t.loggedMinutes}/{t.targetMinutes}m
                        </span>
                        {[15, 25, 60].map((n) => (
                          <button
                            key={n}
                            disabled={done}
                            onClick={() => updateTopic(exam.id, t.id, { loggedMinutes: t.loggedMinutes + n })}
                            className="px-2 py-1 rounded-lg liquid-glass border text-[10px] font-mono font-bold cursor-pointer disabled:opacity-40"
                            style={{ color: currentTheme.textSecondary }}
                            title={`Log ${n} minutes`}
                          >
                            +{n}
                          </button>
                        ))}
                        <button
                          onClick={() => onSaveExams(exams.map((e) =>
                            e.id === exam.id ? { ...e, topics: e.topics.filter((x) => x.id !== t.id) } : e
                          ))}
                          className="p-1 hover:text-rose-500 cursor-pointer shrink-0"
                          style={{ color: currentTheme.textMuted }}
                          title="Remove topic"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div
                        className="h-1 rounded-full overflow-hidden mt-2"
                        style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${tpct}%`, backgroundColor: done ? '#10b981' : '#8b5cf6' }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add topic */}
              {addingTopicTo === exam.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={topicName}
                    onChange={(e) => setTopicName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addTopic(exam.id); }}
                    placeholder="Topic — e.g. Quadratic equations"
                    className="flex-1 min-w-[140px] px-3 py-2 rounded-xl liquid-glass-input text-xs outline-none"
                    style={{ color: currentTheme.textPrimary }}
                  />
                  <input
                    type="number"
                    min="15"
                    value={topicTarget}
                    onChange={(e) => setTopicTarget(e.target.value)}
                    className="w-20 px-3 py-2 rounded-xl liquid-glass-input text-xs font-mono outline-none"
                    style={{ color: currentTheme.textPrimary }}
                    title="Target minutes"
                  />
                  <button
                    onClick={() => addTopic(exam.id)}
                    disabled={!topicName.trim()}
                    className="px-3 py-2 rounded-xl text-[11px] font-bold cursor-pointer disabled:opacity-40"
                    style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
                  >
                    Add
                  </button>
                  <button
                    onClick={() => setAddingTopicTo(null)}
                    className="px-3 py-2 rounded-xl text-[11px] font-semibold cursor-pointer"
                    style={{ color: currentTheme.textSecondary }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setAddingTopicTo(exam.id)}
                  className="flex items-center space-x-1.5 text-[11px] font-bold cursor-pointer"
                  style={{ color: currentTheme.accent }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add topic</span>
                </button>
              )}

              {/* Generate */}
              <div
                className="flex flex-wrap items-center gap-2 pt-3 border-t"
                style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
              >
                <Calendar className="w-3.5 h-3.5" style={{ color: currentTheme.textMuted }} />
                <span className="text-[11px] font-mono" style={{ color: currentTheme.textSecondary }}>
                  Daily start
                </span>
                <input
                  type="time"
                  value={startTimes[exam.id] || '09:00'}
                  onChange={(e) => setStartTimes((prev) => ({ ...prev, [exam.id]: e.target.value }))}
                  className="px-2.5 py-1.5 rounded-xl liquid-glass-input text-[11px] font-mono outline-none"
                  style={{ color: currentTheme.textPrimary }}
                />
                <span className="flex-1" />
                <button
                  onClick={() => generatePlan(exam)}
                  disabled={burn.totalRemaining <= 0}
                  className="px-4 py-2 rounded-xl text-[11px] font-bold cursor-pointer disabled:opacity-40"
                  style={{ backgroundColor: currentTheme.accent, color: currentTheme.accentText }}
                  title="Spread remaining topic minutes across days until the exam"
                >
                  Generate study plan
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
