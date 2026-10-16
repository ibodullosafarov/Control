import { describe, expect, it } from 'vitest';
import { isValidDomain, repairBlocklist, repairDomain } from '../src/services/domains';

describe('isValidDomain', () => {
  it('accepts ordinary domains', () => {
    expect(isValidDomain('youtube.com')).toBe(true);
    expect(isValidDomain('news.ycombinator.com')).toBe(true);
    expect(isValidDomain('claude.ai')).toBe(true);
  });

  it('rejects non-domains', () => {
    expect(isValidDomain('')).toBe(false);
    expect(isValidDomain('Google Docs')).toBe(false);
    expect(isValidDomain('not a domain')).toBe(false);
    expect(isValidDomain('nodot')).toBe(false);
  });
});

describe('repairDomain', () => {
  it('repairs known duplicated-suffix typos', () => {
    expect(repairDomain('claude.ai.com')).toBe('claude.ai');
    expect(repairDomain('gemini.google.com.com')).toBe('gemini.google.com');
    expect(repairDomain('chatgpt.com.com')).toBe('chatgpt.com');
  });

  it('collapses a generic doubled .com suffix', () => {
    expect(repairDomain('example.com.com')).toBe('example.com');
  });

  it('leaves good domains alone', () => {
    expect(repairDomain('youtube.com')).toBe('youtube.com');
    expect(repairDomain('  YouTube.COM  ')).toBe('youtube.com');
  });
});

describe('repairBlocklist', () => {
  it('repairs, dedupes, preserves order, and never drops entries', () => {
    const { list, fixed } = repairBlocklist([
      'youtube.com',
      'chatgpt.com.com',
      'claude.ai.com',
      'chatgpt.com',
      '',
      '  ',
    ]);
    expect(list).toEqual(['youtube.com', 'chatgpt.com', 'claude.ai']);
    expect(fixed).toEqual([
      { before: 'chatgpt.com.com', after: 'chatgpt.com' },
      { before: 'claude.ai.com', after: 'claude.ai' },
    ]);
  });

  it('keeps even invalid entries (flag at edit time, never shrink protection)', () => {
    const { list } = repairBlocklist(['Google Docs', 'youtube.com']);
    expect(list).toEqual(['google docs', 'youtube.com']);
  });

  it('handles non-arrays', () => {
    expect(repairBlocklist(undefined)).toEqual({ list: [], fixed: [] });
  });
});
