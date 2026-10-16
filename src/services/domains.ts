/**
 * Blocklist domain helpers (pure, no React/Electron).
 *
 * A mistyped domain is a silent blocking bypass: `chatgpt.com.com` is
 * syntactically valid but never matches the real `chatgpt.com`, so the
 * session looks protected while the site stays reachable. These helpers
 * validate entries at edit time and repair known-bad entries on load.
 */

const DOMAIN_RE = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

/** True when the string is shaped like a real registrable domain. */
export function isValidDomain(domain: string): boolean {
  return DOMAIN_RE.test(domain.trim());
}

/**
 * Known-bad entries observed in the wild (duplicated public suffix from
 * autocomplete/typo, e.g. `chatgpt.com.com` for `chatgpt.com`).
 */
const KNOWN_REPAIRS: Record<string, string> = {
  'claude.ai.com': 'claude.ai',
  'gemini.google.com.com': 'gemini.google.com',
  'chatgpt.com.com': 'chatgpt.com',
};

/** Repair one entry; returns the original when nothing is wrong with it. */
export function repairDomain(domain: string): string {
  const d = domain.trim().toLowerCase();
  if (!d) return domain;
  if (KNOWN_REPAIRS[d]) return KNOWN_REPAIRS[d];
  // Generic collapse of a doubled trailing suffix: `x.com.com` -> `x.com`.
  // Loop so `x.com.com.com` still converges.
  let out = d;
  while (/\.com\.com$/i.test(out)) out = out.replace(/\.com$/i, '');
  return out;
}

export interface BlocklistRepair {
  list: string[];
  /** Entries that changed (before -> after), for logging/notice. */
  fixed: Array<{ before: string; after: string }>;
}

/**
 * Repair + dedupe a stored blocklist, preserving order. Never drops
 * entries — even invalid ones survive (flagged at edit time instead), so
 * repair can never silently shrink protection.
 */
export function repairBlocklist(raw: unknown): BlocklistRepair {
  if (!Array.isArray(raw)) return { list: [], fixed: [] };
  const list: string[] = [];
  const fixed: Array<{ before: string; after: string }> = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().toLowerCase();
    if (!trimmed || seen.has(trimmed)) {
      // Drop empties and exact dupes (post-repair key check below handles
      // dupes created by repair itself).
      if (!trimmed) continue;
      continue;
    }
    const repaired = repairDomain(trimmed);
    if (seen.has(repaired)) continue;
    seen.add(repaired);
    if (repaired !== trimmed) fixed.push({ before: item, after: repaired });
    list.push(repaired);
  }
  return { list, fixed };
}
