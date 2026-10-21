/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  // numer wersji z package.json, pokazywany w nagłówku aplikacji
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 5173,
    proxy: { '/api/': 'http://localhost:3000' },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  test: {
    root: '.',
    include: ['src/**/*.test.ts'],
  },
});
