/**
 * Crypto Service for Transmogrifier
 *
 * Two encryption modes:
 *  1. Device key (AES-256-GCM via CryptoKey from IndexedDB) — local settings encryption.
 *     Transparent to the user, persists across sessions, no passphrase needed.
 *  2. Passphrase (AES-256-GCM via PBKDF2) — cloud sync encryption.
 *     User enters once per device to encrypt/decrypt settings on OneDrive.
 */

const PBKDF2_ITERATIONS = 600_000;
const IV_LENGTH = 12;   // bytes (standard for AES-GCM)
const SALT_LENGTH = 16; // bytes (PBKDF2 only)

/**
 * Derive an AES-256-GCM key from a passphrase and salt using PBKDF2
 */
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypted envelope stored on OneDrive
 */
export interface EncryptedEnvelope {
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
 * Encrypt a plaintext JSON string using a passphrase.
 * Returns an envelope with salt + IV + ciphertext (all base64).
 */
export async function encrypt(plaintext: string, passphrase: string): Promise<EncryptedEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(passphrase, salt);

  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encoder.encode(plaintext),
  );

  return {
    v: 1,
    salt: uint8ToBase64(salt),
    iv: uint8ToBase64(iv),
    data: uint8ToBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * Decrypt an encrypted envelope using a passphrase.
 * Throws if the passphrase is wrong or data is tampered.
 */
export async function decrypt(envelope: EncryptedEnvelope, passphrase: string): Promise<string> {
  if (envelope.v !== 1) {
    throw new Error(`Unsupported encryption version: ${envelope.v}`);
  }

  const salt = base64ToUint8(envelope.salt);
  const iv = base64ToUint8(envelope.iv);
  const ciphertext = base64ToUint8(envelope.data);
  const key = await deriveKey(passphrase, salt);

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
