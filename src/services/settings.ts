/**
 * Settings Service for Library of Transmogrifia (PWA)
 *
 * Two-tier encryption model (same as the Transmogrifier extension):
 *  1. LOCAL: Settings encrypted with a per-device AES-256-GCM key stored in IndexedDB.
 *     Transparent to the user — no passphrase needed for day-to-day use.
 *  2. CLOUD SYNC: Settings encrypted with an identity-derived key (HKDF from Microsoft user ID).
 *     Deterministic — same user ID produces the same key on any device.
 *     No passphrase needed — derived automatically when the user is signed in.
 */

import { encryptWithIdentityKey, decryptWithIdentityKey, encryptWithKey, decryptWithKey } from './crypto';
import type { LocalEncryptedEnvelope, SyncEncryptedEnvelope } from './crypto';
import { getDeviceKey, deleteDeviceKey } from './device-key';
import { getSettingsValue, setSettingsValue, removeSettingsValue } from './cache';
import { downloadSettings, uploadSettings } from './graph';
import { getUserId } from './auth';
import type { TransmogrifierSettings, AIProvider, ImageProvider } from '../types';

const SETTINGS_VERSION = 1;

// ─── Stored envelope shape ────────────────

interface StoredSettings {
  envelope: LocalEncryptedEnvelope;
  updatedAt: number;
}

// ─── In-memory state ────────────────

let cachedSettings: TransmogrifierSettings | null = null;

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
 * Clear all settings, device key, and cached state.
 */
export async function clearSettings(): Promise<void> {
  await removeSettingsValue('envelope');
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
 * Loads settings, encrypts with identity key (HKDF from userId), uploads.
 * Requires the user to be signed in.
 */
export async function pushSettingsToCloud(): Promise<void> {
  const userId = await getUserId();
  if (!userId) {
    throw new Error('Not signed in. Sign in to sync settings.');
  }

  const settings = await loadSettings();
  if (settings.updatedAt === 0) {
    throw new Error('No settings to push. Configure your settings first.');
  }

  console.log('[Settings] Encrypting for sync, userId prefix:', userId.substring(0, 8) + '…');
  const json = JSON.stringify(settings);
  const envelope = await encryptWithIdentityKey(json, userId);
  await uploadSettings(envelope, settings.updatedAt);

  console.log('[Settings] Pushed settings to OneDrive');
}

/**
 * Pull settings from OneDrive.
 * Downloads settings.enc.json, decrypts with identity key (or legacy passphrase),
 * re-encrypts with device key, stores in IDB.
 * Returns true if settings were updated.
 */
export async function pullSettingsFromCloud(): Promise<boolean> {
  const userId = await getUserId();
  if (!userId) {
    throw new Error('Not signed in. Sign in to sync settings.');
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

  const envelope = cloudFile.envelope;
  let settings: TransmogrifierSettings;

  if (envelope.v === 2) {
    // v2: identity-key encrypted
    try {
      console.log('[Settings] Decrypting cloud settings, userId prefix:', userId.substring(0, 8) + '…,',
        'iv length:', (envelope as SyncEncryptedEnvelope).iv.length,
        'data length:', (envelope as SyncEncryptedEnvelope).data.length);
      const json = await decryptWithIdentityKey(envelope as SyncEncryptedEnvelope, userId);
      settings = JSON.parse(json) as TransmogrifierSettings;
    } catch (err) {
      console.error('[Settings] Failed to decrypt cloud settings:', err);
      throw new Error('Failed to decrypt settings from OneDrive.');
    }
  } else if (envelope.v === 1 && 'salt' in envelope) {
    // v1: legacy passphrase-encrypted — need migration
    // TODO: Prompt for legacy passphrase if v1 envelope is encountered
    throw new Error(
      'Settings on OneDrive use the old passphrase format. ' +
      'Please re-push settings from the extension to upgrade to the new format.'
    );
  } else {
    throw new Error(`Unknown settings encryption version: ${(envelope as { v: number }).v}`);
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

  console.log('[Settings] Imported settings from cloud (re-encrypted with device key)');
  return true;
}

// ─── Auto-import on new device ────────────────

/**
 * If local settings are blank (never configured), attempt to pull from
 * OneDrive.  Call this once after sign-in / app boot so a user signing in
 * on a new device inherits their cloud settings automatically.  Existing
 * settings are never overwritten.
 *
 * Returns `true` if settings were imported.
 */
export async function tryAutoImportFromCloud(): Promise<boolean> {
  const local = await loadSettings();
  if (local.updatedAt !== 0) {
    // User already has settings on this device — leave them alone
    return false;
  }

  try {
    const imported = await pullSettingsFromCloud();
    if (imported) {
      console.log('[Settings] Auto-imported settings from OneDrive (new device)');
    }
    return imported;
  } catch (err) {
    // Non-fatal — the user can still configure manually
    console.warn('[Settings] Auto-import from cloud failed:', err);
    return false;
  }
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
    default:
      return null;
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
    default:
      return null;
  }
}
