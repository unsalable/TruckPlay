// iOS 26 CarPlay's widget page, for a truck: the game clock with the day's two deadlines in the
// calendar widget's language, and four status tiles in the Home widget's.

import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { Rolling } from '../components/Rolling';
import { spring } from '../design/motion';
import { Bed, Drop, FuelPump, Gauge, Wrench } from '../icons/glyphs';
import { useStore } from '../state/store';
import { telemetry } from '../state/telemetry';
import { clock, dayLong, dayShort, duration, distance, kmh } from '../state/format';
import { useT } from '../state/i18n';
import './widgets.css';

export function Widgets() {
  const t = useT();
  const s = useStore(telemetry, x => ({
    now: x.game.time,
    rest: x.game.rest,
    job: x.job.on,
    due: x.job.due,
    dst: x.job.dst.city,
    company: x.job.dst.company,
    navTime: x.truck.nav.time,
    fuel: x.truck.fuel,
    cap: x.truck.fuelCap,
    range: x.truck.fuelRange,
    adblue: x.truck.adblue,
    adblueCap: x.truck.adblueCap,
    speed: x.truck.speed,
    limit: x.truck.nav.limit,
    wear: Math.max(x.truck.wear.engine, x.truck.wear.trans, x.truck.wear.cabin, x.truck.wear.chassis, x.truck.wear.wheels),
    waterT: x.truck.waterT,
    on: x.truck.on,
  }));

  const fuelPct = s.cap ? s.fuel / s.cap : 0;
  const adPct = s.adblueCap ? s.adblue / s.adblueCap : 0;
  const late = s.job && s.due > 0 && s.now + s.navTime / 60 > s.due;
  const range = distance(s.range);
  const over = s.limit > 0.5 && kmh(s.speed) > kmh(s.limit) + 2;

  return (
    <div className="widgets">
      <section className="w-cal">
        <div className="w-cal__clock">
          <span className="w-cal__time tabular">
            <Rolling value={clock(s.now)} />
          </span>
          <span className="w-cal__day">{s.now ? dayLong(s.now) : t('widgets.clock')}</span>
        </div>
        <ul className="w-cal__events">
          {s.job && (
            <li style={{ '--bar': late ? 'var(--red)' : 'var(--yellow)' } as React.CSSProperties}>
              <span className="w-cal__when tabular">
                {dayShort(s.due)} {clock(s.due)}
              </span>
              <span className="w-cal__what">
                {t('widgets.due')} · {s.dst}
              </span>
            </li>
          )}
          {s.rest > 0 && (
            <li style={{ '--bar': 'var(--green)' } as React.CSSProperties}>
              <span className="w-cal__when tabular">{clock(s.now + s.rest)}</span>
              <span className="w-cal__what">
                {t('dash.rest')} · {duration(s.rest)}
              </span>
            </li>
          )}
        </ul>
      </section>

      <section className="w-tiles">
        <Tile index={0} glyph={<FuelPump />} tint="var(--orange)" title={t('truck.fuel')} value={`%${Math.round(fuelPct * 100)} · ${range.value} ${range.unit}`} alert={fuelPct < 0.12 && s.on} />
        <Tile index={1} glyph={<Drop />} tint="var(--cyan)" title={t('truck.adblue')} value={`%${Math.round(adPct * 100)}`} alert={adPct < 0.1 && s.on} />
        <Tile index={2} glyph={<Gauge />} tint="var(--blue)" title={`${kmh(s.speed)} km/sa`} value={s.limit > 0.5 ? `${t('nav.speedLimit')} ${kmh(s.limit)}` : '—'} alert={over} />
        <Tile index={3} glyph={s.rest > 0 && s.rest < 60 ? <Bed /> : <Wrench />} tint="var(--green)" title={t('truck.damage')} value={`%${Math.round(s.wear * 100)}`} alert={s.wear > 0.25} />
      </section>
    </div>
  );
}

function Tile({ index, glyph, tint, title, value, alert }: { index: number; glyph: ReactNode; tint: string; title: string; value: string; alert?: boolean }) {
  return (
    <motion.div
      className={`w-tile ${alert ? 'w-tile--alert' : 'glass'}`}
      initial={{ opacity: 0, y: 18, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...spring.bouncy, delay: 0.06 + index * 0.06 }}
    >
      <span className="w-tile__glyph" style={{ color: alert ? 'var(--red)' : tint }}>
        {glyph}
      </span>
      <span className="w-tile__title">{title}</span>
      <span className="w-tile__value tabular">
        <Rolling value={value} />
      </span>
    </motion.div>
  );
}
