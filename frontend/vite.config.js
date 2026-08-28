import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    // No source maps in production: they would publish readable source and
    // every inline comment to anyone who opens devtools.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Recharts and its d3 dependencies are ~60% of the bundle but are only
        // needed on the dashboard and analytics pages. Splitting them keeps the
        // login and customer screens off the critical path for that weight,
        // and lets the chart chunk stay cached across deploys of app code.
        manualChunks: {
          charts: ['recharts'],
          vendor: ['react', 'react-dom', 'react-router-dom', 'axios'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.js'],
    exclude: ['**/node_modules/**', '**/e2e/**'],
  },
});
