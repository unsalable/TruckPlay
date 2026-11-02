// ETS2 world coordinates ↔ longitude/latitude, the way the map tiles were drawn: the Lambert
// conformal conic projection from the game's def/climate.sii (standard parallels 37° and 65°,
// origin 50°N 15°E), on a sphere whose radius cancels out. Great Britain is authored at a
// larger scale than the continent, so the sectors north-west of Calais are scaled back.
// Plain erasable TypeScript, so map/ build scripts can import it straight from Node.

export type LngLat = [number, number];
export type GamePos = [number, number]; // [x, z]: x east, z south, metres

const R = 6_370_997;
const DEG = Math.PI / 180;
const LENGTH_OF_DEGREE = R * DEG;

const PARALLEL_1 = 37 * DEG;
const PARALLEL_2 = 65 * DEG;
const ORIGIN_LAT = 50 * DEG;
const ORIGIN_LON = 15 * DEG;
const OFFSET_X = 16_660;
const OFFSET_Z = 4_150;
const FACTOR_Z = -1.71570875e-4;
const FACTOR_X = 1.729241463e-4;

const UK_SCALE = 0.75;
const CALAIS_X = -31_100;
const CALAIS_Z = -5_500;

const t = (lat: number) => Math.tan(Math.PI / 4 + lat / 2);
const N = Math.log(Math.cos(PARALLEL_1) / Math.cos(PARALLEL_2)) / Math.log(t(PARALLEL_2) / t(PARALLEL_1));
const F = (Math.cos(PARALLEL_1) * t(PARALLEL_1) ** N) / N;
const RHO_0 = (R * F) / t(ORIGIN_LAT) ** N;

function lccForward(lng: number, lat: number): [number, number] {
  const rho = (R * F) / t(lat * DEG) ** N;
  const theta = N * (lng * DEG - ORIGIN_LON);
  return [rho * Math.sin(theta), RHO_0 - rho * Math.cos(theta)];
}

function lccInverse(x: number, y: number): LngLat {
  const dy = RHO_0 - y;
  const rho = Math.sign(N) * Math.hypot(x, dy);
  const theta = Math.atan2(Math.sign(N) * x, Math.sign(N) * dy);
  const lat = 2 * Math.atan(((R * F) / rho) ** (1 / N)) - Math.PI / 2;
  return [(theta / N + ORIGIN_LON) / DEG, lat / DEG];
}

/** Great Britain: authored at its own scale, and driven on the left. */
export const isUkSector = (x: number, z: number) => {
  const sx = Math.floor(x / 4000);
  const sz = Math.floor(z / 4000);
  return sx <= -8 && sz <= -2 && !(sx === -8 && sz === -2);
};

export function gameToLngLat(x: number, z: number): LngLat {
  const uk = isUkSector(x, z);
  let px = x - OFFSET_X;
  let pz = z - OFFSET_Z;
  if (uk) {
    px = (px + CALAIS_X / 2) * UK_SCALE;
    pz = (pz + CALAIS_Z / 2) * UK_SCALE;
  }
  return lccInverse(px * FACTOR_X * LENGTH_OF_DEGREE, pz * FACTOR_Z * LENGTH_OF_DEGREE);
}

export function lngLatToGame(lng: number, lat: number): GamePos {
  const [lx, ly] = lccForward(lng, lat);
  let x = lx / FACTOR_X / LENGTH_OF_DEGREE;
  let z = ly / FACTOR_Z / LENGTH_OF_DEGREE;
  const ukX = x / UK_SCALE - CALAIS_X / 2;
  const ukZ = z / UK_SCALE - CALAIS_Z / 2;
  if (isUkSector(ukX + OFFSET_X, ukZ + OFFSET_Z)) {
    x = ukX;
    z = ukZ;
  }
  return [x + OFFSET_X, z + OFFSET_Z];
}

/**
 * The game's heading (0..1, counter-clockwise from north) as a compass bearing in degrees.
 * Grid north and true north part ways away from 15°E on a conic map; the convergence keeps the
 * puck parallel to the roads.
 */
export function headingToBearing(h: number, lng: number): number {
  const convergence = N * (lng - ORIGIN_LON / DEG);
  return (((-h * 360 + convergence) % 360) + 360) % 360;
}

/** Map metres per game metre (the world is drawn about 19× larger than it is driven). */
export const MAP_SCALE = FACTOR_X * LENGTH_OF_DEGREE;
