import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev proxy: all /api/* requests are forwarded to the backend on localhost:5000.
    // This means the browser always calls the same origin (localhost:5173) so there
    // are zero CORS issues in development regardless of what VITE_API_URL is set to.
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
