// Places on the map: where the job's destination is, and what cities are called in the
// language TırPlay speaks. Both come from map/data (the search index of truckermudgeon's map and
// the city table read from the game by map/build-cities.mjs).

import { loadMapData } from './source';
import type { LngLat } from './projection';

export interface SearchFeature {
  type: 'Feature';
  properties: {
    type: 'city' | 'company' | 'dealer' | 'ferry' | 'train' | 'viewpoint' | 'landmark' | 'scenery';
    label: string;
    sprite: string;
    stateName?: string;
    stateCode?: string;
    city?: { name: string; stateCode: string; distance: number };
  };
  geometry: { type: 'Point'; coordinates: LngLat };
}

export interface CityName {
  name: string;
  en: string;
  tr: string;
  country: string;
}

let search: Promise<SearchFeature[]> | null = null;
let cities: Promise<Record<string, CityName>> | null = null;

export function searchIndex(): Promise<SearchFeature[]> {
  search ??= loadMapData<{ features: SearchFeature[] }>('ets2-search.geojson').then(fc => fc?.features ?? []);
  return search;
}

export function cityTable(): Promise<Record<string, CityName>> {
  cities ??= loadMapData<Record<string, CityName>>('cities.json').then(t => t ?? {});
  return cities;
}

export const fold = (s: string) =>
  s
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Map label → the city's name in `lang` (labels in the tiles are English or the game's own). */
export async function cityLabels(lang: 'tr' | 'en'): Promise<Record<string, string>> {
  const table = await cityTable();
  const out: Record<string, string> = {};
  for (const c of Object.values(table)) {
    const local = c[lang] || c.name;
    if (c.en && c.en !== local) out[c.en] = local;
    if (c.name && c.name !== local) out[c.name] = local;
  }
  return out;
}

export interface Destination {
  at: LngLat;
  label: string;
  /** True when the company itself was found, not just its city. */
  exact: boolean;
}

/** Where a job is going: the company's depot in the destination city, else the city. */
export async function findDestination(dst: { city: string; cityId: string; company: string; companyId: string }): Promise<Destination | null> {
  if (!dst.cityId && !dst.city) return null;
  const [features, table] = await Promise.all([searchIndex(), cityTable()]);
  const known = table[dst.cityId];
  const names = new Set([dst.city, dst.cityId, known?.en, known?.name, known?.tr].filter(Boolean).map(s => fold(s!)));
  const inCity = (f: SearchFeature) => names.has(fold(f.properties.city?.name ?? f.properties.label));
  const company = fold(dst.company);
  const depots = features.filter(
    f => f.properties.type === 'company' && (f.properties.sprite === dst.companyId || fold(f.properties.label) === company),
  );
  const depot = depots.find(inCity) ?? (depots.length === 1 ? depots[0] : undefined);
  if (depot) return { at: depot.geometry.coordinates, label: depot.properties.label, exact: true };
  const city = features.find(f => f.properties.type === 'city' && names.has(fold(f.properties.label)));
  return city ? { at: city.geometry.coordinates, label: city.properties.label, exact: false } : null;
}
