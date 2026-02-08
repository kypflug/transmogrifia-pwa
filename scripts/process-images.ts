/**
 * Process raw generated images into optimized web assets.
 *
 * Usage:
 *   npx tsx scripts/process-images.ts
 *
 * Input:  public/images/hero-raw.png, public/images/icon-raw.png
 * Output: Optimized hero (WebP/AVIF), icons (multiple sizes PNG), favicon
 */

import sharp from 'sharp';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const root = process.cwd();
const heroSrc = resolve(root, 'public/images/hero-raw.png');
const iconSrc = resolve(root, 'public/images/icon-raw.png');
const iconsDir = resolve(root, 'public/icons');
const imagesDir = resolve(root, 'public/images');

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Hero image processing ────────────────────────────────────────────────────
async function processHero() {
  if (!existsSync(heroSrc)) {
    console.warn('⚠️  No hero-raw.png found — skipping hero processing.');
    return;
  }
  console.log('🖼️  Processing hero image…');
  ensureDir(imagesDir);

  const img = sharp(heroSrc);

  // Full-size WebP for modern browsers
  await img
    .clone()
    .resize(1536, 1024, { fit: 'cover' })
    .webp({ quality: 80 })
    .toFile(resolve(imagesDir, 'hero.webp'));
  console.log('   ✅ hero.webp (1536×1024)');

  // Full-size AVIF for best compression
  await img
    .clone()
    .resize(1536, 1024, { fit: 'cover' })
    .avif({ quality: 50, effort: 6 })
    .toFile(resolve(imagesDir, 'hero.avif'));
  console.log('   ✅ hero.avif (1536×1024)');

  // Fallback JPEG
  await img
    .clone()
    .resize(1536, 1024, { fit: 'cover' })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(resolve(imagesDir, 'hero.jpg'));
  console.log('   ✅ hero.jpg (1536×1024)');

  // Smaller variant for mobile
  await img
    .clone()
    .resize(768, 512, { fit: 'cover' })
    .webp({ quality: 75 })
    .toFile(resolve(imagesDir, 'hero-768.webp'));
  console.log('   ✅ hero-768.webp (768×512)');

  await img
    .clone()
    .resize(768, 512, { fit: 'cover' })
    .jpeg({ quality: 75, mozjpeg: true })
    .toFile(resolve(imagesDir, 'hero-768.jpg'));
  console.log('   ✅ hero-768.jpg (768×512)');
}

// ── Icon processing ──────────────────────────────────────────────────────────
async function processIcons() {
  if (!existsSync(iconSrc)) {
    console.warn('⚠️  No icon-raw.png found — skipping icon processing.');
    return;
  }
  console.log('\n🎯  Processing app icons…');
  ensureDir(iconsDir);

  const sizes = [16, 32, 48, 64, 128, 180, 192, 512];

  for (const size of sizes) {
    const filename = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
    await sharp(iconSrc)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png({ quality: 90 })
      .toFile(resolve(iconsDir, filename));
    console.log(`   ✅ ${filename} (${size}×${size})`);
  }

  // Maskable icon with padding (safe area = inner 80%)
  await sharp(iconSrc)
    .resize(512, 512, { fit: 'contain', background: { r: 250, g: 250, b: 250, alpha: 255 } })
    .extend({
      top: 51, bottom: 51, left: 51, right: 51,  // ~10% padding each side
      background: { r: 250, g: 250, b: 250, alpha: 255 },
    })
    .resize(512, 512)  // back to 512 after padding
    .png()
    .toFile(resolve(iconsDir, 'icon-maskable-512.png'));
  console.log('   ✅ icon-maskable-512.png (512×512, padded)');

  // ICO favicon (multi-size)
  // Sharp can't write .ico directly, so we'll create a 32x32 PNG for the SVG fallback
  // and keep the SVG favicon approach. The 32px PNG is useful as a fallback.
  await sharp(iconSrc)
    .resize(32, 32)
    .png()
    .toFile(resolve(root, 'public/favicon-32.png'));
  console.log('   ✅ favicon-32.png (32×32)');

  // Generate a simple SVG favicon that references the PNG (better than emoji)
  const favicon32 = await sharp(iconSrc).resize(64, 64).png().toBuffer();
  const b64 = favicon32.toString('base64');
  const svgFavicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <image href="data:image/png;base64,${b64}" width="64" height="64"/>
</svg>`;
  writeFileSync(resolve(root, 'public/favicon.svg'), svgFavicon);
  console.log('   ✅ favicon.svg (embedded PNG)');
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🏛️  Library of Transmogrifia — Image Processing\n');
  await processHero();
  await processIcons();
  console.log('\n✨  All images processed!\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
