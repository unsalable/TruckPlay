// Where the blue line goes: the game's own route, nothing of TruckPlay's.
//
// With a job, the job's destination, through the waypoints the driver marked on the game's map
// (M); without one, the place marked there. In a convoy the game keeps a separate multiplayer
// route; that one counts there. The marks come from the newest save (the game writes one every few
// minutes, in a convoy too); the game's live "distance to go" says whether it is routing at all
// right now, so a removed mark disappears at once instead of waiting for the next save.

import { createStore } from '../state/store';
import { gameSave } from '../state/save';
import { connection, telemetry } from '../state/telemetry';
import { gameToLngLat, type LngLat } from './projection';
import { mapDestination } from './mapView';
import { cityTable, findDestination, fold, searchIndex } from './places';
import { loadTileBytes } from './source';
import { decodeTile, lngLatToTile } from './mvt';

export interface Target {
  at: LngLat;
  /** Waypoints marked on the game's map to pass on the way, in order. */
  via: LngLat[];
  label: string;
  /** POI kind (company, city…) or 'pin'. */
  kind: string;
  by: 'job' | 'game';
}

/** The game's marked route in effect (single player's or the convoy's): waypoints ahead, the
 *  last is where it ends. Empty while the game routes nowhere. */
export const gameRoute = createStore<LngLat[]>([]);

/** The target in effect (derived; see above). */
export const target = createStore<Target | null>(null);

const SAVE_FRESH = 6 * 3600_000;

const sameTarget = (a: Target | null, b: Target | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.at[0] === b.at[0] &&
    a.at[1] === b.at[1] &&
    a.by === b.by &&
    a.label === b.label &&
    a.via.length === b.via.length &&
    a.via.every((p, i) => p[0] === b.via[i][0] && p[1] === b.via[i][1]));

function recompute() {
  const job = telemetry.get().job;
  const jobDst = mapDestination.get();
  const marks = gameRoute.get();
  let next: Target | null = null;
  if (job.on && jobDst) {
    // Marks left from before (the save trails the game) can be far off the way: a waypoint the
    // route would go well out of its way for is not one the driver has on the route now.
    const from = truckAt();
    const direct = from ? kmBetween(from, jobDst.at) : 0;
    const via = from ? marks.filter(p => kmBetween(from, p) + kmBetween(p, jobDst.at) < direct * 1.6 + 20) : marks;
    next = { at: jobDst.at, via, label: jobDst.label, kind: jobDst.exact ? 'company' : 'city', by: 'job' };
  } else if (marks.length) {
    next = { at: marks[marks.length - 1], via: marks.slice(0, -1), label: '', kind: 'pin', by: 'game' };
  }
  if (!sameTarget(target.get(), next)) target.set(next);
}

let started = false;
export function startTargets() {
  if (started) return;
  started = true;
  // Where the job ends, found once per job in the game's places (whatever map is on screen).
  let dstKey = '';
  const updateDestination = () => {
    const job = telemetry.get().job;
    const key = job.on ? `${job.dst.cityId}/${job.dst.companyId}` : '';
    if (key === dstKey) return;
    dstKey = key;
    if (!key) {
      mapDestination.set(null);
      return;
    }
    void findDestination(job.dst).then(d => {
      if (dstKey === key) mapDestination.set(d);
    });
  };
  updateDestination();
  telemetry.subscribe(updateDestination);
  const readMarks = () => {
    const s = gameSave.get();
    const tel = telemetry.get();
    const live = connection.get().state === 'live';
    // In a convoy the game keeps the multiplayer route; its time offset is 0 in single player.
    const marks = tel.game.mp !== 0 ? s.onlineWaypoints : s.waypoints;
    const routing = tel.truck.nav.dist > 50;
    const fresh = s.at && Date.now() - s.at < SAVE_FRESH;
    const next = live && fresh && routing ? marks.map(([x, z]) => gameToLngLat(x, z)) : [];
    const cur = gameRoute.get();
    if (next.length !== cur.length || next.some((p, i) => p[0] !== cur[i][0] || p[1] !== cur[i][1])) gameRoute.set(next);
  };
  gameSave.subscribe(readMarks);
  connection.subscribe(readMarks);
  // The live checks (routing at all, which route) change with telemetry: only act when they flip.
  let state = '';
  telemetry.subscribe(() => {
    const t = telemetry.get();
    const now = `${t.job.on}|${t.truck.nav.dist > 50}|${t.game.mp !== 0}`;
    if (now === state) return;
    state = now;
    readMarks();
    recompute();
  });
  readMarks();
  for (const s of [mapDestination, gameRoute]) s.subscribe(recompute);
  recompute();
}

// ---------- places ----------

export const kmBetween = (a: LngLat, b: LngLat) =>
  Math.hypot((a[0] - b[0]) * 111.32 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180), (a[1] - b[1]) * 110.574);

/** The truck's position on the map, or null before the game reports one. */
export function truckAt(): LngLat | null {
  const p = telemetry.get().truck.pos;
  return p.x || p.z ? gameToLngLat(p.x, p.z) : null;
}

/** POI kind from a tile feature's sprite (the same mapping as the map's icons, maps/style.ts). */
export function poiKind(sprite: string, poiType = ''): string {
  switch (sprite) {
    case 'gas_ico':
      return 'fuel';
    case 'parking_ico':
      return 'parking';
    case 'service_ico':
      return 'service';
    case 'garage_large_ico':
      return 'garage';
    case 'dealer_ico':
      return 'dealer';
    case 'recruitment_ico':
      return 'recruit';
    case 'weigh_station_ico':
    case 'weigh_ico':
      return 'weigh';
    case 'toll_ico':
      return 'toll';
    case 'border_ico':
      return 'border';
    case 'photo_sight_captured':
      return 'photo';
    case 'viewpoint':
      return 'view';
    case 'port_overlay':
      return 'ferry';
    case 'train_ico':
      return 'train';
    default:
      return poiType === 'company' ? 'company' : '';
  }
}

export interface Place {
  at: LngLat;
  label: string;
  kind: string;
  km: number;
}

/**
 * Places of `kind` around `from`, nearest first, read straight from the map tiles (a square of
 * tiles about 300 km across on the map), so the list does not depend on what the map has shown.
 */
export async function nearby(kind: string, from: LngLat, limit = 20): Promise<Place[]> {
  const z = 9;
  const [cx, cy] = lngLatToTile(from[0], from[1], z);
  const jobs: Array<Promise<Place[]>> = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      jobs.push(
        loadTileBytes('ets2', z, cx + dx, cy + dy).then(buf => {
          if (!buf) return [];
          const feats = decodeTile(new Uint8Array(buf), z, cx + dx, cy + dy, (p, type) => type === 1 && p.type === 'poi');
          const out: Place[] = [];
          for (const f of feats) {
            const k = poiKind(String(f.props.sprite ?? ''), String(f.props.poiType ?? ''));
            if (k !== kind) continue;
            const at = f.parts[0]?.[0];
            if (at) out.push({ at, label: String(f.props.poiName ?? ''), kind: k, km: kmBetween(from, at) });
          }
          return out;
        }),
      );
    }
  }
  const all = (await Promise.all(jobs)).flat();
  // Tiles overlap at their edges: one place each.
  const seen = new Set<string>();
  return all
    .sort((a, b) => a.km - b.km)
    .filter(p => {
      const key = `${p.at[0].toFixed(4)},${p.at[1].toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

/** Cities and places by name (the map's search index), nearest first among equals. */
export async function searchPlaces(query: string, from: LngLat | null, lang: 'tr' | 'en', limit = 12): Promise<Place[]> {
  const q = fold(query);
  if (!q) return [];
  const [features, table] = await Promise.all([searchIndex(), cityTable()]);
  const local = new Map<string, string>();
  for (const c of Object.values(table)) if (c.en) local.set(fold(c.en), lang === 'tr' ? c.tr || c.en : c.en);
  const scored: Array<Place & { score: number }> = [];
  for (const f of features) {
    const p = f.properties;
    if (p.type === 'scenery') continue;
    const label = p.type === 'city' ? local.get(fold(p.label)) ?? p.label : p.label;
    const city = p.city?.name ? local.get(fold(p.city.name)) ?? p.city.name : '';
    const name = fold(label);
    const hay = `${name} ${fold(city)}`;
    const at = name.startsWith(q) ? 0 : hay.includes(q) ? 1 : -1;
    if (at < 0) continue;
    const kind = p.type === 'city' ? 'city' : p.type === 'company' ? 'company' : p.type === 'dealer' ? 'dealer' : p.type === 'ferry' ? 'ferry' : p.type;
    const km = from ? kmBetween(from, f.geometry.coordinates) : 0;
    scored.push({ at: f.geometry.coordinates, label: city && p.type !== 'city' ? `${label} · ${city}` : label, kind, km, score: at * 10 + (p.type === 'city' ? 0 : 1) });
  }
  return scored.sort((a, b) => a.score - b.score || a.km - b.km).slice(0, limit);
}

/** Where each owned garage's city is (the garage itself is found near it). */
export async function ownedGarageCities(lang: 'tr' | 'en'): Promise<Array<{ token: string; name: string; at: LngLat }>> {
  const owned = gameSave.get().garages;
  if (!owned.length) return [];
  const [features, table] = await Promise.all([searchIndex(), cityTable()]);
  const cities = new Map<string, LngLat>();
  for (const f of features) if (f.properties.type === 'city') cities.set(fold(f.properties.label), f.geometry.coordinates);
  const out: Array<{ token: string; name: string; at: LngLat }> = [];
  for (const token of owned) {
    const c = table[token];
    const at = c && (cities.get(fold(c.en)) ?? cities.get(fold(c.name)));
    if (at) out.push({ token, name: (lang === 'tr' ? c.tr : c.en) || c.name, at });
  }
  return out;
}

/** The garage building nearest to a city's centre (from the tile there). */
export async function garageNear(at: LngLat): Promise<LngLat | null> {
  const found = await nearby('garage', at, 1);
  return found[0] && found[0].km < 25 ? found[0].at : null;
}
