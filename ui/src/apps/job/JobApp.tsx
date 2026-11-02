import type { ReactNode } from 'react';
import { AppScaffold, Empty, Row, Section } from '../../components/AppScaffold';
import { Box, CheckCircle, Clock, Euro, Ferry, Road, Train, Warning, Weight, XCircle } from '../../icons/glyphs';
import { useStore } from '../../state/store';
import { telemetry } from '../../state/telemetry';
import { eventLog } from '../../state/events';
import { clock, dayShort, distanceText, duration, mass, money, number } from '../../state/format';
import { useT } from '../../state/i18n';
import './job.css';

const eventGlyph: Record<string, [ReactNode, string]> = {
  'player.fined': [<Warning key="w" />, 'var(--red)'],
  'player.tollgate.paid': [<Euro key="e" />, 'var(--orange)'],
  'player.use.ferry': [<Ferry key="f" />, 'var(--blue)'],
  'player.use.train': [<Train key="t" />, 'var(--indigo)'],
  'job.delivered': [<CheckCircle key="c" />, 'var(--green)'],
  'job.cancelled': [<XCircle key="x" />, 'var(--red)'],
};

export function JobApp() {
  const t = useT();
  const s = useStore(telemetry, x => ({ job: x.job, now: x.game.time, dist: x.truck.nav.dist, navTime: x.truck.nav.time }));
  const log = useStore(eventLog, l => l, (a, b) => a === b);
  const { job } = s;
  const eta = s.now + s.navTime / 60;
  const left = job.due - s.now;
  const late = job.due > 0 && eta > job.due;
  const progress = job.plannedKm > 0 ? Math.min(1, Math.max(0, 1 - s.dist / 1000 / job.plannedKm)) : 0;

  return (
    <AppScaffold title={t('job.title')}>
      {!job.on ? (
        <div className="job-empty">
          <Empty glyph={<Box />} title={t('job.none')} hint={t('job.noneHint')} />
        </div>
      ) : (
        <>
          <div className="route glass">
            <div className="route__ends">
              <div>
                <span className="route__label">{t('job.from')}</span>
                <span className="route__city">{job.src.city}</span>
                <span className="route__company">{job.src.company}</span>
              </div>
              <div className="route__right">
                <span className="route__label">{t('job.to')}</span>
                <span className="route__city">{job.dst.city}</span>
                <span className="route__company">{job.dst.company}</span>
              </div>
            </div>
            <div className="route__track">
              <span className="route__fill" style={{ width: `${progress * 100}%` }} />
              <span className="route__truck" style={{ left: `${progress * 100}%` }} />
            </div>
            <div className="route__meta tabular">
              <span>{distanceText(s.dist)}</span>
              <span>{duration(s.navTime / 60)}</span>
              <span style={{ color: late ? 'var(--red)' : 'var(--green)' }}>
                {dayShort(eta)} {clock(eta)}
              </span>
            </div>
          </div>

          <Section>
            <Row icon={<Box />} tint="var(--brown)" title={t('job.cargo')} value={job.cargo} />
            <Row icon={<Weight />} tint="var(--gray)" title={t('job.mass')} value={mass(job.mass)} />
            <Row icon={<Euro />} tint="var(--green)" title={t('job.income')} value={money(job.income)} />
            <Row
              icon={<Clock />}
              tint={late ? 'var(--red)' : 'var(--blue)'}
              title={t('job.due')}
              subtitle={left > 0 ? `${duration(left)} ${t('widgets.left')}` : t('widgets.late')}
              value={`${dayShort(job.due)} ${clock(job.due)}`}
            />
            <Row icon={<Road />} tint="var(--indigo)" title={t('job.planned')} value={`${number(job.plannedKm)} km`} />
            <Row icon={<Warning />} tint="var(--orange)" title={t('job.damage')} value={`%${number(job.damage * 100, 1)}`} />
          </Section>
        </>
      )}

      <Section title={t('job.log').toLocaleUpperCase('tr')}>
        {log.length === 0 ? (
          <Row title={<span style={{ color: 'var(--label-2)' }}>{t('job.logEmpty')}</span>} />
        ) : (
          log.slice(0, 12).map(e => {
            const [glyph, tint] = eventGlyph[e.kind] ?? [<Warning key="d" />, 'var(--gray)'];
            return <Row key={e.id} icon={glyph} tint={tint} title={e.title} subtitle={e.body} value={e.gameTime ? `${dayShort(e.gameTime)} ${clock(e.gameTime)}` : ''} />;
          })
        )}
      </Section>
    </AppScaffold>
  );
}
