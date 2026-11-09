// Haritalar: the game's own GPS map, live — the very map, route and marks the game's GPS shows,
// copied out of the game as it draws it (maps/gameMapFeed.ts) — in the furniture of Apple Maps on
// CarPlay: destination card top left, glass zoom controls down the right edge, the trip capsule
// at the bottom and the speed limit sign in the corner, all with the game's own figures. Where
// the route goes is the game's business: the job, and what the driver marks on the game's map (M).
//
// Without the game (the window on its own, development) TruckPlay's own map stands in, with its
// search and nearby places; how that one looks lives in Settings › Maps.

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { GameMap } from '../../maps/GameMap';
import { GameMapWaiting, LiveGameMap } from '../../maps/LiveGameMap';
import { connection } from '../../state/telemetry';
import { gameMapReady } from '../../maps/gameMapFeed';
import { focusMap, mapPick, mapView, setCameraMode, zoomBy } from '../../maps/mapView';
import { garageNear, kmBetween, nearby, ownedGarageCities, searchPlaces, target, truckAt, type Place, type Target } from '../../maps/targets';
import { Box, ChevronLeft, Close, FuelPump, Bed, Home, LocationArrow, Minus, Plus, Road, Search, Wrench } from '../../icons/glyphs';
import { goBack, pushBack } from '../../shell/appLayer';
import { sendToPlugin } from '../../state/bridge';
import { useStore } from '../../state/store';
import { telemetry } from '../../state/telemetry';
import { clock, distance, duration, kmh } from '../../state/format';
import { useT, language, type StringKey } from '../../state/i18n';
import { spring } from '../../design/motion';
import './maps.css';

const kindLabel = (kind: string, owned = false): StringKey => (owned ? 'maps.kind.garageOwned' : (`maps.kind.${kind}` as StringKey));

// The live map's zoom steps (see LiveGameMap; 1 is the game's own GPS screen): out as far as the
// game's map reaches, in to the next junction.
const ZOOMS = [0.9, 1.15, 1.5, 2, 2.6];
const ZOOM_HOME = 1;
const ZOOM_CLOSE = 3;

export function MapsApp() {
  const t = useT();
  const live = useStore(gameMapReady, r => r);
  // In the game its own map is the map; TruckPlay's own only stands in without a game.
  const inGame = useStore(connection, c => c.state === 'live');
  const [zoomAt, setZoomAt] = useState(ZOOM_HOME);
  const view = useStore(mapView, v => v);
  const tgt = useStore(target, x => x);
  const pick = useStore(mapPick, p => p);
  const [sheet, setSheet] = useState<'search' | null>(null);
  const s = useStore(telemetry, x => ({
    dist: x.truck.nav.dist,
    time: x.truck.nav.time,
    limit: x.truck.nav.limit,
    now: x.game.time,
    job: x.job.on,
  }));
  // The game's own figures: its distance and time to go.
  const metres = s.dist;
  const minutes = s.time / 60;
  const routed = metres > 50;
  const d = distance(metres);
  const following = view.mode === 'follow';

  useEffect(() => (sheet ? pushBack(() => setSheet(null)) : undefined), [sheet]);
  useEffect(() => (pick ? pushBack(() => mapPick.set(null)) : undefined), [pick]);
  useEffect(() => () => mapPick.set(null), []);

  // A place from search: the map goes there and shows its card; the route there is marked in
  // the game (M), and TruckPlay follows the game.
  const show = (p: { at: [number, number]; label: string; kind: string }) => {
    setSheet(null);
    mapPick.set({ at: p.at, label: p.label, kind: p.kind, owned: false });
    focusMap(p.at);
  };

  // With the game's map, the card stands whenever the game routes, even to a mark not saved yet.
  const guide = tgt || (live && routed) ? (tgt ?? null) : undefined;
  const zoomIn = () => setZoomAt(i => Math.min(ZOOMS.length - 1, i + 1));
  const zoomOut = () => setZoomAt(i => Math.max(0, i - 1));

  return (
    <div className="maps">
      <AnimatePresence initial={false}>
        <motion.div
          key={live ? 'live' : inGame ? 'waiting' : 'own'}
          className="maps__surface"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {live ? (
            <LiveGameMap zoom={ZOOMS[zoomAt]} lift={0.22} />
          ) : inGame ? (
            <GameMapWaiting lift={0.22} hint={t('maps.waitCab')} />
          ) : (
            <GameMap variant="app" />
          )}
        </motion.div>
      </AnimatePresence>

      <motion.button className="maps__back glass-strong" data-pointer="highlight" onClick={goBack} whileTap={{ scale: 0.88 }} transition={spring.snappy} aria-label={t('common.back')}>
        <ChevronLeft />
      </motion.button>

      <AnimatePresence>
        {guide !== undefined && (
          <motion.div
            key="guide"
            className="maps__guide glass-strong"
            initial={{ opacity: 0, y: -14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.97 }}
            transition={spring.bouncy}
          >
            <motion.button
              className="maps__guide-main"
              data-pointer="highlight"
              onClick={() => (live ? setZoomAt(i => (i === 0 ? ZOOM_CLOSE : 0)) : setCameraMode(view.mode === 'overview' ? 'follow' : 'overview'))}
              whileTap={{ scale: 0.97 }}
              transition={spring.snappy}
            >
              <span className={`maps__guide-icon maps__guide-icon--${guide?.by ?? 'game'}`}>{guide?.by === 'job' ? <Box /> : <LocationArrow />}</span>
              <span className="maps__guide-text">
                <span className="maps__guide-dist tabular">{routed ? `${d.value} ${d.unit}` : t(`maps.by.${guide?.by ?? 'game'}` as StringKey)}</span>
                <span className="maps__guide-dest">{guide ? guideLine(guide, t) : t('maps.by.game')}</span>
              </span>
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="maps__rail">
        {!live && (
          <motion.button className="maps__control glass-strong" data-pointer="highlight" onClick={() => setSheet('search')} whileTap={{ scale: 0.88 }} transition={spring.snappy} aria-label={t('maps.search')}>
            <Search />
          </motion.button>
        )}
        {!live && (
        <AnimatePresence initial={false} mode="popLayout">
          <motion.button
            key={following ? 'overview' : 'recenter'}
            className={`maps__control glass-strong${following ? '' : ' maps__control--accent'}`}
            data-pointer="highlight"
            onClick={() => setCameraMode(following ? 'overview' : 'follow')}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            whileTap={{ scale: 0.88 }}
            transition={spring.bouncy}
            aria-label={following ? t('maps.overview') : t('maps.recenter')}
          >
            {following ? <Road /> : <LocationArrow />}
          </motion.button>
        </AnimatePresence>
        )}
        <div className="maps__zoom glass-strong">
          <motion.button data-pointer="highlight" onClick={() => (live ? zoomIn() : zoomBy(0.5))} whileTap={{ scale: 0.85 }} transition={spring.snappy} aria-label={t('maps.zoomIn')}>
            <Plus />
          </motion.button>
          <span className="maps__divider" />
          <motion.button data-pointer="highlight" onClick={() => (live ? zoomOut() : zoomBy(-0.5))} whileTap={{ scale: 0.85 }} transition={spring.snappy} aria-label={t('maps.zoomOut')}>
            <Minus />
          </motion.button>
        </div>
      </div>

      {s.limit > 0.5 && (
        <div className="speed-sign maps__sign">
          <span className="tabular">{kmh(s.limit)}</span>
        </div>
      )}

      <div className="maps__eta glass-strong">
        {routed ? (
          <>
            <span className="maps__eta-item">
              <b className="tabular">{clock(s.now + minutes)}</b>
              <span>{t('nav.arrival')}</span>
            </span>
            <span className="maps__eta-item">
              <b>{duration(minutes)}</b>
              <span>{t('maps.time')}</span>
            </span>
            <span className="maps__eta-item">
              <b className="tabular">
                {d.value} {d.unit}
              </b>
              <span>{t('maps.distance')}</span>
            </span>
          </>
        ) : (
          <span className="maps__eta-item maps__eta-item--muted">
            <b>{t('nav.noRoute')}</b>
            <span>{t('nav.noRouteHint')}</span>
          </span>
        )}
      </div>

      <AnimatePresence>{!live && pick && !sheet && <PlaceCard key={`${pick.at.join()}`} place={pick} onClose={() => mapPick.set(null)} />}</AnimatePresence>
      <AnimatePresence>{!live && sheet === 'search' && <SearchSheet key="search" onPick={show} onClose={() => setSheet(null)} />}</AnimatePresence>
    </div>
  );
}

function guideLine(tgt: Target, t: (k: StringKey) => string): string {
  if (tgt.by === 'game') return t('maps.by.game');
  return tgt.label || t(kindLabel(tgt.kind));
}

// ---------------- place card ----------------

function PlaceCard({ place, onClose }: { place: { at: [number, number]; label: string; kind: string; owned: boolean }; onClose(): void }) {
  const t = useT();
  const from = truckAt();
  const km = from ? kmBetween(from, place.at) : 0;
  const d = distance(km * 1000);
  return (
    <motion.div
      className="maps-card glass-strong"
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 18, scale: 0.97 }}
      transition={spring.bouncy}
    >
      <span className={`maps-card__icon maps-kind--${place.owned ? 'owned' : place.kind}`}>
        <KindGlyph kind={place.kind} />
      </span>
      <span className="maps-card__text">
        <b>{place.label || t(kindLabel(place.kind, place.owned))}</b>
        <span>
          {place.label ? `${t(kindLabel(place.kind, place.owned))} · ` : ''}
          {from ? `${d.value} ${d.unit} ${t('maps.away')}` : ''}
        </span>
      </span>
      <motion.button className="maps-card__close" data-pointer="highlight" onClick={onClose} whileTap={{ scale: 0.85 }} transition={spring.snappy} aria-label={t('common.close')}>
        <Close />
      </motion.button>
    </motion.div>
  );
}

function KindGlyph({ kind }: { kind: string }) {
  switch (kind) {
    case 'service':
      return <Wrench />;
    case 'fuel':
      return <FuelPump />;
    case 'parking':
      return <Bed />;
    case 'garage':
      return <Home />;
    case 'pin':
      return <LocationArrow />;
    default:
      return <Box />;
  }
}

// ---------------- search ----------------

type Category = 'service' | 'fuel' | 'parking' | 'garage';

function SearchSheet({ onPick, onClose }: { onPick(p: Place): void; onClose(): void }) {
  const t = useT();
  const lang = useStore(language, l => l);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | null>(null);
  const [results, setResults] = useState<Place[] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    sendToPlugin({ t: 'typing', on: true });
    requestAnimationFrame(() => input.current?.focus());
    return () => sendToPlugin({ t: 'typing', on: false });
  }, []);

  useEffect(() => {
    let live = true;
    const from = truckAt();
    if (category) {
      setResults(null);
      if (category === 'garage') {
        void ownedGarageCities(lang).then(cities => {
          if (!live) return;
          const list = cities.map(c => ({ at: c.at, label: c.name, kind: 'garage', km: from ? kmBetween(from, c.at) : 0 }));
          setResults(list.sort((a, b) => a.km - b.km).slice(0, 40));
        });
      } else if (from) {
        void nearby(category, from).then(list => live && setResults(list));
      } else setResults([]);
    } else if (query.trim()) {
      const timer = window.setTimeout(() => {
        void searchPlaces(query, from, lang).then(list => live && setResults(list));
      }, 120);
      return () => {
        live = false;
        window.clearTimeout(timer);
      };
    } else setResults(null);
    return () => {
      live = false;
    };
  }, [query, category, lang]);

  const choose = async (p: Place) => {
    // A garage from the list is its city: go to the garage building itself when the map has it.
    if (category === 'garage') {
      const at = await garageNear(p.at);
      onPick({ ...p, at: at ?? p.at });
    } else onPick(p);
  };

  const chips: Array<{ id: Category; icon: React.ReactNode }> = [
    { id: 'service', icon: <Wrench /> },
    { id: 'fuel', icon: <FuelPump /> },
    { id: 'parking', icon: <Bed /> },
    { id: 'garage', icon: <Home /> },
  ];

  return (
    <motion.div className="maps-sheet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <motion.div className="maps-sheet__scrim" onClick={onClose} />
      <motion.div
        className="maps-sheet__panel glass-strong"
        initial={{ x: -40, opacity: 0, scale: 0.97 }}
        animate={{ x: 0, opacity: 1, scale: 1 }}
        exit={{ x: -30, opacity: 0, scale: 0.98 }}
        transition={spring.bouncy}
      >
        <div className="maps-search">
          <Search />
          <input
            ref={input}
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setCategory(null);
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'Enter' && results?.[0]) void choose(results[0]);
            }}
            placeholder={t('maps.searchPlaceholder')}
            spellCheck={false}
          />
          <motion.button className="maps-search__cancel" data-pointer="highlight" onClick={onClose} whileTap={{ scale: 0.9 }}>
            {t('common.cancel')}
          </motion.button>
        </div>
        <div className="maps-chips">
          {chips.map((c, i) => (
            <motion.button
              key={c.id}
              className={`maps-chip maps-kind--${c.id}${category === c.id ? ' maps-chip--on' : ''}`}
              data-pointer="highlight"
              onClick={() => {
                setQuery('');
                setCategory(category === c.id ? null : c.id);
              }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring.snappy, delay: 0.04 + i * 0.03 }}
              whileTap={{ scale: 0.92 }}
            >
              <span className="maps-chip__icon">{c.icon}</span>
              {t(`maps.near.${c.id}` as StringKey)}
            </motion.button>
          ))}
        </div>
        <div className="maps-results">
          {results && results.length === 0 && <p className="maps-results__empty">{t(category === 'garage' ? 'maps.garagesEmpty' : 'maps.nearEmpty')}</p>}
          {results?.map((p, i) => {
            const d = distance(p.km * 1000);
            return (
              <motion.button
                key={`${p.at.join()}-${i}`}
                className="maps-result"
                data-pointer="highlight"
                onClick={() => void choose(p)}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...spring.snappy, delay: Math.min(i, 8) * 0.025 }}
              >
                <span className={`maps-result__icon maps-kind--${p.kind}`}>
                  <KindGlyph kind={p.kind} />
                </span>
                <span className="maps-result__text">
                  <b>{p.label || t(kindLabel(p.kind))}</b>
                  <span>{p.label ? t(kindLabel(p.kind)) : ''}</span>
                </span>
                {p.km > 0 && (
                  <span className="maps-result__km tabular">
                    {d.value} {d.unit}
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
