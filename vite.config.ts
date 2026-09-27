import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works at https://<user>.github.io/neon-swarm/.
  base: './',
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 900 },
  test: { include: ['tests/**/*.test.ts'] },
});
