/**
 * One-time migration of pre-rename persisted field names (Focus → Control).
 *
 * Pure and dependency-free on purpose: both the renderer store
 * (`storage.ts`) and the Electron main store (`electron/store.ts`) run it on
 * load, so old saved data keeps working after the rename. Idempotent — safe
 * to run on every load.
 */
export function migrateLegacyFieldNames(data: unknown): void {
  if (!data || typeof data !== 'object') return;
  const root = data as Record<string, unknown>;

  // tasks: focusMinutes → controlMinutes
  if (Array.isArray(root.tasks)) {
    for (const t of root.tasks) {
      if (t && typeof t === 'object') {
        const rec = t as Record<string, unknown>;
        if (rec.focusMinutes !== undefined && rec.controlMinutes === undefined) {
          rec.controlMinutes = rec.focusMinutes;
        }
        delete rec.focusMinutes;
      }
    }
  }

  // plans: blocks[].focusMode → controlMode
  const plans = root.plans;
  if (plans && typeof plans === 'object') {
    for (const day of Object.values(plans as Record<string, unknown>)) {
      const blocks = (day as { blocks?: unknown })?.blocks;
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (b && typeof b === 'object') {
            const rec = b as Record<string, unknown>;
            if (rec.focusMode !== undefined && rec.controlMode === undefined) {
              rec.controlMode = rec.focusMode;
            }
            delete rec.focusMode;
          }
        }
      }
    }
  }

  // settings: minimalModeOnFocus → minimalModeOnControl
  const settings = root.settings;
  if (settings && typeof settings === 'object') {
    const rec = settings as Record<string, unknown>;
    if (rec.minimalModeOnFocus !== undefined && rec.minimalModeOnControl === undefined) {
      rec.minimalModeOnControl = rec.minimalModeOnFocus;
    }
    delete rec.minimalModeOnFocus;
  }
}
