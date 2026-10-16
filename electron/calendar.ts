import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { shell } from 'electron';
import { ScheduleBlock, GoogleCalendarConfig } from '../src/types';
import { generateIcsContent } from '../src/services/planner';

export class CalendarManager {
  async exportToIcs(blocks: ScheduleBlock[]): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
      const icsContent = generateIcsContent(blocks);
      const downloadsDir = path.join(os.homedir(), 'Downloads');
      const rawDate = blocks[0]?.date || 'plan';
      const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : 'plan';
      const filename = `control-schedule-${safeDate}.ics`;
      const filePath = path.join(downloadsDir, filename);

      fs.writeFileSync(filePath, icsContent, 'utf-8');

      // Optionally trigger macOS Calendar app open (no shell — fixed argv)
      shell.openPath(filePath).catch((err: unknown) => console.warn('Could not auto-open calendar file:', err));

      return { success: true, filePath };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }

  async syncToGoogleCalendar(
    blocks: ScheduleBlock[],
    config: GoogleCalendarConfig
  ): Promise<{ success: boolean; syncedCount: number; error?: string; icsFallback?: boolean }> {
    try {
      // If we don't have OAuth token or credentials, export to .ics as reliable fallback
      // and report honestly: nothing was synced to Google.
      if (!config.clientId || !config.connected) {
        // Safe graceful fallback
        await this.exportToIcs(blocks);
        return {
          success: false,
          syncedCount: 0,
          error: 'Google Calendar not connected — exported .ics instead.',
          icsFallback: true,
        };
      }

      let synced = 0;
      const errors: string[] = [];
      for (const block of blocks) {
        const sh = parseInt((block.startTime || '').split(':')[0] || '', 10);
        const sm = parseInt((block.startTime || '').split(':')[1] || '', 10);
        const eh = parseInt((block.endTime || '').split(':')[0] || '', 10);
        const em = parseInt((block.endTime || '').split(':')[1] || '', 10);
        const [year, month, day] = block.date.split('-').map(Number);
        if (![sh, sm, eh, em, year, month, day].every((n) => Number.isFinite(n))) {
          errors.push(`Skipping block "${block.modeName}": invalid time/date.`);
          continue;
        }

        const startIso = new Date(year, month - 1, day, sh, sm).toISOString();
        const endIso = new Date(year, month - 1, day, eh, em).toISOString();

        void startIso;
        void endIso;
        // No direct Google API client in this legacy path — do NOT claim success.
        // The two-way engine (electron/google/syncEngine.ts) owns real pushes.
        errors.push(`Block "${block.modeName}": legacy sync has no Google API client — use connected sync.`);
      }

      if (synced === 0) {
        return { success: false, syncedCount: 0, error: errors.join(' ') || 'Nothing synced.' };
      }
      return { success: true, syncedCount: synced };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, syncedCount: 0, error: msg };
    }
  }
}

export const calendarManager = new CalendarManager();
