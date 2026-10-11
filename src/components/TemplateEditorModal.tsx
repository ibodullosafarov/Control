import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, Save, X } from 'lucide-react';
import { ThemeId } from '../types';
import { THEMES } from '../styles/themes';
import { parseFlexTemplate } from '../services/flexTemplates';

interface TemplateEditorModalProps {
  /** Empty for a brand-new template. */
  initialName: string;
  initialContent: string;
  theme: ThemeId;
  /** Names that already exist (to warn before overwriting a different file). */
  existingNames: string[];
  onClose: () => void;
  /** Persist verbatim content. Resolves with an error message or null. */
  onSave: (name: string, content: string) => Promise<string | null>;
}

const FLEX_SKELETON = `{{date}} Day Plan

# Morning Session

## Time
09:00-10:30

## Blocking
Mode: {Deep Work}

# Afternoon Session

## Time
14:00-15:00

## Blocking
Mode: {Deep Work}
`;

/**
 * Markdown-first template editor: free-form textarea on the left, live
 * deterministic parse on the right. The file is always saved verbatim —
 * parsing only previews and validates, never rewrites user content.
 */
export const TemplateEditorModal: React.FC<TemplateEditorModalProps> = ({
  initialName,
  initialContent,
  theme,
  existingNames,
  onClose,
  onSave,
}) => {
  const currentTheme = THEMES[theme] || THEMES.serika;
  const isNew = !initialName;
  const [name, setName] = useState(initialName);
  const [content, setContent] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const preview = useMemo(
    () => parseFlexTemplate(name.trim() || 'untitled', content),
    [name, content]
  );

  const trimmedName = name.trim();
  const collides =
    isNew && trimmedName && existingNames.some((n) => n.toLowerCase() === trimmedName.toLowerCase());
  const canSave =
    !isSaving && trimmedName.length > 0 && content.trim().length > 0 && !collides;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const error = await onSave(trimmedName, content);
      if (error) {
        setSaveError(error);
        setIsSaving(false);
      } else {
        onClose();
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setIsSaving(false);
    }
  };

  const insertSkeleton = () => {
    setContent((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n\n${FLEX_SKELETON}` : FLEX_SKELETON));
  };

  const border = currentTheme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => !isSaving && onClose()} />
      <div
        className="relative w-full max-w-4xl max-h-[90vh] flex flex-col p-6 rounded-3xl liquid-glass border space-y-4 animate-modal-in"
        style={{ borderColor: border }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold" style={{ color: currentTheme.textPrimary }}>
              {isNew ? 'New template' : `Edit ${initialName}`}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: currentTheme.textSecondary }}>
              Markdown stays exactly as you write it. The preview parses `# Tasks` with{' '}
              <span className="font-mono">## Time</span> and <span className="font-mono">## Blocking</span> sections.
            </p>
          </div>
          <button
            onClick={() => !isSaving && onClose()}
            className="p-1.5 rounded-xl hover:bg-white/10 cursor-pointer shrink-0"
            style={{ color: currentTheme.textSecondary }}
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isNew}
            placeholder="Template name…"
            title={isNew ? 'Template file name' : 'Rename via Duplicate instead'}
            className="flex-1 px-3 py-1.5 rounded-xl liquid-glass-input border text-xs font-bold outline-none disabled:opacity-60"
            style={{ color: currentTheme.textPrimary }}
          />
          <button
            onClick={insertSkeleton}
            className="px-3 py-1.5 rounded-xl liquid-glass border text-[11px] font-bold hover:bg-white/10 transition-all cursor-pointer whitespace-nowrap"
            style={{ color: currentTheme.textSecondary }}
            title="Append an example task skeleton"
          >
            + Example task
          </button>
        </div>
        {collides && (
          <p className="text-[11px] text-amber-500">
            A template named “{trimmedName}” already exists — pick another name (overwriting from
            here is disabled; edit that file instead).
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-h-0 flex-1">
          {/* Editor */}
          <div className="flex flex-col min-h-0">
            <span className="text-[11px] font-bold mb-1" style={{ color: currentTheme.textSecondary }}>
              Markdown
            </span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              placeholder={'{{date}} Day Plan\n\n# English 50\n\n## Time\n13:30-15:45\n\n## Blocking\nMode: {Quick}\n'}
              className="flex-1 min-h-[280px] max-h-[46vh] overflow-y-auto px-3.5 py-3 rounded-2xl liquid-glass-input border text-xs font-mono outline-none resize-y"
              style={{ color: currentTheme.textPrimary }}
            />
          </div>

          {/* Live preview */}
          <div className="flex flex-col min-h-0">
            <span className="text-[11px] font-bold mb-1" style={{ color: currentTheme.textSecondary }}>
              Live preview · {preview.template.tasks.length} task{preview.template.tasks.length === 1 ? '' : 's'}
              {preview.template.hasDatePlaceholder ? ' · uses {{date}}' : ''}
            </span>
            <div
              className="flex-1 min-h-[280px] max-h-[46vh] overflow-y-auto p-3.5 rounded-2xl liquid-glass-card border space-y-2"
              style={{ borderColor: border }}
            >
              {preview.errors.length > 0 && (
                <div className="space-y-1">
                  {preview.errors.map((e, i) => (
                    <p key={i} className="text-[11px] text-rose-400 flex items-start space-x-1.5">
                      <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" />
                      <span>
                        {e.task ? `“${e.task}”${e.field ? ` · ${e.field}` : ''}: ` : ''}{e.message}
                      </span>
                    </p>
                  ))}
                </div>
              )}
              {preview.template.tasks.length === 0 && preview.errors.length === 0 && (
                <p className="text-[11px]" style={{ color: currentTheme.textSecondary }}>
                  No absolute-time tasks detected. Duration-style templates (sections with{' '}
                  <span className="font-mono">Duration:</span>) are handled by the green Schedule
                  button — add <span className="font-mono"># Title</span> headings with{' '}
                  <span className="font-mono">## Time</span> / <span className="font-mono">## Blocking</span>{' '}
                  sections here.
                </p>
              )}
              {preview.template.tasks.map((t) => (
                <div key={t.order} className="p-2.5 rounded-xl liquid-glass border">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold truncate" style={{ color: currentTheme.textPrimary }}>
                      <FileText className="w-3 h-3 inline mr-1 opacity-60" />
                      {t.title || <span className="opacity-50">(untitled)</span>}
                    </span>
                    <span className="text-[11px] font-mono font-bold shrink-0" style={{ color: currentTheme.textSecondary }}>
                      {t.start && t.end ? `${t.start}–${t.end}` : <span className="text-rose-400">no time</span>}
                    </span>
                  </div>
                  <p className="text-[10px] mt-0.5" style={{ color: currentTheme.textSecondary }}>
                    {t.modeRef ? (
                      <>Mode: <span className="font-mono">{t.modeRef}</span></>
                    ) : (
                      <span className="text-amber-500">Mode missing — pick one when applying</span>
                    )}
                    {t.notes.length > 0 ? ` · ${t.notes.length} note line${t.notes.length === 1 ? '' : 's'} kept` : ''}
                  </p>
                </div>
              ))}
              {preview.template.warnings.length > 0 && (
                <p className="text-[10px] opacity-70" style={{ color: currentTheme.textSecondary }}>
                  {preview.template.warnings.join(' ')}
                </p>
              )}
            </div>
          </div>
        </div>

        {saveError && (
          <div className="px-3.5 py-2 rounded-xl text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
            {saveError}
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-[10px] opacity-60 flex items-center" style={{ color: currentTheme.textSecondary }}>
            <CheckCircle2 className="w-3 h-3 inline mr-1" />
            Saved verbatim to Templates — formatting is never rewritten.
          </p>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => !isSaving && onClose()}
              disabled={isSaving}
              className="px-4 py-2 rounded-xl liquid-glass border text-xs font-bold hover:bg-white/10 transition-all cursor-pointer disabled:opacity-50"
              style={{ color: currentTheme.textSecondary }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white transition-all active:scale-95 shadow-md cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: currentTheme.accent }}
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Saving…' : isNew ? 'Create template' : 'Save changes'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
