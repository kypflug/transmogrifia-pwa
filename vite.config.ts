import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: [
        'favicon.svg',
        'favicon-32.png',
        'icons/*.png',
        'images/hero.webp',
        'images/hero.avif',
        'images/hero.jpg',
        'images/hero-768.webp',
        'images/hero-768.jpg',
      ],
      manifest: {
        name: 'Library of Transmogrifia',
        short_name: 'Transmogrifia',
        description: 'Read your transmogrified articles anywhere',
        theme_color: '#FFFFFF',
        background_color: '#FFFFFF',
        display: 'standalone',
        display_override: ['window-controls-overlay'],
        start_url: '/',
        orientation: 'any',
        categories: ['productivity', 'education'],
        share_target: {
          action: '/?share-target',
          method: 'GET',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
          },
        },
        launch_handler: {
          client_mode: 'navigate-existing',
        },
        icons: [
          { src: 'icons/icon-48.png', sizes: '48x48', type: 'image/png' },
          { src: 'icons/icon-128.png', sizes: '128x128', type: 'image/png' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webp,avif,jpg}'],
        globIgnores: ['**/images/*-raw.png'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/graph\.microsoft\.com\/.*/i,
            handler: 'NetworkOnly',
          },
          // Cache shared article HTML blobs — immutable once published
          {
            urlPattern: /^https:\/\/[a-z0-9]+\.blob\.core\.windows\.net\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'shared-article-blobs',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          // Cache share code resolution responses
          {
            urlPattern: /\/api\/s\/[A-Za-z0-9]+$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'share-resolve',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60, // 1 hour (matches server Cache-Control)
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
