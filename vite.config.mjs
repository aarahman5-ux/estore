import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  publicDir: false,
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'public',
    emptyOutDir: false,
    lib: {
      entry: 'src/admin-workspace.tsx',
      name: 'IslandBasketInventory',
      formats: ['iife'],
      fileName: () => 'admin-workspace.js'
    }
  }
});
