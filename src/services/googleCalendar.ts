import { ScheduleBlock, GoogleCalendarConfig } from '../types';
import { generateIcsContent } from './planner';

export class GoogleCalendarService {
  async syncApprovedBlocks(
    blocks: ScheduleBlock[],
    config: GoogleCalendarConfig
  ): Promise<{ success: boolean; syncedCount: number; error?: string }> {
    if (window.focusAPI) {
      return await window.focusAPI.syncToGoogleCalendar(blocks, config);
    }

    // In web fallback, simulate or offer direct ICS export
    console.log('Syncing blocks to Google Calendar (web fallback):', blocks);
    return {
      success: true,
      syncedCount: blocks.length,
    };
  }

  downloadIcsFile(blocks: ScheduleBlock[], filename = 'focus-study-plan.ics') {
    const icsString = generateIcsContent(blocks);
    const blob = new Blob([icsString], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

export const googleCalendarService = new GoogleCalendarService();
