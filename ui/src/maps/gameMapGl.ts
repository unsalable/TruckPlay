// Draws the game's own GPS map (gameMapFeed.ts) in Apple Maps' colours, with WebGL 2.
//
// The game paints its map in a handful of flat colours of its own (def/map_data.sii): roads it has
// seen yellow, the rest grey, junctions beige, buildings orange, grass green, the route red with a
// black edge, green arrows where it turns, all over nothing (alpha 0). So every pixel is one of those
// colours, or, along an edge, a blend of two of them. Each new frame is first sorted out once, at the
// map's own size: for every pixel, the one colour or the blend of two that comes closest, which says
// how much of it is road, building, grass, route and so on. A pixel nothing explains (the game's
// icons) keeps its own colour. Then every screen frame paints those shares in the theme's colours,
// with casings along the roads, cropped and zoomed around the truck: the route and the marks are
// the game's own, exactly and at once; only the paint is Apple's. The game's own truck, in the
// middle of its map, gives way to the road around it (Apple's arrow stands there instead).

import type { MapTheme } from './style';

export interface GameMapFrame {
  w: number;
  h: number;
  /** RGBA, rows top down, colour straight (not premultiplied). */
  data: Uint8Array;
}

/** What one screen frame shows: `zoom` 1 is what the game's own GPS screen shows across the
 *  height (half the map's height), more is closer; the truck sits `lift` of the height below the
 *  middle. */
export interface GameMapView {
  zoom: number;
  lift: number;
  theme: MapTheme;
}

// The game's map colours (def/map_data.sii; the file writes 0xAABBGGRR) and what each one is.
const Kind = { Road: 0, Building: 1, Park: 2, Route: 3, RouteLater: 4, Edge: 5, Arrow: 6, Nothing: 7 } as const;
type Kind = (typeof Kind)[keyof typeof Kind];

const GAME_COLOURS: Array<[number, Kind]> = [
  [0xffc64c, Kind.Road], // road_discovered_color: roads the driver has seen
  [0x707070, Kind.Road], // road_color: roads not yet seen
  [0xebca98, Kind.Road], // prefab_discovered_color: the driveable part of junctions
  [0x737373, Kind.Road], // prefab_color, prefab_grass_color: junctions not yet seen
  [0xe0a23b, Kind.Building], // prefab_obstacle_discovered_color
  [0x333333, Kind.Building], // prefab_obstacle_color
  [0xa9ca95, Kind.Park], // prefab_grass_discovered_color
  [0xdf420c, Kind.Route], // navigation_current_color, navigation_highlight_color
  [0x7c0707, Kind.RouteLater], // navigation_color, navigation_fade_color: legs after the next stop
  [0x000000, Kind.Edge], // outline_color: the route's edge
  [0x11fb06, Kind.Arrow], // navigation_arrow_color: arrows where the route turns
];
// One more slot: the map's own background where it has one (an opaque map), else unused.
const SLOTS = GAME_COLOURS.length + 1;

interface Paint {
  land: string;
  park: string;
  building: string;
  road: string;
  roadEdge: string;
  route: string;
  routeLater: string;
  routeEdge: string;
  arrow: string;
}

// As style.ts paints TruckPlay's own map: Apple's paper and graphite, white and grey streets, the
// blue line.
const PAINT: Record<MapTheme, Paint> = {
  light: {
    land: '#f3f1ec',
    park: '#cde6c0',
    building: '#e4e0d8',
    road: '#ffffff',
    roadEdge: '#d3cdc1',
    route: '#1f8bff',
    routeLater: '#62a9f7',
    routeEdge: '#0b62d6',
    arrow: '#ffffff',
  },
  dark: {
    land: '#1d1f23',
    park: '#1b2a21',
    building: '#2b2e34',
    road: '#474a52',
    roadEdge: '#2a2c31',
    route: '#3d9cff',
    routeLater: '#2f6fb8',
    routeEdge: '#0a58c9',
    arrow: '#ffffff',
  },
};

const VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Pass 1, at the map's own size: what each pixel is.
const SORT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSrc;
uniform vec3 uPal[${SLOTS}];
uniform int uKind[${SLOTS}];
uniform int uCount;
uniform float uPremul;   // 1: the map's colour comes premultiplied by its alpha
layout(location = 0) out vec4 oA;  // road, building, park, kept (nothing explains it)
layout(location = 1) out vec4 oB;  // route, later legs, route edge, arrow
layout(location = 2) out vec4 oC;  // the kept colour, premultiplied

void add(inout vec4 a, inout vec4 b, int k, float v) {
  if (k == 0) a.r += v;
  else if (k == 1) a.g += v;
  else if (k == 2) a.b += v;
  else if (k == 3) b.r += v;
  else if (k == 4) b.g += v;
  else if (k == 5) b.b += v;
  else if (k == 6) b.a += v;
}

bool routeish(vec3 c) {
  vec3 d1 = c - uPal[7];
  vec3 d2 = c - uPal[8];
  return min(dot(d1, d1), dot(d2, d2)) < 0.03;
}

void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uSrc, at, 0);
  float a = s.a;
  vec3 c = uPremul > 0.5 && a > 0.0 ? clamp(s.rgb / a, 0.0, 1.0) : s.rgb;
  vec4 A = vec4(0.0), B = vec4(0.0);
  if (a < 0.5 / 255.0) {
    oA = A; oB = B; oC = vec4(0.0);
    return;
  }
  // The closest colour, or blend of two.
  float best = 1e9;
  int bi = 0, bj = 0;
  float bt = 1.0;
  for (int i = 0; i < ${SLOTS}; i++) {
    if (i >= uCount) break;
    vec3 d = c - uPal[i];
    float r = dot(d, d);
    if (r < best) { best = r; bi = i; bj = i; bt = 1.0; }
  }
  // Most pixels are one of the colours exactly; only edges need the blends.
  for (int i = 0; i < ${SLOTS}; i++) {
    if (i >= uCount || best < 0.0003) break;
    for (int j = i + 1; j < ${SLOTS}; j++) {
      if (j >= uCount) break;
      vec3 d = uPal[i] - uPal[j];
      float dd = dot(d, d);
      if (dd < 1e-5) continue;
      float t = clamp(dot(c - uPal[j], d) / dd, 0.0, 1.0);
      vec3 e = c - (uPal[j] + t * d);
      float r = dot(e, e) + 0.0004;  // one colour beats a blend that fits as well
      if (r < best) { best = r; bi = i; bj = j; bt = t; }
    }
  }
  // Black is the route's edge only beside the route (elsewhere it is part of an icon).
  int ki = uKind[bi], kj = uKind[bj];
  if (ki == 5 || kj == 5) {
    bool near = false;
    for (int y = -3; y <= 3 && !near; y++)
      for (int x = -3; x <= 3 && !near; x++) {
        vec4 n = texelFetch(uSrc, at + ivec2(x, y), 0);
        if (n.a > 0.5 && routeish(uPremul > 0.5 ? n.rgb / n.a : n.rgb)) near = true;
      }
    if (!near) best = 1.0;
  }
  float kept = smoothstep(0.004, 0.012, best);
  float k = a * (1.0 - kept);
  add(A, B, ki, k * bt);
  if (bj != bi) add(A, B, kj, k * (1.0 - bt));
  A.a = a * kept;
  oA = A;
  oB = B;
  oC = vec4(c * A.a, A.a);
}`;

// Pass 2, every screen frame: the shares, painted, around the truck.
const PAINT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uC;
uniform vec2 uScale;     // map uv per screen uv, across and down
uniform vec2 uCentre;    // the map uv at the screen's middle
uniform vec2 uStep;      // one screen pixel, in map uv
uniform vec3 uLand, uPark, uBuilding, uRoad, uRoadEdge, uRoute, uRouteLater, uRouteEdge, uArrow;
uniform float uEdgePx;   // the road casing's width, screen pixels
uniform float uHole;     // the game's own truck: its reach from the map's middle, in map heights
uniform float uMapAspect;
out vec4 oColor;

float roadAround(vec2 uv, vec2 r) {
  float m = 0.0;
  m = max(m, texture(uA, uv + vec2(r.x, 0.0)).r);
  m = max(m, texture(uA, uv - vec2(r.x, 0.0)).r);
  m = max(m, texture(uA, uv + vec2(0.0, r.y)).r);
  m = max(m, texture(uA, uv - vec2(0.0, r.y)).r);
  m = max(m, texture(uA, uv + r * 0.7071).r);
  m = max(m, texture(uA, uv - r * 0.7071).r);
  m = max(m, texture(uA, uv + vec2(r.x, -r.y) * 0.7071).r);
  m = max(m, texture(uA, uv + vec2(-r.x, r.y) * 0.7071).r);
  return m;
}

// The map's shares at one point: A and B as sorted, C the kept colour, w the road casing.
struct Shares { vec4 A; vec4 B; vec4 C; float w; };

Shares at(vec2 uv) {
  return Shares(texture(uA, uv), texture(uB, uv), texture(uC, uv), roadAround(uv, uStep * uEdgePx));
}

// What two points share (no kept colour: the game's icons stay where they are).
Shares least(Shares a, Shares b) {
  return Shares(min(a.A, b.A), min(a.B, b.B), vec4(0.0), min(a.w, b.w));
}

Shares blend(Shares a, Shares b, float t) {
  return Shares(mix(a.A, b.A, t), mix(a.B, b.B, t), mix(a.C, b.C, t), mix(a.w, b.w, t));
}

void main() {
  vec2 uv = uCentre + (vUv - 0.5) * uScale;
  Shares s = at(uv);
  // Where the game draws its own truck, the map is filled in from just outside it, from the nearer
  // end of an up-and-down chord: the map turns with the truck, so the road it is on runs straight up
  // and down through it, and the route leaves it upwards. Both run on underneath Apple's arrow.
  vec2 d = (uv - 0.5) * vec2(uMapAspect, 1.0);
  float r = length(d);
  float reach = uHole * 1.12;
  if (uHole > 0.0 && r < reach) {
    vec2 toUv = vec2(1.0 / uMapAspect, 1.0);
    float hy = sqrt(max(reach * reach - d.x * d.x, 0.0));
    // Only what goes on further out the same way carries in: a road crossing just outside the
    // truck does not.
    float further = max(uHole * 0.5, 0.01);
    Shares up = least(at(0.5 + vec2(d.x, -hy) * toUv), at(0.5 + vec2(d.x, -hy - further) * toUv));
    Shares down = least(at(0.5 + vec2(d.x, hy) * toUv), at(0.5 + vec2(d.x, hy + further) * toUv));
    Shares along = blend(up, down, smoothstep(-0.12, 0.12, hy > 0.0 ? d.y / hy : 0.0));
    s = blend(along, s, smoothstep(uHole, reach, r));
  }
  vec4 A = s.A;
  vec4 B = s.B;
  vec4 C = s.C;
  vec3 col = uLand;
  col = mix(col, uPark, clamp(A.b, 0.0, 1.0));
  col = mix(col, uBuilding, clamp(A.g, 0.0, 1.0));
  float casing = s.w;
  col = mix(col, uRoadEdge, clamp(casing, 0.0, 1.0));
  col = mix(col, uRoad, clamp(A.r, 0.0, 1.0));
  col = mix(col, uRouteEdge, clamp(B.b, 0.0, 1.0));
  col = mix(col, uRouteLater, clamp(B.g, 0.0, 1.0));
  col = mix(col, uRoute, clamp(B.r, 0.0, 1.0));
  col = mix(col, uArrow, clamp(B.a, 0.0, 1.0));
  col = col * (1.0 - clamp(C.a, 0.0, 1.0)) + C.rgb;
  // Past the map's edge there is only land; the last bit fades into it.
  vec2 inside = min(uv, 1.0 - uv);
  float fade = smoothstep(0.0, 0.035, min(inside.x, inside.y));
  oColor = vec4(mix(uLand, col, fade), 1.0);
}`;

const hex = (s: string): [number, number, number] => {
  const n = parseInt(s.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | null {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('game map shader:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const v = make(gl.VERTEX_SHADER, vs);
  const f = make(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.warn('game map program:', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

interface MapLook {
  /** The map's own background, when it has one (an opaque map); a map with transparency has none. */
  background: [number, number, number] | null;
  /** Its colour comes premultiplied by its alpha. */
  premultiplied: boolean;
  /** How far the game's own truck reaches from the map's middle, in map heights (0: none there). */
  hole: number;
}

/** Whether the pixel at `i` is one of the game's map colours (or nothing, or the background). */
function explained(f: GameMapFrame, i: number, premul: boolean, bg: MapLook['background']) {
  const a = f.data[i + 3];
  if (a < 24) return true;
  const k = premul ? 255 / a : 1;
  const r = (f.data[i] * k) / 255;
  const g = (f.data[i + 1] * k) / 255;
  const b = (f.data[i + 2] * k) / 255;
  const near = (c: number[]) => (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2 < 0.012;
  if (bg && near(bg)) return true;
  // Black is not counted: it is the edge of the game's truck as much as of the route.
  for (const [c, kind] of GAME_COLOURS)
    if (kind !== Kind.Edge && near([((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255])) return true;
  return false;
}

/** The game's truck in the middle of its map: from the middle outwards, as far as pixels none of
 *  the map's colours explain go on, the furthest of a ring of rays. */
function holeOf(f: GameMapFrame, premul: boolean, bg: MapLook['background']) {
  const cx = Math.floor(f.w / 2);
  const cy = Math.floor(f.h / 2);
  const max = Math.round(f.h * 0.12);
  let reach = 0;
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let gap = 0;
    for (let s = 0; s <= max; s++) {
      const x = Math.round(cx + dx * s);
      const y = Math.round(cy + dy * s);
      if (explained(f, (y * f.w + x) * 4, premul, bg)) {
        // A pixel or two of the map's colours inside the truck (its edge blending in) is not its end.
        if (++gap > 2) break;
      } else {
        gap = 0;
        reach = Math.max(reach, s);
      }
    }
  }
  return reach > 2 ? (reach + 2) / f.h : 0;
}

/** What kind of picture the game's map is, from a sample of its pixels: if nearly all are opaque,
 *  the commonest colour is its background; if no half-covered pixel is brighter than its alpha, its
 *  colour is premultiplied. */
function lookOf(f: GameMapFrame): MapLook {
  const counts = new Map<number, number>();
  let opaque = 0;
  let partial = 0;
  let brighter = 0;
  const n = 8192;
  const px = f.w * f.h;
  for (let k = 0; k < n; k++) {
    const i = (((k * 2654435761) >>> 0) % px) * 4;
    const a = f.data[i + 3];
    if (a > 8 && a < 247) {
      partial++;
      if (Math.max(f.data[i], f.data[i + 1], f.data[i + 2]) > a + 6) brighter++;
    }
    if (a < 250) continue;
    opaque++;
    const key = (f.data[i] << 16) | (f.data[i + 1] << 8) | f.data[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let background: MapLook['background'] = null;
  if (opaque >= n * 0.97) {
    let top = 0;
    let best = -1;
    for (const [key, c] of counts) if (c > top) [top, best] = [c, key];
    if (best >= 0) background = [((best >> 16) & 255) / 255, ((best >> 8) & 255) / 255, (best & 255) / 255];
  }
  const premultiplied = partial >= 24 && brighter <= partial * 0.02;
  return { background, premultiplied, hole: holeOf(f, premultiplied, background) };
}

export class GameMapRenderer {
  private gl: WebGL2RenderingContext | null;
  private sort: WebGLProgram | null = null;
  private paint: WebGLProgram | null = null;
  private src: WebGLTexture | null = null;
  private shares: WebGLTexture[] = [];
  private fbo: WebGLFramebuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private w = 0;
  private h = 0;
  private frames = 0;
  private look: MapLook = { background: null, premultiplied: false, hole: 0 };
  readonly ok: boolean;

  constructor(private canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false });
    const gl = this.gl;
    if (gl) {
      this.sort = compile(gl, VS, SORT);
      this.paint = compile(gl, VS, PAINT_FS);
      this.vao = gl.createVertexArray();
      this.fbo = gl.createFramebuffer();
    }
    this.ok = !!(gl && this.sort && this.paint && this.vao && this.fbo);
  }

  get hasFrame() {
    return this.w > 0;
  }

  /** A new frame of the game's map: uploaded and sorted out once. */
  setFrame(f: GameMapFrame) {
    const gl = this.gl;
    if (!gl || !this.ok) return;
    if (this.frames++ % 30 === 0) this.look = lookOf(f);
    if (f.w !== this.w || f.h !== this.h || !this.src) this.resize(f.w, f.h);
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, f.w, f.h, gl.RGBA, gl.UNSIGNED_BYTE, f.data);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.sort);
    const pal: number[] = [];
    const kinds: number[] = [];
    for (const [c, k] of GAME_COLOURS) {
      pal.push(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
      kinds.push(k);
    }
    pal.push(...(this.look.background ?? [0, 0, 0]));
    kinds.push(Kind.Nothing);
    gl.uniform3fv(gl.getUniformLocation(this.sort!, 'uPal'), pal);
    gl.uniform1iv(gl.getUniformLocation(this.sort!, 'uKind'), kinds);
    gl.uniform1i(gl.getUniformLocation(this.sort!, 'uCount'), this.look.background ? SLOTS : SLOTS - 1);
    gl.uniform1f(gl.getUniformLocation(this.sort!, 'uPremul'), this.look.premultiplied ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.uniform1i(gl.getUniformLocation(this.sort!, 'uSrc'), 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** One screen frame. */
  draw(view: GameMapView) {
    const gl = this.gl;
    if (!gl || !this.ok || !this.w) return;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(this.paint);
    const p = this.paint!;
    const u = (name: string) => gl.getUniformLocation(p, name);
    // Down the screen: `1 / (2 zoom)` of the map's height; across, as much as the screen's shape
    // asks. The map's middle (the truck) sits `lift` below the screen's.
    const down = 0.5 / Math.max(0.05, view.zoom);
    const across = down * (cw / ch) * (this.h / this.w);
    gl.uniform2f(u('uScale'), across, down);
    gl.uniform2f(u('uCentre'), 0.5, 0.5 - view.lift * down);
    gl.uniform2f(u('uStep'), across / cw, down / ch);
    gl.uniform1f(u('uEdgePx'), view.theme === 'light' ? 1.6 : 1.3);
    gl.uniform1f(u('uHole'), this.look.hole);
    gl.uniform1f(u('uMapAspect'), this.w / this.h);
    const paint = PAINT[view.theme];
    for (const [name, value] of Object.entries({
      uLand: paint.land,
      uPark: paint.park,
      uBuilding: paint.building,
      uRoad: paint.road,
      uRoadEdge: paint.roadEdge,
      uRoute: paint.route,
      uRouteLater: paint.routeLater,
      uRouteEdge: paint.routeEdge,
      uArrow: paint.arrow,
    }))
      gl.uniform3fv(u(name), hex(value));
    for (let i = 0; i < 3; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.shares[i]);
    }
    gl.uniform1i(u('uA'), 0);
    gl.uniform1i(u('uB'), 1);
    gl.uniform1i(u('uC'), 2);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** The land colour of a theme, for whatever stands in before the first frame. */
  static land(theme: MapTheme) {
    return PAINT[theme].land;
  }

  dispose() {
    const gl = this.gl;
    if (!gl) return;
    gl.deleteTexture(this.src);
    this.shares.forEach(t => gl.deleteTexture(t));
    gl.deleteFramebuffer(this.fbo);
    gl.deleteVertexArray(this.vao);
    if (this.sort) gl.deleteProgram(this.sort);
    if (this.paint) gl.deleteProgram(this.paint);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.gl = null;
  }

  private texture(w: number, h: number, filter: number) {
    const gl = this.gl!;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private resize(w: number, h: number) {
    const gl = this.gl!;
    gl.deleteTexture(this.src);
    this.shares.forEach(t => gl.deleteTexture(t));
    this.src = this.texture(w, h, gl.NEAREST);
    this.shares = [0, 1, 2].map(() => this.texture(w, h, gl.LINEAR));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    this.shares.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.w = w;
    this.h = h;
  }
}
