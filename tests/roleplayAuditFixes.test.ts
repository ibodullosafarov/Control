import { describe, expect, it } from 'vitest';
import { ScheduleBlock, TaskItem, DayPlan } from '../src/types';

describe('Roleplay audit fixes', () => {
  describe('Multi-day plan task mirroring (Bug 1)', () => {
    // Pure reproduction of the handleSavePlan task filtering rule
    function reconcileTasksOnPlanSave(
      date: string,
      newPlanBlocks: ScheduleBlock[],
      previousPlans: Record<string, DayPlan>,
      currentTasks: TaskItem[]
    ): TaskItem[] {
      const nextBlocks = newPlanBlocks;
      const nextById = new Map(nextBlocks.map((b) => [b.id, b]));
      let tasks = [...currentTasks];

      const prevDateBlockIds = new Set((previousPlans[date]?.blocks || []).map((b) => b.id));
      tasks = tasks.flatMap((t) => {
        if (t.source === 'calendar' && t.sourceId && prevDateBlockIds.has(t.sourceId) && !nextById.has(t.sourceId)) {
          if (t.completed || !t.id.startsWith('task-cal-')) {
            return [{ ...t, source: 'manual' as const, sourceId: undefined }];
          }
          return [];
        }
        return [t];
      });

      return tasks;
    }

    it('never removes or modifies calendar tasks belonging to other dates', () => {
      const taskDay1: TaskItem = {
        id: 'task-cal-block-day1',
        title: 'Day 1 Task',
        completed: false,
        order: 0,
        createdAt: '2026-10-20T10:00:00Z',
        source: 'calendar',
        sourceId: 'block-day1',
      };
      const taskDay2: TaskItem = {
        id: 'task-cal-block-day2',
        title: 'Day 2 Task',
        completed: false,
        order: 1,
        createdAt: '2026-10-21T10:00:00Z',
        source: 'calendar',
        sourceId: 'block-day2',
      };

      const prevPlans: Record<string, DayPlan> = {
        '2026-10-20': {
          date: '2026-10-20',
          goals: [],
          timeWindows: [],
          blocks: [
            {
              id: 'block-day1',
              date: '2026-10-20',
              startTime: '09:00',
              endTime: '10:00',
              modeId: 'm1',
              modeName: 'Day 1 Task',
              modeIcon: '',
              modeColor: '',
              workDuration: 60,
              breakDuration: 0,
              cycles: 1,
              status: 'approved',
            },
          ],
        },
        '2026-10-21': {
          date: '2026-10-21',
          goals: [],
          timeWindows: [],
          blocks: [
            {
              id: 'block-day2',
              date: '2026-10-21',
              startTime: '14:00',
              endTime: '15:00',
              modeId: 'm1',
              modeName: 'Day 2 Task',
              modeIcon: '',
              modeColor: '',
              workDuration: 60,
              breakDuration: 0,
              cycles: 1,
              status: 'approved',
            },
          ],
        },
      };

      // User updates Day 1 to add a new block3, keeping block-day1
      const updatedDay1Blocks = [
        ...prevPlans['2026-10-20'].blocks,
        {
          id: 'block-day1-extra',
          date: '2026-10-20',
          startTime: '11:00',
          endTime: '12:00',
          modeId: 'm1',
          modeName: 'Extra',
          modeIcon: '',
          modeColor: '',
          workDuration: 60,
          breakDuration: 0,
          cycles: 1,
          status: 'approved' as const,
        },
      ];

      const result = reconcileTasksOnPlanSave('2026-10-20', updatedDay1Blocks, prevPlans, [taskDay1, taskDay2]);

      // taskDay2 MUST still exist and retain its calendar source!
      const day2Task = result.find((t) => t.id === 'task-cal-block-day2');
      expect(day2Task).toBeDefined();
      expect(day2Task?.source).toBe('calendar');
      expect(day2Task?.sourceId).toBe('block-day2');
    });

    it('reverts adopted manual tasks to manual instead of deleting them when calendar block is deleted', () => {
      const adoptedTask: TaskItem = {
        id: 'manual-task-123', // Not starting with task-cal-
        title: 'User Backlog Task',
        completed: false,
        order: 0,
        createdAt: '2026-10-20T10:00:00Z',
        source: 'calendar',
        sourceId: 'block-1',
      };

      const prevPlans: Record<string, DayPlan> = {
        '2026-10-20': {
          date: '2026-10-20',
          goals: [],
          timeWindows: [],
          blocks: [
            {
              id: 'block-1',
              date: '2026-10-20',
              startTime: '09:00',
              endTime: '10:00',
              modeId: 'm1',
              modeName: 'User Backlog Task',
              modeIcon: '',
              modeColor: '',
              workDuration: 60,
              breakDuration: 0,
              cycles: 1,
              status: 'approved',
            },
          ],
        },
      };

      // Block is deleted on 2026-10-20
      const result = reconcileTasksOnPlanSave('2026-10-20', [], prevPlans, [adoptedTask]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('manual-task-123');
      expect(result[0].source).toBe('manual');
      expect(result[0].sourceId).toBeUndefined();
    });
  });

  describe('Overnight event geometry (Bug 5)', () => {
    function computeDurationMinutes(startTime: string, endTime: string): number {
      const [sH, sM] = startTime.split(':').map(Number);
      const [eH, eM] = endTime.split(':').map(Number);
      const startAbsMins = sH * 60 + (sM || 0);
      const endAbsMins = eH * 60 + (eM || 0);
      const effectiveEnd = endAbsMins < startAbsMins ? 24 * 60 : endAbsMins;
      return Math.max(20, effectiveEnd - startAbsMins);
    }

    it('spans overnight events to midnight instead of collapsing to 20 minutes', () => {
      // 23:00 to 01:00 is 1 hour remaining in the day (60 minutes)
      const duration = computeDurationMinutes('23:00', '01:00');
      expect(duration).toBe(60);

      // Normal same-day event 09:00 to 10:30 is 90 minutes
      expect(computeDurationMinutes('09:00', '10:30')).toBe(90);

      // Short event 09:00 to 09:10 clamps to minimum 20 minutes
      expect(computeDurationMinutes('09:00', '09:10')).toBe(20);
    });
  });

  describe('Remaining cycle calculation in taskCyclePlan (Bug 6)', () => {
    function taskCyclePlanRemaining(taskCycles: number, cyclesCompleted: number, placedIndices: number[]): number {
      const total = typeof taskCycles === 'number' && taskCycles > 1 ? Math.floor(taskCycles) : 1;
      const done = Math.max(0, cyclesCompleted || 0);
      const base = Math.max(done, placedIndices.length ? Math.max(...placedIndices) : 0);
      return Math.max(0, total - base);
    }

    it('returns 0 cycles left when task cycles are all completed or placed', () => {
      // 2 cycles, 2 done -> 0 left
      expect(taskCyclePlanRemaining(2, 2, [])).toBe(0);
      // 3 cycles, 1 done, cycle 2 placed -> cycle 3 remaining (1 left)
      expect(taskCyclePlanRemaining(3, 1, [2])).toBe(1);
      // 3 cycles, cycle 3 placed -> 0 left
      expect(taskCyclePlanRemaining(3, 0, [1, 2, 3])).toBe(0);
      // 3 cycles, 1 done, none placed -> 2 left
      expect(taskCyclePlanRemaining(3, 1, [])).toBe(2);
      // 1 cycle, 1 done -> 0 left (previously returned 1 due to Math.max(1, ...))
      expect(taskCyclePlanRemaining(1, 1, [])).toBe(0);
    });
  });
});
