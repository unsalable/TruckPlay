import { createStore } from './store';

// Mirrors the plugin's `tel` message (plugin/src/telemetry.cpp). SDK units: m/s, m, L, °C, bar,
// in-game minutes; heading is 0..1 counter-clockwise from north.

export interface Placement {
  x: number;
  y: number;
  z: number;
  h: number;
  p: number;
  r: number;
}

export interface Lights {
  lBlink: boolean;
  rBlink: boolean;
  lInd: boolean;
  rInd: boolean;
  hazard: boolean;
  parking: boolean;
  low: boolean;
  high: boolean;
  beacon: boolean;
  brake: boolean;
  reverse: boolean;
  auxF: number;
  auxR: number;
}

export interface Truck {
  on: boolean;
  brand: string;
  brandId: string;
  name: string;
  id: string;
  plate: string;
  plateCountry: string;
  speed: number;
  rpm: number;
  rpmMax: number;
  gear: number;
  dgear: number;
  gearsF: number;
  gearsR: number;
  cruise: number;
  steer: number;
  throttle: number;
  brake: number;
  clutch: number;
  fuel: number;
  fuelCap: number;
  fuelRange: number;
  fuelAvg: number;
  fuelWarn: boolean;
  adblue: number;
  adblueCap: number;
  adblueWarn: boolean;
  air: number;
  airWarnAt: number;
  airWarn: boolean;
  airEmg: boolean;
  brakeT: number;
  oilP: number;
  oilWarn: boolean;
  oilT: number;
  waterT: number;
  waterWarn: boolean;
  batt: number;
  battWarn: boolean;
  electric: boolean;
  engine: boolean;
  pbrake: boolean;
  mbrake: boolean;
  retarder: number;
  retarderSteps: number;
  lights: Lights;
  wipers: boolean;
  diffLock: boolean;
  backlight: number;
  odo: number;
  wear: { engine: number; trans: number; cabin: number; chassis: number; wheels: number };
  nav: { dist: number; time: number; limit: number };
  pos: Placement;
}

export interface Trailer {
  on: boolean;
  attached: boolean;
  name: string;
  brand: string;
  plate: string;
  cargoDamage: number;
  wear: { body: number; chassis: number; wheels: number };
  pos: Placement;
}

export interface Place {
  city: string;
  cityId: string;
  company: string;
  companyId: string;
}

export interface Job {
  on: boolean;
  cargo: string;
  cargoId: string;
  mass: number;
  damage: number;
  income: number;
  due: number;
  plannedKm: number;
  loaded: boolean;
  special: boolean;
  market: string;
  src: Place;
  dst: Place;
}

export interface Telemetry {
  paused: boolean;
  game: { time: number; rest: number; brk: number; scale: number; mp: number };
  truck: Truck;
  trailer: Trailer;
  job: Job;
}

export interface GameEvent {
  id: string;
  a: Record<string, string | number | boolean>;
}

const zeroPos: Placement = { x: 0, y: 0, z: 0, h: 0, p: 0, r: 0 };

export const emptyTelemetry: Telemetry = {
  paused: true,
  game: { time: 0, rest: 0, brk: 0, scale: 0, mp: 0 },
  truck: {
    on: false,
    brand: '',
    brandId: '',
    name: '',
    id: '',
    plate: '',
    plateCountry: '',
    speed: 0,
    rpm: 0,
    rpmMax: 2500,
    gear: 0,
    dgear: 0,
    gearsF: 12,
    gearsR: 2,
    cruise: 0,
    steer: 0,
    throttle: 0,
    brake: 0,
    clutch: 0,
    fuel: 0,
    fuelCap: 0,
    fuelRange: 0,
    fuelAvg: 0,
    fuelWarn: false,
    adblue: 0,
    adblueCap: 0,
    adblueWarn: false,
    air: 0,
    airWarnAt: 0,
    airWarn: false,
    airEmg: false,
    brakeT: 0,
    oilP: 0,
    oilWarn: false,
    oilT: 0,
    waterT: 0,
    waterWarn: false,
    batt: 0,
    battWarn: false,
    electric: false,
    engine: false,
    pbrake: false,
    mbrake: false,
    retarder: 0,
    retarderSteps: 0,
    lights: {
      lBlink: false,
      rBlink: false,
      lInd: false,
      rInd: false,
      hazard: false,
      parking: false,
      low: false,
      high: false,
      beacon: false,
      brake: false,
      reverse: false,
      auxF: 0,
      auxR: 0,
    },
    wipers: false,
    diffLock: false,
    backlight: 0,
    odo: 0,
    wear: { engine: 0, trans: 0, cabin: 0, chassis: 0, wheels: 0 },
    nav: { dist: 0, time: 0, limit: 0 },
    pos: zeroPos,
  },
  trailer: {
    on: false,
    attached: false,
    name: '',
    brand: '',
    plate: '',
    cargoDamage: 0,
    wear: { body: 0, chassis: 0, wheels: 0 },
    pos: zeroPos,
  },
  job: {
    on: false,
    cargo: '',
    cargoId: '',
    mass: 0,
    damage: 0,
    income: 0,
    due: 0,
    plannedKm: 0,
    loaded: false,
    special: false,
    market: '',
    src: { city: '', cityId: '', company: '', companyId: '' },
    dst: { city: '', cityId: '', company: '', companyId: '' },
  },
};

export const telemetry = createStore<Telemetry>(emptyTelemetry);

export type Connection = 'demo' | 'waiting' | 'live';
export const connection = createStore<{ state: Connection; plugin?: string; sdk?: string }>({ state: 'waiting' });

type EventListener = (e: GameEvent) => void;
const eventListeners = new Set<EventListener>();
export function onGameEvent(l: EventListener): () => void {
  eventListeners.add(l);
  return () => eventListeners.delete(l);
}
export function emitGameEvent(e: GameEvent) {
  eventListeners.forEach(l => l(e));
}
