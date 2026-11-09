// The game's map, live. One component for the Maps app (interactive, camera modes) and the
// Dashboard card (follows the truck, never touched). The truck is drawn as Apple's navigation
// arrow lying on the road; the camera rides behind it heading-up, pulling back as speed builds.
// Telemetry arrives 20 times a second; the arrow and camera are interpolated every frame.

import { LngLatBounds, Map as MapLibre, Marker, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { TrailMap } from '../components/TrailMap';
import { useStore } from '../state/store';
import { host } from '../state/bridge';
import { telemetry } from '../state/telemetry';
import { nav, resolvedAppearance, settings } from '../state/ui';
import { installMapFonts, MAP_FONT } from './mapFonts';
import { installMapProtocol } from './source';
import { enabledPoiKinds, mapStyle, type MapTheme } from './style';
import { provideMapImages } from './icons';
import { cityLabels } from './places';
import { gameToLngLat, headingToBearing } from './projection';
import { mapDestination, mapFocus, mapPick, mapView, type CameraMode } from './mapView';
import { kmBetween, ownedGarageCities, poiKind, startTargets, target } from './targets';
import { gameSave } from '../state/save';
import './gameMap.css';

type Variant = 'app' | 'card';

const OSR = host?.info.mode === 'osr';
const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 1;
const angleDelta = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

let fontsReady: Promise<unknown> | null = null;
function prepare() {
  installMapProtocol();
  installMapFonts();
  startTargets();
  fontsReady ??= Promise.all(Object.values(MAP_FONT).map(f => document.fonts.load(`600 16px "${f}"`).catch(() => null)));
  return fontsReady;
}

function puckElement() {
  const el = document.createElement('div');
  el.className = 'map-puck';
  el.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="tp-puck" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#44a4ff"/><stop offset="1" stop-color="#0a6cf5"/></linearGradient></defs>
    <circle cx="32" cy="32" r="27" fill="rgba(10,132,255,0.16)"/>
    <path d="M32 9 51 52.5c.6 1.4-.9 2.7-2.2 1.9L32 44.6 15.2 54.4c-1.3.8-2.8-.5-2.2-1.9L32 9z" fill="url(#tp-puck)" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>
  </svg>`;
  return el;
}

// Pin colours by whose destination it is: the job's red, the end of the route marked on the
// game's own map orange.
const PIN_COLOR: Record<string, string> = { job: '#ff3b30', game: '#ff9500' };

function pinElement(color = '#ff3b30') {
  const el = document.createElement('div');
  el.className = 'map-pin';
  el.innerHTML = `<svg viewBox="0 0 40 52" aria-hidden="true">
    <path d="M20 2C10.1 2 2 9.9 2 19.7 2 32.6 16.4 46.6 18.6 48.6c.8.7 2 .7 2.8 0C23.6 46.6 38 32.6 38 19.7 38 9.9 29.9 2 20 2z" fill="${color}" stroke="#fff" stroke-width="2.5"/>
    <path d="M14.5 11.5c.6 0 1 .4 1 1v.3c2-1 4-1 6 .1 1.8.9 3.6.9 5.6-.2.7-.4 1.4.1 1.4.9v8.1c0 .4-.2.7-.5.9-2.4 1.4-4.8 1.5-7.1.3-1.6-.8-3.3-.8-5.4.3v5.3c0 .6-.4 1-1 1s-1-.4-1-1V12.5c0-.6.4-1 1-1z" fill="#fff"/>
  </svg>`;
  return el;
}

export function GameMap({ variant }: { variant: Variant }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const theme = useStore(resolvedAppearance, a => a);

  useEffect(() => {
    const el = ref.current;
    if (!el || failed) return;
    let map: MapLibre | null = null;
    let puck: Marker | null = null;
    let pin: Marker | null = null;
    let raf = 0;
    let disposed = false;
    const offs: Array<() => void> = [];
    const app = variant === 'app';

    // Truck pose: the latest sample and the smoothed pose drawn on screen.
    let sample = { x: 0, z: 0, h: 0, v: 0, t: 0, ok: false };
    const pose = { x: 0, z: 0, h: 0, zoom: 13, init: false };
    const readSample = () => {
      const tr = telemetry.get().truck;
      const ok = tr.pos.x !== 0 || tr.pos.z !== 0;
      sample = { x: tr.pos.x, z: tr.pos.z, h: tr.pos.h, v: tr.speed, t: performance.now(), ok };
    };
    readSample();

    let applied = { lng: 0, lat: 0, bearing: 0, zoom: 0, pitch: 0 };
    let easingUntil = 0;
    let lastFrame = performance.now();
    let onScreen = true;
    let mode: CameraMode = app ? mapView.get().mode : 'follow';
    // How the followed view looks: 3D (tilted, buildings, sky) or 2D, heading or north up.
    const look = () => {
      const s = settings.get();
      return { view3d: s.map3d, buildings: s.mapBuildings, north: s.mapNorthUp, pois: enabledPoiKinds(s.mapPois) };
    };
    const pitch3d = app ? 67 : 60;

    // Apple Maps' driving camera: low behind the arrow, tilted until the sky shows at the top,
    // pulling back as speed builds. 2D sits higher.
    const autoZoom = (speed: number) => {
      const t = Math.min(1, (Math.abs(speed) * 3.6) / 90);
      const z = look().view3d ? 14.3 - t * 0.9 : 13.5 - t * 0.8;
      return app ? z + mapView.get().zoomBias : z - 0.5;
    };
    const padding = () => {
      const h = el.clientHeight;
      if (mode !== 'follow') return { top: 0, bottom: 0, left: 0, right: 0 };
      const l = look();
      // Heading up, the arrow sits low so the road ahead fills the screen.
      const share = l.north ? 0 : l.view3d ? (app ? 0.42 : 0.36) : app ? 0.3 : 0.24;
      return { top: h * share, bottom: 0, left: 0, right: 0 };
    };
    const camera = (lng: number, lat: number, bearing: number, zoom: number) => {
      const l = look();
      return {
        center: [lng, lat] as [number, number],
        bearing: mode === 'follow' && !l.north ? bearing : 0,
        pitch: mode === 'follow' && l.view3d ? pitch3d : 0,
        zoom,
        padding: padding(),
      };
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!map || !sample.ok) return;
      // The card sleeps while an app covers it or its page is swiped away.
      if (!app && (nav.get().app || !onScreen)) {
        lastFrame = now;
        return;
      }
      // In the game every repaint is copied into the truck's screen; 30 camera moves a second
      // read as smooth there and halve the work.
      if (OSR && now - lastFrame < 32) return;
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;

      const ahead = Math.min(0.25, (now - sample.t) / 1000);
      const a = sample.h * Math.PI * 2;
      const tx = sample.x - Math.sin(a) * sample.v * ahead;
      const tz = sample.z - Math.cos(a) * sample.v * ahead;
      const jump = Math.hypot(tx - pose.x, tz - pose.z) > 250;
      if (!pose.init || jump) {
        Object.assign(pose, { x: tx, z: tz, h: sample.h, zoom: autoZoom(sample.v), init: true });
      } else {
        const k = 1 - Math.exp(-dt / 0.09);
        pose.x += (tx - pose.x) * k;
        pose.z += (tz - pose.z) * k;
        pose.h += (angleDelta(pose.h * 360, sample.h * 360) / 360) * k;
        pose.zoom += (autoZoom(sample.v) - pose.zoom) * (1 - Math.exp(-dt / 1.2));
      }
      const [lng, lat] = gameToLngLat(pose.x, pose.z);
      const bearing = headingToBearing(pose.h, lng);
      puck?.setLngLat([lng, lat]).setRotation(bearing);

      if (mode !== 'follow' || now < easingUntil) return;
      const c = camera(lng, lat, bearing, pose.zoom);
      const moved =
        Math.abs(c.center[0] - applied.lng) > 1e-8 ||
        Math.abs(c.center[1] - applied.lat) > 1e-8 ||
        Math.abs(angleDelta(applied.bearing, c.bearing)) > 0.02 ||
        Math.abs(c.zoom - applied.zoom) > 0.001 ||
        c.pitch !== applied.pitch;
      if (!moved) return;
      map.jumpTo(c);
      applied = { lng: c.center[0], lat: c.center[1], bearing: c.bearing, zoom: c.zoom, pitch: c.pitch };
    };

    const applyMode = (next: CameraMode) => {
      const prev = mode;
      mode = next;
      if (!map) return;
      map.scrollZoom[next === 'free' || next === 'overview' ? 'enable' : 'disable']();
      map.doubleClickZoom[next === 'free' || next === 'overview' ? 'enable' : 'disable']();
      const [lng, lat] = gameToLngLat(pose.x, pose.z);
      if (next === 'overview') {
        const dst = mapDestination.get();
        const b = new LngLatBounds([lng, lat], [lng, lat]);
        if (dst) b.extend(dst.at);
        const u = remPx();
        map.fitBounds(b, {
          padding: { top: 96 * u, bottom: 80 * u, left: 70 * u, right: 80 * u },
          bearing: 0,
          pitch: 0,
          maxZoom: dst ? 11.5 : 12,
          duration: 1100,
        });
      } else if (next === 'follow' && prev !== next && pose.init) {
        glideToFollow();
      }
    };

    // Back to riding with the truck (or into a new look of it): one smooth camera move.
    const glideToFollow = () => {
      if (!map || !pose.init) return;
      pose.zoom = autoZoom(sample.v);
      const [lng, lat] = gameToLngLat(pose.x, pose.z);
      const c = camera(lng, lat, headingToBearing(pose.h, lng), pose.zoom);
      map.easeTo({ ...c, duration: 1000, easing: t => 1 - (1 - t) ** 3 });
      easingUntil = performance.now() + 1000;
      applied = { lng: c.center[0], lat: c.center[1], bearing: c.bearing, zoom: c.zoom, pitch: c.pitch };
    };

    void (async () => {
      await prepare();
      if (disposed) return;
      let names = await cityLabels(settings.get().lang === 'en' ? 'en' : 'tr');
      if (disposed) return;
      // Before the truck reports in, show the whole of Europe.
      const start = sample.ok ? gameToLngLat(sample.x, sample.z) : ([12, 50] as [number, number]);
      let currentTheme: MapTheme = resolvedAppearance.get();
      let currentLook = look();
      const styleFor = () =>
        mapStyle(currentTheme, remPx(), names, { view3d: currentLook.view3d, buildings: currentLook.buildings, pois: currentLook.pois });
      const m = new MapLibre({
        container: el,
        style: styleFor(),
        center: start,
        zoom: sample.ok ? autoZoom(sample.v) : 4.2,
        pitch: sample.ok && currentLook.view3d ? pitch3d : 0,
        interactive: app,
        attributionControl: false,
        renderWorldCopies: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        keyboard: false,
        minZoom: 3.5,
        maxZoom: 17.5,
        maxPitch: 70,
        fadeDuration: 180,
      });
      map = m;
      // Handle for development snapshots (window.__tpMaps.app / .card).
      Object.assign(((window as unknown as { __tpMaps?: object }).__tpMaps ??= {}), { [variant]: m });
      provideMapImages(m, remPx, prepare());
      m.on('error', e => {
        const src = (e as { sourceId?: string }).sourceId;
        if (src === 'game') setFailed(true);
      });
      if (app) {
        m.on('dragstart', () => mapView.patch({ mode: 'free' }));
        // In follow modes the wheel tunes the camera's distance instead of taking over.
        const wheel = (e: WheelEvent) => {
          if (mode === 'free' || mode === 'overview') return;
          e.preventDefault();
          e.stopPropagation();
          const v = mapView.get();
          mapView.patch({ zoomBias: Math.max(-3, Math.min(2.5, v.zoomBias - e.deltaY / 480)) });
        };
        el.addEventListener('wheel', wheel, { capture: true, passive: false });
        offs.push(() => el.removeEventListener('wheel', wheel, { capture: true }));
        let bias = mapView.get().zoomBias;
        offs.push(
          mapView.subscribe(() => {
            const v = mapView.get();
            if (v.mode !== mode) applyMode(v.mode);
            const delta = v.zoomBias - bias;
            bias = v.zoomBias;
            // Exploring: the zoom buttons zoom the map itself.
            if (delta && map && (mode === 'free' || mode === 'overview')) map.easeTo({ zoom: map.getZoom() + delta, duration: 320 });
          }),
        );
      }
      applyMode(mode);

      puck = new Marker({ element: puckElement(), rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(start).addTo(m);
      // Where the blue line ends (maps/targets.ts), in the colour of whose destination it is.
      let pinBy = '';
      const showTarget = () => {
        const t = target.get();
        if (!t) {
          pin?.remove();
          return;
        }
        if (!pin || pinBy !== t.by) {
          pin?.remove();
          pinBy = t.by;
          pin = new Marker({ element: pinElement(PIN_COLOR[t.by]), anchor: 'bottom' });
        }
        pin.setLngLat(t.at).addTo(m);
      };
      showTarget();
      offs.push(target.subscribe(showTarget));

      // A place chosen in search: the camera goes there, flat and north up, and stays.
      if (app) {
        offs.push(
          mapFocus.subscribe(() => {
            const f = mapFocus.get();
            if (!f) return;
            mapView.patch({ mode: 'free' });
            m.easeTo({ center: f.at, zoom: Math.max(m.getZoom(), 11.5), pitch: 0, bearing: 0, duration: 900, easing: t => 1 - (1 - t) ** 3 });
          }),
        );
      }

      // The waypoints marked on the game's map that the route passes, as small numbered dots.
      let waypoints: Marker[] = [];
      const showWaypoints = () => {
        waypoints.forEach(w => w.remove());
        const pts = target.get()?.via ?? [];
        waypoints = pts.map((at, i) => {
          const el = document.createElement('div');
          el.className = 'map-waypoint';
          el.textContent = String(i + 1);
          return new Marker({ element: el }).setLngLat(at).addTo(m);
        });
      };
      showWaypoints();
      offs.push(target.subscribe(showWaypoints));
      offs.push(() => waypoints.forEach(w => w.remove()));


      // The player's own garages (from the save): the garage on the map nearest each owned city's
      // centre, found among the tiles the map has loaded, refreshed whenever the map settles.
      let ownedCities: Array<{ token: string; name: string; at: [number, number] }> = [];
      let ownedKey = '';
      const placeOwned = () => {
        if (!map || !ownedCities.length) return;
        const src = m.getSource('owned') as GeoJSONSource | undefined;
        if (!src) return;
        const garages = m.querySourceFeatures('game', {
          sourceLayer: 'ets2',
          filter: ['all', ['==', ['get', 'type'], 'poi'], ['==', ['get', 'sprite'], 'garage_large_ico']],
        });
        const best = new Map<string, { at: [number, number]; km: number; name: string }>();
        for (const g of garages) {
          const at = (g.geometry as unknown as { coordinates: [number, number] }).coordinates;
          for (const c of ownedCities) {
            const km = kmBetween(at, c.at);
            if (km > 14) continue;
            const cur = best.get(c.token);
            if (!cur || km < cur.km) best.set(c.token, { at, km, name: c.name });
          }
        }
        const features = [...best.values()].map(b => ({ type: 'Feature' as const, properties: { label: b.name }, geometry: { type: 'Point' as const, coordinates: b.at } }));
        const key = features.map(f => f.geometry.coordinates.join()).sort().join(';');
        if (key === ownedKey) return;
        ownedKey = key;
        src.setData({ type: 'FeatureCollection', features });
      };
      const loadOwned = () => {
        void ownedGarageCities(settings.get().lang === 'en' ? 'en' : 'tr').then(c => {
          ownedCities = c;
          ownedKey = '';
          placeOwned();
        });
      };
      loadOwned();
      offs.push(gameSave.subscribe(loadOwned));
      m.on('idle', placeOwned);
      m.on('styledata', () => {
        ownedKey = '';
      });

      if (app) {
        // A tap on a place shows its card (it offers the route there); a tap on empty map while
        // exploring drops a pin there.
        m.on('click', e => {
          const layers = ['pois-owned', 'pois-truck', 'pois-parking', 'pois-transport', 'pois-road', 'pois-company', 'pois-sights'].filter(id => m.getLayer(id));
          const hit = m.queryRenderedFeatures(e.point, { layers })[0];
          if (hit) {
            const at = (hit.geometry as unknown as { coordinates: [number, number] }).coordinates;
            const owned = hit.layer.id === 'pois-owned';
            const kind = owned ? 'garage' : poiKind(String(hit.properties.sprite ?? ''), String(hit.properties.poiType ?? ''));
            mapPick.set({ at, label: String(hit.properties.poiName ?? hit.properties.label ?? ''), kind, owned });
          } else if (mode !== 'follow') {
            mapPick.set({ at: [e.lngLat.lng, e.lngLat.lat], label: '', kind: 'pin', owned: false });
          }
        });
      }

      const restyle = () => {
        if (!map) return;
        map.setStyle(styleFor());
      };
      // 3D/2D, north up, buildings: restyle what the look needs and glide the camera into it.
      offs.push(
        settings.subscribe(() => {
          const next = look();
          const samePois = next.pois.join() === currentLook.pois.join();
          if (next.view3d === currentLook.view3d && next.buildings === currentLook.buildings && next.north === currentLook.north && samePois) return;
          const restyleNeeded = next.view3d !== currentLook.view3d || next.buildings !== currentLook.buildings || !samePois;
          const cameraNeeded = next.view3d !== currentLook.view3d || next.north !== currentLook.north;
          currentLook = next;
          if (restyleNeeded) restyle();
          if (mode === 'follow' && cameraNeeded) glideToFollow();
        }),
      );
      offs.push(
        resolvedAppearance.subscribe(() => {
          const t = resolvedAppearance.get();
          if (t !== currentTheme) {
            currentTheme = t;
            restyle();
          }
        }),
      );
      let lang = settings.get().lang;
      offs.push(
        settings.subscribe(() => {
          const l = settings.get().lang;
          if (l === lang) return;
          lang = l;
          void cityLabels(l === 'en' ? 'en' : 'tr').then(n => {
            names = n;
            restyle();
          });
        }),
      );
      const onFrame = () => restyle();
      window.addEventListener('tp-frame', onFrame);
      offs.push(() => window.removeEventListener('tp-frame', onFrame));
    })();

    offs.push(telemetry.subscribe(readSample));
    const ro = new ResizeObserver(() => map?.resize());
    ro.observe(el);
    const io = new IntersectionObserver(entries => {
      onScreen = entries.some(e => e.isIntersecting);
    });
    io.observe(el);
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      offs.forEach(off => off());
      map?.remove();
      map = null;
    };
  }, [variant, failed]);

  if (failed) return <TrailMap metersVisible={variant === 'app' ? 520 : undefined} puckAt={0.7} />;
  return <div ref={ref} className={`game-map game-map--${variant}`} data-theme={theme} />;
}
