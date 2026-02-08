import type { SortOrder, FilterMode, Theme } from '../types';

const KEYS = {
  sort: 'transmogrifia-sort',
  filter: 'transmogrifia-filter',
  theme: 'transmogrifia-theme',
  sidebarWidth: 'transmogrifia-sidebar-width',
} as const;

export function getSortOrder(): SortOrder {
  return (localStorage.getItem(KEYS.sort) as SortOrder) || 'newest';
}

export function setSortOrder(order: SortOrder): void {
  localStorage.setItem(KEYS.sort, order);
}

export function getFilterMode(): FilterMode {
  return (localStorage.getItem(KEYS.filter) as FilterMode) || 'all';
}

export function setFilterMode(mode: FilterMode): void {
  localStorage.setItem(KEYS.filter, mode);
}

export function getTheme(): Theme {
  return (localStorage.getItem(KEYS.theme) as Theme) || 'system';
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEYS.theme, theme);
}

export function getSidebarWidth(): number {
  const stored = localStorage.getItem(KEYS.sidebarWidth);
  return stored ? parseInt(stored, 10) : 340;
}

export function setSidebarWidth(width: number): void {
  localStorage.setItem(KEYS.sidebarWidth, String(width));
}
