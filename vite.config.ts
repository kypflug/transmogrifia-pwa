import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Dev-only Vite plugin that handles /api/google-token requests inline,
 * injecting GOOGLE_CLIENT_SECRET from .env so no separate Azure Functions
 * host is needed during local development.
 */
function googleTokenProxy(): Plugin {
  let clientSecret = '';

  return {
    name: 'google-token-proxy',
    apply: 'serve',
    configResolved(config) {
      // loadEnv reads .env files; the '' prefix means load ALL vars (not just VITE_)
      const env = loadEnv(config.mode, config.root, '');
      clientSecret = env.GOOGLE_CLIENT_SECRET || '';
      if (!clientSecret) {
        config.logger.warn('[google-token-proxy] GOOGLE_CLIENT_SECRET not set in .env — Google sign-in will fail locally');
      }
    },
    configureServer(server) {
      server.middlewares.use('/api/google-token', async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'method_not_allowed' }));
          return;
        }
        if (!clientSecret) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'server_error', error_description: 'GOOGLE_CLIENT_SECRET not set in .env' }));
          return;
        }

        // Read request body
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        let body: Record<string, string>;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_request' }));
          return;
        }

        // Build form body for Google
        const params = new URLSearchParams();
        params.set('client_id', '896663119069-nq0ur8ed7c7td44v6o29gu3qdr9t1un7.apps.googleusercontent.com');
        params.set('client_secret', clientSecret);
        params.set('grant_type', body.grant_type);
        if (body.grant_type === 'authorization_code') {
          if (body.code) params.set('code', body.code);
          if (body.redirect_uri) params.set('redirect_uri', body.redirect_uri);
          if (body.code_verifier) params.set('code_verifier', body.code_verifier);
        } else if (body.grant_type === 'refresh_token') {
          if (body.refresh_token) params.set('refresh_token', body.refresh_token);
        }

        // Forward to Google
        const googleRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params,
        });
        const googleBody = await googleRes.text();

        res.writeHead(googleRes.status, { 'Content-Type': 'application/json' });
        res.end(googleBody);
      });
    },
  };
}

export default defineConfig({
  plugins: [
    googleTokenProxy(),
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
  server: {
    proxy: {
      // Proxy cloud API requests to avoid CORS issues during local development
      '/api': {
        target: 'https://transmogrifier-api.azurewebsites.net',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
