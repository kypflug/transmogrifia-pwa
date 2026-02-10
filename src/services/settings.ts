/**
 * Settings Service for Library of Transmogrifia (PWA)
 *
 * Two-tier encryption model (same as the Transmogrifier extension):
 *  1. LOCAL: Settings encrypted with a per-device AES-256-GCM key stored in IndexedDB.
 *     Transparent to the user — no passphrase needed for day-to-day use.
 *  2. CLOUD SYNC: Settings encrypted with a user-chosen passphrase (PBKDF2 + AES-256-GCM).
 *     The passphrase is entered once per device to enable OneDrive sync.
 *     The same passphrase decrypts settings on any device (extension or PWA).
 *
 * Replaces chrome.storage.local with IndexedDB and chrome.storage.session
 * with a module-scoped variable (cleared on page unload / idle timeout).
 */

import { encrypt, decrypt, encryptWithKey, decryptWithKey } from './crypto';
import type { LocalEncryptedEnvelope } from './crypto';
import { getDeviceKey, deleteDeviceKey } from './device-key';
import { getSettingsValue, setSettingsValue, removeSettingsValue } from './cache';
import { downloadSettings, uploadSettings } from './graph';
import type { TransmogrifierSettings, AIProvider, ImageProvider } from '../types';

const SETTINGS_VERSION = 1;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ─── Stored envelope shape ────────────────

interface StoredSettings {
  envelope: LocalEncryptedEnvelope;
  updatedAt: number;
}

// ─── In-memory state ────────────────

let cachedSettings: TransmogrifierSettings | null = null;

/**
 * Sync passphrase — held in memory only.
 * Cleared on page unload and after idle timeout.
 */
let syncPassphrase: string | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

// Clear passphrase on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    syncPassphrase = null;
  });
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  if (syncPassphrase) {
    idleTimer = setTimeout(() => {
      syncPassphrase = null;
      console.log('[Settings] Sync passphrase cleared (idle timeout)');
    }, IDLE_TIMEOUT_MS);
  }
}

// ─── Sync passphrase management ────────────────

export function hasSyncPassphrase(): boolean {
  return !!syncPassphrase;
}

export function setSyncPassphrase(p: string): void {
  syncPassphrase = p;
  resetIdleTimer();
}

export function clearSyncPassphrase(): void {
  syncPassphrase = null;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

// ─── Default settings ────────────────

export function getDefaultSettings(): TransmogrifierSettings {
  return {
    version: SETTINGS_VERSION,
    aiProvider: 'azure-openai',
    ai: {},
    imageProvider: 'none',
    image: {},
    cloud: { apiUrl: '' },
    sharingProvider: 'none',
    sharing: {},
    updatedAt: 0,
  };
}

// ─── Settings CRUD ────────────────

/**
 * Load and decrypt settings from IndexedDB using the device key.
 * No passphrase needed — the device key is auto-generated and stored in IndexedDB.
 * Returns default settings if none exist or decryption fails.
 */
export async function loadSettings(): Promise<TransmogrifierSettings> {
  if (cachedSettings) return cachedSettings;

  const stored = await getSettingsValue<StoredSettings>('envelope');
  if (!stored?.envelope) {
    return getDefaultSettings();
  }

  try {
    const key = await getDeviceKey();
    const json = await decryptWithKey(stored.envelope, key);
    const settings = JSON.parse(json) as TransmogrifierSettings;
    cachedSettings = settings;
    return settings;
  } catch (err) {
    console.error('[Settings] Failed to decrypt settings:', err);
    return getDefaultSettings();
  }
}

/**
 * Encrypt and save settings to IndexedDB using the device key.
 */
export async function saveSettings(settings: TransmogrifierSettings): Promise<void> {
  settings.updatedAt = Date.now();
  settings.version = SETTINGS_VERSION;

  const key = await getDeviceKey();
  const json = JSON.stringify(settings);
  const envelope = await encryptWithKey(json, key);

  const stored: StoredSettings = {
    envelope,
    updatedAt: settings.updatedAt,
  };

  await setSettingsValue('envelope', stored);
  cachedSettings = settings;

  console.log('[Settings] Saved settings (device-key encrypted)');
}

/**
 * Clear all settings, device key, and sync passphrase.
 */
export async function clearSettings(): Promise<void> {
  await removeSettingsValue('envelope');
  clearSyncPassphrase();
  await deleteDeviceKey();
  cachedSettings = null;
}

/**
 * Invalidate in-memory cache (call after sync pull).
 */
export function invalidateCache(): void {
  cachedSettings = null;
}

// ─── Cloud sync ────────────────

/**
 * Push settings to OneDrive.
 * Loads settings, re-encrypts with sync passphrase (PBKDF2), uploads.
 * Requires a sync passphrase to be set.
 */
export async function pushSettingsToCloud(): Promise<void> {
  if (!syncPassphrase) {
    throw new Error('No sync passphrase set. Set a passphrase first.');
  }

  const settings = await loadSettings();
  if (settings.updatedAt === 0) {
    throw new Error('No settings to push. Configure your settings first.');
  }

  const json = JSON.stringify(settings);
  const envelope = await encrypt(json, syncPassphrase);
  await uploadSettings(envelope, settings.updatedAt);
  resetIdleTimer();

  console.log('[Settings] Pushed settings to OneDrive');
}

/**
 * Pull settings from OneDrive.
 * Downloads settings.enc.json, decrypts with sync passphrase,
 * re-encrypts with device key, stores in IDB.
 * Returns true if settings were updated.
 */
export async function pullSettingsFromCloud(): Promise<boolean> {
  if (!syncPassphrase) {
    throw new Error('No sync passphrase set. Set a passphrase first.');
  }

  const cloudFile = await downloadSettings();
  if (!cloudFile) {
    console.log('[Settings] No settings found on OneDrive');
    return false;
  }

  // Check if local is newer (before expensive decryption)
  const stored = await getSettingsValue<StoredSettings>('envelope');
  if (stored && stored.updatedAt >= cloudFile.updatedAt) {
    console.log('[Settings] Local settings are newer, skipping import');
    return false;
  }

  // Decrypt the inner envelope with passphrase
  let settings: TransmogrifierSettings;
  try {
    const json = await decrypt(cloudFile.envelope, syncPassphrase);
    settings = JSON.parse(json) as TransmogrifierSettings;
  } catch (err) {
    console.error('[Settings] Failed to decrypt cloud settings (wrong passphrase?):', err);
    throw new Error('Failed to decrypt settings. Check your passphrase.');
  }

  // Re-encrypt with device key and store locally
  const deviceKey = await getDeviceKey();
  const localEnvelope = await encryptWithKey(JSON.stringify(settings), deviceKey);
  const newStored: StoredSettings = {
    envelope: localEnvelope,
    updatedAt: settings.updatedAt,
  };
  await setSettingsValue('envelope', newStored);
  cachedSettings = settings;
  resetIdleTimer();

  console.log('[Settings] Imported settings from cloud (re-encrypted with device key)');
  return true;
}

// ─── Config resolution ────────────────

/**
 * Resolve the effective AI config from user settings.
 */
export async function getEffectiveAIConfig(): Promise<{
  provider: AIProvider;
  endpoint?: string;
  apiKey: string;
  deployment?: string;
  apiVersion?: string;
  model?: string;
} | null> {
  const settings = await loadSettings();
  return getAIProviderConfig(settings, settings.aiProvider);
}

/**
 * Resolve the effective image config from user settings.
 */
export async function getEffectiveImageConfig(): Promise<{
  provider: ImageProvider;
  endpoint?: string;
  apiKey?: string;
  deployment?: string;
  apiVersion?: string;
  model?: string;
} | null> {
  const settings = await loadSettings();
  const provider = settings.imageProvider;
  if (provider === 'none') return null;
  return getImageProviderConfig(settings, provider);
}

/** Default cloud API URL (Azure Functions) */
const DEFAULT_CLOUD_URL = 'https://transmogrifier-api.azurewebsites.net';

/**
 * Resolve the effective cloud API URL.
 */
export async function getEffectiveCloudUrl(): Promise<string> {
  const settings = await loadSettings();
  return settings.cloud.apiUrl || DEFAULT_CLOUD_URL;
}

/**
 * Resolve the effective sharing config (BYOS).
 * Returns null if sharing is disabled or not configured.
 */
export async function getEffectiveSharingConfig(): Promise<{
  provider: 'azure-blob';
  accountName: string;
  containerName: string;
  sasToken: string;
} | null> {
  const settings = await loadSettings();
  if (!settings.sharingProvider || settings.sharingProvider === 'none') return null;

  if (settings.sharingProvider === 'azure-blob') {
    const c = settings.sharing?.azureBlob;
    if (!c?.accountName || !c?.containerName || !c?.sasToken) return null;
    return {
      provider: 'azure-blob',
      accountName: c.accountName,
      containerName: c.containerName,
      sasToken: c.sasToken,
    };
  }

  return null;
}

// ─── Internal helpers ────────────────

function getAIProviderConfig(
  settings: TransmogrifierSettings,
  provider: AIProvider,
): { provider: AIProvider; endpoint?: string; apiKey: string; deployment?: string; apiVersion?: string; model?: string } | null {
  switch (provider) {
    case 'azure-openai': {
      const c = settings.ai.azureOpenai;
      if (!c?.apiKey) return null;
      return { provider, endpoint: c.endpoint, apiKey: c.apiKey, deployment: c.deployment, apiVersion: c.apiVersion };
    }
    case 'openai': {
      const c = settings.ai.openai;
      if (!c?.apiKey) return null;
      return { provider, apiKey: c.apiKey, model: c.model };
    }
    case 'anthropic': {
      const c = settings.ai.anthropic;
      if (!c?.apiKey) return null;
      return { provider, apiKey: c.apiKey, model: c.model };
    }
    case 'google': {
      const c = settings.ai.google;
      if (!c?.apiKey) return null;
      return { provider, apiKey: c.apiKey, model: c.model };
    }
  }
}

function getImageProviderConfig(
  settings: TransmogrifierSettings,
  provider: ImageProvider,
): { provider: ImageProvider; endpoint?: string; apiKey: string; deployment?: string; apiVersion?: string; model?: string } | null {
  switch (provider) {
    case 'azure-openai': {
      const c = settings.image.azureOpenai;
      if (!c?.apiKey) return null;
      return { provider, endpoint: c.endpoint, apiKey: c.apiKey, deployment: c.deployment, apiVersion: c.apiVersion };
    }
    case 'openai': {
      const c = settings.image.openai;
      if (!c?.apiKey) return null;
      return { provider, apiKey: c.apiKey, model: c.model };
    }
    case 'google': {
      const c = settings.image.google;
      if (!c?.apiKey) return null;
      return { provider, apiKey: c.apiKey, model: c.model };
    }
    case 'none':
      return null;
  }
}
