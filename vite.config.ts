import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLEFILE=1 builds a single self-contained HTML file (catalog and meshes inlined).
// base './': relative paths, so the build runs under any URL, including GitHub Pages (https://<user>.github.io/<repo>/).
const single = process.env.SINGLEFILE === '1';

export default defineConfig({
  base: './',
  plugins: single ? [viteSingleFile()] : [],
  // DEV_UI=1 enables developer-only UI (per-level 3MF export, toggle for unreleased parts, no MakerWorld key required)
  define: { __SINGLEFILE__: JSON.stringify(single), __DEV_UI__: JSON.stringify(process.env.DEV_UI === '1') },
  // public/ is not copied to the output.
  publicDir: false,
  build: {
    outDir: single ? 'dist-single' : 'dist',
    target: 'es2020',
    assetsInlineLimit: single ? 100_000_000 : 4096,
    chunkSizeWarningLimit: 2000,
  },
});
