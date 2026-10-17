import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.OMNI_API ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // доступ с телефона в локальной сети: http://<ip-компьютера>:5173
    port: 5173,
    proxy: {
      // Host не меняем: сервер сверяет Origin с Host (защита от CSRF)
      '/api': { target: API, ws: true, changeOrigin: false },
    },
  },
  preview: { port: 4173, proxy: { '/api': { target: API, ws: true, changeOrigin: false } } },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client', 'react-router'],
          query: ['@tanstack/react-query', 'zustand'],
          zod: ['zod'],
          icons: ['lucide-react'],
        },
      },
    },
  },
});
