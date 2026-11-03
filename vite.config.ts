import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages (/morphing-game/) and locally.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
