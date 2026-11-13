import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri expects a fixed port and doesn't need the browser opened.
  server: { port: 5199, strictPort: true },
  clearScreen: false,
  build: { target: 'es2022', sourcemap: true },
});
