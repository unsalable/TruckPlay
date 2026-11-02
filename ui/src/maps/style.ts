// The game's map in Apple Maps' clothes: warm paper land, white streets with soft casings,
// marigold motorways, blue water, quiet labels in Inter. Night is the dark driving map —
// graphite land, inky water, gold-brown motorways. Road widths follow the game's real road
// widths from street level up, so lines meet the junction shapes (prefabs) exactly.
//
// `u` is one UI point in pixels (screen height / 480): label sizes and the thin lines of the
// zoomed-out map scale with the screen like the rest of TırPlay.

import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { MAP_FONT } from './mapFonts';
import { MAP_SCHEME } from './source';

export type MapTheme = 'light' | 'dark';

interface Palette {
  land: string;
  water: string;
  park: string;
  urban: string;
  urbanDark: string;
  surface: string;
  surfaceEdge: string;
  building: string;
  buildingSide: string;
  local: [string, string];
  divided: [string, string];
  freeway: [string, string];
  rail: string;
  ferry: string;
  border: string;
  label: string;
  label2: string;
  halo: string;
  route: [string, string];
}

const PALETTES: Record<MapTheme, Palette> = {
  light: {
    land: '#f3f1ec',
    water: '#a6d0f3',
    park: '#cde6c0',
    urban: '#ebe8e1',
    urbanDark: '#e3dfd6',
    surface: '#ffffff',
    surfaceEdge: '#d8d3c8',
    building: '#e4e0d8',
    buildingSide: '#e9e5dd',
    local: ['#ffffff', '#d7d2c7'],
    divided: ['#ffffff', '#cbc5b8'],
    freeway: ['#fbd474', '#e0a645'],
    rail: '#c8c3b9',
    ferry: '#6ea5d8',
    border: '#a59eb8',
    label: '#1d1d1f',
    label2: '#6e6e73',
    halo: 'rgba(255, 255, 255, 0.92)',
    route: ['#1f8bff', '#0b62d6'],
  },
  dark: {
    land: '#1d1f23',
    water: '#0e2134',
    park: '#1b2a21',
    urban: '#23262b',
    urbanDark: '#292c32',
    surface: '#3a3d44',
    surfaceEdge: '#2b2e33',
    building: '#2b2e34',
    buildingSide: '#33363d',
    local: ['#3b3e45', '#292b30'],
    divided: ['#4b4e56', '#2d2f34'],
    freeway: ['#a78645', '#57451f'],
    rail: '#3d4046',
    ferry: '#3d6d9a',
    border: '#5f5a72',
    label: '#f2f2f7',
    label2: '#a1a1a6',
    halo: 'rgba(0, 0, 0, 0.72)',
    route: ['#3d9cff', '#0a58c9'],
  },
};

/** POI kinds TırPlay draws its own icons for (see icons.ts). */
export const POI_KIND: ExpressionSpecification = [
  'match',
  ['get', 'sprite'],
  'gas_ico', 'fuel',
  'parking_ico', 'parking',
  'service_ico', 'service',
  'garage_large_ico', 'garage',
  'dealer_ico', 'dealer',
  'recruitment_ico', 'recruit',
  'weigh_station_ico', 'weigh',
  'weigh_ico', 'weigh',
  'toll_ico', 'toll',
  'border_ico', 'border',
  'photo_sight_captured', 'photo',
  'viewpoint', 'view',
  'port_overlay', 'ferry',
  'train_ico', 'train',
  ['match', ['get', 'poiType'], 'company', 'company', ''],
];

const ROAD_FACILITIES = ['toll_ico', 'border_ico', 'weigh_ico', 'quarry'];

// Real width in pixels for a road `metres` wide in the game: 1 game metre is drawn as 19.23
// map metres; at 45°N MapLibre's zoom z is 78 271.5·cos45°/2^z map metres per pixel.
const realPx = (metres: number, z: number) => metres * 2 ** z * 3.474e-4;

function roadWidth(metres: number, lowZoom: Array<[number, number]>, u: number): ExpressionSpecification {
  const stops: number[] = [];
  for (const [z, w] of lowZoom) stops.push(z, w * u);
  stops.push(10, Math.max(realPx(metres, 10), (lowZoom.at(-1)?.[1] ?? 0) * u * 1.05), 18, realPx(metres, 18));
  return ['interpolate', ['exponential', 2], ['zoom'], ...stops] as ExpressionSpecification;
}

const isRoad = (cls: string[]): ExpressionSpecification => [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  ['==', ['get', 'type'], 'road'],
  ['!=', ['get', 'hidden'], true],
  ['in', ['get', 'roadType'], ['literal', cls]],
];

const areaColor = (p: Palette): ExpressionSpecification => [
  'match',
  ['get', 'color'],
  0, p.surface,
  1, p.urban,
  2, p.urbanDark,
  3, p.park,
  p.urban,
];

export interface MapLook {
  /** Tilted 3D view: buildings rise, a sky meets the horizon. */
  view3d: boolean;
  buildings: boolean;
  /** Kinds of places to show (POI_KIND values); all when absent. */
  pois?: string[];
}

/** The kinds of places the driver can switch on and off (Settings › Maps), in that order. */
export const MAP_POI_GROUPS: Array<{ id: string; kinds: string[] }> = [
  { id: 'service', kinds: ['service'] },
  { id: 'fuel', kinds: ['fuel'] },
  { id: 'parking', kinds: ['parking'] },
  { id: 'garage', kinds: ['garage'] },
  { id: 'dealer', kinds: ['dealer'] },
  { id: 'recruit', kinds: ['recruit'] },
  { id: 'company', kinds: ['company'] },
  { id: 'transport', kinds: ['ferry', 'train'] },
  { id: 'road', kinds: ['toll', 'border', 'weigh'] },
  { id: 'sights', kinds: ['photo', 'view'] },
];

/** The POI kinds a settings map switches on (everything unless switched off). */
export function enabledPoiKinds(groups: Record<string, boolean>): string[] {
  return MAP_POI_GROUPS.filter(g => groups[g.id] !== false).flatMap(g => g.kinds);
}

// Apple Maps' 3D sky: a clear gradient by day, deep blue at night, both fading into a haze at the
// horizon so the far map dissolves instead of ending in a hard edge.
const SKY: Record<MapTheme, NonNullable<StyleSpecification['sky']>> = {
  light: {
    'sky-color': '#6fa8ee',
    'horizon-color': '#d9e8f8',
    'fog-color': '#ece9e2',
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.55,
    'fog-ground-blend': 0.4,
    'atmosphere-blend': 0,
  },
  dark: {
    'sky-color': '#050b1a',
    'horizon-color': '#1b2742',
    'fog-color': '#1d1f23',
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.6,
    'fog-ground-blend': 0.4,
    'atmosphere-blend': 0,
  },
};

export function mapStyle(theme: MapTheme, u: number, names: Record<string, string> = {}, look: MapLook = { view3d: true, buildings: true }): StyleSpecification {
  const p = PALETTES[theme];
  const shown = (kinds: string[]) => (look.pois ? kinds.filter(k => look.pois!.includes(k)) : kinds);
  const cityName: ExpressionSpecification = ['coalesce', ['get', ['get', 'name'], ['literal', names]], ['get', 'name']];
  const text = (size: number) => size * u;
  const roads: Array<{ id: string; cls: string[]; metres: number; low: Array<[number, number]>; colors: [string, string]; minzoom: number }> = [
    { id: 'local', cls: ['local', 'unknown'], metres: 9, low: [[8.5, 0.35], [9.5, 0.8]], colors: p.local, minzoom: 8.5 },
    { id: 'divided', cls: ['divided'], metres: 15, low: [[6, 0.45], [8, 1.0], [9.5, 1.6]], colors: p.divided, minzoom: 6 },
    { id: 'freeway', cls: ['freeway'], metres: 20, low: [[4, 0.7], [6, 1.2], [8, 2.0], [9.5, 2.8]], colors: p.freeway, minzoom: 4 },
  ];

  const layers: LayerSpecification[] = [
    { id: 'land', type: 'background', paint: { 'background-color': p.land } },
    { id: 'water', type: 'fill', source: 'world', 'source-layer': 'water', paint: { 'fill-color': p.water, 'fill-antialias': true } },
    {
      id: 'areas',
      type: 'fill',
      source: 'game',
      'source-layer': 'ets2',
      minzoom: 7,
      filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['in', ['get', 'type'], ['literal', ['mapArea', 'prefab']]], ['!=', ['get', 'color'], 0]],
      layout: { 'fill-sort-key': ['coalesce', ['get', 'zIndex'], 0] },
      paint: { 'fill-color': areaColor(p), 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0, 8.5, 1] },
    },
    {
      id: 'buildings',
      type: 'fill',
      source: 'footprints',
      'source-layer': 'footprints',
      minzoom: 11.5,
      paint: { 'fill-color': p.building, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0, 12.5, 1] },
    },
    {
      id: 'borders',
      type: 'line',
      source: 'world',
      'source-layer': 'countries',
      filter: ['!=', ['get', 'name'], 'Serbia-Kosovo'],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': p.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8 * u, 9, 1.4 * u], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 1, 11, 0.4] },
    },
    {
      id: 'ferries',
      type: 'line',
      source: 'game',
      'source-layer': 'ets2',
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'type'], 'ferry']],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': p.ferry, 'line-width': 1.2 * u, 'line-dasharray': [2, 2.5] },
    },
    {
      id: 'rail',
      type: 'line',
      source: 'game',
      'source-layer': 'ets2',
      minzoom: 9,
      filter: isRoad(['train']),
      paint: { 'line-color': p.rail, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6 * u, 14, 2 * u] },
    },
  ];

  // Casings under everything, then the junction surfaces over the casing ends, then the road fills.
  for (const r of roads) {
    layers.push({
      id: `${r.id}-case`,
      type: 'line',
      source: 'game',
      'source-layer': 'ets2',
      minzoom: Math.max(r.minzoom, 9),
      filter: isRoad(r.cls),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': r.colors[1],
        'line-gap-width': roadWidth(r.metres, r.low, u),
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5 * u, 13, 1.1 * u, 16, 2 * u],
      },
    });
  }
  layers.push({
    id: 'junctions',
    type: 'fill',
    source: 'game',
    'source-layer': 'ets2',
    minzoom: 9,
    filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['in', ['get', 'type'], ['literal', ['mapArea', 'prefab']]], ['==', ['get', 'color'], 0]],
    paint: { 'fill-color': p.surface, 'fill-outline-color': p.surfaceEdge },
  });
  for (const r of roads) {
    layers.push({
      id: r.id,
      type: 'line',
      source: 'game',
      'source-layer': 'ets2',
      minzoom: r.minzoom,
      filter: isRoad(r.cls),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': r.colors[0], 'line-width': roadWidth(r.metres, r.low, u) },
    });
  }

  layers.push(
    // The route lies on the road, under the buildings it passes behind.
    {
      id: 'route-case',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.route[1], 'line-width': ['interpolate', ['exponential', 1.7], ['zoom'], 5, 4.4 * u, 10, 7 * u, 12.5, 13 * u, 14, 24 * u, 16, 60 * u] },
    },
    {
      id: 'route',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.route[0], 'line-width': ['interpolate', ['exponential', 1.7], ['zoom'], 5, 3 * u, 10, 5 * u, 12.5, 10 * u, 14, 19 * u, 16, 50 * u] },
    },
  );
  // 3D buildings rise out of their footprints as the camera comes down (heights are the game's,
  // scaled like everything else on this map).
  if (look.view3d && look.buildings) {
    layers.push({
      id: 'buildings-3d',
      type: 'fill-extrusion',
      source: 'footprints',
      'source-layer': 'footprints',
      minzoom: 12.2,
      paint: {
        'fill-extrusion-color': theme === 'light' ? '#f3f1ec' : '#363b44',
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 12.2, 0, 13.1, ['*', 19, ['coalesce', ['get', 'height'], 5]]],
        'fill-extrusion-opacity': theme === 'light' ? 0.94 : 0.92,
        'fill-extrusion-vertical-gradient': true,
      },
    });
  }
  layers.push(
    {
      id: 'shields',
      type: 'symbol',
      source: 'game',
      'source-layer': 'ets2',
      minzoom: 7,
      filter: ['all', ['==', ['get', 'type'], 'poi'], ['==', ['get', 'poiType'], 'road'], ['!', ['in', ['get', 'sprite'], ['literal', ROAD_FACILITIES]]]],
      layout: {
        'icon-image': ['concat', 'shield:', ['get', 'sprite']],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.82, 11, 1],
        'icon-padding': 6 * u,
        'symbol-sort-key': ['case', ['>=', ['index-of', '_e', ['get', 'sprite']], 0], 0, 1],
      },
    },
    // Points of interest appear the closer you get, the way Apple Maps reveals them; what a
    // trucker needs on the road (service, fuel, rest, garages) shows from further out and wins
    // when labels crowd (later layers are placed first).
    ...[
      poiLayer('pois-sights', shown(['recruit', 'photo', 'view']), 11.5, 12.5, p, theme, u),
      poiLayer('pois-company', shown(['company']), 12, 12.6, p, theme, u),
      poiLayer('pois-road', shown(['dealer', 'weigh']), 11, 12.5, p, theme, u),
      poiLayer('pois-transport', shown(['ferry', 'train', 'toll', 'border']), 9.5, 11, p, theme, u),
      poiLayer('pois-parking', shown(['parking']), 10.5, 13, p, theme, u, 1.05),
      poiLayer('pois-truck', shown(['service', 'fuel', 'garage']), 9, 12, p, theme, u, 1.15),
    ].filter(l => l !== null),
    ...(look.pois && !look.pois.includes('garage')
      ? []
      : [
          ({
            id: 'pois-owned',
            type: 'symbol',
            source: 'owned',
            minzoom: 6,
            layout: {
              'icon-image': 'poi:garage-owned',
              'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.85, 14, 1.25],
              'icon-allow-overlap': true,
              'text-field': ['step', ['zoom'], '', 11, ['get', 'label']],
              'text-font': [MAP_FONT.semibold],
              'text-size': 10.5 * u,
              'text-offset': [0, 1.45],
              'text-anchor': 'top',
              'text-optional': true,
            },
            paint: { 'text-color': theme === 'light' ? '#a26f00' : '#ffcc33', 'text-halo-color': p.halo, 'text-halo-width': 1.2 * u },
          } as LayerSpecification),
        ]),
    {
      id: 'cities-small',
      type: 'symbol',
      source: 'game',
      'source-layer': 'ets2',
      minzoom: 7,
      maxzoom: 13,
      filter: ['all', ['==', ['get', 'type'], 'city'], ['>', ['get', 'scaleRank'], 6]],
      layout: { 'text-field': cityName, 'text-font': [MAP_FONT.medium], 'text-size': text(12), 'text-padding': 4 * u },
      paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.4 * u },
    },
    {
      id: 'cities-medium',
      type: 'symbol',
      source: 'game',
      'source-layer': 'ets2',
      minzoom: 5.5,
      maxzoom: 13,
      filter: ['all', ['==', ['get', 'type'], 'city'], ['<=', ['get', 'scaleRank'], 6], ['>', ['get', 'scaleRank'], 3]],
      layout: { 'text-field': cityName, 'text-font': [MAP_FONT.semibold], 'text-size': text(13.5), 'text-padding': 4 * u },
      paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.5 * u },
    },
    {
      id: 'cities-big',
      type: 'symbol',
      source: 'game',
      'source-layer': 'ets2',
      minzoom: 4,
      maxzoom: 13,
      filter: ['all', ['==', ['get', 'type'], 'city'], ['<=', ['get', 'scaleRank'], 3]],
      layout: { 'text-field': cityName, 'text-font': [MAP_FONT.bold], 'text-size': ['interpolate', ['linear'], ['zoom'], 4, text(13), 8, text(16)], 'text-padding': 4 * u },
      paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.6 * u },
    },
    {
      id: 'countries',
      type: 'symbol',
      source: 'game',
      'source-layer': 'ets2',
      maxzoom: 6.5,
      filter: ['==', ['get', 'type'], 'country'],
      layout: {
        'text-field': ['upcase', ['get', 'name']],
        'text-font': [MAP_FONT.semibold],
        'text-size': text(11),
        'text-letter-spacing': 0.16,
        'text-max-width': 6,
      },
      paint: { 'text-color': p.label2, 'text-halo-color': p.halo, 'text-halo-width': 1.2 * u },
    },
  );

  return {
    version: 8,
    name: `TırPlay ${theme}`,
    ...(look.view3d ? { sky: SKY[theme] } : {}),
    light: { anchor: 'map', color: '#ffffff', intensity: theme === 'light' ? 0.45 : 0.3, position: [1.25, 210, 38] },
    sources: {
      game: { type: 'vector', url: `${MAP_SCHEME}://tiles/ets2.json` },
      world: { type: 'vector', url: `${MAP_SCHEME}://tiles/world.json` },
      footprints: { type: 'vector', url: `${MAP_SCHEME}://tiles/ets2-footprints.json` },
      route: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      // The player's own garages (from the save), placed by GameMap on the garages of the tiles.
      owned: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers,
  };
}

const POI_TEXT: Record<string, [string, string]> = {
  fuel: ['#2f7cf6', '#5aa0ff'],
  company: ['#8a6a45', '#c9a37a'],
  garage: ['#5e5ce6', '#8e8cff'],
  dealer: ['#d97400', '#ffa64d'],
};

function poiLayer(id: string, kinds: string[], minzoom: number, labelFrom: number, p: Palette, theme: MapTheme, u: number, scale = 1): LayerSpecification | null {
  if (!kinds.length) return null;
  const color: ExpressionSpecification = ['match', POI_KIND, ...Object.entries(POI_TEXT).flatMap(([k, c]) => [k, c[theme === 'light' ? 0 : 1]]), p.label2] as ExpressionSpecification;
  return {
    id,
    type: 'symbol',
    source: 'game',
    'source-layer': 'ets2',
    minzoom,
    filter: ['all', ['==', ['get', 'type'], 'poi'], ['in', POI_KIND, ['literal', kinds]]],
    layout: {
      'icon-image': ['concat', 'poi:', POI_KIND],
      'icon-size': ['interpolate', ['linear'], ['zoom'], minzoom, 0.78 * scale, 14, scale],
      'icon-padding': 4 * u,
      'text-field': ['step', ['zoom'], '', labelFrom, ['coalesce', ['get', 'poiName'], '']],
      'text-font': [MAP_FONT.semibold],
      'text-size': 10.5 * u,
      'text-offset': [0, 1.3],
      'text-anchor': 'top',
      'text-optional': true,
      'text-max-width': 8,
    },
    paint: { 'text-color': color, 'text-halo-color': p.halo, 'text-halo-width': 1.2 * u },
  };
}

export function themeColors(theme: MapTheme) {
  return PALETTES[theme];
}
