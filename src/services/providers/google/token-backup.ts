/**
 * Google Token Backup Service
 *
 * iOS aggressively evicts localStorage for PWAs — WKWebView process kills,
 * storage pressure, and OS updates can all wipe stored Google tokens.
 * IndexedDB is significantly more durable on iOS.
 *
 * This service mirrors Google-related localStorage entries to IndexedDB after
 * every successful auth operation, and restores them on cold start if
 * localStorage was wiped.
 *
 * Follows the same pattern as `msal-cache-backup.ts` but for Google OAuth tokens.
 */

const DB_NAME = 'TransmogrifierGoogleAuthBackup';
const DB_VERSION = 1;
const STORE_NAME = 'google-tokens';
const SNAPSHOT_KEY = 'google-snapshot';

/**
 * Patterns that identify Google auth localStorage keys.
 * All Google auth keys share the `transmogrifia_google_` prefix.
 */
const GOOGLE_KEY_PATTERNS = ['transmogrifia_google_'];

/** Returns true if a localStorage key belongs to Google auth. */
function isGoogleKey(key: string): boolean {
  return GOOGLE_KEY_PATTERNS.some(p => key.includes(p));
}

function openBackupDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Snapshot all Google-related localStorage entries to IndexedDB.
 * Call after successful sign-in and token acquisition.
 */
export async function backupGoogleTokens(): Promise<void> {
  try {
    const snapshot: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isGoogleKey(key)) {
        const val = localStorage.getItem(key);
        if (val !== null) snapshot[key] = val;
      }
    }

    // Only write if there's meaningful data (at least an access or refresh token)
    const hasTokenData = Object.keys(snapshot).some(
      k => k.includes('access_token') || k.includes('refresh_token'),
    );
    if (!hasTokenData) return;

    const db = await openBackupDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(snapshot, SNAPSHOT_KEY);
      tx.oncomplete = () => {
        console.debug('[GoogleAuthBackup] Saved %d Google keys to IndexedDB', Object.keys(snapshot).length);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[GoogleAuthBackup] Failed to backup Google tokens:', err);
  }
}

/**
 * Restore Google tokens from IndexedDB if localStorage was wiped.
 * Call BEFORE initialising the Google auth provider so it picks up the restored tokens.
 *
 * Returns true if entries were restored (caller may want to log this).
 */
export async function restoreGoogleTokensIfNeeded(): Promise<boolean> {
  try {
    // Check if localStorage already has Google token data
    let hasGoogleData = false;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isGoogleKey(key) && (key.includes('access_token') || key.includes('refresh_token'))) {
        hasGoogleData = true;
        break;
      }
    }

    if (hasGoogleData) return false; // localStorage is fine, no restore needed

    // localStorage is empty — try to restore from IndexedDB
    const db = await openBackupDB();
    const snapshot = await new Promise<Record<string, string> | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
      req.onsuccess = () => resolve(req.result as Record<string, string> | undefined);
      req.onerror = () => reject(req.error);
    });

    if (!snapshot || Object.keys(snapshot).length === 0) return false;

    // Restore each key to localStorage, skipping the temporary code_verifier
    let restored = 0;
    for (const [key, value] of Object.entries(snapshot)) {
      // Don't restore code_verifier — it's transient and only valid during the auth redirect
      if (key.includes('code_verifier')) continue;
      try {
        localStorage.setItem(key, value);
        restored++;
      } catch {
        // localStorage quota exceeded or unavailable — stop trying
        break;
      }
    }

    if (restored > 0) {
      console.info('[GoogleAuthBackup] Restored %d Google keys from IndexedDB backup', restored);
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[GoogleAuthBackup] Failed to restore Google tokens:', err);
    return false;
  }
}

/**
 * Clear the IndexedDB backup (call on explicit sign-out).
 */
export async function clearGoogleTokenBackup(): Promise<void> {
  try {
    const db = await openBackupDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Register listeners to backup Google tokens before iOS kills the process.
 *
 * iOS aggressively terminates WKWebView processes when the PWA is
 * backgrounded. `pagehide` is the last reliable event before termination.
 * `visibilitychange: hidden` fires earlier (app switch) and gives more
 * time for the IndexedDB write to complete.
 *
 * Call once after entering the app (sign-in confirmed).
 */
export function setupGoogleTokenBackup(): void {
  let lastBackup = 0;
  const MIN_INTERVAL_MS = 60_000; // At most once per minute on visibility

  const debouncedBackup = () => {
    const now = Date.now();
    if (now - lastBackup < MIN_INTERVAL_MS) return;
    lastBackup = now;
    backupGoogleTokens().catch(() => {});
  };

  // pagehide — last chance before iOS process kill; always run (no debounce)
  window.addEventListener('pagehide', () => {
    backupGoogleTokens().catch(() => {});
  });

  // visibilitychange: hidden — fires on app switch, tab switch, etc.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') debouncedBackup();
  });
}
