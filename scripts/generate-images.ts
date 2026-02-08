/**
 * Generate hero image and app icon for the Library of Transmogrifia PWA.
 *
 * Usage:
 *   npx tsx scripts/generate-images.ts
 *
 * Reads VITE_AZURE_IMAGE_* env vars from .env (dotenv-style, parsed inline).
 * Outputs raw PNGs to public/images/ — run scripts/process-images.ts next.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

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

const env = loadEnv();
const endpoint = env.VITE_AZURE_IMAGE_ENDPOINT?.replace(/\/+$/, '');
const apiKey = env.VITE_AZURE_IMAGE_API_KEY;
const deployment = env.VITE_AZURE_IMAGE_DEPLOYMENT;
const apiVersion = env.VITE_AZURE_IMAGE_API_VERSION || '2024-10-21';

if (!endpoint || !apiKey || !deployment) {
  console.error('Missing VITE_AZURE_IMAGE_* env vars. Check .env.');
  process.exit(1);
}

// ── Image generation helper ──────────────────────────────────────────────────
async function generateImage(
  prompt: string,
  size: string,
  outputPath: string,
): Promise<void> {
  const url = `${endpoint}/openai/deployments/${deployment}/images/generations?api-version=${apiVersion}`;

  console.log(`\n🎨  Generating: ${outputPath}`);
  console.log(`    Size: ${size}`);
  console.log(`    Prompt: ${prompt.slice(0, 120)}…\n`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      prompt,
      n: 1,
      size,
      output_format: 'png',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Image API ${res.status}: ${body}`);
  }

  const result = await res.json();
  const b64 = result.data?.[0]?.b64_json;
  if (!b64) {
    console.error('Unexpected response:', JSON.stringify(result).slice(0, 300));
    throw new Error('No b64_json in response');
  }

  const dir = resolve(process.cwd(), outputPath, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(process.cwd(), outputPath), Buffer.from(b64, 'base64'));
  console.log(`✅  Saved ${outputPath}`);
}

// ── Prompts ──────────────────────────────────────────────────────────────────

const heroPrompt = `A watercolor illustration of a grand classical library inspired by the ancient Library of Alexandria. The scene shows tall stone columns, arched ceilings, and shelves overflowing with scrolls and books, with warm light streaming through high windows. Scholars read at long wooden tables. The watercolor effect should be pronounced with paint bleeding, color blending, and brushstroke textures. Use predominantly green and blue hues, a bit muted, with warm golden accents from the window light. No text or labels.`;

const iconPrompt = `A watercolor illustration of a single classical scroll or book on a stone pedestal, viewed straight-on as an app icon. Simple, iconic composition centered in the frame with generous padding. The watercolor effect should be pronounced with paint bleeding, color blending, and brushstroke textures. Use predominantly green and blue hues, a bit muted. Minimal detail, bold shapes suitable for a small icon. No text, no background clutter.`;

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🏛️  Library of Transmogrifia — Image Generation\n');

  // Hero: wide landscape for sign-in background
  await generateImage(heroPrompt, '1536x1024', 'public/images/hero-raw.png');

  // Delay to avoid rate limits
  await new Promise(r => setTimeout(r, 1000));

  // Icon: square for app icon / favicon source
  await generateImage(iconPrompt, '1024x1024', 'public/images/icon-raw.png');

  console.log('\n✨  Raw images generated. Run `npx tsx scripts/process-images.ts` to optimize.\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
