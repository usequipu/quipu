import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import type { OutputAsset, OutputChunk } from 'rollup';

export default defineConfig({
  root: __dirname,
  plugins: [
    react(),
    // Inject all extracted CSS back into the JS bundle so output is a single file
    {
      name: 'css-inject',
      apply: 'build' as const,
      enforce: 'post' as const,
      generateBundle(_opts: unknown, bundle: Record<string, OutputAsset | OutputChunk>) {
        const cssChunks = Object.values(bundle).filter(
          (c): c is OutputAsset => c.type === 'asset' && c.fileName.endsWith('.css'),
        );
        const jsEntry = Object.values(bundle).find(
          (c): c is OutputChunk => c.type === 'chunk' && c.isEntry,
        );
        if (!cssChunks.length || !jsEntry) return;
        const css = cssChunks.map((c) => String(c.source)).join('\n');
        const escaped = JSON.stringify(css);
        jsEntry.code =
          `(function(){var s=document.createElement('style');s.textContent=${escaped};document.head.appendChild(s);})();\n` +
          jsEntry.code;
        for (const c of cssChunks) delete bundle[c.fileName];
      },
    },
  ],
  resolve: {
    alias: {},
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.tsx'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: path.resolve(__dirname, '../../dist-plugins/pdf-plugin'),
    emptyOutDir: true,
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
    cssCodeSplit: false,
    minify: false,
  },
});
