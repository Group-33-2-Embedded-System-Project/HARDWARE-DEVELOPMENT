import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    strategies: 'injectManifest',
    srcDir: 'src',
    filename: 'service-worker.js',
    manifest: {
      name: 'Coop Guard', short_name: 'Coop Guard',
      description: 'Live smart coop predator deterrent controls and alerts.',
      theme_color: '#113529', background_color: '#f5f6ef', display: 'standalone', start_url: '/',
      icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
    },
  })],
});
