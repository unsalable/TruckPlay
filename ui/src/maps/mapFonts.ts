// Map labels are drawn by MapLibre from the page's own fonts (no glyph server), so they share
// Inter with the rest of TırPlay. MapLibre reads the weight from the family name, which is why
// each weight gets its own family here, all pointing at the same variable font files.

import latin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import latinExt from '@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2?url';
import greek from '@fontsource-variable/inter/files/inter-greek-wght-normal.woff2?url';
import cyrillic from '@fontsource-variable/inter/files/inter-cyrillic-wght-normal.woff2?url';

export const MAP_FONT = {
  regular: 'TP Map Regular',
  medium: 'TP Map Medium',
  semibold: 'TP Map Semibold',
  bold: 'TP Map Bold',
} as const;

const SUBSETS: Array<[string, string]> = [
  [latin, 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'],
  [latinExt, 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'],
  [greek, 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF'],
  [cyrillic, 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'],
];

let installed = false;

export function installMapFonts() {
  if (installed) return;
  installed = true;
  for (const family of Object.values(MAP_FONT)) {
    for (const [url, unicodeRange] of SUBSETS) {
      document.fonts.add(new FontFace(family, `url(${url}) format('woff2')`, { weight: '100 900', unicodeRange, display: 'block' }));
    }
  }
}
