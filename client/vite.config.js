import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    target: 'es2022', // required for top-level await
  },
  server: {
    port: 5173,
  },
});
