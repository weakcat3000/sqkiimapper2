import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import pkg from './package.json' with { type: 'json' };

let gitSha = '';
try {
  gitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  gitSha = '';
}

const appVersion = gitSha ? `v${pkg.version}-${gitSha}` : `v${pkg.version}`;
const basePath = process.env.VITE_BASE_PATH || '/sqkiimapper2/';

export default defineConfig({
  base: basePath,
  publicDir: 'public',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
