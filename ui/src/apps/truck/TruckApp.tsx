// Tır: the truck at a glance, in CarPlay Ultra's instrument language — one large speedometer with
// the rev band inside it, then the systems you check on a long haul.

import { motion, useSpring, useTransform } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { AppScaffold, Empty } from '../../components/AppScaffold';
import { Battery, Drop, FuelPump, Gauge, HighBeam, LowBeam, ParkingBrake, Thermometer, Truck, Warning } from '../../icons/glyphs';
import { useStore } from '../../state/store';
import { telemetry } from '../../state/telemetry';
import { distance, gearLabel, kmh, number } from '../../state/format';
import { useT } from '../../state/i18n';
import './truck.css';

const SWEEP = 260; // degrees
const START = 140; // from 3 o'clock, clockwise

function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const a0 = ((START + from * SWEEP) * Math.PI) / 180;
  const a1 = ((START + to * SWEEP) * Math.PI) / 180;
  const large = (to - from) * SWEEP > 180 ? 1 : 0;
  return `M${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)}A${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`;
}

function Speedometer() {
  const t = useT();
  const s = useStore(telemetry, x => ({
    speed: kmh(x.truck.speed),
    rpm: x.truck.rpm,
    rpmMax: x.truck.rpmMax || 2500,
    gear: x.truck.dgear,
    limit: kmh(x.truck.nav.limit),
    cruise: kmh(x.truck.cruise),
  }));
  const max = 130;
  const speed = useSpring(0, { stiffness: 140, damping: 22 });
  const rpm = useSpring(0, { stiffness: 140, damping: 22 });
  useEffect(() => {
    speed.set(Math.min(max, s.speed) / max);
    rpm.set(Math.min(1, s.rpm / s.rpmMax));
  }, [s.speed, s.rpm, s.rpmMax, speed, rpm]);
  const speedArc = useTransform(speed, v => arcPath(100, 100, 84, 0, Math.max(0.0001, v)));
  const rpmArc = useTransform(rpm, v => arcPath(100, 100, 69, 0, Math.max(0.0001, v)));
  const ticks: ReactNode[] = [];
  for (let i = 0; i <= 13; i++) {
    const a = ((START + (i / 13) * SWEEP) * Math.PI) / 180;
    const major = i % 2 === 0;
    ticks.push(
      <line
        key={i}
        x1={100 + Math.cos(a) * (major ? 92 : 94)}
        y1={100 + Math.sin(a) * (major ? 92 : 94)}
        x2={100 + Math.cos(a) * 98}
        y2={100 + Math.sin(a) * 98}
        stroke="currentColor"
        strokeOpacity={major ? 0.55 : 0.25}
        strokeWidth={major ? 1.6 : 1}
        strokeLinecap="round"
      />,
    );
  }
  const limitMark = s.limit > 0 ? ((START + (Math.min(max, s.limit) / max) * SWEEP) * Math.PI) / 180 : null;
  const over = s.limit > 0 && s.speed > s.limit + 2;
  return (
    <div className="speedo">
      <svg viewBox="0 0 200 200" className="speedo__svg">
        <defs>
          <linearGradient id="speedo-g" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#0a84ff" />
            <stop offset="1" stopColor="#64d2ff" />
          </linearGradient>
        </defs>
        {ticks}
        <path d={arcPath(100, 100, 84, 0, 1)} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="9" strokeLinecap="round" />
        <motion.path d={speedArc} fill="none" stroke={over ? 'var(--red)' : 'url(#speedo-g)'} strokeWidth="9" strokeLinecap="round" />
        <path d={arcPath(100, 100, 69, 0, 1)} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="4" strokeLinecap="round" />
        <motion.path d={rpmArc} fill="none" stroke="var(--orange)" strokeWidth="4" strokeLinecap="round" />
        {limitMark !== null && (
          <circle cx={100 + Math.cos(limitMark) * 84} cy={100 + Math.sin(limitMark) * 84} r="6.5" fill="#fff" stroke="#e2231a" strokeWidth="3" />
        )}
      </svg>
      <div className="speedo__center">
        <span className="speedo__value tabular">{s.speed}</span>
        <span className="speedo__unit">{t('unit.kmh')}</span>
        <span className="speedo__gear">
          <b className="tabular">{gearLabel(s.gear)}</b>
          {s.cruise > 0 && <span className="tabular">· {s.cruise}</span>}
        </span>
        <span className="speedo__rpm tabular">{number(Math.round(s.rpm / 10) * 10)} rpm</span>
      </div>
    </div>
  );
}

function Meter({ glyph, tint, label, value, fraction, warn }: { glyph: ReactNode; tint: string; label: string; value: string; fraction?: number; warn?: boolean }) {
  return (
    <div className={`meter glass ${warn ? 'meter--warn' : ''}`}>
      <span className="meter__glyph" style={{ color: warn ? 'var(--red)' : tint }}>
        {glyph}
      </span>
      <span className="meter__label">{label}</span>
      <span className="meter__value tabular">{value}</span>
      {fraction !== undefined && (
        <span className="meter__bar">
          <motion.span
            style={{ background: warn ? 'var(--red)' : tint, transformOrigin: '0 50%' }}
            animate={{ scaleX: Math.max(0, Math.min(1, fraction)) }}
            transition={{ type: 'spring', visualDuration: 0.6, bounce: 0 }}
          />
        </span>
      )}
    </div>
  );
}

export function TruckApp() {
  const t = useT();
  const s = useStore(telemetry, x => x.truck);
  const trailer = useStore(telemetry, x => x.trailer);
  if (!s.on) {
    return (
      <AppScaffold title={t('truck.title')} scroll={false}>
        <Empty glyph={<Truck />} title={t('truck.noTruck')} hint={t('truck.noTruckHint')} />
      </AppScaffold>
    );
  }
  const fuelPct = s.fuelCap ? s.fuel / s.fuelCap : 0;
  const range = distance(s.fuelRange);
  const wear: Array<[string, number]> = [
    [t('truck.engine'), s.wear.engine],
    [t('truck.transmission'), s.wear.trans],
    [t('truck.cabin'), s.wear.cabin],
    [t('truck.chassis'), s.wear.chassis],
    [t('truck.wheels'), s.wear.wheels],
  ];
  if (trailer.on) wear.push([t('truck.trailer'), Math.max(trailer.wear.body, trailer.wear.chassis, trailer.wear.wheels)]);

  return (
    <AppScaffold
      title={`${s.brand} ${s.name}`.trim() || t('truck.title')}
      trailing={s.plate ? <span className="plate">{s.plate}</span> : undefined}
      scroll={false}
    >
      <div className="truck">
        <Speedometer />
        <div className="truck__side">
          <div className="truck__meters">
            <Meter glyph={<FuelPump />} tint="var(--orange)" label={`${t('truck.fuel')} · ${range.value} ${range.unit}`} value={`%${Math.round(fuelPct * 100)}`} fraction={fuelPct} warn={s.fuelWarn} />
            <Meter glyph={<Drop />} tint="var(--cyan)" label={t('truck.adblue')} value={`${number(s.adblue)} L`} fraction={s.adblueCap ? s.adblue / s.adblueCap : 0} warn={s.adblueWarn} />
            <Meter glyph={<Gauge />} tint="var(--blue)" label={t('truck.air')} value={`${number(s.air, 1)} bar`} fraction={s.air / 10} warn={s.airWarn || s.airEmg} />
            <Meter glyph={<Thermometer />} tint="var(--yellow)" label={t('truck.oil')} value={`${number(s.oilT)} °C`} fraction={s.oilT / 130} warn={s.oilWarn} />
            <Meter glyph={<Thermometer />} tint="var(--teal)" label={t('truck.water')} value={`${number(s.waterT)} °C`} fraction={s.waterT / 120} warn={s.waterWarn} />
            <Meter glyph={<Battery />} tint="var(--green)" label={t('truck.battery')} value={`${number(s.batt, 1)} V`} fraction={s.batt / 30} warn={s.battWarn} />
          </div>
          <div className="truck__wear glass">
            {wear.map(([label, v]) => (
              <div className="wear" key={label}>
                <span className="wear__label">{label}</span>
                <span className="wear__bar">
                  <span style={{ width: `${Math.max(2, Math.min(100, v * 100))}%`, background: v > 0.3 ? 'var(--red)' : v > 0.12 ? 'var(--orange)' : 'var(--green)' }} />
                </span>
                <span className="wear__value tabular">%{Math.round(v * 100)}</span>
              </div>
            ))}
          </div>
          <div className="truck__chips">
            <Chip on={s.lights.low} glyph={<LowBeam />} tint="var(--green)" label={t('truck.lowBeam')} />
            <Chip on={s.lights.high} glyph={<HighBeam />} tint="var(--blue)" label={t('truck.highBeam')} />
            <Chip on={s.pbrake} glyph={<ParkingBrake />} tint="var(--red)" label={t('truck.parkingBrake')} />
            <Chip on={s.lights.hazard} glyph={<Warning />} tint="var(--orange)" label={t('truck.hazard')} />
          </div>
        </div>
      </div>
    </AppScaffold>
  );
}

function Chip({ on, glyph, tint, label }: { on: boolean; glyph: ReactNode; tint: string; label: string }) {
  return (
    <span className={`chip ${on ? 'chip--on' : ''}`} style={{ color: on ? tint : undefined }} title={label}>
      {glyph}
      <span className="chip__label">{label}</span>
    </span>
  );
}
