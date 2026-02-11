/**
 * Crypto Service for Library of Transmogrifia (PWA)
 *
 * Two encryption modes:
 *  1. Device key (AES-256-GCM via CryptoKey from IndexedDB) — local settings encryption.
 *     Transparent to the user, persists across sessions, no passphrase needed.
 *  2. Identity key (AES-256-GCM via HKDF from Microsoft user ID) — cloud sync encryption.
 *     Deterministic: same user ID produces the same key on any device.
 *     No passphrase needed — derived automatically when the user is signed in.
 */

const IV_LENGTH = 12;   // bytes (standard for AES-GCM)

// HKDF parameters for identity-based key derivation
// MUST match the extension's crypto-service.ts exactly
const HKDF_SALT = new TextEncoder().encode('transmogrifier-settings-v2');
const HKDF_INFO = new TextEncoder().encode('settings-encryption');

/**
 * Derive a deterministic AES-256-GCM key from a Microsoft user ID using HKDF.
 * Same userId always produces the same key (deterministic, no random salt).
 */
export async function deriveIdentityKey(userId: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(userId),
    'HKDF',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: HKDF_SALT as unknown as BufferSource,
      info: HKDF_INFO as unknown as BufferSource,
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypted envelope stored on OneDrive (identity-key encrypted, v2).
 * No salt needed — HKDF parameters are fixed.
 */
export interface SyncEncryptedEnvelope {
  /** Schema version (2 = HKDF identity key) */
  v: 2;
  /** Base64-encoded AES-GCM IV (12 bytes) */
  iv: string;
  /** Base64-encoded ciphertext */
  data: string;
}

/**
 * Legacy passphrase-encrypted envelope (v1, PBKDF2).
 * Kept for migration: if a user pulls an existing v1 envelope from OneDrive,
 * we need to prompt for the old passphrase once to migrate.
 */
export interface LegacyEncryptedEnvelope {
  /** Schema version */
  v: 1;
  /** Base64-encoded PBKDF2 salt */
  salt: string;
  /** Base64-encoded AES-GCM IV */
  iv: string;
  /** Base64-encoded ciphertext */
  data: string;
}

/**
 * Encrypt plaintext with an identity-derived key (HKDF from userId).
 * Returns an envelope with IV + ciphertext (no salt — key derivation is deterministic).
 */
export async function encryptWithIdentityKey(plaintext: string, userId: string): Promise<SyncEncryptedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveIdentityKey(userId);
  const encoder = new TextEncoder();

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encoder.encode(plaintext),
  );

  return {
    v: 2,
    iv: uint8ToBase64(iv),
    data: uint8ToBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * Decrypt an identity-key-encrypted envelope.
 * Throws if the userId doesn't match or data is tampered.
 */
export async function decryptWithIdentityKey(envelope: SyncEncryptedEnvelope, userId: string): Promise<string> {
  if (envelope.v !== 2) {
    throw new Error(`Unsupported sync encryption version: ${envelope.v}. Expected v2 (identity key).`);
  }

  const iv = base64ToUint8(envelope.iv);
  const ciphertext = base64ToUint8(envelope.data);
  const key = await deriveIdentityKey(userId);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    ciphertext as unknown as BufferSource,
  );

  return new TextDecoder().decode(plaintext);
}

/**
 * Decrypt a legacy v1 passphrase-encrypted envelope (for migration only).
 * Uses PBKDF2 with 600k iterations — same algorithm as the old crypto-service.
 */
export async function decryptLegacyEnvelope(envelope: LegacyEncryptedEnvelope, passphrase: string): Promise<string> {
  if (envelope.v !== 1) {
    throw new Error(`Expected v1 envelope for legacy decryption, got v${envelope.v}`);
  }

  const salt = base64ToUint8(envelope.salt);
  const iv = base64ToUint8(envelope.iv);
  const ciphertext = base64ToUint8(envelope.data);

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: 600_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    ciphertext as unknown as BufferSource,
  );

  return new TextDecoder().decode(plaintext);
}

// ─── Device-key encryption (local storage) ────────────────

/**
 * Locally-encrypted envelope stored in IndexedDB.
 * Uses a device-resident CryptoKey (no passphrase, no salt).
 */
export interface LocalEncryptedEnvelope {
  /** Schema version */
  v: 1;
  /** Base64-encoded AES-GCM IV (12 bytes) */
  iv: string;
  /** Base64-encoded ciphertext */
  data: string;
}

/**
 * Encrypt plaintext with a CryptoKey (device key).
 * Returns an envelope with IV + ciphertext (no salt — key is pre-derived).
 */
export async function encryptWithKey(plaintext: string, key: CryptoKey): Promise<LocalEncryptedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encoder.encode(plaintext),
  );

  return {
    v: 1,
    iv: uint8ToBase64(iv),
    data: uint8ToBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * Decrypt a locally-encrypted envelope with a CryptoKey (device key).
 * Throws if the key is wrong or data is tampered.
 */
export async function decryptWithKey(envelope: LocalEncryptedEnvelope, key: CryptoKey): Promise<string> {
  if (envelope.v !== 1) {
    throw new Error(`Unsupported local encryption version: ${envelope.v}`);
  }

  const iv = base64ToUint8(envelope.iv);
  const ciphertext = base64ToUint8(envelope.data);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    ciphertext as unknown as BufferSource,
  );

  return new TextDecoder().decode(plaintext);
}

// ─── Base64 helpers ────────────────

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
