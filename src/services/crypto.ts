/**
 * Crypto Service — re-exports from @kypflug/transmogrifier-core
 *
 * All crypto operations are platform-agnostic and live in core.
 * This file exists for backward-compatible import paths.
 */

export {
  deriveIdentityKey,
  encryptWithIdentityKey,
  decryptWithIdentityKey,
  decryptLegacyEnvelope,
  encryptWithKey,
  decryptWithKey,
  uint8ToBase64,
  base64ToUint8,
} from '@kypflug/transmogrifier-core';

export type {
  SyncEncryptedEnvelope,
  LegacyEncryptedEnvelope,
  LocalEncryptedEnvelope,
} from '@kypflug/transmogrifier-core';
