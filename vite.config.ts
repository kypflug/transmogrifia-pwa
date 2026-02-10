import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
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
        theme_color: '#0078D4',
        background_color: '#FAFAFA',
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
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
