import React, { useState, useEffect, useRef } from 'react';
import { AppWindow, FolderOpen, Search } from 'lucide-react';
import { ThemeId } from '../types';
import { THEMES } from '../styles/themes';
import { searchBlocks, BlockSearchResult } from '../services/appSearch';
import { BrandIcon } from './BrandIcon';

interface AppSearchInputProps {
  theme: ThemeId;
  placeholder?: string;
  buttonLabel?: string;
  disableApps?: boolean;
  disableDomains?: boolean;
  onSelectApp: (appName: string) => void;
  onSelectDomain?: (domain: string) => void;
}

export const AppSearchInput: React.FC<AppSearchInputProps> = ({
  theme,
  placeholder = 'Search apps & websites to block...',
  buttonLabel = 'Add',
  disableApps = false,
  disableDomains = false,
  onSelectApp,
  onSelectDomain,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BlockSearchResult>({ apps: [], domains: [] });
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Debounced search as the user types
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const res = await searchBlocks(query);
        if (!cancelled) setResults(res);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, isOpen]);

  const handleFocus = async () => {
    setIsOpen(true);
    setIsLoading(true);
    try {
      setResults(await searchBlocks(query));
    } finally {
      setIsLoading(false);
    }
  };

  const handlePick = (kind: 'app' | 'domain', value: string) => {
    if (kind === 'app') {
      onSelectApp(value);
    } else {
      onSelectDomain?.(value);
    }
    setQuery('');
    setIsOpen(false);
  };

  const hasAny =
    (!disableApps && results.apps.length > 0) || (!disableDomains && results.domains.length > 0);

  return (
    <div ref={wrapperRef} className="relative flex-1">
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
          style={{ color: currentTheme.textMuted }}
        />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={handleFocus}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setIsOpen(false);
            if (e.key === 'Enter' && query.trim()) {
              e.preventDefault();
              if (!disableDomains) handlePick('domain', `${query.trim().replace(/^https?:\/\//, '').split('/')[0]}.com`);
            }
          }}
          placeholder={placeholder}
          className="w-full pl-9 pr-3 py-2.5 rounded-2xl liquid-glass-input text-xs outline-none"
          style={{ color: currentTheme.textPrimary }}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {isOpen && hasAny && (
        <div
          className="absolute left-0 right-0 top-full mt-2 z-50 overflow-hidden rounded-2xl liquid-glass-elevated border shadow-2xl motion-blur-in"
          style={{
            backgroundColor: currentTheme.isDark ? 'rgba(12, 14, 22, 0.96)' : 'rgba(255, 255, 255, 0.98)',
            borderColor: currentTheme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
          }}
        >
          <div className="max-h-72 overflow-y-auto py-1.5">
            {!disableApps && results.apps.length > 0 && (
              <div className="px-3 pt-1.5 pb-1">
                <span
                  className="text-[10px] font-mono font-bold uppercase tracking-wider flex items-center space-x-1.5"
                  style={{ color: currentTheme.textMuted }}
                >
                  <span className="inline-flex items-center space-x-1">
                    <AppWindow className="w-3 h-3" />
                    <span>Applications</span>
                  </span>
                </span>
              </div>
            )}
            {!disableApps &&
              results.apps.map((app) => (
                <button
                  key={app.path}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handlePick('app', app.name);
                  }}
                  className="w-full flex items-center space-x-2.5 px-3 py-2 text-left transition-colors cursor-pointer hover:bg-sky-500/10"
                  style={{ color: currentTheme.textPrimary }}
                >
                  {/* Real app icon, then brand logo, then generic placeholder */}
                  {app.icon ? (
                    <img
                      src={app.icon}
                      alt=""
                      className="w-[18px] h-[18px] rounded-[4px] shrink-0 object-contain"
                      style={{ flexShrink: 0 }}
                    />
                  ) : (
                    <span
                      className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center"
                      style={{
                        flexShrink: 0,
                        backgroundColor: 'rgba(148,163,184,0.15)',
                      }}
                    >
                      <BrandIcon name={app.name} size={14} fallback="globe" />
                    </span>
                  )}
                  <span className="text-xs font-semibold truncate whitespace-nowrap">{app.name}</span>
                  <span
                    className="text-[10px] font-mono ml-auto flex items-center space-x-1 shrink-0"
                    style={{ color: currentTheme.textMuted }}
                  >
                    <FolderOpen className="w-2.5 h-2.5" />
                    <span className="max-w-[140px] truncate">{app.path}</span>
                  </span>
                </button>
              ))}

            {!disableDomains && results.domains.length > 0 && (
              <div className="px-3 pt-2 pb-1">
                <span
                  className="text-[10px] font-mono font-bold uppercase tracking-wider flex items-center space-x-1.5"
                  style={{ color: currentTheme.textMuted }}
                >
                  <span className="inline-flex items-center space-x-1">
                    <span className="text-emerald-500">●</span>
                    <span>Websites</span>
                  </span>
                </span>
              </div>
            )}
            {!disableDomains &&
              results.domains.map((domain) => (
                <button
                  key={domain}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handlePick('domain', domain);
                  }}
                  className="w-full flex items-center space-x-2.5 px-3 py-2 text-left transition-colors cursor-pointer hover:bg-emerald-500/10"
                  style={{ color: currentTheme.textPrimary }}
                >
                  <span
                    className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center shrink-0"
                    style={{ flexShrink: 0 }}
                  >
                    <BrandIcon name={domain} size={15} fallback="globe" fallbackColor="#10b981" />
                  </span>
                  <span className="text-xs font-mono truncate whitespace-nowrap">{domain}</span>
                </button>
              ))}

            {isLoading && (
              <div className="px-3 py-2.5 text-[11px] font-mono" style={{ color: currentTheme.textMuted }}>
                Searching installed applications...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};