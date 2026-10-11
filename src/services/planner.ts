import { StudyMode, ScheduleBlock, DayPlan, TimeWindow, PlanGoal } from '../types';

export function parseTimeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

export function formatMinutesToTime(totalMinutes: number): string {
  const normalized = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function generateDeterministicSchedule(
  date: string,
  goals: PlanGoal[],
  timeWindows: TimeWindow[],
  modes: StudyMode[],
  interBlockBufferMinutes = 15
): ScheduleBlock[] {
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
    return [];
  }

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
        currentWindowIdx++;
        if (currentWindowIdx < sortedWindows.length) {
          currentClockMins = sortedWindows[currentWindowIdx].startMins;
        }
        continue;
      }

      // Calculate how many cycles we can fit
      const singleCycleMins = mode.workDuration + mode.breakDuration;
      let sessionWorkMins: number;
      let sessionTotalMins: number;
      let cyclesToRun: number;

      if (remainingMinutesToSchedule >= mode.workDuration) {
        cyclesToRun = Math.min(
          mode.cycles,
          Math.max(1, Math.floor(remainingMinutesToSchedule / mode.workDuration))
        );
        sessionWorkMins = cyclesToRun * mode.workDuration;
        sessionTotalMins = sessionWorkMins + (cyclesToRun > 1 ? (cyclesToRun - 1) * mode.breakDuration : 0);
      } else {
        cyclesToRun = 1;
        sessionWorkMins = remainingMinutesToSchedule;
        sessionTotalMins = remainingMinutesToSchedule;
      }

      // If it doesn't fit entirely in the window, shrink to fit available window time
      if (sessionTotalMins > availableInWindow) {
        sessionTotalMins = availableInWindow;
        sessionWorkMins = Math.max(15, availableInWindow - (cyclesToRun > 1 ? (cyclesToRun - 1) * mode.breakDuration : 0));
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
        workDuration: mode.workDuration,
        breakDuration: mode.breakDuration,
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

  return blocks;
}

/**
 * Generate standard iCalendar (.ics) string for export
 */
export function generateIcsContent(blocks: ScheduleBlock[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Focus Personal Study System//macOS//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const block of blocks) {
    const [startH, startM] = block.startTime.split(':').map(Number);
    const [endH, endM] = block.endTime.split(':').map(Number);
    const [year, month, day] = block.date.split('-').map(Number);

    const dtStart = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}T${String(startH).padStart(2, '0')}${String(startM).padStart(2, '0')}00`;
    const dtEnd = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}T${String(endH).padStart(2, '0')}${String(endM).padStart(2, '0')}00`;
    const uid = `focus-${block.id}@local`;

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:🎯 Focus: ${block.modeName}`,
      `DESCRIPTION:Focus session for ${block.modeName} (${block.cycles} cycles of ${block.workDuration}m work / ${block.breakDuration}m break). Planned with Focus.`,
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-PT5M',
      'ACTION:DISPLAY',
      `DESCRIPTION:Focus session "${block.modeName}" starting in 5 minutes`,
      'END:VALARM',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
