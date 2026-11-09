// The CarPlay Dashboard: the map on the left, three glass cards on the right — where to next, what
// is playing, and the delivery as a Live Activity (the arc from pickup to drop-off).

import { AnimatePresence, animate, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { GameMap } from '../maps/GameMap';
import { GameMapWaiting, LiveGameMap } from '../maps/LiveGameMap';
import { connection } from '../state/telemetry';
import { gameMapReady } from '../maps/gameMapFeed';
import { Equalizer } from '../apps/music/musicParts';
import { Rolling } from '../components/Rolling';
import { Cover } from '../components/Cover';
import { Backward, Bed, Box, Forward, Pause, Play, Truck } from '../icons/glyphs';
import { useStore } from '../state/store';
import { telemetry } from '../state/telemetry';
import { livePosition, media, nowPlaying } from '../state/media';
import { clock, dayShort, distance, duration, kmh } from '../state/format';
import { useT } from '../state/i18n';
import { nav, openApp, PAGE_DASHBOARD } from '../state/ui';
import { spring } from '../design/motion';
import { tapAllowed } from '../shell/stage';
import { useNow } from '../components/useNow';
import './dashboard.css';

export function Dashboard() {
  // Coming back to the Dashboard from another page, the cards file in one after another.
  const page = useStore(nav, n => n.page);
  const prev = useRef(page);
  const [wave, setWave] = useState(0);
  useEffect(() => {
    if (page === PAGE_DASHBOARD && prev.current !== PAGE_DASHBOARD) setWave(w => w + 1);
    prev.current = page;
  }, [page]);
  const cards = [<NextCard key="next" />, <NowPlayingCard key="np" />, <DeliveryCard key="live" />];
  // The map keeps its element (a live map is costly to rebuild); it only takes a breath.
  const mapSlot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (wave > 0 && mapSlot.current) animate(mapSlot.current, { opacity: [0.5, 1], scale: [0.97, 1] }, spring.smooth);
  }, [wave]);
  return (
    <div className="dash">
      <div className="dash__map-slot" ref={mapSlot}>
        <MapCard />
      </div>
      <div className="dash__side">
        {cards.map((card, i) => (
          <motion.div
            key={`${card.key}:${wave}`}
            className="dash__slot"
            initial={wave > 0 ? { opacity: 0, x: 36, scale: 0.94 } : false}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ ...spring.bouncy, delay: 0.05 + i * 0.07 }}
          >
            {card}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function openFrom(app: Parameters<typeof openApp>[0], e: React.MouseEvent) {
  if (!tapAllowed()) return;
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const s = Math.min(r.width, r.height) * 0.5;
  openApp(app, { x: r.left + r.width / 2 - s / 2, y: r.top + r.height / 2 - s / 2, w: s, h: s });
}

function MapCard() {
  const t = useT();
  const live = useStore(gameMapReady, r => r);
  const inGame = useStore(connection, c => c.state === 'live');
  const nav = useStore(telemetry, s => ({ dist: s.truck.nav.dist, time: s.truck.nav.time, limit: s.truck.nav.limit, now: s.game.time }));
  const routed = nav.dist > 50;
  const d = distance(nav.dist);
  return (
    <motion.div className="dash__map card" onClick={e => openFrom('maps', e)} data-pointer="highlight" whileTap={{ scale: 0.985 }} transition={spring.snappy}>
      {live ? (
        <LiveGameMap zoom={1} lift={0.18} className="live-map--small" />
      ) : inGame ? (
        <GameMapWaiting lift={0.18} className="live-map--small" hint={t('maps.waitCab')} />
      ) : (
        <GameMap variant="card" />
      )}
      {nav.limit > 0.5 && (
        <div className="speed-sign" aria-label={t('nav.speedLimit')}>
          <span className="tabular">{kmh(nav.limit)}</span>
        </div>
      )}
      <div className="dash__eta glass-strong">
        {routed ? (
          <>
            <span className="tabular">
              <b>
                <Rolling value={clock(nav.now + nav.time / 60)} />
              </b>{' '}
              {t('nav.arrival')}
            </span>
            <span>{duration(nav.time / 60)}</span>
            <span className="tabular">
              <Rolling value={d.value} /> {d.unit}
            </span>
          </>
        ) : (
          <span className="dash__eta-muted">{t('nav.noRoute')}</span>
        )}
      </div>
    </motion.div>
  );
}

function NextCard() {
  const t = useT();
  const s = useStore(telemetry, x => ({
    on: x.job.on,
    city: x.job.dst.city,
    company: x.job.dst.company,
    dist: x.truck.nav.dist,
    rest: x.game.rest,
  }));
  const d = distance(s.dist);
  return (
    <motion.div className="dash-card card glass" onClick={e => openFrom('job', e)} data-pointer="highlight" whileTap={{ scale: 0.97 }} transition={spring.snappy}>
      <span className="dash-card__badge" style={{ background: s.on ? 'var(--blue)' : 'var(--indigo)' }}>
        {s.on ? <Box /> : <Bed />}
      </span>
      <span className="dash-card__lines">
        {s.on ? (
          <>
            <span className="dash-card__title tabular">
              <Rolling value={d.value} /> {d.unit}
            </span>
            <span className="dash-card__sub">
              {s.city}
              {s.company ? ` · ${s.company}` : ''}
            </span>
          </>
        ) : (
          <>
            <span className="dash-card__title">{t('dash.freeDrive')}</span>
            <span className="dash-card__sub">
              {s.rest > 0 ? `${t('dash.restIn')} ${duration(s.rest)}` : t('dash.freeDriveHint')}
            </span>
          </>
        )}
      </span>
    </motion.div>
  );
}

function NowPlayingCard() {
  const t = useT();
  const np = useStore(nowPlaying, n => n);
  const has = np.source !== 'none' && !!np.title;
  useNow(np.playing ? 500 : 0);
  const progress = np.duration ? livePosition(np) / np.duration : 0;
  const key = `${np.title}\u0001${np.artist}`;
  return (
    <motion.div className="dash-card dash-card--media card glass" onClick={e => openFrom('nowplaying', e)} data-pointer="highlight" whileTap={{ scale: 0.97 }} transition={spring.snappy}>
      {has ? (
        <>
          <span className="dash-cover">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={key}
                className="dash-cover__art"
                initial={{ opacity: 0, scale: 0.7, rotate: -8 }}
                animate={{ opacity: 1, scale: np.playing ? 1 : 0.88, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.7, rotate: 8 }}
                transition={spring.bouncy}
              >
                <Cover src={np.artwork} hue={np.hue} size="var(--np-cover)" radius="9rem" />
              </motion.span>
            </AnimatePresence>
            {np.app?.icon && <img className="dash-cover__app" src={np.app.icon} alt="" />}
          </span>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={key}
              className="dash-card__lines dash-card__lines--media"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={spring.smooth}
            >
              <span className="dash-card__song">
                {np.playing && <Equalizer className="dash-card__eq" />}
                {np.title}
              </span>
              <span className="dash-card__sub">{np.artist || np.app?.name}</span>
              {np.duration > 0 && (
                <span className="mini-progress">
                  <span style={{ transform: `scaleX(${progress})` }} />
                </span>
              )}
            </motion.span>
          </AnimatePresence>
          <span className="dash-card__controls" onClick={e => e.stopPropagation()}>
            <motion.button className="ctl" data-pointer="highlight" onClick={media.previous} whileTap={{ scale: 0.78, x: -3 }} transition={spring.snappy} aria-label="previous">
              <Backward />
            </motion.button>
            <motion.button className="ctl ctl--main" data-pointer="highlight" onClick={media.toggle} whileTap={{ scale: 0.8 }} transition={spring.snappy} aria-label="play">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={np.playing ? 'pause' : 'play'}
                  className="ctl__glyph"
                  initial={{ opacity: 0, scale: 0.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.4 }}
                  transition={spring.snappy}
                >
                  {np.playing ? <Pause /> : <Play />}
                </motion.span>
              </AnimatePresence>
            </motion.button>
            <motion.button className="ctl" data-pointer="highlight" onClick={media.next} whileTap={{ scale: 0.78, x: 3 }} transition={spring.snappy} aria-label="next">
              <Forward />
            </motion.button>
          </span>
        </>
      ) : (
        <span className="dash-card__lines">
          <span className="dash-card__title">{t('dash.noMusic')}</span>
          <span className="dash-card__sub">{t('dash.noMusicHint')}</span>
        </span>
      )}
    </motion.div>
  );
}

function DeliveryCard() {
  const t = useT();
  const s = useStore(telemetry, x => ({
    on: x.job.on,
    src: x.job.src.city,
    dst: x.job.dst.city,
    planned: x.job.plannedKm,
    dist: x.truck.nav.dist,
    navTime: x.truck.nav.time,
    now: x.game.time,
    due: x.job.due,
    cargo: x.job.cargo,
    fuel: x.truck.fuel,
    cap: x.truck.fuelCap,
    range: x.truck.fuelRange,
  }));
  if (!s.on) {
    const pct = s.cap ? s.fuel / s.cap : 0;
    const r = distance(s.range);
    return (
      <div className="dash-card card glass">
        <span className="dash-card__badge" style={{ background: 'var(--orange)' }}>
          <Truck />
        </span>
        <span className="dash-card__lines">
          <span className="dash-card__title tabular">%{Math.round(pct * 100)}</span>
          <span className="dash-card__sub tabular">
            {t('dash.fuel')} · {r.value} {r.unit} {t('dash.range')}
          </span>
        </span>
      </div>
    );
  }
  const progress = s.planned > 0 ? Math.min(1, Math.max(0, 1 - s.dist / 1000 / s.planned)) : 0;
  const eta = s.now + s.navTime / 60;
  const late = s.due > 0 && eta > s.due;
  return (
    <motion.div className="dash-card dash-card--live card glass" onClick={e => openFrom('job', e)} data-pointer="highlight" whileTap={{ scale: 0.97 }} transition={spring.snappy}>
      <div className="live__top">
        <span className="live__cargo">
          <Box /> {s.cargo}
        </span>
        <span className="live__eta tabular" style={{ color: late ? 'var(--red)' : 'var(--green)' }}>
          {dayShort(eta)} {clock(eta)}
        </span>
      </div>
      <Arc progress={progress} />
      <div className="live__ends">
        <span className="live__city">{s.src}</span>
        <span className="live__mid">
          <span className="live__caption">{t('nav.arrival').toLocaleUpperCase('tr')}</span>
          <span className="tabular">{duration(s.navTime / 60)}</span>
        </span>
        <span className="live__city live__city--dst">{s.dst}</span>
      </div>
    </motion.div>
  );
}

function Arc({ progress }: { progress: number }) {
  // Quadratic arc from (6,30) through the top to (194,30); the truck rides along it.
  const p0 = { x: 6, y: 30 };
  const c = { x: 100, y: -8 };
  const p1 = { x: 194, y: 30 };
  const at = (u: number) => ({
    x: (1 - u) * (1 - u) * p0.x + 2 * (1 - u) * u * c.x + u * u * p1.x,
    y: (1 - u) * (1 - u) * p0.y + 2 * (1 - u) * u * c.y + u * u * p1.y,
  });
  const pos = at(progress);
  const d = `M${p0.x} ${p0.y}Q${c.x} ${c.y} ${p1.x} ${p1.y}`;
  return (
    <svg className="live__arc" viewBox="0 0 200 36" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="2.4" strokeLinecap="round" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" pathLength={1} strokeDasharray={`${progress} 1`} />
      <circle cx={p0.x} cy={p0.y} r="3.4" fill="currentColor" />
      <circle cx={p1.x} cy={p1.y} r="3.4" fill="currentColor" fillOpacity="0.5" />
      <circle cx={pos.x} cy={pos.y} r="5.6" fill="var(--blue)" stroke="#fff" strokeWidth="1.6" />
    </svg>
  );
}
