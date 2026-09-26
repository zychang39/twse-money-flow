import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { configYaml } from './build/config-yaml.ts';
import { serviceWorker } from './build/service-worker.ts';

export default defineConfig({
  base: '/twse-money-flow/',
  plugins: [configYaml(), preact(), serviceWorker()],
  server: { fs: { allow: ['..'] } },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 400,
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
