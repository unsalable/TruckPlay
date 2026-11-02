// Where map data comes from: `tirplay://` URLs in the style are answered by the host over IPC
// (in the game) or by the Vite dev server (on the desktop). Both serve map/data.

import { addProtocol, setWorkerUrl } from 'maplibre-gl';
// The worker is its own self-contained module and must reach the browser untouched: the build
// copies it as a file, the dev server hands it out raw (see vite.config.ts).
import workerAsset from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { host } from '../state/bridge';

export const MAP_SCHEME = 'tirplay';

interface Served {
  status: number;
  body?: Uint8Array;
}

/** A file of map/data (tiles, search index, the road graph), from the host or the dev server. */
export async function load(path: string, signal?: AbortSignal): Promise<Served> {
  if (host) return host.invoke('map:get', path);
  const res = await fetch(`/map/${path}`, { signal });
  return { status: res.status, body: res.status === 200 ? new Uint8Array(await res.arrayBuffer()) : undefined };
}

const toArrayBuffer = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

let installed = false;

export function installMapProtocol() {
  if (installed) return;
  installed = true;
  setWorkerUrl(import.meta.env.DEV ? new URL('/map/worker.mjs', location.href).href : new URL(workerAsset, location.href).href);
  addProtocol(MAP_SCHEME, async (params, abort) => {
    const path = params.url.slice(MAP_SCHEME.length + 3);
    const r = await load(path, abort.signal);
    if (r.status === 204) return { data: new ArrayBuffer(0) };
    if (r.status !== 200 || !r.body) throw new Error(`map data ${path}: ${r.status}`);
    if (params.type === 'json') return { data: JSON.parse(new TextDecoder().decode(r.body)) };
    return { data: toArrayBuffer(r.body) };
  });
}

/** Raw (decompressed) vector tile bytes, for the route planner. Null where the map has none. */
export async function loadTileBytes(archive: string, z: number, x: number, y: number): Promise<ArrayBuffer | null> {
  try {
    const r = await load(`tiles/${archive}/${z}/${x}/${y}`);
    return r.status === 200 && r.body ? toArrayBuffer(r.body) : null;
  } catch {
    return null;
  }
}

/** One of the GeoJSON files next to the tiles (search index). */
export async function loadMapData<T>(file: string): Promise<T | null> {
  try {
    const r = await load(`data/${file}`);
    return r.status === 200 && r.body ? (JSON.parse(new TextDecoder().decode(r.body)) as T) : null;
  } catch {
    return null;
  }
}
