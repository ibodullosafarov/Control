import { describe, expect, it } from 'vitest';
import { generateRoomCode, sanitizeRoomCode } from '../src/services/cloud';

describe('online room codes', () => {
  it('generates 6-char unambiguous codes', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      expect(code).not.toMatch(/[01ILO]/);
    }
  });

  it('sanitizes user-entered codes', () => {
    expect(sanitizeRoomCode('kq7x-pa!')).toBe('KQ7XPA');
    expect(sanitizeRoomCode('  abc123xyz!! ')).toBe('ABC123XY');
    expect(sanitizeRoomCode('')).toBe('');
  });
});
