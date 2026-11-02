// Settings › Maps, the one place the map's settings live: how it looks (3D or 2D, heading or north
// up, 3D buildings) and which kinds of places it shows. Everything is on until switched off.

import type { ReactNode } from 'react';
import { Row, Section, Segmented, Toggle } from '../../components/AppScaffold';
import { Box, Bed, Euro, Ferry, FuelPump, Home, Map as MapGlyph, Message, Photo, Truck, Wrench } from '../../icons/glyphs';
import { MAP_POI_GROUPS } from '../../maps/style';
import { useStore } from '../../state/store';
import { settings } from '../../state/ui';
import { useT, type StringKey } from '../../state/i18n';
import './mapSettings.css';

const POI_ROWS: Record<string, { icon: ReactNode; tint: string }> = {
  service: { icon: <Wrench />, tint: 'var(--orange)' },
  fuel: { icon: <FuelPump />, tint: 'var(--blue)' },
  parking: { icon: <Bed />, tint: 'var(--indigo)' },
  garage: { icon: <Home />, tint: 'var(--purple)' },
  dealer: { icon: <Truck />, tint: 'var(--red)' },
  recruit: { icon: <Message />, tint: 'var(--teal)' },
  company: { icon: <Box />, tint: 'var(--brown)' },
  transport: { icon: <Ferry />, tint: 'var(--cyan)' },
  road: { icon: <Euro />, tint: 'var(--gray)' },
  sights: { icon: <Photo />, tint: 'var(--pink)' },
};

export function MapSettings() {
  const t = useT();
  const s = useStore(settings, x => ({ map3d: x.map3d, north: x.mapNorthUp, buildings: x.mapBuildings, pois: x.mapPois }));
  const setPoi = (id: string, on: boolean) => settings.patch({ mapPois: { ...settings.get().mapPois, [id]: on } });
  return (
    <>
      <Section title={t('settings.maps').toLocaleUpperCase('tr')}>
        <Row icon={<MapGlyph />} tint="var(--green)" title={t('maps.view')}>
          <Segmented<'3d' | '2d'>
            value={s.map3d ? '3d' : '2d'}
            onChange={v => settings.patch({ map3d: v === '3d' })}
            options={[
              { value: '3d', label: '3B' },
              { value: '2d', label: '2B' },
            ]}
          />
        </Row>
        <Row icon={<MapGlyph />} tint="var(--blue)" title={t('maps.heading')}>
          <Segmented<'up' | 'north'>
            value={s.north ? 'north' : 'up'}
            onChange={v => settings.patch({ mapNorthUp: v === 'north' })}
            options={[
              { value: 'up', label: t('maps.headingUp') },
              { value: 'north', label: t('maps.northUp') },
            ]}
          />
        </Row>
        <div className={s.map3d ? '' : 'map-settings__off'}>
          <Row icon={<Home />} tint="var(--gray)" title={t('maps.buildings')}>
            <Toggle on={s.buildings} onChange={v => settings.patch({ mapBuildings: v })} />
          </Row>
        </div>
      </Section>
      <Section title={t('maps.show').toLocaleUpperCase('tr')} footer={t('maps.showHint')}>
        {MAP_POI_GROUPS.map(g => (
          <Row key={g.id} icon={POI_ROWS[g.id]?.icon} tint={POI_ROWS[g.id]?.tint} title={t(`maps.poi.${g.id}` as StringKey)}>
            <Toggle on={s.pois[g.id] !== false} onChange={v => setPoi(g.id, v)} />
          </Row>
        ))}
      </Section>
    </>
  );
}
