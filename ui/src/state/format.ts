import { language, t, type Lang } from './i18n';

// Game time is minutes since 00:00 of the first in-game day, a Monday.

const locale = (lang: Lang) => (lang === 'tr' ? 'tr-TR' : 'en-GB');

/** 24-hour clock; Turkish writes the hour with two digits (05:02), English does not (5:02). */
export function clock(minutes: number, lang: Lang = language.get()): string {
  const m = Math.floor(((minutes % 1440) + 1440) % 1440);
  const h = String(Math.floor(m / 60));
  return `${lang === 'tr' ? h.padStart(2, '0') : h}:${String(m % 60).padStart(2, '0')}`;
}

export function dayIndex(minutes: number): number {
  return Math.floor(minutes / 1440) % 7;
}

export function dayShort(minutes: number, lang: Lang = language.get()): string {
  return t('days.short', lang).split(',')[dayIndex(minutes)];
}

export function dayLong(minutes: number, lang: Lang = language.get()): string {
  return t('days.long', lang).split(',')[dayIndex(minutes)];
}

/** "3 sa 14 dk", "45 dk" */
export function duration(minutes: number, lang: Lang = language.get()): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} ${t('unit.min', lang)}`;
  if (m === 0) return `${h} ${t('unit.h', lang)}`;
  return `${h} ${t('unit.h', lang)} ${m} ${t('unit.min', lang)}`;
}

/** Short form for tight spaces: "3:14 sa" style is avoided; use "3 sa" / "45 dk". */
export function durationShort(minutes: number, lang: Lang = language.get()): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} ${t('unit.min', lang)}`;
  const h = total / 60;
  return `${h < 10 ? h.toFixed(1).replace('.', lang === 'tr' ? ',' : '.') : Math.round(h)} ${t('unit.h', lang)}`;
}

export function number(value: number, digits = 0, lang: Lang = language.get()): string {
  return new Intl.NumberFormat(locale(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** Meters → "650 m", "12,4 km", "234 km". */
export function distance(meters: number, lang: Lang = language.get()): { value: string; unit: string } {
  if (meters < 1000) return { value: number(Math.round(meters / 10) * 10, 0, lang), unit: 'm' };
  const km = meters / 1000;
  return { value: number(km, km < 100 ? 1 : 0, lang), unit: 'km' };
}

export function distanceText(meters: number, lang: Lang = language.get()): string {
  const d = distance(meters, lang);
  return `${d.value} ${d.unit}`;
}

export const kmh = (ms: number) => Math.round(Math.abs(ms) * 3.6);

export function money(euros: number, lang: Lang = language.get()): string {
  return `${number(Math.round(euros), 0, lang)} €`;
}

export function mass(kg: number, lang: Lang = language.get()): string {
  return kg >= 1000 ? `${number(kg / 1000, kg < 100_000 ? 1 : 0, lang)} t` : `${number(kg, 0, lang)} kg`;
}

export function percent(fraction: number, lang: Lang = language.get()): string {
  return `%${number(Math.round(fraction * 100), 0, lang)}`.replace(/^%(.*)$/, lang === 'tr' ? '%$1' : '$1%');
}

/** Gear as the dashboard shows it: R1, N, 1…12, with the retarder-friendly "C" for crawl kept simple. */
export function gearLabel(gear: number): string {
  if (gear === 0) return 'N';
  if (gear < 0) return `R${-gear}`;
  return String(gear);
}
