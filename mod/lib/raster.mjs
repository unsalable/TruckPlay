// A tiny BGRA canvas: enough to draw the calibration grid and the boot splash without native deps.

const FONT = {
  // 5×7 glyphs, one string per row, '#' = ink
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '..##.', '...#.', '..#..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  x: ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
};

// Every letter a wordmark or label here uses must be drawn above: a missing one silently leaves a
// gap ("TR   PLAY").
export function missingGlyphs(text) {
  return [...new Set(text)].filter(ch => !(ch in FONT));
}

export class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4);
  }

  // color: [r, g, b, a?]
  fillRect(x, y, w, h, [r, g, b, a = 255]) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      let o = (yy * this.width + x0) * 4;
      for (let xx = x0; xx < x1; xx++, o += 4) {
        this.data[o] = b;
        this.data[o + 1] = g;
        this.data[o + 2] = r;
        this.data[o + 3] = a;
      }
    }
  }

  fill(color) {
    this.fillRect(0, 0, this.width, this.height, color);
  }

  // Vertical gradient between two colors.
  gradient(top, bottom) {
    for (let y = 0; y < this.height; y++) {
      const t = y / Math.max(1, this.height - 1);
      const c = top.map((v, i) => Math.round(v + (bottom[i] - v) * t));
      this.fillRect(0, y, this.width, 1, c);
    }
  }

  text(str, x, y, scale, color) {
    let cx = x;
    for (const ch of String(str)) {
      const g = FONT[ch] ?? FONT[' '];
      g.forEach((row, ry) => {
        for (let rx = 0; rx < 5; rx++) if (row[rx] === '#') this.fillRect(cx + rx * scale, y + ry * scale, scale, scale, color);
      });
      cx += 6 * scale;
    }
    return cx - x;
  }

  textWidth(str, scale) {
    return String(str).length * 6 * scale - scale;
  }
}
