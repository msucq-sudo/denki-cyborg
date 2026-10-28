import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: { main: 'index.html', bestiary: 'bestiary.html', spark: 'spark.html', lab: 'lab.html', map: 'map.html', sfx: 'sfx.html', stats: 'stats.html' },
    },
  },
  test: { environment: 'node', globals: true, include: ['src/**/*.test.ts'] },
});
