import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, host: true },
  build: {
    target: 'es2022',
    // three.js and globe.gl dominate the bundle; splitting them keeps the app
    // chunk small enough to iterate on without re-shipping the renderer.
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          /node_modules[\\/](globe\.gl|three|three-globe)[\\/]/.test(id) ? 'globe' : undefined,
      },
    },
  },
});
