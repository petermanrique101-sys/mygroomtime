import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // why: injectManifest gives us a custom service worker file. Chunk 18 needs a SW so
      // it can register Background Sync for offline-queue replay where supported (Chrome,
      // Edge). Safari/Firefox don't support Background Sync so the foreground replay path
      // is the fallback.
      strategies: 'injectManifest',
      injectRegister: 'auto',
      registerType: 'autoUpdate',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: 'MyGroomTime',
        short_name: 'GroomTime',
        description: 'Mobile groomer scheduling, on the phone.',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/calendar',
        icons: [],
      },
      devOptions: {
        // why: keep the SW disabled in dev by default so HMR isn't fighting it. Set to
        // true when running an explicit offline-simulation pass.
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
});
