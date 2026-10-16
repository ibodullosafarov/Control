import { describe, expect, it } from 'vitest';
import {
  applyFlexTemplate,
  formatFlexDate,
  parseFlexTemplate,
  partitionForReplace,
  resolveFlexTaskModes,
} from '../src/services/flexTemplates';
import { isBreakTitle } from '../src/services/scheduleTemplates';
import { ScheduleBlock, StudyMode } from '../src/types';

function makeMode(overrides: Partial<StudyMode> = {}): StudyMode {
  return {
    id: 'mode-deep',
    name: 'Deep Work',
    description: 'desc',
    icon: 'target',
    color: '#38bdf8',
    workDuration: 50,
    breakDuration: 10,
    cycles: 3,
    longBreakDuration: 20,
    longBreakInterval: 4,
    blocklist: ['example.com'],
    blockedApps: [],
    allowlist: [],
    allowBreakWebsites: true,
    countTowardStats: true,
    isChillMode: false,
    blockingStrategy: 'dynamic_hosts',
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const MODES = [
  makeMode({ id: 'm-quick', name: 'Quick', workDuration: 25 }),
  makeMode({ id: 'm-deep-study', name: 'Deep Study', workDuration: 50 }),
];

// The task's illustrative example, verbatim in structure.
const EXAMPLE_MD = `{{date}} Day Plan

# English 50

## Time
13:30-15:45

## Blocking
Mode: {Quick}

# SAT Math 50

## Time
16:00-17:30

## Blocking
Mode: {Deep Study}

# Vocabulary 30

## Time
17:45-18:15
`;

describe('parseFlexTemplate', () => {
  it('parses the example into three scheduled tasks', () => {
    const { template, errors } = parseFlexTemplate('Study Day', EXAMPLE_MD);
    // Vocabulary has no Blocking section — correctly surfaced, fixable via override.
    expect(errors).toEqual([
      {
        template: 'Study Day',
        task: 'Vocabulary 30',
        field: 'Mode',
        message: expect.stringMatching(/names no mode/),
      },
    ]);
    expect(template.title).toBe('Study Day');
    expect(template.hasDatePlaceholder).toBe(true);
    expect(template.variables).toContain('date');
    expect(template.tasks).toHaveLength(3);

    const [eng, math, vocab] = template.tasks;
    expect([eng.title, eng.start, eng.end, eng.modeRef]).toEqual([
      'English 50', '13:30', '15:45', 'Quick',
    ]);
    expect([math.title, math.start, math.end, math.modeRef]).toEqual([
      'SAT Math 50', '16:00', '17:30', 'Deep Study',
    ]);
    expect([vocab.title, vocab.start, vocab.end, vocab.modeRef]).toEqual([
      'Vocabulary 30', '17:45', '18:15', null,
    ]);
  });

  it('flags the missing mode (fixable via override, not silent)', () => {
    const { errors } = parseFlexTemplate('Study Day', EXAMPLE_MD);
    expect(errors).toHaveLength(1);
    expect(errors[0].task).toBe('Vocabulary 30');
    expect(errors[0].field).toBe('Mode');
  });

  it('accepts en-dash ranges, Start/End lines and braceless modes', () => {
    const raw = [
      '# A',
      '## Time',
      '9:00 – 10:30',
      '## Blocking',
      'Mode: Quick',
      '# B',
      '## Time',
      'Start: 11:00',
      'End: 11:45',
      '## Blocking',
      'mode: {Deep Study}',
    ].join('\n');
    const { template, errors } = parseFlexTemplate('t', raw);
    expect(errors).toEqual([]);
    expect([template.tasks[0].start, template.tasks[0].end]).toEqual(['09:00', '10:30']);
    expect([template.tasks[1].start, template.tasks[1].end]).toEqual(['11:00', '11:45']);
    expect(template.tasks[0].modeRef).toBe('Quick');
    expect(template.tasks[1].modeRef).toBe('Deep Study');
  });

  it('reports missing/malformed times and rejects cross-midnight', () => {
    const raw = [
      '# NoTime',
      '## Blocking',
      'Mode: Quick',
      '# BadTime',
      '## Time',
      'sometime-ish',
      '## Blocking',
      'Mode: Quick',
      '# Overnight',
      '## Time',
      '23:00-01:00',
      '## Blocking',
      'Mode: Quick',
      '# BadClock',
      '## Time',
      '25:00-26:00',
      '## Blocking',
      'Mode: Quick',
    ].join('\n');
    const { template, errors } = parseFlexTemplate('t', raw);
    expect(template.tasks).toHaveLength(4);
    expect(errors.map((e) => [e.task, e.field])).toEqual([
      ['NoTime', 'Time'],
      ['BadTime', 'Time'],
      ['Overnight', 'Time'],
      ['BadClock', 'Time'],
    ]);
    expect(errors[2].message).toMatch(/cross-midnight/);
  });

  it('keeps arbitrary Markdown as notes and preamble', () => {
    const raw = [
      'My preamble with *emphasis* and {{date}}.',
      '',
      '# Task',
      'A stray paragraph.',
      '## Time',
      '10:00-11:00',
      '## Blocking',
      'Mode: Quick',
      '## Resources',
      '- https://example.com/video?q=1&r=2',
      'Some **bold** note.',
      '### Deep heading stays too',
    ].join('\n');
    const { template, errors } = parseFlexTemplate('t', raw);
    expect(errors).toEqual([]);
    expect(template.preamble).toContain('*emphasis*');
    expect(template.tasks[0].notes).toEqual([
      'A stray paragraph.',
      '- https://example.com/video?q=1&r=2\nSome **bold** note.\n### Deep heading stays too',
    ]);
  });

  it('supports unicode and never throws on garbage', () => {
    const { template, errors } = parseFlexTemplate(
      '日本語',
      '# 数学 📐\n## Time\n10:00-11:00\n## Blocking\nMode: Quick\n'
    );
    expect(errors).toEqual([]);
    expect(template.tasks[0].title).toBe('数学 📐');
    expect(() => parseFlexTemplate('t', '\0\0# \xff\n## \n- :-:')).not.toThrow();
    expect(parseFlexTemplate('t', 'no headings here').errors.length).toBeGreaterThan(0);
  });

  it('reads frontmatter name/description without losing the body', () => {
    const { template, errors } = parseFlexTemplate(
      'file',
      '---\nname: Fancy\ndescription: hi\n---\n\n# Real Title\n## Time\n10:00-11:00\n## Blocking\nMode: Quick\n'
    );
    expect(errors).toEqual([]);
    expect(template.title).toBe('Fancy');
    expect(template.description).toBe('hi');
  });
});

describe('resolveFlexTaskModes', () => {
  it('resolves built-in and custom modes by name, case-insensitively', () => {
    const modes = [...MODES, makeMode({ id: 'm-custom', name: 'My Custom Ritual' })];
    const { template } = parseFlexTemplate('t', EXAMPLE_MD);
    const res = resolveFlexTaskModes(template, modes);
    expect(res[0]).toEqual({ order: 0, modeId: 'm-quick', error: null });
    expect(res[1]).toEqual({ order: 1, modeId: 'm-deep-study', error: null });
    expect(res[2].modeId).toBeNull();
    expect(res[2].error).toMatch(/names no mode/);
  });

  it('reports unknown modes with the available names listed', () => {
    const { template } = parseFlexTemplate(
      't',
      '# X\n## Time\n10:00-11:00\n## Blocking\nMode: {Nope}\n'
    );
    const [res] = resolveFlexTaskModes(template, MODES);
    expect(res.modeId).toBeNull();
    expect(res.error).toMatch(/Nope/);
    expect(res.error).toMatch(/Quick/);
    expect(res.error).toMatch(/Deep Study/);
  });
});

describe('applyFlexTemplate', () => {
  const salted = () => {
    let i = 0;
    return () => `s${i++}`;
  };

  function apply(configOverrides = {}, ctxOverrides = {}) {
    const { template } = parseFlexTemplate('Study Day', EXAMPLE_MD);
    return applyFlexTemplate(
      template,
      { date: '2026-10-12', modeOverrides: { 2: 'm-quick' }, ...configOverrides },
      { modes: MODES, nowMs: 1_000_000, idSalt: salted(), ...ctxOverrides }
    );
  }

  it('creates three real events on the target date with resolved modes', () => {
    const res = apply();
    expect(res.errors).toEqual([]);
    expect(res.blocks.map((b) => [b.startTime, b.endTime, b.modeName, b.modeId])).toEqual([
      ['13:30', '15:45', 'English 50', 'm-quick'],
      ['16:00', '17:30', 'SAT Math 50', 'm-deep-study'],
      ['17:45', '18:15', 'Vocabulary 30', 'm-quick'],
    ]);
    expect(res.totalMinutes).toBe(135 + 90 + 30);
    expect(res.alreadyApplied).toBe(false);
    for (const b of res.blocks) {
      expect(b.date).toBe('2026-10-12');
      expect(b.status).toBe('approved');
      expect(b.source).toBe('control');
      expect(b.originTemplate).toBe('Study Day');
      expect(b.googleCalendarEventId).toBeUndefined();
      expect(b.workDuration).toBeGreaterThan(0);
    }
  });

  it('blocks on unresolved modes until overridden', () => {
    const { template } = parseFlexTemplate('Study Day', EXAMPLE_MD);
    const res = applyFlexTemplate(
      template,
      { date: '2026-10-12', modeOverrides: {} },
      { modes: MODES, nowMs: 1 }
    );
    expect(res.blocks).toEqual([]);
    expect(res.errors).toEqual([expect.stringMatching(/Vocabulary 30.*no mode/)]);
  });

  it('generates single-cycle blocks whose work equals the event length', () => {
    const res = apply();
    expect(res.errors).toEqual([]);
    expect(res.blocks.map((b) => [b.startTime, b.endTime, b.workDuration, b.cycles])).toEqual([
      ['13:30', '15:45', 135, 1],
      ['16:00', '17:30', 90, 1],
      ['17:45', '18:15', 30, 1],
    ]);
    expect(res.blocks.every((b) => b.breakDuration === 0)).toBe(true);
  });

  it('applies per-task time overrides without touching the template', () => {
    const { template } = parseFlexTemplate('Study Day', EXAMPLE_MD);
    const before = template.tasks[0].start;
    const res = applyFlexTemplate(
      template,
      {
        date: '2026-10-12',
        modeOverrides: { 0: 'm-quick', 1: 'm-deep-study', 2: 'm-quick' },
        timeOverrides: { 0: { start: '13:00', end: '13:30' } },
      },
      { modes: MODES, nowMs: 1 }
    );
    expect(res.errors).toEqual([]);
    expect([res.blocks[0].startTime, res.blocks[0].endTime, res.blocks[0].workDuration]).toEqual([
      '13:00', '13:30', 30,
    ]);
    // Later tasks keep template times; template object untouched.
    expect([res.blocks[1].startTime, res.blocks[1].endTime]).toEqual(['16:00', '17:30']);
    expect(template.tasks[0].start).toBe(before);
  });

  it('rejects invalid override times atomically', () => {
    const { template } = parseFlexTemplate('Study Day', EXAMPLE_MD);
    const badStart = applyFlexTemplate(
      template,
      {
        date: '2026-10-12',
        modeOverrides: { 0: 'm-quick', 1: 'm-deep-study', 2: 'm-quick' },
        timeOverrides: { 1: { start: 'sometime' } },
      },
      { modes: MODES, nowMs: 1 }
    );
    expect(badStart.blocks).toEqual([]);
    expect(badStart.errors).toEqual([expect.stringMatching(/invalid overridden time/)]);
    const backwards = applyFlexTemplate(
      template,
      {
        date: '2026-10-12',
        modeOverrides: { 0: 'm-quick', 1: 'm-deep-study', 2: 'm-quick' },
        timeOverrides: { 1: { start: '17:00', end: '16:00' } },
      },
      { modes: MODES, nowMs: 1 }
    );
    expect(backwards.blocks).toEqual([]);
    expect(backwards.errors).toEqual([expect.stringMatching(/not after/)]);
  });

  it('is atomic: one bad task means zero blocks', () => {
    const { template } = parseFlexTemplate(
      't',
      '# Good\n## Time\n10:00-11:00\n## Blocking\nMode: Quick\n# Bad\n## Blocking\nMode: Quick\n'
    );
    const res = applyFlexTemplate(template, { date: '2026-10-12' }, { modes: MODES, nowMs: 1 });
    expect(res.blocks).toEqual([]);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it('warns on overlaps and flags re-application', () => {
    const existing: ScheduleBlock[] = [
      {
        id: 'old', date: '2026-10-12', startTime: '13:00', endTime: '14:00',
        modeId: 'm', modeName: 'Standup', modeIcon: 'x', modeColor: '#fff',
        workDuration: 60, breakDuration: 0, cycles: 1, status: 'approved',
      },
    ];
    const res = apply({}, { existingBlocks: existing });
    expect(res.blocks).toHaveLength(3);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].taskTitle).toBe('English 50');
    const again = apply({}, { existingBlocks: res.blocks });
    expect(again.alreadyApplied).toBe(true);
    expect(again.blocks).toHaveLength(3);
  });

  it('substitutes {{date}} in titles and notes', () => {
    const { template } = parseFlexTemplate(
      't',
      '{{date}} plan\n# Review {{date}}\nSays {{date}} here.\n## Time\n10:00-11:00\n## Blocking\nMode: Quick\n'
    );
    const res = applyFlexTemplate(template, { date: '2026-10-12' }, { modes: MODES, nowMs: 1 });
    expect(res.errors).toEqual([]);
    expect(res.blocks[0].modeName).toBe('Review 2026-10-12');
    expect(res.blocks[0].description).toBe('Says 2026-10-12 here.');
  });
});

describe('isBreakTitle (B-16)', () => {
  it('matches exact, prefixed, and suffixed break titles', () => {
    expect(isBreakTitle('Break')).toBe(true);
    expect(isBreakTitle('Long Break')).toBe(true);
    expect(isBreakTitle('Break: wind down')).toBe(true);
    expect(isBreakTitle('Rest — 10 min')).toBe(true);
    expect(isBreakTitle('Lunch Break')).toBe(true);
  });

  it('does not match leading-verb control titles', () => {
    expect(isBreakTitle('Break down 50 problems')).toBe(false);
    expect(isBreakTitle('English 50')).toBe(false);
    expect(isBreakTitle('')).toBe(false);
  });

  it('generates "Long Break" as rest, never control work', () => {
    const { template } = parseFlexTemplate(
      't',
      '# Long Break\n## Time\n16:20-16:30\n## Blocking\nMode: {Rest Mode}\n'
    );
    const modes = [makeMode({ id: 'm-rest', name: 'Rest Mode' })];
    const res = applyFlexTemplate(template, { date: '2026-10-12' }, { modes, nowMs: 1 });
    expect(res.errors).toEqual([]);
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0].workDuration).toBe(0);
    expect(res.blocks[0].breakDuration).toBe(10);
    expect(res.blocks[0].timerEnabled).toBe(false);
  });
});

describe('partitionForReplace', () => {
  it('lists removals and counts Google-mapped events', () => {
    const mk = (id: string, gid?: string): ScheduleBlock => ({
      id, date: '2026-10-12', startTime: '09:00', endTime: '10:00',
      modeId: 'm', modeName: 'X', modeIcon: 'x', modeColor: '#fff',
      workDuration: 60, breakDuration: 0, cycles: 1, status: 'approved',
      ...(gid ? { googleCalendarEventId: gid } : {}),
    });
    const part = partitionForReplace([mk('a', 'g1'), mk('b')]);
    expect(part.removeIds).toEqual(['a', 'b']);
    expect(part.googleMapped).toBe(1);
    expect(partitionForReplace([])).toEqual({ removeIds: [], googleMapped: 0 });
  });
});

describe('formatFlexDate', () => {
  it('keeps the planner canonical form', () => {
    expect(formatFlexDate('2026-10-12')).toBe('2026-10-12');
  });
});
