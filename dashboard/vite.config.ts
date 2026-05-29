import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/events':       'http://localhost:3444',
      '/api':          'http://localhost:3444',
    },
  },
});
