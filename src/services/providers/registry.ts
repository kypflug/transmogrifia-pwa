/**
 * Provider Registry for Library of Transmogrifia
 *
 * Manages the active auth and storage providers. Provider type is persisted
 * in localStorage so the correct provider is initialised on app restart.
 */

import type { AuthProvider, StorageProvider, AuthProviderType } from './types';

const PROVIDER_TYPE_KEY = 'transmogrifia_provider_type';

let authProvider: AuthProvider | null = null;
let storageProvider: StorageProvider | null = null;

// ─── Getters ────────────────────────────────────────────────────────

/** Get the active auth provider. Throws if none is set. */
export function getAuth(): AuthProvider {
  if (!authProvider) throw new Error('Auth provider not initialised — call setProviders() first');
  return authProvider;
}

/** Get the active storage provider. Throws if none is set. */
export function getStorage(): StorageProvider {
  if (!storageProvider) throw new Error('Storage provider not initialised — call setProviders() first');
  return storageProvider;
}

/** Returns true if providers have been set. */
export function hasProviders(): boolean {
  return authProvider !== null && storageProvider !== null;
}

// ─── Setters ────────────────────────────────────────────────────────

/** Set the active auth and storage providers. Persists the type to localStorage. */
export function setProviders(auth: AuthProvider, storage: StorageProvider): void {
  authProvider = auth;
  storageProvider = storage;
  try {
    localStorage.setItem(PROVIDER_TYPE_KEY, auth.type);
  } catch { /* localStorage may be unavailable */ }
}

/** Clear providers and persisted type (call on sign-out). */
export function clearProviders(): void {
  authProvider = null;
  storageProvider = null;
  try {
    localStorage.removeItem(PROVIDER_TYPE_KEY);
  } catch { /* */ }
}

// ─── Type persistence ───────────────────────────────────────────────

/** Get the persisted provider type, or null if the user hasn't signed in before. */
export function getProviderType(): AuthProviderType | null {
  try {
    const stored = localStorage.getItem(PROVIDER_TYPE_KEY);
    if (stored === 'microsoft' || stored === 'google') return stored;
    return null;
  } catch {
    return null;
  }
}
