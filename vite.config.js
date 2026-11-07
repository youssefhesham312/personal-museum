import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Three.js changes far less often than the app. A separate vendor
        // chunk keeps repeat visits and app-only deploys cacheable.
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/idb')) return 'idb';
        },
      },
    },
  },
});
