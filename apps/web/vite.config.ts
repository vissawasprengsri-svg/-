import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Rewrites index.html's own <link> tags and swaps the service worker in
      // on every deploy without asking — right for a single-user finance app
      // where "the tab you left open yesterday is running stale code" is a
      // worse outcome than an unprompted refresh.
      registerType: 'autoUpdate',
      manifest: {
        name: 'บัญชีเงินผม',
        short_name: 'บัญชีเงินผม',
        description: 'แอปติดตามรายรับ-รายจ่าย เงินสำรองจ่าย และเงินให้ยืม',
        // Matches --blueprint, the navy already used for the header mark and
        // primary buttons — the PWA install icon/splash and the in-app chrome
        // read as the same product instead of two different shades of blue.
        theme_color: '#1B4965',
        background_color: '#F1F4F7',
        display: 'standalone',
        start_url: '/',
        lang: 'th',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
