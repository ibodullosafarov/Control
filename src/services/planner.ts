import { StudyMode, ScheduleBlock, DayPlan, TimeWindow, PlanGoal } from '../types';

export function parseTimeToMinutes(timeStr: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((timeStr || '').trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatMinutesToTime(totalMinutes: number): string {
  const normalized = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export interface ScheduleAdjustment {
  modeName: string;
  kind: 'shrunk' | 'single-short-cycle' | 'dropped-to-one-cycle' | 'window-skipped';
  detail: string;
}

export interface DeterministicScheduleReport {
  blocks: ScheduleBlock[];
  adjustments: ScheduleAdjustment[];
}

export function generateDeterministicSchedule(
  date: string,
  goals: PlanGoal[],
  timeWindows: TimeWindow[],
  modes: StudyMode[],
  interBlockBufferMinutes = 15
): ScheduleBlock[] {
  return generateDeterministicScheduleWithReport(date, goals, timeWindows, modes, interBlockBufferMinutes).blocks;
}

export function generateDeterministicScheduleWithReport(
  date: string,
  goals: PlanGoal[],
  timeWindows: TimeWindow[],
  modes: StudyMode[],
  interBlockBufferMinutes = 15
): DeterministicScheduleReport {
  const blocks: ScheduleBlock[] = [];
  const modeMap = new Map(modes.map((m) => [m.id, m]));

  // Sort time windows chronologically
  const sortedWindows = [...timeWindows]
    .map((w) => ({
      startMins: parseTimeToMinutes(w.start),
      endMins: parseTimeToMinutes(w.end),
    }))
    .filter((w) => w.endMins > w.startMins)
    .sort((a, b) => a.startMins - b.startMins);

  if (sortedWindows.length === 0 || goals.length === 0) {
    return { blocks: [], adjustments: [] };
  }

  const adjustments: ScheduleAdjustment[] = [];

  let currentWindowIdx = 0;
  let currentClockMins = sortedWindows[0].startMins;

  for (const goal of goals) {
    const mode = modeMap.get(goal.modeId);
    if (!mode || goal.targetMinutes <= 0) continue;

    let remainingMinutesToSchedule = goal.targetMinutes;

    while (remainingMinutesToSchedule > 0 && currentWindowIdx < sortedWindows.length) {
      const currentWindow = sortedWindows[currentWindowIdx];

      // Ensure clock is within current window
      if (currentClockMins < currentWindow.startMins) {
        currentClockMins = currentWindow.startMins;
      }

      const availableInWindow = currentWindow.endMins - currentClockMins;
      if (availableInWindow <= 15) {
        // Window almost full, advance to next window
        adjustments.push({ modeName: mode.name, kind: 'window-skipped', detail: `Skipped tight window (${availableInWindow}m left) for ${mode.name}.` });
        currentWindowIdx++;
        if (currentWindowIdx < sortedWindows.length) {
          currentClockMins = sortedWindows[currentWindowIdx].startMins;
        }
        continue;
      }

      // Calculate how many cycles we can fit
      let sessionWorkMins: number;
      let sessionTotalMins: number;
      let cyclesToRun: number;
      // Per-cycle durations stored on the block. For full multi-cycle
      // sessions these match the mode; for remainder/shrink fits they are
      // scaled down so the calendar event and the timer agree (B-01).
      let blockWorkDuration = mode.workDuration;
      let blockBreakDuration = mode.breakDuration;

      if (remainingMinutesToSchedule >= mode.workDuration) {
        cyclesToRun = Math.min(
          mode.cycles,
          Math.max(1, Math.floor(remainingMinutesToSchedule / mode.workDuration))
        );
        sessionWorkMins = cyclesToRun * mode.workDuration;
        sessionTotalMins = sessionWorkMins + (cyclesToRun > 1 ? (cyclesToRun - 1) * mode.breakDuration : 0);
      } else {
        // Honest remainder: a single short cycle, not a full mode interval
        // masquerading as a short event.
        cyclesToRun = 1;
        sessionWorkMins = remainingMinutesToSchedule;
        sessionTotalMins = remainingMinutesToSchedule;
        blockWorkDuration = remainingMinutesToSchedule;
        blockBreakDuration = 0;
        adjustments.push({ modeName: mode.name, kind: 'single-short-cycle', detail: `Remainder ${remainingMinutesToSchedule}m for ${mode.name} planned as one short cycle (not a full ${mode.workDuration}m block).` });
      }

      // If it doesn't fit entirely in the window, shrink to fit available window time
      if (sessionTotalMins > availableInWindow) {
        const origWork = blockWorkDuration;
        sessionTotalMins = availableInWindow;
        const breakTotal = cyclesToRun > 1 ? (cyclesToRun - 1) * mode.breakDuration : 0;
        sessionWorkMins = Math.max(15, availableInWindow - breakTotal);
        // Scale per-cycle work so stored durations imply the stored wall time:
        // wall = cycles*work + (cycles-1)*break.
        blockWorkDuration = Math.max(5, Math.floor(sessionWorkMins / cyclesToRun));
        blockBreakDuration = mode.breakDuration;
        sessionWorkMins = blockWorkDuration * cyclesToRun;
        sessionTotalMins = sessionWorkMins + breakTotal;
        adjustments.push({ modeName: mode.name, kind: 'shrunk', detail: `Shrunk ${mode.name} block from ${origWork}m to ${blockWorkDuration}m per cycle to fit the window.` });
        if (sessionTotalMins > availableInWindow) {
          // Still overflowing (tiny window + many breaks): drop to one cycle.
          cyclesToRun = 1;
          blockBreakDuration = 0;
          blockWorkDuration = Math.max(5, availableInWindow);
          sessionWorkMins = blockWorkDuration;
          sessionTotalMins = blockWorkDuration;
          adjustments.push({ modeName: mode.name, kind: 'dropped-to-one-cycle', detail: `Dropped ${mode.name} to one cycle (${blockWorkDuration}m) — window too small for breaks.` });
        }
      }

      const blockStartMins = currentClockMins;
      const blockEndMins = blockStartMins + sessionTotalMins;

      blocks.push({
        id: `block-${date}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        date,
        startTime: formatMinutesToTime(blockStartMins),
        endTime: formatMinutesToTime(blockEndMins),
        modeId: mode.id,
        modeName: mode.name,
        modeIcon: mode.icon,
        modeColor: mode.color,
        workDuration: blockWorkDuration,
        breakDuration: blockBreakDuration,
        cycles: cyclesToRun,
        status: 'proposed',
      });

      remainingMinutesToSchedule -= sessionWorkMins;
      currentClockMins = blockEndMins + interBlockBufferMinutes;

      if (currentClockMins >= currentWindow.endMins) {
        currentWindowIdx++;
        if (currentWindowIdx < sortedWindows.length) {
          currentClockMins = sortedWindows[currentWindowIdx].startMins;
        }
      }
    }
  }

  return { blocks, adjustments };
}

/**
 * Generate standard iCalendar (.ics) string for export
 */
export function generateIcsContent(blocks: ScheduleBlock[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Control Personal Study System//macOS//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  const dtStamp = `${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
  const esc = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const fold = (line: string): string[] => {
    const out: string[] = [];
    let rest = line;
    out.push(rest.slice(0, 75));
    rest = rest.slice(75);
    while (rest.length > 0) {
      out.push(` ${rest.slice(0, 74)}`);
      rest = rest.slice(74);
    }
    return out;
  };
  const pushFolded = (line: string): void => {
    for (const part of fold(line)) lines.push(part);
  };
  for (const block of blocks) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(block.date)) continue;
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(block.startTime)) continue;
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(block.endTime)) continue;
    const [startH, startM] = block.startTime.split(':').map(Number);
    const [endH, endM] = block.endTime.split(':').map(Number);
    const [year, month, day] = block.date.split('-').map(Number);

    const dtStart = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}T${String(startH).padStart(2, '0')}${String(startM).padStart(2, '0')}00`;
    const dtEnd = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}T${String(endH).padStart(2, '0')}${String(endM).padStart(2, '0')}00`;
    const uid = `control-${block.id}@local`;

    lines.push('BEGIN:VEVENT');
    pushFolded(`UID:${esc(uid)}`);
    pushFolded(`DTSTAMP:${dtStamp}`);
    pushFolded(`DTSTART:${dtStart}`);
    pushFolded(`DTEND:${dtEnd}`);
    pushFolded(`SUMMARY:${esc(`🎯 Control: ${block.modeName}`)}`);
    pushFolded(
      `DESCRIPTION:${esc(`Control session for ${block.modeName} (${block.cycles} cycle${block.cycles === 1 ? '' : 's'} of ${block.workDuration}m work${block.cycles > 1 ? ` with ${block.cycles - 1} × ${block.breakDuration}m breaks between cycles (no trailing break)` : ''}).${block.description ? ` ${block.description}.` : ''}${block.importWarning ? ` Note: ${block.importWarning}` : ''} Planned with Control. (Floating local time — check zone when traveling.)`)}`
    );
    pushFolded('STATUS:CONFIRMED');
    lines.push('BEGIN:VALARM', 'TRIGGER:-PT5M', 'ACTION:DISPLAY');
    pushFolded(`DESCRIPTION:${esc(`Control session "${block.modeName}" starting in 5 minutes`)}`);
    lines.push('END:VALARM', 'END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
