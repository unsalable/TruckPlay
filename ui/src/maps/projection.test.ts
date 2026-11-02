import { describe, expect, it } from 'vitest';
import { gameToLngLat, headingToBearing, lngLatToGame } from './projection';
import { shieldLabel } from './icons';

// Reference points from truckermudgeon/maps, whose tiles TırPlay draws.
const POINTS: Array<[string, [number, number], [number, number]]> = [
  ['south of London (UK scale)', [-40_169, -10_685], [-0.5943602137854889, 51.29443960532431]],
  ['Crete', [62_276, 84_880], [24.63877984644102, 35.391305791648065]],
  ['Batisse depot, Paris', [-30_120, 5_847], [2.2454398875049852, 48.96983557895307]],
];

describe('ETS2 projection', () => {
  it.each(POINTS)('%s: game → lng/lat', (_name, game, lngLat) => {
    const [lng, lat] = gameToLngLat(...game);
    expect(lng).toBeCloseTo(lngLat[0], 9);
    expect(lat).toBeCloseTo(lngLat[1], 9);
  });

  it.each(POINTS)('%s: lng/lat → game', (_name, game, lngLat) => {
    const [x, z] = lngLatToGame(...lngLat);
    expect(x).toBeCloseTo(game[0], 6);
    expect(z).toBeCloseTo(game[1], 6);
  });

  it('turns grid north into a compass bearing with the cone’s convergence', () => {
    expect(headingToBearing(0, 15)).toBeCloseTo(0, 9); // on the central meridian
    expect(headingToBearing(0.25, 15)).toBeCloseTo(270, 9); // west
    expect(headingToBearing(0, 29)).toBeGreaterThan(10); // İstanbul: grid north leans east
  });
});

describe('road shields', () => {
  it('reads the sign from the sprite name', () => {
    expect(shieldLabel('d_a20').label).toBe('A20');
    expect(shieldLabel('tr_o3').label).toBe('O-3');
    expect(shieldLabel('tr_d100').label).toBe('D100');
    expect(shieldLabel('es_ap9').label).toBe('AP-9');
    expect(shieldLabel('swe_47').label).toBe('47');
    expect(shieldLabel('ro_21b').label).toBe('21B');
  });
});
