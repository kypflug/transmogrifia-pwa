/**
 * Create a revocable gift token for the Library of Transmogrifia.
 *
 * Encrypts the admin's TransmogrifierSettings with a chosen passphrase
 * and uploads the encrypted blob to Azure Blob Storage. Friends redeem
 * the passphrase on the sign-in screen to import the settings.
 *
 * Usage:
 *   npx tsx scripts/create-gift-token.ts <passphrase>
 *   npx tsx scripts/create-gift-token.ts --revoke <passphrase>
 *
 * The blob filename is derived from SHA-256(passphrase), so:
 *  - The passphrase is never exposed in the URL
 *  - Revoking = deleting the blob for that passphrase hash
 *
 * Requires .env with:
 *   GIFT_BLOB_SAS_TOKEN          — SAS token with write/delete permission
 *   VITE_AZURE_OPENAI_ENDPOINT   — (and other settings to bundle into the gift)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { webcrypto } from 'crypto';

// Polyfill for Node < 20
if (!globalThis.crypto) {
  (globalThis as Record<string, unknown>).crypto = webcrypto;
}

// ── Inline dotenv ────────────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    console.error('No .env file found. Copy .env.example to .env and fill in credentials.');
    process.exit(1);
  }
  const env: Record<string, string> = {};
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

// ── Crypto helpers (mirror src/services/crypto.ts for Node) ──────────────────

const PBKDF2_ITERATIONS = 600_000;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

interface EncryptedEnvelope {
  v: 1;
  salt: string;
  iv: string;
  data: string;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
}

async function encrypt(plaintext: string, passphrase: string): Promise<EncryptedEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    v: 1,
    salt: uint8ToBase64(salt),
    iv: uint8ToBase64(iv),
    data: uint8ToBase64(new Uint8Array(ciphertext)),
  };
}

// ── Hash helper ──────────────────────────────────────────────────────────────

async function tokenToFilename(token: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(token.trim()),
  );
  const hex = Array.from(new Uint8Array(hashBuffer).slice(0, 8))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `gift-${hex}.enc.json`;
}

// ── Build settings from env vars ─────────────────────────────────────────────

interface TransmogrifierSettings {
  version: number;
  aiProvider: string;
  ai: Record<string, unknown>;
  imageProvider: string;
  image: Record<string, unknown>;
  cloud: { apiUrl: string };
  sharingProvider: string;
  sharing: Record<string, unknown>;
  updatedAt: number;
}

function buildSettings(env: Record<string, string>): TransmogrifierSettings {
  const settings: TransmogrifierSettings = {
    version: 1,
    aiProvider: 'azure-openai',
    ai: {},
    imageProvider: 'none',
    image: {},
    cloud: { apiUrl: env.VITE_CLOUD_API_URL || '' },
    sharingProvider: 'none',
    sharing: {},
    updatedAt: Date.now(),
  };

  // Azure OpenAI chat config
  if (env.VITE_AZURE_OPENAI_ENDPOINT && env.VITE_AZURE_OPENAI_API_KEY) {
    settings.ai = {
      azureOpenai: {
        endpoint: env.VITE_AZURE_OPENAI_ENDPOINT.replace(/\/+$/, ''),
        apiKey: env.VITE_AZURE_OPENAI_API_KEY,
        deployment: env.VITE_AZURE_OPENAI_DEPLOYMENT || '',
        apiVersion: env.VITE_AZURE_OPENAI_API_VERSION || '2024-10-21',
      },
    };
  }

  // Azure OpenAI image config
  if (env.VITE_AZURE_IMAGE_ENDPOINT && env.VITE_AZURE_IMAGE_API_KEY) {
    settings.imageProvider = 'azure-openai';
    settings.image = {
      azureOpenai: {
        endpoint: env.VITE_AZURE_IMAGE_ENDPOINT.replace(/\/+$/, ''),
        apiKey: env.VITE_AZURE_IMAGE_API_KEY,
        deployment: env.VITE_AZURE_IMAGE_DEPLOYMENT || '',
        apiVersion: env.VITE_AZURE_IMAGE_API_VERSION || '2024-10-21',
      },
    };
  }

  // Azure Blob sharing config
  if (env.VITE_SHARING_ACCOUNT_NAME && env.VITE_SHARING_SAS_TOKEN) {
    settings.sharingProvider = 'azure-blob';
    settings.sharing = {
      azureBlob: {
        accountName: env.VITE_SHARING_ACCOUNT_NAME,
        containerName: env.VITE_SHARING_CONTAINER_NAME || 'shared',
        sasToken: env.VITE_SHARING_SAS_TOKEN,
      },
    };
  }

  return settings;
}

// ── Blob upload/delete ───────────────────────────────────────────────────────

async function uploadBlob(
  baseUrl: string,
  sasToken: string,
  filename: string,
  body: string,
): Promise<void> {
  const sas = sasToken.startsWith('?') ? sasToken : `?${sasToken}`;
  const url = `${baseUrl.replace(/\/+$/, '')}/${filename}${sas}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-ms-blob-type': 'BlockBlob',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }
}

async function deleteBlob(
  baseUrl: string,
  sasToken: string,
  filename: string,
): Promise<void> {
  const sas = sasToken.startsWith('?') ? sasToken : `?${sasToken}`;
  const url = `${baseUrl.replace(/\/+$/, '')}/${filename}${sas}`;

  const res = await fetch(url, { method: 'DELETE' });
  if (res.status === 404) {
    console.log('⚠️  Blob not found — token may have already been revoked.');
    return;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Delete failed (${res.status}): ${text}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isRevoke = args[0] === '--revoke';
  const passphrase = isRevoke ? args[1] : args[0];

  if (!passphrase) {
    console.error('Usage:');
    console.error('  npx tsx scripts/create-gift-token.ts <passphrase>');
    console.error('  npx tsx scripts/create-gift-token.ts --revoke <passphrase>');
    process.exit(1);
  }

  const env = loadEnv();
  const blobBase = env.VITE_GIFT_BLOB_BASE;
  const blobSas = env.GIFT_BLOB_SAS_TOKEN;

  if (!blobBase) {
    console.error('Missing VITE_GIFT_BLOB_BASE in .env');
    process.exit(1);
  }
  if (!blobSas) {
    console.error('Missing GIFT_BLOB_SAS_TOKEN in .env (SAS with write/delete perms)');
    process.exit(1);
  }

  const filename = await tokenToFilename(passphrase);
  console.log(`Blob filename: ${filename}`);

  if (isRevoke) {
    console.log('Revoking gift token…');
    await deleteBlob(blobBase, blobSas, filename);
    console.log('✅ Gift token revoked.');
    return;
  }

  // Build and encrypt settings
  const settings = buildSettings(env);
  console.log(`AI provider: ${settings.aiProvider}`);
  console.log(`Image provider: ${settings.imageProvider}`);
  console.log(`Sharing provider: ${settings.sharingProvider}`);

  const json = JSON.stringify(settings);
  console.log('Encrypting settings with passphrase…');
  const envelope = await encrypt(json, passphrase);

  // Upload
  console.log('Uploading to blob storage…');
  await uploadBlob(blobBase, blobSas, filename, JSON.stringify(envelope));

  console.log('');
  console.log('✅ Gift token created!');
  console.log(`   Passphrase:  ${passphrase}`);
  console.log(`   Blob:        ${blobBase.replace(/\/+$/, '')}/${filename}`);
  console.log('');
  console.log('To revoke:');
  console.log(`   npx tsx scripts/create-gift-token.ts --revoke "${passphrase}"`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
