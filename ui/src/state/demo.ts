// A believable drive for development and for running TruckPlay without the game: a Scania on the
// motorway from İstanbul to Edirne with electronics on board, on the real road (map/
// build-demo-route.mjs traced it from the map). Same message shape the plugin sends.

import { emitGameEvent, telemetry, type Telemetry } from './telemetry';
import { connection } from './telemetry';
import { seedTrail } from './trail';
import route from './demoRoute.json';

const START_MINUTE = 3 * 1440 + 17 * 60 + 42; // Thursday 17:42
const GAME_SCALE = 19; // game seconds per real second, as on the road in ETS2
const START_AT = 600; // metres into the route

const points = route.points as Array<[number, number]>;
const STEP = route.step;
const LENGTH = (points.length - 1) * STEP;

/** Position along the route, `s` metres from its start. */
function along(s: number) {
  const f = Math.max(0, Math.min(points.length - 1.001, s / STEP));
  const i = Math.floor(f);
  const k = f - i;
  const [ax, az] = points[i];
  const [bx, bz] = points[i + 1];
  return { x: ax + (bx - ax) * k, z: az + (bz - az) * k };
}

/** Game heading (0..1 counter-clockwise from north) of the road around `s`. */
function headingAt(s: number) {
  const a = along(s - 9);
  const b = along(s + 9);
  const turn = Math.atan2(-(b.x - a.x), -(b.z - a.z)) / (Math.PI * 2);
  return (turn + 1) % 1;
}

/** How hard the road bends over the next stretch, in turns. */
function bendAhead(s: number) {
  let max = 0;
  const h0 = headingAt(s);
  for (let d = 20; d <= 160; d += 20) {
    const dh = Math.abs(((headingAt(s + d) - h0 + 1.5) % 1) - 0.5);
    max = Math.max(max, dh / (d / 100));
  }
  return max;
}

let timer: number | undefined;

export function startDemo() {
  stopDemo();
  connection.set({ state: 'demo' });
  const state = {
    t: 0,
    gameSeconds: START_MINUTE * 60,
    s: START_AT,
    speed: 0,
    target: 24,
    gear: 1,
    fuel: 742,
    adblue: 61,
    odo: 184_211.4,
    dist: 0,
    x: 0,
    z: 0,
    heading: headingAt(START_AT),
    nextTarget: 6,
    rest: 9 * 60 + 12,
  };
  let last = performance.now();

  // The road already behind the truck, for the trail view.
  const past: Array<{ x: number; z: number }> = [];
  for (let s = 0; s <= START_AT; s += 8) past.push(along(s));
  seedTrail(past);

  const tick = () => {
    const now = performance.now();
    const dt = Math.min(0.2, (now - last) / 1000);
    last = now;
    state.t += dt;
    state.gameSeconds += dt * GAME_SCALE;

    // Cruise between 70 and 88 km/h, easing off for bends and the odd slow-down.
    state.nextTarget -= dt;
    if (state.nextTarget <= 0) {
      state.target = Math.random() < 0.14 ? 15 + Math.random() * 5 : 20 + Math.random() * 4.5;
      state.nextTarget = 6 + Math.random() * 10;
    }
    const bend = bendAhead(state.s);
    const target = Math.min(state.target, bend > 0.05 ? Math.max(9, 24 - bend * 160) : 99);
    const accel = target > state.speed ? 0.9 : -1.8;
    state.speed = Math.max(0, state.speed + accel * dt * (Math.abs(target - state.speed) > 0.3 ? 1 : 0));
    const kmh = state.speed * 3.6;
    state.gear = Math.max(1, Math.min(12, Math.round(kmh / 7.6)));
    const rpm = Math.min(1950, 620 + ((kmh % 7.6) / 7.6) * 500 + state.gear * 45);

    state.s += state.speed * dt;
    if (state.s >= LENGTH - 30) {
      emitGameEvent({ id: 'job.delivered', a: { revenue: 7850, 'earned.xp': 912, 'cargo.damage': 0.006, 'distance.km': Math.round((LENGTH * GAME_SCALE) / 1000) } });
      state.s = START_AT;
    }
    const p = along(state.s);
    state.x = p.x;
    state.z = p.z;
    state.heading = headingAt(state.s);
    state.dist = (LENGTH - state.s) * GAME_SCALE;
    state.fuel = Math.max(0, state.fuel - state.speed * dt * GAME_SCALE * 0.00031);
    state.adblue = Math.max(0, state.adblue - state.speed * dt * GAME_SCALE * 0.000016);
    state.odo += (state.speed * dt * GAME_SCALE) / 1000;

    const minute = Math.floor(state.gameSeconds / 60);
    const hour = Math.floor((minute % 1440) / 60);
    const night = hour >= 19 || hour < 6;
    const avg = 21.5;

    const tel: Telemetry = {
      paused: false,
      game: { time: minute, rest: Math.max(0, state.rest - (minute - START_MINUTE)), brk: 0, scale: GAME_SCALE, mp: 0 },
      truck: {
        on: true,
        brand: 'Scania',
        brandId: 'scania',
        name: 'S',
        id: 'vehicle.scania.s_2016',
        plate: '34 TP 2026',
        plateCountry: 'Türkiye',
        speed: state.speed,
        rpm,
        rpmMax: 2500,
        gear: state.gear,
        dgear: state.gear,
        gearsF: 12,
        gearsR: 2,
        cruise: state.speed > 20 ? 22.2 : 0,
        steer: Math.sin(state.t / 3) * 0.04,
        throttle: accel > 0 ? 0.4 : 0,
        brake: accel < 0 ? 0.2 : 0,
        clutch: 0,
        fuel: state.fuel,
        fuelCap: 1200,
        fuelRange: (state.fuel / 0.31) * 1000,
        fuelAvg: 0.31,
        fuelWarn: state.fuel < 120,
        adblue: state.adblue,
        adblueCap: 80,
        adblueWarn: false,
        air: 8.6 + Math.sin(state.t / 4) * 0.3,
        airWarnAt: 6.2,
        airWarn: false,
        airEmg: false,
        brakeT: 64 + Math.sin(state.t / 9) * 6,
        oilP: 4.2,
        oilWarn: false,
        oilT: 92 + Math.sin(state.t / 20) * 2,
        waterT: 86 + Math.sin(state.t / 25) * 2,
        waterWarn: false,
        batt: 27.8,
        battWarn: false,
        electric: true,
        engine: true,
        pbrake: state.speed < 0.2,
        mbrake: false,
        retarder: 0,
        retarderSteps: 4,
        lights: {
          lBlink: false,
          rBlink: false,
          lInd: false,
          rInd: false,
          hazard: false,
          parking: night,
          low: night,
          high: false,
          beacon: false,
          brake: accel < 0,
          reverse: false,
          auxF: 0,
          auxR: 0,
        },
        wipers: false,
        diffLock: false,
        backlight: night ? 1 : 0,
        odo: state.odo,
        wear: { engine: 0.012, trans: 0.018, cabin: 0.04, chassis: 0.027, wheels: 0.033 },
        nav: { dist: state.dist, time: state.dist / avg, limit: 25 },
        pos: { x: state.x, y: 52, z: state.z, h: state.heading, p: 0, r: 0 },
      },
      trailer: {
        on: true,
        attached: true,
        name: 'Krone Cool Liner',
        brand: 'Krone',
        plate: '34 TR 4512',
        cargoDamage: 0.006,
        wear: { body: 0.02, chassis: 0.015, wheels: 0.03 },
        pos: { x: state.x, y: 52, z: state.z + 12, h: state.heading, p: 0, r: 0 },
      },
      job: {
        on: true,
        cargo: 'Elektronik',
        cargoId: 'electronics',
        mass: 18_640,
        damage: 0.006,
        income: 7_850,
        due: START_MINUTE + 11 * 60 + 20,
        plannedKm: Math.round((LENGTH * GAME_SCALE) / 1000),
        loaded: true,
        special: false,
        market: 'cargo_market',
        src: { city: 'İstanbul', cityId: 'istanbul', company: 'Log n Stick', companyId: 'lognstick' },
        dst: { city: 'Edirne', cityId: 'edirne', company: 'Kaarfor', companyId: 'kaarfor' },
      },
    };
    telemetry.set(tel);
  };

  timer = window.setInterval(tick, 50);
  tick();
}

export function stopDemo() {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
}

/** For trying the notification banners without the game. */
export function demoEvent(kind: 'fine' | 'toll' | 'delivered' | 'ferry') {
  switch (kind) {
    case 'fine':
      emitGameEvent({ id: 'player.fined', a: { 'fine.offence': 'speeding', 'fine.amount': 450 } });
      break;
    case 'toll':
      emitGameEvent({ id: 'player.tollgate.paid', a: { 'pay.amount': 118 } });
      break;
    case 'delivered':
      emitGameEvent({ id: 'job.delivered', a: { revenue: 7850, 'earned.xp': 912, 'cargo.damage': 0.006, 'distance.km': Math.round((LENGTH * GAME_SCALE) / 1000) } });
      break;
    case 'ferry':
      emitGameEvent({ id: 'player.use.ferry', a: { 'source.name': 'Çanakkale', 'target.name': 'Eceabat', 'pay.amount': 260 } });
      break;
  }
}
