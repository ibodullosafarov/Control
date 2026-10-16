import type { Exam, ScheduleBlock } from '../types';

export interface DayAllocation {
  day: string;
  minutes: number;
}

export interface ExamBurndown {
  daysLeft: number;
  totalRemaining: number;
  perDayNeeded: number;
  onTrack: boolean;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDayKey(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const dd = Number(m[3]);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(dd)) return null;
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;
  const d = new Date(y, mo - 1, dd);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== dd) return null;
  return d;
}

/** Whole days from now's local day to examDate (examDate minus today). */
export function daysUntil(examDate: string, now?: Date): number {
  const exam = parseDayKey(examDate);
  if (!exam) return 0;
  const ref = now ?? new Date();
  const todayMidnight = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const diffMs = exam.getTime() - todayMidnight.getTime();
  return Math.round(diffMs / 86400000);
}

/**
 * Distribute totalMinutes over days [fromDay, examDate) — exam day excluded —
 * capped at dailyMinutes/day, earliest days first. Zero-minute days dropped.
 */
export function spreadMinutesAcrossDays(
  totalMinutes: number,
  fromDay: string,
  examDate: string,
  dailyMinutes: number,
): DayAllocation[] {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return [];
  if (!Number.isFinite(dailyMinutes) || dailyMinutes <= 0) return [];
  const start = parseDayKey(fromDay);
  const end = parseDayKey(examDate);
  if (!start || !end) return [];
  const total = Math.floor(totalMinutes);
  const cap = Math.floor(dailyMinutes);
  if (total <= 0 || cap <= 0) return [];
  const out: DayAllocation[] = [];
  let remaining = total;
  const cursor = new Date(start.getTime());
  while (cursor.getTime() < end.getTime() && remaining > 0) {
    const give = Math.min(remaining, cap);
    if (give > 0) out.push({ day: toDayKey(cursor), minutes: give });
    remaining -= give;
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function examTotals(exam: Exam): { target: number; logged: number; remaining: number } {
  let target = 0;
  let logged = 0;
  let remaining = 0;
  for (const t of exam.topics) {
    const tgt = Number.isFinite(t.targetMinutes) ? Math.max(0, Math.floor(t.targetMinutes)) : 0;
    const log = Number.isFinite(t.loggedMinutes) ? Math.max(0, Math.floor(t.loggedMinutes)) : 0;
    target += tgt;
    logged += log;
    remaining += Math.max(0, tgt - log);
  }
  return { target, logged, remaining };
}

export function examBurndown(exam: Exam, now?: Date): ExamBurndown {
  const daysLeft = daysUntil(exam.date, now);
  const { remaining: totalRemaining } = examTotals(exam);
  let perDayNeeded: number;
  if (totalRemaining <= 0) {
    perDayNeeded = 0;
  } else if (daysLeft <= 0) {
    perDayNeeded = totalRemaining;
  } else {
    perDayNeeded = Math.ceil(totalRemaining / daysLeft);
  }
  const daily = Number.isFinite(exam.dailyMinutes) ? exam.dailyMinutes : 0;
  return { daysLeft, totalRemaining, perDayNeeded, onTrack: perDayNeeded <= daily };
}

function parseStartTime(startTime: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(startTime);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function addMinutesToClock(startTime: string, minutes: number): string {
  const start = parseStartTime(startTime);
  if (start === null) return '23:59';
  const end = Math.min(start + Math.floor(minutes), 23 * 60 + 59);
  return `${pad2(Math.floor(end / 60))}:${pad2(end % 60)}`;
}

export function buildExamBlocks(args: {
  exam: Exam;
  modeId: string;
  modeName: string;
  startTime: string;
  fromDay?: string;
}): ScheduleBlock[] {
  const { exam, modeId, modeName, startTime } = args;
  const todayKey = toDayKey(new Date());
  const rawFrom = args.fromDay ?? todayKey;
  const effectiveFrom = rawFrom < todayKey ? todayKey : rawFrom;
  const perTopic: Array<{ topicIndex: number; topicId: string; topicName: string; allocs: DayAllocation[] }> = [];
  for (let i = 0; i < exam.topics.length; i++) {
    const t = exam.topics[i];
    const logged = Number.isFinite(t.loggedMinutes) ? Math.max(0, Math.floor(t.loggedMinutes)) : 0;
    const target = Number.isFinite(t.targetMinutes) ? Math.max(0, Math.floor(t.targetMinutes)) : 0;
    const remaining = Math.max(0, target - logged);
    if (remaining <= 0) continue;
    const allocs = spreadMinutesAcrossDays(remaining, effectiveFrom, exam.date, exam.dailyMinutes);
    if (allocs.length === 0) continue;
    perTopic.push({ topicIndex: i, topicId: t.id, topicName: t.name, allocs });
  }
  // Order by (day, topic order).
  const byDay = new Map<string, typeof perTopic>();
  for (const entry of perTopic) {
    for (const a of entry.allocs) {
      const list = byDay.get(a.day);
      if (list) list.push({ ...entry, allocs: [a] });
      else byDay.set(a.day, [{ ...entry, allocs: [a] }]);
    }
  }
  const days = [...byDay.keys()].sort();
  const blocks: ScheduleBlock[] = [];
  for (const day of days) {
    const entries = (byDay.get(day) ?? []).sort((x, y) => x.topicIndex - y.topicIndex);
    for (const e of entries) {
      const minutes = e.allocs[0].minutes;
      blocks.push({
        id: `exam-${exam.id}-${e.topicId}-${day}`,
        date: day,
        startTime,
        endTime: addMinutesToClock(startTime, minutes),
        modeId,
        modeName,
        modeIcon: '',
        modeColor: '',
        workDuration: minutes,
        breakDuration: 0,
        cycles: 1,
        status: 'proposed',
        description: `${exam.name}: ${e.topicName}`,
      });
    }
  }
  return blocks;
}
