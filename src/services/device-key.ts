/**
 * Device Key Service for Transmogrifier
 *
 * Generates and retrieves a per-device, non-extractable AES-256-GCM CryptoKey
 * stored in IndexedDB. This key encrypts settings locally — no user input needed.
 *
 * Security model:
 *  - The key is marked { extractable: false }, so it cannot be read via the API
 *  - IndexedDB natively supports structured-cloneable CryptoKey objects
 *  - Each device (extension install / PWA instance) gets its own key
 *  - The key protects settings at rest on the local device
 *  - For cross-device sync, a separate user passphrase encrypts settings on OneDrive
 *
 * Compatible with both Chrome extension and PWA contexts (pure Web Crypto + IDB).
 */

const DB_NAME = 'TransmogrifierKeyStore';
const DB_VERSION = 1;
const STORE_NAME = 'keys';
const DEVICE_KEY_ID = 'device-aes-key';

/** Cached key to avoid repeated IDB lookups */
let cachedKey: CryptoKey | null = null;

/**
 * Open (or create) the key store database.
 */
function openKeyStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Generate a fresh non-extractable AES-256-GCM key.
 */
async function generateDeviceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt'],
  );
}

/**
 * Store a CryptoKey in IndexedDB.
 */
async function storeKey(key: CryptoKey): Promise<void> {
  const db = await openKeyStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(key, DEVICE_KEY_ID);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Retrieve the CryptoKey from IndexedDB, or null if not yet created.
 */
async function loadKey(): Promise<CryptoKey | null> {
  const db = await openKeyStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(DEVICE_KEY_ID);
    req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/**
 * Get the device key, creating it on first use.
 * The key persists in IndexedDB across sessions and service-worker restarts.
 */
export async function getDeviceKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  let key = await loadKey();
  if (!key) {
    key = await generateDeviceKey();
    await storeKey(key);
    console.log('[DeviceKey] Generated new device key');
  }

  cachedKey = key;
  return key;
}

/**
 * Delete the device key (used when clearing all settings).
 */
export async function deleteDeviceKey(): Promise<void> {
  cachedKey = null;
  const db = await openKeyStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(DEVICE_KEY_ID);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
