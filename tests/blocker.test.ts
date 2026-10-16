import { describe, expect, it, vi } from 'vitest';
import {
  buildHostsContent,
  buildManagedSection,
  hasManagedSection,
  hostsAlreadyBlocked,
  privilegedCopyCommand,
  runPrivilegedShell,
  stripManagedSection,
} from '../electron/blocker';

const BASE_HOSTS = '##\n# Host Database\n127.0.0.1 localhost\n255.255.255.255 broadcasthost\n';

describe('buildManagedSection', () => {
  it('normalizes domains with www/ipv6 variants', () => {
    const section = buildManagedSection(['Example.COM']);
    expect(section).toContain('127.0.0.1 example.com');
    expect(section).toContain('::1 example.com');
    expect(section).toContain('127.0.0.1 www.example.com');
    expect(section).toContain('::1 www.example.com');
  });

  it('strips URL schemes/paths and skips blanks', () => {
    const section = buildManagedSection(['https://x.com/feed', '   ', 'www.y.com']);
    expect(section).toContain('127.0.0.1 x.com');
    expect(section).not.toContain('www.www.y.com');
    // x.com → plain + www (2× 127.0.0.1); www.y.com → plain only (1×).
    expect(section.split('\n').filter((l) => l.includes('127.0.0.1')).length).toBe(3);
  });

  it('is wrapped in markers with a do-not-edit notice', () => {
    const lines = buildManagedSection(['a.com']).split('\n');
    expect(lines[0]).toMatch(/BEGIN CONTROL/);
    expect(lines[lines.length - 1]).toMatch(/END CONTROL/);
  });
});

describe('buildHostsContent / stripManagedSection', () => {
  it('appends the section while preserving surrounding content', () => {
    const out = buildHostsContent(BASE_HOSTS, ['a.com']);
    expect(out).toContain('127.0.0.1 localhost');
    expect(out).toContain('127.0.0.1 a.com');
  });

  it('replaces an existing section instead of stacking', () => {
    const once = buildHostsContent(BASE_HOSTS, ['a.com']);
    const twice = buildHostsContent(once, ['b.com']);
    expect(twice).not.toContain('a.com');
    expect(twice).toContain('b.com');
    expect(twice.match(/BEGIN CONTROL/g)?.length).toBe(1);
  });

  it('strip removes exactly the managed section', () => {
    const blocked = buildHostsContent(BASE_HOSTS, ['a.com']);
    const stripped = stripManagedSection(blocked);
    expect(stripped).not.toContain('a.com');
    expect(stripped).toContain('127.0.0.1 localhost');
    expect(stripManagedSection(BASE_HOSTS)).toBe(BASE_HOSTS.trim() + '\n');
  });
});

describe('hostsAlreadyBlocked (the no-second-prompt rule)', () => {
  it('is true for identical content, including trailing-newline variants', () => {
    const blocked = buildHostsContent(BASE_HOSTS, ['a.com', 'b.com']);
    expect(hostsAlreadyBlocked(blocked, ['a.com', 'b.com'])).toBe(true);
    expect(hostsAlreadyBlocked(blocked + '\n', ['a.com', 'b.com'])).toBe(true);
  });

  it('is false when domains differ or no section exists', () => {
    const blocked = buildHostsContent(BASE_HOSTS, ['a.com']);
    expect(hostsAlreadyBlocked(blocked, ['a.com', 'b.com'])).toBe(false);
    expect(hostsAlreadyBlocked(blocked, [])).toBe(false);
    expect(hostsAlreadyBlocked(BASE_HOSTS, ['a.com'])).toBe(false);
  });

  it('is false when the section was hand-edited', () => {
    const blocked = buildHostsContent(BASE_HOSTS, ['a.com']);
    // Content appended OUTSIDE the markers must not force a rewrite...
    expect(hostsAlreadyBlocked(`${blocked}# extra line\n`, ['a.com'])).toBe(true);
    // ...but edits INSIDE the markers do.
    const tampered = blocked.replace('127.0.0.1 a.com', '127.0.0.1 evil.com');
    expect(hostsAlreadyBlocked(tampered, ['a.com'])).toBe(false);
  });

  it('round-trips: content we just built never needs a rewrite', () => {
    for (const domains of [[], ['x.com'], ['a.com', 'https://B.com/p']]) {
      const content = buildHostsContent('127.0.0.1 localhost\n', domains);
      expect(hostsAlreadyBlocked(content, domains)).toBe(true);
    }
  });
});

describe('hasManagedSection (stop is a no-op when clean)', () => {
  it('detects presence and absence', () => {
    expect(hasManagedSection(BASE_HOSTS)).toBe(false);
    expect(hasManagedSection(buildHostsContent(BASE_HOSTS, ['a.com']))).toBe(true);
  });
});

describe('privilegedCopyCommand (one dialog by construction)', () => {
  it('is a single osascript invocation covering copy, flush and reload', () => {
    const cmd = privilegedCopyCommand('/tmp/hosts_control_1', '/etc/hosts');
    expect(cmd.match(/osascript/g)?.length).toBe(1);
    expect(cmd.match(/with administrator privileges/g)?.length).toBe(1);
    expect(cmd).toContain('cp /tmp/hosts_control_1 /etc/hosts');
    expect(cmd).toContain('dscacheutil -flushcache');
    expect(cmd).toContain('killall -HUP mDNSResponder');
  });
});

describe('runPrivilegedShell', () => {
  it('invokes the executor exactly once with the given command', async () => {
    const execFn = vi.fn(async () => ({}));
    await runPrivilegedShell('do-something', execFn);
    expect(execFn).toHaveBeenCalledTimes(1);
    expect(execFn).toHaveBeenCalledWith('do-something');
  });

  it('propagates executor failures (e.g. user cancelled the dialog)', async () => {
    const execFn = vi.fn(async () => {
      throw new Error('User cancelled');
    });
    await expect(runPrivilegedShell('x', execFn)).rejects.toThrow('User cancelled');
  });
});
