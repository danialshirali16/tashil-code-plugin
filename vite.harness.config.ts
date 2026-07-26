import { defineConfig } from 'vite';

/**
 * Dev server for the plugin UI harness (`dev/harness`). Not part of the plugin
 * build: it only swaps the Figma message bus for a local stand-in so the real
 * UI can be opened, clicked and screenshotted in a browser.
 */
export default defineConfig({
  esbuild: { jsxFactory: 'h', jsxFragment: 'Fragment' },
  plugins: [
    {
      // The plugin build addresses its CSS with a leading `!`; strip it so vite
      // can resolve the same imports.
      enforce: 'pre',
      name: 'resolve-create-figma-plugin-css',
      async resolveId(source, importer) {
        if (!source.startsWith('!') || !source.endsWith('.css')) {
          return null;
        }
        return this.resolve(source.slice(1), importer, { skipSelf: true });
      },
    },
  ],
  // The component library imports its CSS as `!../css/base.css`; esbuild's
  // pre-bundling cannot resolve that, so let vite process it with the plugin
  // above instead.
  optimizeDeps: { exclude: ['@create-figma-plugin/ui'] },
  resolve: {
    alias: {
      '@create-figma-plugin/utilities': '/dev/harness/fake-bus.ts',
    },
  },
  // Root stays the repo so `/dev/harness/*` and `/node_modules/*` resolve.
  server: { open: '/dev/harness/index.html', port: 5178 },
});
