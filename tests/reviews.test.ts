import { describe, expect, it } from 'vitest';
import { dueReviews, gradeReview, startReviewing } from '../src/services/reviews';
import type { TaskItem } from '../src/types';

function task(id: string, extra: Partial<TaskItem> = {}): TaskItem {
  return {
    id,
    title: id,
    completed: false,
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

describe('gradeReview', () => {
  it('grades a new card q5 as interval 1, reps 1, due tomorrow', () => {
    expect(gradeReview(undefined, 5, '2026-10-14')).toEqual({
      intervalDays: 1,
      dueDay: '2026-10-15',
      reps: 1,
    });
  });

  it('grows the second success to interval 3', () => {
    expect(gradeReview({ intervalDays: 1, reps: 1 }, 4, '2026-10-14')).toEqual({
      intervalDays: 3,
      dueDay: '2026-10-17',
      reps: 2,
    });
  });

  it('grows the third success by round(prev * 2.2)', () => {
    // round(3 * 2.2) = 7
    expect(gradeReview({ intervalDays: 3, reps: 2 }, 3, '2026-10-14')).toEqual({
      intervalDays: 7,
      dueDay: '2026-10-21',
      reps: 3,
    });
  });

  it('resets reps and interval on failure', () => {
    expect(gradeReview({ intervalDays: 7, reps: 3 }, 2, '2026-10-14')).toEqual({
      intervalDays: 1,
      dueDay: '2026-10-15',
      reps: 0,
    });
    expect(gradeReview(undefined, 1, '2026-10-14')).toEqual({
      intervalDays: 1,
      dueDay: '2026-10-15',
      reps: 0,
    });
  });

  it('clamps the interval to [1, 365]', () => {
    expect(gradeReview({ intervalDays: 300, reps: 5 }, 5, '2026-10-14').intervalDays).toBe(365);
    expect(
      gradeReview({ intervalDays: 300, reps: 5 }, 5, '2026-10-14').dueDay
    ).toBe('2027-10-14');
    expect(gradeReview({ intervalDays: 0, reps: 5 }, 5, '2026-10-14').intervalDays).toBe(1);
  });

  it('carries dueDay across month boundaries', () => {
    expect(gradeReview(undefined, 5, '2026-01-31').dueDay).toBe('2026-02-01');
  });
});

describe('dueReviews', () => {
  const tasks = [
    task('future', { order: 0, review: { intervalDays: 7, dueDay: '2026-10-20', reps: 3 } }),
    task('done', {
      order: 1,
      completed: true,
      review: { intervalDays: 1, dueDay: '2026-10-10', reps: 1 },
    }),
    task('plain', { order: 2 }),
    task('late', { order: 3, review: { intervalDays: 3, dueDay: '2026-10-12', reps: 2 } }),
    task('today-b', { order: 5, review: { intervalDays: 1, dueDay: '2026-10-14', reps: 1 } }),
    task('today-a', { order: 4, review: { intervalDays: 1, dueDay: '2026-10-14', reps: 0 } }),
  ];

  it('keeps only overdue-or-due reviews and sorts by dueDay then order', () => {
    expect(dueReviews(tasks, '2026-10-14').map((t) => t.id)).toEqual([
      'late',
      'today-a',
      'today-b',
    ]);
  });

  it('returns an empty list when nothing is due', () => {
    expect(dueReviews(tasks, '2026-10-01')).toEqual([]);
  });
});

describe('startReviewing', () => {
  it('attaches fresh review state due immediately without mutating', () => {
    const original = task('a', { order: 2, title: 'Chemistry', modeId: 'm1' });
    const out = startReviewing(original, '2026-10-14');
    expect(out.review).toEqual({ intervalDays: 1, dueDay: '2026-10-14', reps: 0 });
    expect(out.title).toBe('Chemistry');
    expect(out.modeId).toBe('m1');
    expect(out.order).toBe(2);
    expect(original.review).toBeUndefined();
    expect(out).not.toBe(original);
  });
});
