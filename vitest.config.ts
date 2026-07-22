import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
  },
  // The published component package references source maps that are not shipped.
  logLevel: 'error',
  plugins: [
    {
      name: 'resolve-create-figma-plugin-css',
      enforce: 'pre',
      async resolveId(source, importer) {
        if (!source.startsWith('!') || !source.endsWith('.css')) {
          return null;
        }

        return this.resolve(source.slice(1), importer, { skipSelf: true });
      },
    },
  ],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    server: {
      deps: {
        inline: [/@create-figma-plugin\/ui/],
      },
    },
  },
});
