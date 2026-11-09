// CarPlay-style notification banners for what happens on the road: fines, tolls, ferries, trains,
// deliveries. They drop in from the top with a light spring and leave on their own.

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle, Download, Euro, Ferry, Train, Warning, XCircle } from '../icons/glyphs';
import { onGameEvent, type GameEvent } from '../state/telemetry';
import { t, type StringKey } from '../state/i18n';
import { money, number } from '../state/format';
import { settings } from '../state/ui';
import { useStore } from '../state/store';
import { spring } from '../design/motion';
import { recordEvent } from '../state/events';
import './banner.css';

export interface Note {
  id: number;
  tint: string;
  glyph: ReactNode;
  title: string;
  body: string;
}

let seq = 0;

export function describe(e: GameEvent): Omit<Note, 'id'> | null {
  const a = e.a;
  const num = (k: string) => Number(a[k] ?? 0);
  const str = (k: string) => String(a[k] ?? '');
  switch (e.id) {
    case 'player.fined': {
      const offence = str('fine.offence');
      const key = `offence.${offence}` as StringKey;
      const label = t(key) === key ? t('offence.generic') : t(key);
      return { tint: 'var(--red)', glyph: <Warning />, title: `${t('ev.fined')} · ${money(num('fine.amount'))}`, body: label };
    }
    case 'player.tollgate.paid':
      return { tint: 'var(--orange)', glyph: <Euro />, title: t('ev.toll'), body: money(num('pay.amount')) };
    case 'player.use.ferry':
      return {
        tint: 'var(--blue)',
        glyph: <Ferry />,
        title: t('ev.ferry'),
        body: `${str('source.name')} → ${str('target.name')} · ${money(num('pay.amount'))}`,
      };
    case 'player.use.train':
      return {
        tint: 'var(--indigo)',
        glyph: <Train />,
        title: t('ev.train'),
        body: `${str('source.name')} → ${str('target.name')} · ${money(num('pay.amount'))}`,
      };
    case 'job.delivered':
      return {
        tint: 'var(--green)',
        glyph: <CheckCircle />,
        title: t('ev.delivered'),
        body: `+${money(num('revenue'))} · ${number(num('earned.xp'))} XP`,
      };
    case 'job.cancelled':
      return { tint: 'var(--red)', glyph: <XCircle />, title: t('ev.cancelled'), body: `−${money(num('cancel.penalty'))}` };
    case 'truckplay.split':
      // The Split app turned split screen on or off (state/split.ts).
      return a.on
        ? { tint: 'var(--indigo)', glyph: <CheckCircle />, title: t('ev.splitOn'), body: t('ev.splitOnHint') }
        : { tint: 'var(--gray)', glyph: <CheckCircle />, title: t('ev.splitOff'), body: '' };
    case 'truckplay.mod':
      // The host made the mod again for an updated game (host/src/modcheck.js).
      return { tint: 'var(--blue)', glyph: <CheckCircle />, title: t('ev.modUpdated'), body: t('ev.modUpdatedHint').replace('{v}', str('version')) };
    case 'truckplay.update.ready':
      // A newer TruckPlay came down and checked out (host/src/updater.js); it goes in once the game closes.
      return {
        tint: 'var(--blue)',
        glyph: <Download />,
        title: t('ev.updateReady').replace('{v}', str('version')),
        body: t(a.when === 'window' ? 'ev.updateReadyWindow' : 'ev.updateReadyGame'),
      };
    case 'truckplay.updated':
      // The first start of a version an update put in.
      return { tint: 'var(--green)', glyph: <CheckCircle />, title: t('ev.updated'), body: t('ev.updatedHint').replace('{v}', str('version')) };
    default:
      return null;
  }
}

export function Banners() {
  const [notes, setNotes] = useState<Note[]>([]);
  const enabled = useStore(settings, s => s.notifications);

  useEffect(
    () =>
      onGameEvent(e => {
        const d = describe(e);
        if (!d) return;
        recordEvent(e, d.title, d.body);
        if (!settings.get().notifications) return;
        const note = { ...d, id: ++seq };
        setNotes(n => [...n.slice(-1), note]);
        window.setTimeout(() => setNotes(n => n.filter(x => x.id !== note.id)), 4600);
      }),
    [],
  );

  if (!enabled && notes.length === 0) return null;
  const top = notes[notes.length - 1];

  return (
    <div className="banners">
      <AnimatePresence>
        {top && (
          <motion.div
            key={top.id}
            className="banner glass-strong"
            initial={{ y: '-150%', scale: 0.94, opacity: 0.4 }}
            animate={{ y: '0%', scale: 1, opacity: 1 }}
            exit={{ y: '-150%', scale: 0.96, opacity: 0, transition: { type: 'spring', visualDuration: 0.3, bounce: 0 } }}
            transition={spring.bouncy}
            data-pointer="highlight"
            onClick={() => setNotes([])}
          >
            <motion.span
              className="banner__glyph"
              style={{ background: top.tint }}
              initial={{ scale: 0.2, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ ...spring.bouncy, delay: 0.08 }}
            >
              {top.glyph}
            </motion.span>
            <span className="banner__text">
              <motion.span className="banner__title" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.smooth, delay: 0.12 }}>
                {top.title}
              </motion.span>
              <motion.span className="banner__body" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.smooth, delay: 0.18 }}>
                {top.body}
              </motion.span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
