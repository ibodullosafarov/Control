import { describe, expect, it } from 'vitest';
import { isSingleBlockMode, resolveWorkCompletion } from '../src/services/sessionFlow';

describe('resolveWorkCompletion', () => {
  it('completes a single-cycle mode right after its one work phase (no trailing break)', () => {
    expect(resolveWorkCompletion(0, 1)).toBe('complete');
  });

  it('runs breaks between cycles of multi-cycle modes, completing after the last', () => {
    expect(resolveWorkCompletion(0, 3)).toBe('break');
    expect(resolveWorkCompletion(1, 3)).toBe('break');
    expect(resolveWorkCompletion(2, 3)).toBe('complete');
  });

  it('never invents extra cycles for degenerate totals', () => {
    // completedCyclesCount starts at 0 and only increments in production.
    expect(resolveWorkCompletion(0, 0)).toBe('complete');
    expect(resolveWorkCompletion(5, 3)).toBe('complete');
    expect(resolveWorkCompletion(0, -2)).toBe('complete');
  });
});

describe('isSingleBlockMode', () => {
  it('treats one-cycle modes as single blocks', () => {
    expect(isSingleBlockMode(1)).toBe(true);
    expect(isSingleBlockMode(undefined)).toBe(true);
  });

  it('leaves multi-cycle and chill modes alone', () => {
    expect(isSingleBlockMode(3)).toBe(false);
    expect(isSingleBlockMode(2)).toBe(false);
    expect(isSingleBlockMode(1, true)).toBe(false);
  });
});
