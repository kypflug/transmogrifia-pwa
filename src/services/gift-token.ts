/**
 * Gift Token Service for Library of Transmogrifia
 *
 * Lets the admin issue gift tokens (passphrases) to friends that preconfigure
 * the app with working AI/cloud/sharing settings — zero manual setup.
 *
 * Architecture:
 *  - The admin encrypts their TransmogrifierSettings with a chosen passphrase
 *    and uploads the resulting EncryptedEnvelope to Azure Blob Storage.
 *  - The blob filename is derived from SHA-256(passphrase) so the PWA can
 *    locate it without exposing the passphrase in the URL.
 *  - To **revoke** a token, the admin simply deletes the blob file.
 *
 * The blob container (https://transmogstorage.blob.core.windows.net/giftconfigs)
 * has anonymous blob-level read access — individual blobs can be fetched by
 * exact URL, but the container cannot be listed.
 */

import { decryptLegacyEnvelope } from './crypto';
import type { LegacyEncryptedEnvelope } from './crypto';
import { saveSettings } from './settings';
import type { TransmogrifierSettings } from '../types';

/** Base URL of the blob container that hosts encrypted gift config files. */
const GIFT_BLOB_BASE = 'https://transmogstorage.blob.core.windows.net/giftconfigs';

// ─── Hash helper ────────────────

/**
 * Derive the blob filename from a gift token (passphrase).
 * Uses the first 8 bytes (16 hex chars) of SHA-256(token).
 * This is enough to avoid collisions for a small set of tokens,
 * while not exposing the full hash.
 */
async function tokenToFilename(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token.trim()));
  const hashArray = new Uint8Array(hashBuffer);
  const hex = Array.from(hashArray.slice(0, 8))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `gift-${hex}.enc.json`;
}

// ─── Redemption ────────────────

/**
 * Redeem a gift token (passphrase) to import pre-configured settings.
 *
 * 1. Derives the blob filename from SHA-256(token)
 * 2. Fetches the encrypted config blob from blob storage
 * 3. Decrypts it with the token (PBKDF2 passphrase)
 * 4. Saves the decrypted settings locally (encrypted with device key)
 *
 * @param token - The gift token / passphrase
 * @throws If the feature is not configured, the token is revoked/invalid,
 *         or decryption fails
 */
export async function redeemGiftToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('Please enter a gift token.');
  }

  // Derive blob filename from token hash
  const filename = await tokenToFilename(trimmed);
  const base = GIFT_BLOB_BASE.replace(/\/+$/, '');
  const url = `${base}/${filename}`;

  // Fetch the encrypted blob
  const response = await fetch(url);
  if (response.status === 404) {
    throw new Error('This token is invalid or has been revoked.');
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch gift config (${response.status}).`);
  }

  let envelope: LegacyEncryptedEnvelope;
  try {
    envelope = await response.json() as LegacyEncryptedEnvelope;
  } catch {
    throw new Error('Gift config is not valid.');
  }

  // Decrypt with the gift token (passphrase)
  let json: string;
  try {
    json = await decryptLegacyEnvelope(envelope, trimmed);
  } catch {
    throw new Error('Invalid token. Please check and try again.');
  }

  // Parse and validate
  let settings: TransmogrifierSettings;
  try {
    settings = JSON.parse(json) as TransmogrifierSettings;
  } catch {
    throw new Error('Gift config is corrupted.');
  }

  if (!settings.version || !settings.aiProvider) {
    throw new Error('Gift config is not a valid settings file.');
  }

  // Save locally (encrypted with device key)
  await saveSettings(settings);
}
