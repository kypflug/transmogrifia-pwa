import type { SortOrder, FilterMode, Theme } from '../types';
import { safeGetItem, safeSetItem } from '../utils/storage';

const KEYS = {
  sort: 'transmogrifia-sort',
  filter: 'transmogrifia-filter',
  theme: 'transmogrifia-theme',
  sidebarWidth: 'transmogrifia-sidebar-width',
} as const;

export function getSortOrder(): SortOrder {
  return (safeGetItem(KEYS.sort) || 'newest') as SortOrder;
}

export function setSortOrder(order: SortOrder): void {
  safeSetItem(KEYS.sort, order);
}

export function getFilterMode(): FilterMode {
  return (safeGetItem(KEYS.filter) || 'all') as FilterMode;
}

export function setFilterMode(mode: FilterMode): void {
  safeSetItem(KEYS.filter, mode);
}

export function getTheme(): Theme {
  return (safeGetItem(KEYS.theme) || 'system') as Theme;
}

export function setTheme(theme: Theme): void {
  safeSetItem(KEYS.theme, theme);
}

export function getSidebarWidth(): number {
  const stored = safeGetItem(KEYS.sidebarWidth) || '340';
  return parseInt(stored, 10);
}

export function setSidebarWidth(width: number): void {
  safeSetItem(KEYS.sidebarWidth, String(width));
}
