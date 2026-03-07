import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Order matters: more specific paths must come before less specific ones
      { find: '@excalidraw/excalidraw/index.css', replacement: path.resolve(__dirname, './src/test/__mocks__/empty.js') },
      { find: '@excalidraw/excalidraw', replacement: path.resolve(__dirname, './src/test/__mocks__/excalidraw.jsx') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
    css: false,
    fileParallelism: false,
  },
});
