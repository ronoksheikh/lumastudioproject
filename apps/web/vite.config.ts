import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import type { PluginOption } from 'vite';

// In development the API runs on :8080 with APP_ORIGIN=http://localhost:5180 (see .env.example),
// so cookies, CSRF and the Origin check all line up behind this proxy.
export default defineConfig({
  plugins: [react(), tailwindcss()] as PluginOption[],
  server: { port: 5180, proxy: { '/api': 'http://localhost:8080' } },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  worker: { format: 'es' },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], css: false, globals: false },
});
