import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import pkg from './package.json' with { type: 'json' };

let gitSha = '';
try {
  gitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  gitSha = '';
}

const appVersion = gitSha ? `v${pkg.version}-${gitSha}` : `v${pkg.version}`;

export default defineConfig({
  base: '/sqkiimapper2/',
  publicDir: 'public',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        htmReplica: resolve(__dirname, 'htm-circle-tool-replica.html'),
      },
    },
  },
});
