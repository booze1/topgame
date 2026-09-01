import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client is served in production by the same Node process that runs the
// game server (see src/server/index.ts), so the build lands in dist/client and
// dev proxies the websocket through to the dev server on PORT.
const SERVER_PORT = Number(process.env.PORT ?? 8787);

export default defineConfig({
  root: 'src/client',
  publicDir: '../../public',
  plugins: [react()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: `ws://localhost:${SERVER_PORT}`, ws: true },
      '/api': { target: `http://localhost:${SERVER_PORT}` },
    },
  },
});
