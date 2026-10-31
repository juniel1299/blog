import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tistory serves skin assets from ./images/ and needs stable names, so build as a single IIFE
// with fixed file names. skin.html / index.xml live in tistory/ and are copied verbatim so
// Tistory substitution tags ([##_..._##], <s_...>) are never touched by the bundler.
export default defineConfig({
  plugins: [react()],
  // Preact's React-compatible layer: same widget code, ~1/4 of React's size in the bundle.
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom/client': 'preact/compat/client',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
  publicDir: 'tistory',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist/tistory',
    emptyOutDir: true,
    lib: {
      entry: 'src/main.js',
      formats: ['iife'],
      name: 'TistorySkin',
      fileName: () => 'images/script.js',
      cssFileName: 'style',
    },
  },
  server: { port: 5173, strictPort: true },
  test: { environment: 'jsdom' },
});
