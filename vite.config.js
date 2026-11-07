import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Avoid automatic reloads when the tab regains focus and a new SW is available.
      // With `prompt`, updates are downloaded but only applied after an explicit refresh.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'X Thread Draft Tool',
        short_name: 'Thread Draft',
        description: 'Compose, manage, and export Twitter/X threads with ease',
        theme_color: '#1da1f2',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // Serverless API responses (drafts, auth, one-time share links) are always live.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly'
          }
        ],
        // Without this, the service worker serves index.html for /api/auth/login and breaks sign-in
        // in an installed PWA.
        navigateFallbackDenylist: [/^\/api\//, /^\/llms\.txt$/]
      }
    })
  ],
  server: {
    port: 5173,
    open: true,
    // With `npm run dev:api` running, the app talks to the local API on the same origin
    proxy: {
      '/api': 'http://127.0.0.1:8787'
    }
  }
})
