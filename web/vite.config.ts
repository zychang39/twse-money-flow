import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { configYaml } from './build/config-yaml.ts';
import { serviceWorker } from './build/service-worker.ts';
import { fontPreload } from './build/font-preload.ts';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: '/twse-money-flow/',
  plugins: [configYaml(), preact(), serviceWorker(), fontPreload()],
  resolve: {
    // 自託管 Inter（數字與英文）；只打包 CSS 實際引用的拉丁子集
    alias: { '@inter': fileURLToPath(new URL('./node_modules/@fontsource-variable/inter/files', import.meta.url)) },
  },
  server: { fs: { allow: ['..'] } },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 400,
  },
  worker: { format: 'es', plugins: () => [configYaml()] },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
