import type { SortOrder, FilterMode, Theme } from '../types';
import { safeGetItem, safeSetItem } from '../utils/storage';
import { getSettingsValue, setSettingsValue } from './cache';

const KEYS = {
  sort: 'transmogrifia-sort',
  filter: 'transmogrifia-filter',
  theme: 'transmogrifia-theme',
  sidebarWidth: 'transmogrifia-sidebar-width',
} as const;

// ─── IndexedDB-backed prefs (durable on iOS) ───
// These use an in-memory cache for synchronous reads + async IndexedDB writes.
// On cold start, initPreferences() loads from IDB into the cache.

let prefsLoaded = false;
const prefsCache: Record<string, string> = {};

/**
 * Load preferences from IndexedDB into the in-memory cache.
 * Call once during app boot (before rendering library).
 * Also migrates from localStorage on first run.
 */
export async function initPreferences(): Promise<void> {
  if (prefsLoaded) return;
  const idbKeys = [KEYS.sort, KEYS.filter, KEYS.sidebarWidth] as const;
  for (const key of idbKeys) {
    const val = await getSettingsValue<string>(key);
    if (val !== null && val !== undefined) {
      prefsCache[key] = val;
    } else {
      // One-time migration from localStorage
      const lsVal = safeGetItem(key);
      if (lsVal) {
        prefsCache[key] = lsVal;
        setSettingsValue(key, lsVal).catch(() => {});
      }
    }
  }
  prefsLoaded = true;
}

export function getSortOrder(): SortOrder {
  return (prefsCache[KEYS.sort] || safeGetItem(KEYS.sort) || 'newest') as SortOrder;
}

export function setSortOrder(order: SortOrder): void {
  prefsCache[KEYS.sort] = order;
  safeSetItem(KEYS.sort, order); // fast-read fallback
  setSettingsValue(KEYS.sort, order).catch(() => {});
}

export function getFilterMode(): FilterMode {
  return (prefsCache[KEYS.filter] || safeGetItem(KEYS.filter) || 'all') as FilterMode;
}

export function setFilterMode(mode: FilterMode): void {
  prefsCache[KEYS.filter] = mode;
  safeSetItem(KEYS.filter, mode);
  setSettingsValue(KEYS.filter, mode).catch(() => {});
}

// Theme stays in localStorage for FOUC prevention (read synchronously on cold start)
export function getTheme(): Theme {
  return (safeGetItem(KEYS.theme) || 'system') as Theme;
}

export function setTheme(theme: Theme): void {
  safeSetItem(KEYS.theme, theme);
}

export function getSidebarWidth(): number {
  const stored = prefsCache[KEYS.sidebarWidth] || safeGetItem(KEYS.sidebarWidth);
  if (!stored || stored === '') return 340;
  const parsed = parseInt(stored, 10);
  return isNaN(parsed) ? 340 : parsed;
}

export function setSidebarWidth(width: number): void {
  const val = String(width);
  prefsCache[KEYS.sidebarWidth] = val;
  safeSetItem(KEYS.sidebarWidth, val);
  setSettingsValue(KEYS.sidebarWidth, val).catch(() => {});
}
