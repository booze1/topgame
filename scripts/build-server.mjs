// Bundles the server to a single ESM file so the production image needs only
// Node and the runtime dependencies that cannot be bundled (ws is pure JS, so
// it bundles cleanly and the image ships without node_modules at all).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  // ws pulls these in behind optional try/catch requires for native speedups.
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
