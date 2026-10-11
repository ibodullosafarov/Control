import { describe, expect, it, vi } from 'vitest';
import {
  applyTemplateVariables,
  buildDayScheduleSection,
  dayScheduleHeading,
  extractVariables,
  formatMinutes,
  generateSchedule,
  mergeDayScheduleSection,
  parseBool,
  parseDurationMinutes,
  parseScheduleTemplate,
  parseTimeMinutes,
  validateSingleBlockDurations,
} from '../src/services/scheduleTemplates';
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
  makeMode({ id: 'mode-deep', name: 'Deep Work', isDefault: true }),
  makeMode({ id: 'mode-break', name: 'Break', isChillMode: true, blockingStrategy: 'none', blocklist: [] }),
];

const SAT_MD = `---
type: control-day-template
name: Daily SAT
description: Daily SAT preparation routine
version: 2
default-start: 09:00
---

# Daily SAT

## SAT Math
- Questions: 50
- Duration: 60m
- Timer: true
- Focus Mode: true
- Mode: Deep Work

## Break
- Duration: 15m

## SAT English
- Questions: 50
- Duration: 1h
- Timer: yes
- Focus Mode: on

## Pause
- Type: break
- Duration: 15m
- Timer: false

## Vocabulary 🌱
- Items: 30
- Duration: 30m
- Timer: true
- Focus Mode: false
- Notes: Review chapters 3–4
`;

describe('parseDurationMinutes', () => {
  it.each([
    ['60m', 60],
    ['60', 60],
    ['45min', 45],
    ['30 minutes', 30],
    ['1h', 60],
    ['1h30m', 90],
    ['2 hours', 120],
    ['1:30', 90],
    ['0:45', 45],
  ])('parses %s as %s minutes', (raw, expected) => {
    expect(parseDurationMinutes(raw)).toBe(expected);
  });

  it.each([['soon'], ['0'], ['0m'], ['-5'], ['25h'], ['1:99'], [''], ['abc']])(
    'rejects %s',
    (raw) => {
      expect(parseDurationMinutes(raw)).toBeNull();
    }
  );
});

describe('parseBool / parseTimeMinutes / formatMinutes', () => {
  it.each([['true'], ['YES'], ['1'], ['on']])('parses %s as true', (raw) => {
    expect(parseBool(raw)).toBe(true);
  });
  it.each([['false'], ['No'], ['0'], ['off']])('parses %s as false', (raw) => {
    expect(parseBool(raw)).toBe(false);
  });
  expect(parseBool('maybe')).toBeNull();

  expect(parseTimeMinutes('09:00')).toBe(540);
  expect(parseTimeMinutes('9:05')).toBe(545);
  expect(parseTimeMinutes('24:00')).toBeNull();
  expect(parseTimeMinutes('9am')).toBeNull();
  expect(formatMinutes(540)).toBe('09:00');
  expect(formatMinutes(775)).toBe('12:55');
});

describe('parseScheduleTemplate', () => {
  it('parses a full v2 SAT template', () => {
    const { template, errors } = parseScheduleTemplate('Daily SAT', SAT_MD);
    expect(errors).toEqual([]);
    expect(template.title).toBe('Daily SAT');
    expect(template.description).toBe('Daily SAT preparation routine');
    expect(template.version).toBe(2);
    expect(template.defaultStart).toBe('09:00');
    expect(template.sessions).toHaveLength(5);

    const [math, brk, english, pause, vocab] = template.sessions;
    expect(math.title).toBe('SAT Math');
    expect(math.kind).toBe('session');
    expect(math.durationMinutes).toBe(60);
    expect(math.countValue).toBe(50);
    expect(math.countLabel).toBe('questions');
    expect(math.timer).toBe(true);
    expect(math.focusMode).toBe(true);
    expect(math.modeName).toBe('Deep Work');

    expect(brk.kind).toBe('break');
    expect(brk.durationMinutes).toBe(15);
    expect(brk.timer).toBeNull(); // breaks default at generation time

    expect(english.durationMinutes).toBe(60);
    expect(english.timer).toBe(true);
    expect(english.focusMode).toBe(true);

    expect(pause.kind).toBe('break'); // explicit Type wins
    expect(pause.timer).toBe(false);

    expect(vocab.title).toBe('Vocabulary 🌱');
    expect(vocab.countValue).toBe(30);
    expect(vocab.countLabel).toBe('items');
    expect(vocab.focusMode).toBe(false);
    expect(vocab.notes).toEqual(['Review chapters 3–4']);
  });

  it('falls back to filename/H1 title and reports missing durations', () => {
    const { template, errors } = parseScheduleTemplate(
      'file-name',
      '## Floating\n- Timer: true\n'
    );
    expect(template.title).toBe('file-name');
    expect(errors).toHaveLength(1);
    expect(errors[0].section).toBe('Floating');
    expect(errors[0].field).toBe('Duration');
    expect(errors[0].message).toMatch(/no usable Duration/);
  });

  it('uses frontmatter default-duration as fallback', () => {
    const { template, errors } = parseScheduleTemplate(
      't',
      '---\ndefault-duration: 25m\n---\n\n## A\n- Timer: true\n'
    );
    expect(errors).toEqual([]);
    expect(template.sessions[0].durationMinutes).toBe(25);
  });

  it('reports invalid values with section and field context, without throwing', () => {
    const raw = [
      '## Bad',
      '- Duration: soon',
      '- Timer: perhaps',
      '- Focus Mode: sometimes',
      '- Type: nap',
      '- Questions: lots',
      '- Count: many things',
      '- Mode: ',
      '',
      '## ',
      '',
    ].join('\n');
    const { errors } = parseScheduleTemplate('t', raw);
    const fields = errors.map((e) => e.field);
    expect(fields).toEqual(
      expect.arrayContaining(['Duration', 'Timer', 'Focus Mode', 'Type', 'Questions', 'Count', 'Mode'])
    );
    expect(errors.every((e) => e.template === 't')).toBe(true);
    expect(errors.some((e) => e.section === null)).toBe(true); // empty heading
  });

  it('treats checklist lines as notes and preserves unknown keys', () => {
    const { template, errors } = parseScheduleTemplate(
      't',
      '## Morning\n- [ ] Review notes\n- Duration: 25m\n- Stretch: 5m\nJust some prose\n'
    );
    expect(errors).toEqual([]);
    expect(template.sessions).toHaveLength(1);
    expect(template.sessions[0].durationMinutes).toBe(25);
    expect(template.sessions[0].notes).toEqual(['Review notes', 'Stretch: 5m', 'Just some prose']);
  });

  it('handles legacy v1 checklist templates', () => {
    const raw = [
      '---',
      'type: control-day-template',
      'name: SAT Grind',
      '---',
      '',
      '# SAT Grind',
      '',
      '## Morning',
      '- [ ] First task',
      '  Duration: 25m',
      '- [ ] Second task',
      '',
    ].join('\n');
    const { template, errors } = parseScheduleTemplate('SAT Grind', raw);
    expect(errors).toEqual([]);
    expect(template.version).toBe(1);
    expect(template.title).toBe('SAT Grind');
    expect(template.sessions).toHaveLength(1);
    expect(template.sessions[0].durationMinutes).toBe(25);
  });

  it('flags unknown versions but still parses', () => {
    const { template, errors } = parseScheduleTemplate(
      't',
      '---\nversion: 99\n---\n\n## A\n- Duration: 10m\n'
    );
    expect(errors).toEqual([]);
    expect(template.version).toBe(99);
    expect(template.warnings.length).toBeGreaterThan(0);
  });

  it('rejects content without sections and never throws on garbage', () => {
    expect(parseScheduleTemplate('t', '').errors.length).toBeGreaterThan(0);
    expect(parseScheduleTemplate('t', '# Only a title\n').errors.length).toBeGreaterThan(0);
    expect(() => parseScheduleTemplate('t', '\0\0---\n## \xff\n- Duration:'.repeat(10))).not.toThrow();
  });

  it('extracts variables and substitutes them', () => {
    expect(extractVariables('Hello {{name}}, {{name}} and {{topic}}!')).toEqual(['name', 'topic']);
    expect(applyTemplateVariables('Do {{n}} things {{missing}}', { n: '50' })).toBe(
      'Do 50 things {{missing}}'
    );
  });
});

describe('generateSchedule', () => {
  const parsed = () => parseScheduleTemplate('Daily SAT', SAT_MD).template;

  function run(configOverrides = {}, ctxOverrides = {}) {
    return generateSchedule(
      parsed(),
      { date: '2026-10-12', startTime: '09:00', ...configOverrides },
      { modes: MODES, nowMs: 1_000_000, idSalt: (() => { let i = 0; return () => `s${i++}`; })(), ...ctxOverrides }
    );
  }

  it('generates the canonical SAT day with exact times', () => {
    const res = run();
    expect(res.errors).toEqual([]);
    expect(res.conflicts).toEqual([]);
    expect(res.blocks.map((b) => [b.startTime, b.endTime, b.modeName])).toEqual([
      ['09:00', '10:00', 'SAT Math'],
      ['10:00', '10:15', 'Break'],
      ['10:15', '11:15', 'SAT English'],
      ['11:15', '11:30', 'Pause'],
      ['11:30', '12:00', 'Vocabulary 🌱'],
    ]);
    expect(res.totalMinutes).toBe(180);
    expect(res.endTime).toBe('12:00');
    expect(res.alreadyApplied).toBe(false);

    const [math, brk, , , vocab] = res.blocks;
    expect(math.workDuration).toBe(60);
    expect(math.cycles).toBe(1);
    expect(math.status).toBe('approved');
    expect(math.source).toBe('control');
    expect(math.description).toBe('50 questions');
    expect(math.timerEnabled).toBe(true);
    expect(math.focusMode).toBe(true);
    expect(math.modeId).toBe('mode-deep');
    expect(math.originTemplate).toBe('Daily SAT');
    expect(math.originTemplateAppliedAt).toBe(new Date(1_000_000).toISOString());
    expect(math.googleCalendarEventId).toBeUndefined();

    expect(brk.modeId).toBe('mode-break');
    expect(brk.timerEnabled).toBe(false);
    expect(brk.focusMode).toBeUndefined();

    expect(vocab.description).toBe('30 items · Review chapters 3–4');
    expect(vocab.focusMode).toBe(false);
  });

  it('creates blocks in the existing sync-eligible event shape', () => {
    const res = run();
    for (const b of res.blocks) {
      expect(b.id).toMatch(/^block-/);
      expect(b.date).toBe('2026-10-12');
      expect(b.startTime).toMatch(/^\d{2}:\d{2}$/);
      expect(b.endTime).toMatch(/^\d{2}:\d{2}$/);
      expect(b.modeId).toBeTruthy();
      expect(b.modeName).toBeTruthy();
      expect(b.status).toBe('approved');
      // Must not carry Google linkage — the sync engine owns that.
      expect(b.googleCalendarEventId).toBeUndefined();
      expect(b.googleEventETag).toBeUndefined();
      expect(b.googleCalendarId).toBeUndefined();
    }
    // Unique ids within a run, and fresh ids across runs (clock-driven).
    const ids = res.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    const later = generateSchedule(
      parseScheduleTemplate('Daily SAT', SAT_MD).template,
      { date: '2026-10-12', startTime: '09:00' },
      { modes: MODES, nowMs: 2_000_000, idSalt: (() => { let i = 0; return () => `s${i++}`; })() }
    );
    expect(later.blocks[0].id).not.toBe(res.blocks[0].id);
  });

  it('honors a different start time and target date', () => {
    const res = run({ date: '2026-10-20', startTime: '14:30' });
    expect(res.errors).toEqual([]);
    expect(res.blocks[0].startTime).toBe('14:30');
    expect(res.blocks[0].endTime).toBe('15:30');
    expect(res.blocks.every((b) => b.date === '2026-10-20')).toBe(true);
    expect(res.endTime).toBe('17:30');
  });

  it('applies per-session overrides without touching the template', () => {
    const before = parseScheduleTemplate('Daily SAT', SAT_MD).template;
    const res = run({
      overrides: {
        0: { title: 'Custom Math', durationMinutes: 30, countValue: 25, timer: false, focusMode: false },
        2: { modeId: 'mode-break' },
      },
    });
    expect(res.errors).toEqual([]);
    expect(res.blocks[0].modeName).toBe('Custom Math');
    expect(res.blocks[0].endTime).toBe('09:30');
    expect(res.blocks[0].description).toBe('25 questions');
    expect(res.blocks[0].timerEnabled).toBe(false);
    expect(res.blocks[0].focusMode).toBe(false);
    expect(res.blocks[1].startTime).toBe('09:30'); // downstream shifts
    expect(res.blocks[2].modeId).toBe('mode-break');
    // Template untouched.
    expect(before.sessions[0].title).toBe('SAT Math');
    expect(before.sessions[0].durationMinutes).toBe(60);
  });

  it('substitutes variables', () => {
    const { template } = parseScheduleTemplate('t', '## Review {{topic}}\n- Duration: 20m\n');
    const res = generateSchedule(
      template,
      { date: '2026-10-12', startTime: '09:00', variables: { topic: 'Algebra' } },
      { modes: MODES, nowMs: 1 }
    );
    expect(res.errors).toEqual([]);
    expect(res.blocks[0].modeName).toBe('Review Algebra');
  });

  it('rejects invalid input with fatal errors and no blocks', () => {
    expect(run({ date: 'tomorrow' }).errors.length).toBeGreaterThan(0);
    expect(run({ startTime: '9am' }).errors.length).toBeGreaterThan(0);
    expect(run({ startTime: '23:30' }).errors).toEqual([
      expect.stringMatching(/after midnight/),
    ]);
    const bad = run({ startTime: '23:30' });
    expect(bad.blocks).toEqual([]);
    expect(generateSchedule(parsed(), { date: '2026-10-12', startTime: '09:00' }, { modes: [] }).errors.length).toBeGreaterThan(0);
  });

  it('detects overlaps without moving or dropping anything', () => {
    const existing: ScheduleBlock[] = [
      {
        id: 'old-1', date: '2026-10-12', startTime: '09:30', endTime: '10:30',
        modeId: 'm', modeName: 'Standup', modeIcon: 'x', modeColor: '#fff',
        workDuration: 60, breakDuration: 0, cycles: 1, status: 'approved',
      },
    ];
    const res = run({}, { existingBlocks: existing });
    expect(res.errors).toEqual([]);
    expect(res.blocks).toHaveLength(5); // nothing dropped or shifted
    expect(res.conflicts).toHaveLength(3); // Math, Break and English overlap 09:30–10:30
    expect(res.conflicts[0].overlapping[0].title).toBe('Standup');
    // Other dates are irrelevant.
    const otherDay = run({}, { existingBlocks: [{ ...existing[0], date: '2026-10-13' }] });
    expect(otherDay.conflicts).toEqual([]);
  });

  it('flags re-application of the same template', () => {
    const first = run();
    const again = run(
      {},
      { existingBlocks: first.blocks as ScheduleBlock[] }
    );
    expect(again.alreadyApplied).toBe(true);
    expect(again.blocks).toHaveLength(5); // still previewable; UI confirms
    const unrelated = run({}, { existingBlocks: [{ ...first.blocks[0], id: 'x', originTemplate: undefined }] });
    expect(unrelated.alreadyApplied).toBe(false);
  });

  it('is pure: no timers, no I/O, deterministic given a clock', () => {
    const a = run();
    const b = run();
    expect(a.blocks.map((x) => [x.startTime, x.endTime, x.modeName])).toEqual(
      b.blocks.map((x) => [x.startTime, x.endTime, x.modeName])
    );
    // Sessions never self-start: blocks are data with an approved status.
    expect(a.blocks.every((x) => x.status === 'approved')).toBe(true);
  });
});

describe('validateSingleBlockDurations', () => {
  const single = makeMode({ id: 'm-25', name: '25 English', workDuration: 30, cycles: 1 });
  const multi = makeMode({ id: 'm-3x', name: 'Marathon', workDuration: 50, cycles: 3 });
  const chill = makeMode({ id: 'm-chill', name: 'Chill', workDuration: 20, cycles: 1, isChillMode: true });
  const modes = [single, multi, chill];
  const blk = (modeId: string, modeName: string, startTime: string, endTime: string) => ({
    modeId, modeName, startTime, endTime,
  });

  it('flags single-block events whose length differs from the focus length', () => {
    expect(
      validateSingleBlockDurations([blk('m-25', 'SAT English', '13:30', '14:00')], modes)
    ).toEqual([]);
    const [m] = validateSingleBlockDurations([blk('m-25', 'SAT English', '13:30', '14:15')], modes);
    expect(m).toMatchObject({
      index: 0, title: 'SAT English', eventMinutes: 45, focusMinutes: 30, modeName: '25 English',
    });
  });

  it('exempts multi-cycle modes, chill modes, unknown modes and bad times', () => {
    expect(
      validateSingleBlockDurations([blk('m-3x', 'Long', '09:00', '12:00')], modes)
    ).toEqual([]);
    expect(
      validateSingleBlockDurations([blk('m-chill', 'Rest', '09:00', '09:10')], modes)
    ).toEqual([]);
    expect(
      validateSingleBlockDurations([blk('ghost', 'X', '09:00', '10:00')], modes)
    ).toEqual([]);
    expect(
      validateSingleBlockDurations([blk('m-25', 'X', '10:00', '09:00')], modes)
    ).toEqual([]);
  });

  it('reports each mismatch with its position', () => {
    const out = validateSingleBlockDurations(
      [
        blk('m-25', 'A', '09:00', '09:30'),
        blk('m-25', 'B', '10:00', '10:45'),
        blk('m-25', 'C', '11:00', '11:30'),
      ],
      modes
    );
    expect(out.map((m) => m.index)).toEqual([1]);
  });
});

describe('day note section', () => {
  const lines = [
    { startTime: '09:00', endTime: '10:00', title: 'SAT Math', detail: '50 questions' },
    { startTime: '10:00', endTime: '10:15', title: 'Break' },
  ];

  it('builds plain-bullet lines (never checkboxes)', () => {
    const section = buildDayScheduleSection('Daily SAT', '2026-10-12', lines);
    expect(section).toContain(dayScheduleHeading('Daily SAT', '2026-10-12'));
    expect(section).toContain('- 09:00–10:00 · SAT Math (50 questions)');
    expect(section).toContain('- 10:00–10:15 · Break');
    expect(section).not.toMatch(/\[ \]/);
  });

  it('creates a minimal day file when none exists', () => {
    const merged = mergeDayScheduleSection('', '2026-10-12', buildDayScheduleSection('T', '2026-10-12', lines));
    expect(merged).toMatch(/^---\ntype: control-day\ndate: 2026-10-12\n---\n/);
    expect(merged).toContain('SAT Math');
  });

  it('appends while preserving unrelated content', () => {
    const existing = '---\ntype: control-day\ndate: 2026-10-12\n---\n\n# Monday\n\nMy thoughts here.\n\n- [ ] Buy milk\n';
    const merged = mergeDayScheduleSection(existing, '2026-10-12', buildDayScheduleSection('T', '2026-10-12', lines));
    expect(merged).toContain('My thoughts here.');
    expect(merged).toContain('- [ ] Buy milk');
    expect(merged).toContain('SAT Math');
    expect(merged.indexOf('Buy milk') < merged.indexOf('SAT Math')).toBe(true);
  });

  it('replaces the previous generated section instead of stacking', () => {
    const first = mergeDayScheduleSection('', '2026-10-12', buildDayScheduleSection('Old', '2026-10-12', lines));
    const withUserContent = `${first}\n## Evening\n- [ ] Walk\n`;
    const second = mergeDayScheduleSection(
      withUserContent,
      '2026-10-12',
      buildDayScheduleSection('New', '2026-10-12', [{ startTime: '18:00', endTime: '18:30', title: 'Run' }])
    );
    expect(second).not.toContain('SAT Math');
    expect(second).toContain('Run');
    expect(second).toContain('## Evening');
    expect(second).toContain('- [ ] Walk');
    expect(second.match(/## Generated Schedule/g)?.length).toBe(1);
  });

  it('supports unicode throughout', () => {
    const { template, errors } = parseScheduleTemplate(
      '日本語',
      '# 朝のル틴 🎯\n\n## 数学 📐\n- Duration: 25m\n- Notes: Prüfen naïve façade ✅\n'
    );
    expect(errors).toEqual([]);
    expect(template.title).toBe('朝のル틴 🎯');
    const res = generateSchedule(template, { date: '2026-10-12', startTime: '09:00' }, { modes: MODES, nowMs: 1 });
    expect(res.blocks[0].modeName).toBe('数学 📐');
    expect(res.blocks[0].description).toBe('Prüfen naïve façade ✅');
  });
});
