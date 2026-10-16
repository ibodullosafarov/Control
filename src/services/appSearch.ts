import { InstalledAppInfo } from '../types';
import { DEFAULT_BLOCKLIST } from './defaultData';

export interface BlockSearchResult {
  apps: InstalledAppInfo[];
  domains: string[];
}

// Suggest matching installed macOS applications from the Electron main process.
export async function searchApps(query: string): Promise<InstalledAppInfo[]> {
  if (!window.controlAPI?.searchInstalledApps) return [];
  try {
    return await window.controlAPI.searchInstalledApps(query);
  } catch (err) {
    console.warn('App search failed:', err);
    return [];
  }
}

// Suggest matching blocked-website domains + a smart `${query}.com` guess.
export function suggestDomains(query: string, limit = 10): string[] {
  const q = query.trim().toLowerCase();
  const unique = (arr: string[]) => Array.from(new Set(arr));

  if (!q) {
    return unique(DEFAULT_BLOCKLIST).slice(0, limit);
  }

  const exact = unique(
    DEFAULT_BLOCKLIST.filter(
      (d) => d.includes(q) || d.replace(/^www\./, '').includes(q)
    )
  );

  if (!q.includes('.') && !exact.includes(`${q}.com`)) {
    exact.push(`${q}.com`);
  }

  return exact.slice(0, limit);
}

export async function searchBlocks(query: string): Promise<BlockSearchResult> {
  const [apps, domains] = await Promise.all([
    searchApps(query),
    Promise.resolve(suggestDomains(query)),
  ]);
  return { apps, domains };
}