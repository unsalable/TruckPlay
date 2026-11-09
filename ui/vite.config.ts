import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TileServer } from '../shared/pmtiles.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// In the game the host serves map tiles over IPC; on the desktop dev server they come from here.
function mapTiles(): Plugin {
  const tiles = new TileServer(path.resolve(here, '../map/data'), 'tirplay://');
  return {
    name: 'tirplay-map-tiles',
    configureServer(server) {
      server.middlewares.use('/map/', (req, res) => {
        if (req.url === '/worker.mjs') {
          res.setHeader('Content-Type', 'text/javascript');
          res.end(readFileSync(path.resolve(here, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs')));
          return;
        }
        void tiles.handle(decodeURIComponent((req.url ?? '').slice(1).split('?')[0])).then(r => {
          res.statusCode = r.status;
          if (r.type) res.setHeader('Content-Type', r.type);
          res.setHeader('Cache-Control', 'no-cache');
          res.end(r.body ? Buffer.from(r.body) : undefined);
        });
      });
    },
  };
}

// The host loads the built UI from disk (file://), so assets must be relative.
export default defineConfig({
  base: './',
  plugins: [react(), mapTiles()],
  // Polling: native file events go missing for this folder on Windows.
  server: { port: 5299, strictPort: true, fs: { allow: ['..'] }, watch: { usePolling: true, interval: 250 } },
  build: {
    target: 'chrome140',
    outDir: 'dist',
    assetsInlineLimit: 0,
    // Two pages: the cab screen and the HUD the host draws in a window of its own.
    rolldownOptions: { input: { main: path.resolve(here, 'index.html') } },
  },
});
