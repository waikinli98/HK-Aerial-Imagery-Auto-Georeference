import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command }) => ({
  // Served from a GitHub Pages project site at
  // https://waikinli98.github.io/HK-Aerial-Imagery-Auto-Georeference/ — built
  // asset URLs must be prefixed with the repo name. Dev/preview stays at '/'.
  base: command === 'build' ? '/HK-Aerial-Imagery-Auto-Georeference/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5178,
  },
}));
