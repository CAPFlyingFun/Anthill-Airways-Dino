// Vite build config.
// - `base` must match the GitHub repo name so the game works at
//   https://capflyingfun.github.io/Anthill-Airways-Dino/
// - VitePWA writes the web app manifest + a service worker so the game
//   can be installed to the iPhone home screen and played offline.
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/Anthill-Airways-Dino/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate', // new versions install themselves on next launch
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Anthill Airways',
        short_name: 'Anthill Air',
        description: 'Start as an ant. End up running an airline to an island full of dinosaurs.',
        theme_color: '#2b7a3d',
        background_color: '#7cc35a',
        display: 'fullscreen',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
      },
    }),
  ],
});
