import { defineConfig } from 'vite';

export default defineConfig({
  base: '/sqkiimapper2/',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
