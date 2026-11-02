// The game's road graph lives here, off the main thread: read once, then asked for drives.

import { findRouteVia, readGraph, type Graph, type NavRoute } from './nav';

export type NavRequest =
  | { type: 'graph'; buf: ArrayBuffer }
  | { type: 'route'; id: number; x: number; z: number; heading: number; tx: number; tz: number; via?: Array<[number, number]> };

export type NavResponse =
  | { type: 'ready'; nodes: number; roads: number }
  | { type: 'error'; error: string }
  | { type: 'route'; id: number; route: NavRoute | null; ms: number; error?: string };

let graph: Graph | null = null;
const reply = (msg: NavResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<NavRequest>) => {
  const m = e.data;
  if (m.type === 'graph') {
    try {
      graph = readGraph(m.buf);
      reply({ type: 'ready', nodes: graph.nodes, roads: graph.roads });
    } catch (err) {
      reply({ type: 'error', error: String(err) });
    }
    return;
  }
  if (!graph) {
    reply({ type: 'route', id: m.id, route: null, ms: 0, error: 'no graph' });
    return;
  }
  const t0 = performance.now();
  try {
    const route = findRouteVia(graph, m.x, m.z, m.heading, [...(m.via ?? []), [m.tx, m.tz]]);
    reply({ type: 'route', id: m.id, route, ms: performance.now() - t0 }, route ? [route.world.buffer, route.cum.buffer] : []);
  } catch (err) {
    reply({ type: 'route', id: m.id, route: null, ms: performance.now() - t0, error: String(err) });
  }
};
