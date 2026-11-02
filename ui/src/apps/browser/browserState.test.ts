import { describe, expect, it } from 'vitest';
import { frequent, hostOf, resolveInput } from './browserState';

describe('address field', () => {
  it('opens addresses as they are', () => {
    expect(resolveInput('https://truckersmp.com/events')).toBe('https://truckersmp.com/events');
    expect(resolveInput('  worldoftrucks.com  ')).toBe('https://worldoftrucks.com');
    expect(resolveInput('tr.wikipedia.org/wiki/Scania')).toBe('https://tr.wikipedia.org/wiki/Scania');
  });

  it('searches everything else', () => {
    expect(resolveInput('istanbul hava durumu')).toBe('https://www.google.com/search?q=istanbul%20hava%20durumu');
    expect(resolveInput('scania')).toBe('https://www.google.com/search?q=scania');
    expect(resolveInput('   ')).toBe('');
  });

  it('shows hosts without www and mobile prefixes', () => {
    expect(hostOf('https://www.google.com/search?q=x')).toBe('google.com');
    expect(hostOf('https://m.youtube.com/watch?v=1')).toBe('youtube.com');
  });

  it('ranks frequent sites per host', () => {
    const list = frequent([
      { url: 'https://m.youtube.com/a', title: 'a', visits: 2, last: 1 },
      { url: 'https://m.youtube.com/b', title: 'b', visits: 3, last: 2 },
      { url: 'https://truckersmp.com', title: 't', visits: 4, last: 3 },
    ]);
    expect(list.map(v => hostOf(v.url))).toEqual(['youtube.com', 'truckersmp.com']);
    expect(list[0].visits).toBe(5);
  });
});
