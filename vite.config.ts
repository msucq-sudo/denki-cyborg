import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  test: { environment: 'node', globals: true, include: ['src/**/*.test.ts'] },
});