// Procedural tile atlas rasterizer.
//
// Every tile in tiles.js TILE_DEFS is drawn once, at boot, into a single offscreen
// canvas of 16x16 cells. Autotile tiles get 16 cells (one per 4-bit neighbour-differs
// mask); everything else gets 1. All texture detail comes from hash2() keyed on the
// tile id and the pixel position, so a given tile always rasterizes identically.
//
// Light direction is fixed: highlights up-left, shading down-right.
//
// Browser-only for the raster step; importing this in Node is safe (buildAtlas is a
// no-op without a document, and the pure lookups still work).

import { TILE_COUNT, TILE_DEFS, T } from './tiles.js';
import { hash2 } from './rng.js';

const CELL = 16;
const COLS = 16;

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

function defOf(id) {
  return (id >= 0 && id < TILE_COUNT && TILE_DEFS[id]) ? TILE_DEFS[id] : TILE_DEFS[T.VOID];
}

export function tileVariantCount(id) {
  const d = (id >= 0 && id < TILE_COUNT) ? TILE_DEFS[id] : null;
  return (d && d.autotile) ? 16 : 1;
}

const baseIndex = new Int32Array(TILE_COUNT);
let cellCount = 0;
{
  let n = 0;
  for (let id = 0; id < TILE_COUNT; id++) {
    baseIndex[id] = n;
    n += tileVariantCount(id);
  }
  cellCount = n;
}

const ROWS = Math.max(1, Math.ceil(cellCount / COLS));
const ATLAS_W = COLS * CELL;
const ATLAS_H = ROWS * CELL;

// internal: cell index for (tile id, neighbour mask)
function atlasIndex(id, mask) {
  const i = (id >= 0 && id < TILE_COUNT) ? (id | 0) : 0;
  return baseIndex[i] + (tileVariantCount(i) > 1 ? (mask & 15) : 0);
}

// ---------------------------------------------------------------------------
// colour helpers (packed 0xRRGGBB)
// ---------------------------------------------------------------------------

const hexCache = new Map();

function col(h) {
  if (typeof h === 'number') return h >>> 0 & 0xffffff;
  const key = String(h == null ? '#000000' : h);
  const hit = hexCache.get(key);
  if (hit !== undefined) return hit;
  let s = key.replace('#', '').trim();
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (s.length > 6) s = s.slice(0, 6);
  let v = parseInt(s, 16);
  if (!isFinite(v)) v = 0;
  v = v >>> 0 & 0xffffff;
  hexCache.set(key, v);
  return v;
}

function mix(a, b, t) {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  const ar = a >> 16 & 255, ag = a >> 8 & 255, ab = a & 255;
  const br = b >> 16 & 255, bg = b >> 8 & 255, bb = b & 255;
  const r = (ar + (br - ar) * u) | 0;
  const g = (ag + (bg - ag) * u) | 0;
  const bl = (ab + (bb - ab) * u) | 0;
  return (r << 16 | g << 8 | bl) >>> 0;
}

const lighten = (c, t) => mix(c, 0xffffff, t);
const darken = (c, t) => mix(c, 0x000000, t);

// deterministic [0,1) keyed on tile id, a salt, and a pixel coordinate
function h01(id, salt, x, y) {
  const seed = (Math.imul(id + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) >>> 0;
  return hash2(seed, x, y) / 4294967296;
}

// ---------------------------------------------------------------------------
// pixel painter — writes into one big ImageData, cell-local coordinates
// ---------------------------------------------------------------------------

function put(P, x, y, c, a) {
  if (x < 0 || y < 0 || x > 15 || y > 15) return;
  const d = P.d;
  const i = (((P.oy + y) * P.W) + (P.ox + x)) * 4;
  const sr = c >> 16 & 255, sg = c >> 8 & 255, sb = c & 255;
  if (a === undefined || a >= 255) {
    d[i] = sr; d[i + 1] = sg; d[i + 2] = sb; d[i + 3] = 255;
    return;
  }
  if (a <= 0) return;
  const sa = a / 255;
  const da = d[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) { d[i + 3] = 0; return; }
  const k = da * (1 - sa);
  d[i] = ((sr * sa + d[i] * k) / oa) | 0;
  d[i + 1] = ((sg * sa + d[i + 1] * k) / oa) | 0;
  d[i + 2] = ((sb * sa + d[i + 2] * k) / oa) | 0;
  d[i + 3] = (oa * 255) | 0;
}

function rect(P, x, y, w, h, c, a) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(P, x + i, y + j, c, a);
}

function fill(P, c) { rect(P, 0, 0, 16, 16, c); }

function hline(P, x0, x1, y, c, a) { for (let x = x0; x <= x1; x++) put(P, x, y, c, a); }
function vline(P, x, y0, y1, c, a) { for (let y = y0; y <= y1; y++) put(P, x, y, c, a); }

// filled disc with up-left highlight / down-right shading.
// `mark` (optional Uint8Array(256)) records which cell pixels the disc covered.
function blob(P, cx, cy, r, base, light, dark, mark) {
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      let c = base;
      if (d2 > (r - 1) * (r - 1)) c = (dx + dy < 0) ? light : dark;
      else if (dx + dy < -r) c = light;
      else if (dx + dy > r) c = dark;
      const x = cx + dx, y = cy + dy;
      put(P, x, y, c);
      if (mark && x >= 0 && y >= 0 && x < 16 && y < 16) mark[y * 16 + x] = 1;
    }
  }
}

// ---------------------------------------------------------------------------
// texture renderers
// ---------------------------------------------------------------------------

function texDither(Q, P) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const r = h01(Q.id, 1, x, y);
      let c = Q.base;
      if (((x + y) & 1) === 0 && r < 0.28) c = Q.light;
      else if (r > 0.84) c = Q.dark;
      put(P, x, y, c);
    }
  }
}

function texGrain(Q, P) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const r = h01(Q.id, 2, x, y);
      let c = Q.base;
      if (r < 0.09) c = Q.dark;
      else if (r < 0.22) c = mix(Q.base, Q.dark, 0.4);
      else if (r > 0.91) c = Q.light;
      else if (r > 0.78) c = mix(Q.base, Q.light, 0.4);
      put(P, x, y, c);
    }
  }
  // a few pebbles, lit from the upper-left
  for (let k = 0; k < 3; k++) {
    const bx = 1 + Math.floor(h01(Q.id, 3, k, 0) * 13);
    const by = 1 + Math.floor(h01(Q.id, 3, k, 1) * 13);
    put(P, bx, by, Q.light);
    put(P, bx + 1, by, mix(Q.base, Q.light, 0.5));
    put(P, bx, by + 1, mix(Q.base, Q.dark, 0.5));
    put(P, bx + 1, by + 1, Q.dark);
  }
}

function texBlade(Q, P) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const patch = h01(Q.id, 4, x >> 1, y >> 1);
      const fine = h01(Q.id, 5, x, y);
      let c = Q.base;
      if (patch < 0.30) c = mix(Q.base, Q.dark, 0.35);
      else if (patch > 0.74) c = mix(Q.base, Q.light, 0.30);
      if (fine < 0.07) c = mix(c, Q.dark, 0.45);
      else if (fine > 0.94) c = mix(c, Q.light, 0.45);
      put(P, x, y, c);
    }
  }
  // short blade marks
  for (let k = 0; k < 14; k++) {
    const x = Math.floor(h01(Q.id, 6, k, 0) * 15);
    const y = 1 + Math.floor(h01(Q.id, 6, k, 1) * 13);
    put(P, x, y, Q.light);
    put(P, x, y + 1, mix(Q.base, Q.light, 0.5));
    put(P, x + 1, y + 1, Q.dark);
  }
}

function texTallblade(Q, P) {
  const floorC = mix(Q.base, Q.dark, 0.55);
  for (let y = 0; y < 16; y++) {
    // the mat of leaves is darkest at the roots
    const band = mix(floorC, Q.dark, y / 22);
    for (let x = 0; x < 16; x++) {
      const r = h01(Q.id, 7, x, y);
      put(P, x, y, r < 0.10 ? Q.dark : (r > 0.93 ? Q.base : band));
    }
  }
  // tall leaning blades
  for (let k = 0; k < 10; k++) {
    const x0 = Math.floor(h01(Q.id, 8, k, 0) * 16);
    const top = 1 + Math.floor(h01(Q.id, 8, k, 1) * 5);
    const lean = h01(Q.id, 8, k, 2) < 0.5 ? -1 : 1;
    const tint = h01(Q.id, 8, k, 3);
    const stem = tint > 0.6 ? Q.light : Q.base;
    for (let y = 15; y >= top; y--) {
      const bend = Math.round(((15 - y) / 7) * ((15 - y) / 7) * 2) * lean;
      const x = x0 + bend;
      put(P, x, y, y < top + 3 ? Q.light : stem);
      put(P, x + 1, y, y > top + 2 ? Q.dark : mix(stem, Q.dark, 0.5));
    }
  }
}

function texWave(Q, P) {
  // per-column vertical offset => continuous wavy crest lines, not dashes
  const wobble = new Int8Array(16);
  for (let x = 0; x < 16; x++) wobble[x] = Math.round(Math.sin((x / 16) * Math.PI * 2) * 1.7);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const wob = wobble[x];
      const band = (((y + wob) % 8) + 8) % 8;   // period 8 divides 16 => seamless vertically
      const n = h01(Q.id, 9, x, y);
      let c = Q.base;
      if (band === 0) c = Q.light;
      else if (band === 1) c = mix(Q.base, Q.light, 0.35);
      else if (band === 4) c = Q.dark;
      else if (band === 5) c = mix(Q.base, Q.dark, 0.35);
      if (n > 0.94) c = mix(c, Q.light, 0.3);
      put(P, x, y, c);
    }
  }
  // sparkles on the crests
  for (let k = 0; k < 3; k++) {
    const x = Math.floor(h01(Q.id, 10, k, 0) * 15);
    const y = Math.floor(h01(Q.id, 10, k, 1) * 15);
    put(P, x, y, lighten(Q.light, 0.5));
    put(P, x + 1, y, lighten(Q.light, 0.2));
  }
}

function texStone(Q, P) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const r = h01(Q.id, 11, x, y);
      put(P, x, y, r < 0.16 ? mix(Q.base, Q.dark, 0.5) : (r > 0.88 ? mix(Q.base, Q.light, 0.4) : Q.base));
    }
  }
  for (let k = 0; k < 3; k++) {
    const cx = 3 + Math.floor(h01(Q.id, 12, k, 0) * 10);
    const cy = 3 + Math.floor(h01(Q.id, 12, k, 1) * 10);
    const r = 2 + Math.floor(h01(Q.id, 12, k, 2) * 3);
    blob(P, cx, cy, r, Q.base, Q.light, Q.dark);
    // contact shadow
    hline(P, cx - r + 1, cx + r - 1, cy + r, darken(Q.dark, 0.25), 120);
  }
}

function texCliff(Q, P) {
  for (let x = 0; x < 16; x++) {
    const colTone = h01(Q.id, 13, x, 0);
    for (let y = 0; y < 16; y++) {
      const n = h01(Q.id, 14, x, y);
      let c = Q.base;
      if (colTone < 0.28) c = mix(Q.base, Q.dark, 0.45);
      else if (colTone > 0.76) c = mix(Q.base, Q.light, 0.30);
      if (n < 0.10) c = mix(c, Q.dark, 0.5);
      else if (n > 0.92) c = mix(c, Q.light, 0.4);
      put(P, x, y, c);
    }
  }
  // two vertical cracks
  for (let k = 0; k < 2; k++) {
    let x = 2 + Math.floor(h01(Q.id, 15, k, 0) * 12);
    const y0 = Math.floor(h01(Q.id, 15, k, 1) * 6);
    const y1 = 10 + Math.floor(h01(Q.id, 15, k, 2) * 6);
    for (let y = y0; y <= y1; y++) {
      put(P, x, y, darken(Q.dark, 0.25));
      put(P, x + 1, y, mix(Q.base, Q.light, 0.25));
      if (h01(Q.id, 16, x, y) > 0.72) x += (h01(Q.id, 17, x, y) < 0.5 ? -1 : 1);
      if (x < 1) x = 1; if (x > 14) x = 14;
    }
  }
}

function texShine(Q, P) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dg = (x + y) % 10;
      let c = Q.base;
      if (dg === 0 || dg === 1) c = mix(Q.base, Q.light, 0.75);
      else if (dg === 2) c = mix(Q.base, Q.light, 0.35);
      else if (dg === 6) c = mix(Q.base, Q.dark, 0.30);
      put(P, x, y, c);
    }
  }
  // hairline fractures, lower-right
  for (let k = 0; k < 2; k++) {
    let x = 5 + Math.floor(h01(Q.id, 18, k, 0) * 9);
    for (let y = 4 + k * 5; y < 16; y++) {
      put(P, x, y, mix(Q.base, Q.dark, 0.6));
      if (h01(Q.id, 19, x, y) > 0.6) x -= 1;
      if (x < 0) x = 0;
    }
  }
  put(P, 3, 3, lighten(Q.light, 0.6));
  put(P, 4, 3, lighten(Q.light, 0.3));
  put(P, 3, 4, lighten(Q.light, 0.3));
}

// --- plants -----------------------------------------------------------------

function canopyGround(P, c) { fill(P, c); }

function texTree(Q, P) {
  const ground = col('#54993f');
  const trunk = Q.accent;
  canopyGround(P, ground);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (h01(Q.id, 20, x, y) < 0.12) put(P, x, y, darken(ground, 0.12));
    }
  }
  // contact shadow on the ground
  rect(P, 4, 14, 9, 2, darken(ground, 0.35), 110);
  // canopy: overlapping lobes, top-left lit
  const mark = new Uint8Array(256);
  const lobes = [[5, 5, 5], [11, 5, 4], [8, 3, 5], [4, 8, 4], [12, 8, 4], [8, 8, 5]];
  for (const [cx, cy, r] of lobes) blob(P, cx, cy, r, Q.base, Q.light, Q.dark, mark);
  // leaf speckle, canopy only
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!mark[y * 16 + x]) continue;
      const r = h01(Q.id, 21, x, y);
      if (r > 0.90 && x + y < 16) put(P, x, y, Q.light);
      else if (r < 0.08 && x + y > 14) put(P, x, y, Q.dark);
    }
  }
  // trunk sits in front of the canopy's lower lobes
  for (let y = 11; y < 16; y++) {
    put(P, 6, y, lighten(trunk, 0.28));
    put(P, 7, y, trunk);
    put(P, 8, y, trunk);
    put(P, 9, y, darken(trunk, 0.3));
  }
  hline(P, 6, 9, 11, mix(trunk, Q.dark, 0.45));
}

function texPine(Q, P) {
  const ground = col('#4a8c3c');
  const trunk = Q.accent;
  canopyGround(P, ground);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (h01(Q.id, 22, x, y) < 0.12) put(P, x, y, darken(ground, 0.12));
    }
  }
  rect(P, 5, 14, 7, 2, darken(ground, 0.35), 110);
  // three conical tiers
  const tiers = [[0, 4], [4, 8], [8, 12]];
  for (let t = 0; t < tiers.length; t++) {
    const [y0, y1] = tiers[t];
    for (let y = y0; y <= y1; y++) {
      const grow = (y - y0) + t * 2;
      const half = Math.min(7, 1 + grow);
      for (let x = 8 - half; x <= 8 + half; x++) {
        let c = Q.base;
        if (x < 8 - half + 2) c = Q.light;
        else if (x > 8 + half - 2) c = Q.dark;
        if (h01(Q.id, 23, x, y) > 0.9) c = lighten(Q.light, 0.15);
        put(P, x, y, c);
      }
      if (y === y1) hline(P, 8 - half, 8 + half, y, Q.dark);
    }
  }
  put(P, 8, 0, Q.light);
  // trunk below the lowest tier
  for (let y = 12; y < 16; y++) {
    put(P, 7, y, lighten(trunk, 0.25));
    put(P, 8, y, trunk);
    put(P, 9, y, darken(trunk, 0.3));
  }
}

function texPalm(Q, P) {
  const sand = col('#dcc894');
  const trunk = Q.accent;
  canopyGround(P, sand);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (h01(Q.id, 24, x, y) < 0.14) put(P, x, y, darken(sand, 0.10));
    }
  }
  rect(P, 6, 14, 6, 2, darken(sand, 0.30), 110);
  // leaning trunk
  let tx = 8;
  for (let y = 15; y >= 6; y--) {
    tx = 8 - Math.round(((15 - y) / 9) * 3);
    put(P, tx, y, trunk);
    put(P, tx + 1, y, (y % 2 === 0) ? lighten(trunk, 0.25) : darken(trunk, 0.2));
  }
  const crownX = tx, crownY = 6;
  // fronds: continuous arcs that rise then droop, no gaps between steps
  const fronds = [
    { sx: -1, len: 6, a: -1.15, b: 0.30 },
    { sx: 1, len: 6, a: -1.15, b: 0.30 },
    { sx: -1, len: 5, a: 0.30, b: 0.16 },
    { sx: 1, len: 5, a: 0.30, b: 0.16 },
  ];
  for (const f of fronds) {
    let prevY = crownY;
    for (let i = 1; i <= f.len; i++) {
      const x = crownX + f.sx * i;
      const y = crownY + Math.round(f.a * i + f.b * i * i);
      const lit = f.sx < 0;
      const c = lit ? (i < 4 ? Q.light : Q.base) : (i < 4 ? Q.base : Q.dark);
      const y0 = Math.min(prevY, y), y1 = Math.max(prevY, y);
      for (let yy = y0; yy <= y1; yy++) put(P, x, yy, c);
      put(P, x, y1 + 1, Q.dark);
      if (i > 1 && i < f.len) put(P, x, y0 - 1, mix(c, Q.light, 0.45));
      prevY = y;
    }
  }
  // crown tuft
  put(P, crownX, crownY - 3, Q.light);
  put(P, crownX, crownY - 2, Q.light);
  blob(P, crownX, crownY, 2, Q.base, Q.light, Q.dark);
  // coconuts
  put(P, crownX - 1, crownY + 2, darken(trunk, 0.1));
  put(P, crownX + 1, crownY + 2, darken(trunk, 0.25));
}

function texCactus(Q, P) {
  const sand = col('#dcc894');
  canopyGround(P, sand);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (h01(Q.id, 25, x, y) < 0.14) put(P, x, y, darken(sand, 0.10));
    }
  }
  rect(P, 5, 14, 7, 2, darken(sand, 0.30), 110);
  const body = (x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let c = Q.base;
        if (x === x0) c = Q.light;
        else if (x === x1) c = Q.dark;
        else if (x === x0 + 1) c = mix(Q.base, Q.light, 0.4);
        put(P, x, y, c);
      }
    }
    hline(P, x0, x1, y0, mix(Q.base, Q.light, 0.5));
  };
  body(6, 10, 2, 15);
  // arms
  body(3, 4, 8, 11); hline(P, 3, 5, 8, mix(Q.base, Q.light, 0.5));
  for (let x = 5; x <= 5; x++) { put(P, x, 9, Q.base); put(P, x, 10, Q.dark); }
  body(12, 13, 5, 9); hline(P, 11, 13, 5, mix(Q.base, Q.light, 0.5));
  for (let y = 6; y <= 9; y++) put(P, 11, y, Q.dark);
  put(P, 11, 9, Q.base); put(P, 11, 10, Q.dark);
  // spines
  for (let k = 0; k < 10; k++) {
    const x = 3 + Math.floor(h01(Q.id, 26, k, 0) * 11);
    const y = 3 + Math.floor(h01(Q.id, 26, k, 1) * 12);
    put(P, x, y, lighten(Q.light, 0.55));
  }
}

function texBush(Q, P) {
  const ground = col('#54993f');
  canopyGround(P, ground);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (h01(Q.id, 27, x, y) < 0.12) put(P, x, y, darken(ground, 0.12));
    }
  }
  rect(P, 3, 14, 11, 2, darken(ground, 0.32), 110);
  const mark = new Uint8Array(256);
  blob(P, 5, 9, 4, Q.base, Q.light, Q.dark, mark);
  blob(P, 11, 9, 4, Q.base, Q.light, Q.dark, mark);
  blob(P, 8, 7, 5, Q.base, Q.light, Q.dark, mark);
  blob(P, 8, 11, 4, Q.base, Q.light, Q.dark, mark);
  // foliage speckle inside the silhouette only
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!mark[y * 16 + x]) continue;
      const r = h01(Q.id, 28, x, y);
      if (r > 0.88 && x + y < 16) put(P, x, y, Q.light);
      else if (r < 0.10 && x + y > 15) put(P, x, y, Q.dark);
    }
  }
}

function texFlower(Q, P) {
  // grassy bed first
  const bed = { id: Q.id, base: Q.base, dark: Q.dark, light: mix(Q.base, 0xffffff, 0.22) };
  texBlade(bed, P);
  const mushroom = Q.def.name === 'mushrooms';
  const petal = Q.light;       // colours[2] is the blossom / cap colour here
  const inner = Q.accent !== null ? Q.accent : lighten(petal, 0.5);
  for (let k = 0; k < 4; k++) {
    const x = 2 + Math.floor(h01(Q.id, 29, k, 0) * 12);
    const y = 3 + Math.floor(h01(Q.id, 29, k, 1) * 10);
    if (mushroom) {
      // dome cap with a lighter rim, pale stem
      hline(P, x - 1, x + 1, y, lighten(petal, 0.3));
      hline(P, x - 2, x + 2, y + 1, petal);
      put(P, x + 2, y + 1, darken(petal, 0.25));
      put(P, x, y + 1, inner);
      put(P, x - 1, y + 2, inner);
      put(P, x, y + 2, darken(inner, 0.25));
    } else {
      put(P, x, y - 1, petal);
      put(P, x - 1, y, petal);
      put(P, x + 1, y, darken(petal, 0.18));
      put(P, x, y + 1, darken(petal, 0.18));
      put(P, x, y, inner);
    }
  }
}

// --- built surfaces ---------------------------------------------------------

function texPlank(Q, P) {
  for (let y = 0; y < 16; y++) {
    const row = y >> 2;
    const inRow = y & 3;
    for (let x = 0; x < 16; x++) {
      let c = Q.base;
      if (inRow === 0) c = mix(Q.base, Q.light, 0.55);
      else if (inRow === 3) c = mix(Q.base, Q.dark, 0.75);
      const g = h01(Q.id, 30, x, row * 4);
      if (g < 0.16) c = mix(c, Q.dark, 0.30);
      else if (g > 0.88) c = mix(c, Q.light, 0.25);
      put(P, x, y, c);
    }
    // butt joint per plank row
    const jx = (2 + row * 5) % 16;
    if (inRow !== 3) {
      put(P, jx, y, Q.dark);
      put(P, jx + 1, y, mix(Q.base, Q.light, 0.4));
    }
  }
}

function texChecker(Q, P) {
  const quad = Q.def.name === 'carpet' ? 4 : 8;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const on = (((x / quad) | 0) + ((y / quad) | 0)) & 1;
      let c = on ? Q.light : Q.base;
      if (x % quad === 0 || y % quad === 0) c = mix(c, Q.light, 0.35);
      if (x % quad === quad - 1 || y % quad === quad - 1) c = mix(c, Q.dark, 0.35);
      if (h01(Q.id, 31, x, y) > 0.93) c = mix(c, Q.light, 0.3);
      put(P, x, y, c);
    }
  }
  if (Q.def.name === 'carpet') {
    for (let x = 0; x < 16; x++) { put(P, x, 0, Q.dark); put(P, x, 15, Q.dark); }
    for (let y = 0; y < 16; y++) { put(P, 0, y, Q.dark); put(P, 15, y, Q.dark); }
  } else {
    hline(P, 0, 15, 0, mix(Q.base, Q.dark, 0.45));
    vline(P, 0, 0, 15, mix(Q.base, Q.dark, 0.45));
  }
}

function texBrick(Q, P) {
  const mortar = mix(Q.dark, 0x000000, 0.15);
  fill(P, mortar);
  for (let row = 0; row < 4; row++) {
    const y0 = row * 4;
    const off = (row & 1) ? 4 : 0;
    for (let b = -1; b < 3; b++) {
      const x0 = b * 8 + off;
      for (let y = y0; y < y0 + 3; y++) {
        for (let x = x0; x < x0 + 7; x++) {
          if (x < 0 || x > 15) continue;
          let c = Q.base;
          if (y === y0) c = Q.light;
          else if (y === y0 + 2) c = mix(Q.base, Q.dark, 0.55);
          if (x === x0) c = mix(c, Q.light, 0.35);
          else if (x === x0 + 6) c = mix(c, Q.dark, 0.45);
          if (h01(Q.id, 32, x, y) > 0.9) c = mix(c, Q.dark, 0.2);
          put(P, x, y, c);
        }
      }
    }
  }
}

function texShingle(Q, P) {
  fill(P, mix(Q.base, Q.dark, 0.6));
  for (let row = 0; row < 4; row++) {
    const y0 = row * 4;
    const off = (row & 1) ? 3 : 0;
    for (let s = -1; s < 4; s++) {
      const x0 = s * 6 + off;
      for (let y = y0; y < y0 + 4; y++) {
        for (let x = x0; x < x0 + 5; x++) {
          if (x < 0 || x > 15) continue;
          let c = Q.base;
          if (y === y0) c = Q.light;
          else if (y === y0 + 1) c = mix(Q.base, Q.light, 0.35);
          else if (y === y0 + 3) c = Q.dark;
          if (x === x0) c = mix(c, Q.light, 0.3);
          if (h01(Q.id, 33, x, y0) > 0.85) c = mix(c, Q.dark, 0.18);
          put(P, x, y, c);
        }
      }
    }
  }
}

function texPlaster(Q, P) {
  for (let y = 0; y < 16; y++) {
    const t = y / 15;
    const band = mix(mix(Q.base, Q.light, 0.35), mix(Q.base, Q.dark, 0.30), t);
    for (let x = 0; x < 16; x++) {
      const n = h01(Q.id, 34, x, y);
      let c = band;
      if (n < 0.10) c = mix(band, Q.dark, 0.25);
      else if (n > 0.90) c = mix(band, Q.light, 0.30);
      put(P, x, y, c);
    }
  }
  hline(P, 0, 15, 0, Q.light);
  hline(P, 0, 15, 15, mix(Q.dark, 0x000000, 0.1));
  vline(P, 15, 0, 15, mix(Q.base, Q.dark, 0.35));
}

function texDoor(Q, P) {
  const frame = Q.accent;
  fill(P, Q.base);
  // frame
  for (let y = 0; y < 16; y++) { put(P, 0, y, frame); put(P, 15, y, frame); }
  hline(P, 0, 15, 0, frame);
  hline(P, 0, 15, 15, darken(frame, 0.3));
  // lintel highlight and jamb shading
  hline(P, 1, 14, 1, Q.light);
  vline(P, 1, 1, 14, mix(Q.base, Q.light, 0.5));
  vline(P, 14, 1, 14, Q.dark);
  // recessed panels
  for (let p = 0; p < 2; p++) {
    const y0 = 3 + p * 6, y1 = y0 + 4;
    for (let y = y0; y <= y1; y++) {
      for (let x = 4; x <= 11; x++) {
        let c = mix(Q.base, Q.dark, 0.25);
        if (y === y0 || x === 4) c = Q.dark;
        else if (y === y1 || x === 11) c = Q.light;
        put(P, x, y, c);
      }
    }
  }
  // knob
  put(P, 12, 8, lighten(Q.light, 0.5));
  put(P, 13, 8, Q.light);
  put(P, 12, 9, Q.dark);
  put(P, 13, 9, darken(Q.dark, 0.2));
}

function texWindow(Q, P) {
  const frame = Q.accent;
  fill(P, frame);
  // glass
  for (let y = 2; y <= 13; y++) {
    for (let x = 2; x <= 13; x++) {
      const d = (x - 4) - (y - 4);
      let c = Q.base;
      if (d > 1 && d < 5) c = Q.light;
      else if (d >= 5) c = mix(Q.base, Q.light, 0.4);
      else if (d < -4) c = Q.dark;
      put(P, x, y, c);
    }
  }
  // mullions
  vline(P, 7, 2, 13, frame); vline(P, 8, 2, 13, darken(frame, 0.2));
  hline(P, 2, 13, 7, frame); hline(P, 2, 13, 8, darken(frame, 0.2));
  // frame bevel
  hline(P, 0, 15, 0, lighten(frame, 0.3));
  hline(P, 0, 15, 15, darken(frame, 0.35));
  vline(P, 0, 0, 15, lighten(frame, 0.2));
  vline(P, 15, 0, 15, darken(frame, 0.3));
  // sill
  hline(P, 0, 15, 14, lighten(frame, 0.15));
}

function texSign(Q, P) {
  const wood = Q.light;
  // post
  rect(P, 7, 9, 2, 7, Q.dark);
  vline(P, 7, 9, 15, Q.base);
  // board
  rect(P, 2, 3, 12, 8, wood);
  hline(P, 2, 13, 3, lighten(wood, 0.35));
  hline(P, 2, 13, 10, Q.dark);
  vline(P, 2, 3, 10, lighten(wood, 0.2));
  vline(P, 13, 3, 10, Q.dark);
  // "text"
  hline(P, 4, 11, 5, Q.dark);
  hline(P, 4, 9, 7, Q.dark);
  // ground shadow under post
  hline(P, 5, 10, 15, 0x000000, 70);
}

function texFence(Q, P) {
  const rail = (y0) => {
    for (let x = 0; x < 16; x++) {
      put(P, x, y0, lighten(Q.base, 0.25));
      put(P, x, y0 + 1, Q.base);
      put(P, x, y0 + 2, Q.dark);
    }
  };
  rail(5);
  rail(10);
  // post
  for (let y = 2; y <= 15; y++) {
    put(P, 7, y, Q.light);
    put(P, 8, y, Q.base);
    put(P, 9, y, Q.dark);
  }
  hline(P, 7, 9, 2, lighten(Q.light, 0.3));
  hline(P, 6, 10, 15, 0x000000, 70);
}

function texLedge(Q, P) {
  // upper ground
  for (let y = 0; y <= 2; y++) {
    for (let x = 0; x < 16; x++) {
      const n = h01(Q.id, 35, x, y);
      put(P, x, y, n < 0.15 ? mix(Q.base, Q.dark, 0.3) : mix(Q.base, Q.light, n > 0.85 ? 0.5 : 0.2));
    }
  }
  hline(P, 0, 15, 0, Q.light);
  // drop face
  for (let y = 3; y <= 10; y++) {
    for (let x = 0; x < 16; x++) {
      let c = mix(Q.base, Q.dark, 0.35);
      if (y === 3) c = Q.light;
      else if (y === 4) c = mix(Q.base, Q.light, 0.3);
      else if (y === 10) c = darken(Q.dark, 0.25);
      if (x % 5 === 0 && y > 4 && y < 10) c = mix(c, Q.dark, 0.6);
      if (h01(Q.id, 36, x, y) > 0.9) c = mix(c, Q.light, 0.25);
      put(P, x, y, c);
    }
  }
  // lower ground with the drop's shadow
  for (let y = 11; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const n = h01(Q.id, 37, x, y);
      let c = n < 0.15 ? mix(Q.base, Q.dark, 0.3) : Q.base;
      if (y === 11) c = mix(c, 0x000000, 0.35);
      else if (y === 12) c = mix(c, 0x000000, 0.15);
      put(P, x, y, c);
    }
  }
}

function texStairs(Q, P) {
  for (let y = 0; y < 16; y++) {
    const step = y & 3;
    for (let x = 0; x < 16; x++) {
      let c = Q.base;
      if (step === 0) c = Q.light;
      else if (step === 1) c = mix(Q.base, Q.light, 0.3);
      else if (step === 3) c = Q.dark;
      if (h01(Q.id, 38, x, y) > 0.92) c = mix(c, Q.light, 0.2);
      put(P, x, y, c);
    }
  }
  // side rails
  for (let y = 0; y < 16; y++) {
    put(P, 0, y, mix(Q.base, Q.dark, 0.55));
    put(P, 1, y, mix(Q.base, Q.dark, 0.25));
    put(P, 14, y, mix(Q.base, Q.dark, 0.35));
    put(P, 15, y, mix(Q.base, Q.dark, 0.65));
  }
}

const BOOK_COLORS = ['#b04838', '#3c68b8', '#c8a040', '#48885a', '#8a5aa8', '#d0704c'];

function texShelf(Q, P) {
  const back = mix(Q.dark, 0x000000, 0.3);
  fill(P, back);
  // carcass
  for (let y = 0; y < 16; y++) {
    put(P, 0, y, Q.light); put(P, 1, y, Q.base);
    put(P, 14, y, Q.dark); put(P, 15, y, darken(Q.dark, 0.3));
  }
  hline(P, 0, 15, 0, lighten(Q.light, 0.2));
  hline(P, 0, 15, 1, Q.base);
  const boards = [7, 15];
  for (const by of boards) {
    hline(P, 0, 15, by - 1, Q.light);
    hline(P, 0, 15, by, Q.dark);
  }
  // books in the two bays
  const bays = [[2, 6], [9, 13]];
  for (let b = 0; b < bays.length; b++) {
    const [y0, y1] = bays[b];
    let x = 2;
    let k = 0;
    while (x <= 13) {
      const w = 1 + (h01(Q.id, 39, b * 20 + k, 0) > 0.55 ? 1 : 0);
      const top = y0 + (h01(Q.id, 39, b * 20 + k, 1) > 0.6 ? 1 : 0);
      const c = col(BOOK_COLORS[Math.floor(h01(Q.id, 40, b * 20 + k, 2) * BOOK_COLORS.length) % BOOK_COLORS.length]);
      for (let y = top; y <= y1; y++) {
        for (let i = 0; i < w && x + i <= 13; i++) {
          put(P, x + i, y, i === 0 ? lighten(c, 0.15) : darken(c, 0.2));
        }
      }
      hline(P, x, Math.min(13, x + w - 1), top, lighten(c, 0.4));
      x += w + 1;
      k++;
    }
  }
}

function texCrystal(Q, P) {
  const rock = col('#443e36');
  fill(P, rock);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const n = h01(Q.id, 41, x, y);
      if (n < 0.16) put(P, x, y, darken(rock, 0.25));
      else if (n > 0.9) put(P, x, y, lighten(rock, 0.15));
    }
  }
  const shards = [[8, 3, 12, 4], [4, 7, 14, 3], [12, 8, 15, 3]];
  for (const [cx, top, bot, half] of shards) {
    for (let y = top; y <= bot; y++) {
      const t = (y - top) / Math.max(1, bot - top);
      const w = Math.max(1, Math.round(half * Math.sin(Math.PI * Math.min(1, 0.25 + t * 0.75))));
      for (let x = cx - w; x <= cx + w; x++) {
        let c = Q.base;
        if (x < cx - w + 1) c = Q.dark;
        else if (x < cx) c = Q.light;
        else if (x === cx) c = mix(Q.light, Q.base, 0.5);
        else if (x > cx + w - 1) c = darken(Q.dark, 0.2);
        put(P, x, y, c);
      }
      if (y === top) put(P, cx, y, lighten(Q.light, 0.55));
    }
    hline(P, cx - half, cx + half, bot, darken(Q.dark, 0.3));
    // glow at the base
    hline(P, cx - half - 1, cx + half + 1, bot + 1, Q.light, 80);
  }
  put(P, 7, 5, lighten(Q.light, 0.7));
  put(P, 3, 9, lighten(Q.light, 0.4));
}

// ---------------------------------------------------------------------------
// autotile rims
// ---------------------------------------------------------------------------

function applyRim(Q, P) {
  const m = Q.mask & 15;
  if (!m) return;
  const kind = Q.def.water ? 'water' : (Q.def.texture === 'cliff' ? 'cliff' : 'edge');

  if (kind === 'water') {
    const foam = lighten(Q.light, 0.5);
    const soft = lighten(Q.light, 0.2);
    if (m & 1) for (let x = 0; x < 16; x++) { put(P, x, 0, foam); if (h01(Q.id, 42, x, 0) < 0.55) put(P, x, 1, soft); }
    if (m & 4) for (let x = 0; x < 16; x++) { put(P, x, 15, foam); if (h01(Q.id, 42, x, 1) < 0.55) put(P, x, 14, soft); }
    if (m & 8) for (let y = 0; y < 16; y++) { put(P, 0, y, foam); if (h01(Q.id, 42, y, 2) < 0.55) put(P, 1, y, soft); }
    if (m & 2) for (let y = 0; y < 16; y++) { put(P, 15, y, foam); if (h01(Q.id, 42, y, 3) < 0.55) put(P, 14, y, soft); }
    return;
  }

  if (kind === 'cliff') {
    if (m & 1) { // exposed top: lit cap
      hline(P, 0, 15, 0, lighten(Q.light, 0.25));
      hline(P, 0, 15, 1, Q.light);
      for (let x = 0; x < 16; x++) if (h01(Q.id, 43, x, 0) < 0.5) put(P, x, 2, mix(Q.base, Q.light, 0.5));
    }
    if (m & 4) { // foot of the face falls into shadow
      hline(P, 0, 15, 15, darken(Q.dark, 0.35));
      for (let x = 0; x < 16; x++) if (h01(Q.id, 43, x, 1) < 0.6) put(P, x, 14, darken(Q.dark, 0.15));
    }
    if (m & 8) { vline(P, 0, 0, 15, mix(Q.base, Q.light, 0.45)); }
    if (m & 2) { vline(P, 15, 0, 15, darken(Q.dark, 0.2)); }
    return;
  }

  // generic ground edge (paths): a darker border so it reads as a worn track
  const rim = darken(Q.dark, 0.22);
  const soft = mix(Q.base, Q.dark, 0.7);
  if (m & 1) for (let x = 0; x < 16; x++) { put(P, x, 0, rim); if (h01(Q.id, 44, x, 0) < 0.5) put(P, x, 1, soft); }
  if (m & 4) for (let x = 0; x < 16; x++) { put(P, x, 15, rim); if (h01(Q.id, 44, x, 1) < 0.5) put(P, x, 14, soft); }
  if (m & 8) for (let y = 0; y < 16; y++) { put(P, 0, y, rim); if (h01(Q.id, 44, y, 2) < 0.5) put(P, 1, y, soft); }
  if (m & 2) for (let y = 0; y < 16; y++) { put(P, 15, y, rim); if (h01(Q.id, 44, y, 3) < 0.5) put(P, 14, y, soft); }
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

const RENDERERS = {
  dither: texDither,
  grain: texGrain,
  blade: texBlade,
  tallblade: texTallblade,
  wave: texWave,
  stone: texStone,
  cliff: texCliff,
  shine: texShine,
  tree: texTree,
  pine: texPine,
  palm: texPalm,
  cactus: texCactus,
  bush: texBush,
  flower: texFlower,
  plank: texPlank,
  checker: texChecker,
  brick: texBrick,
  shingle: texShingle,
  plaster: texPlaster,
  door: texDoor,
  window: texWindow,
  sign: texSign,
  fence: texFence,
  ledge: texLedge,
  stairs: texStairs,
  shelf: texShelf,
  crystal: texCrystal,
};

function makeQ(id, mask) {
  const def = defOf(id);
  const c = def.colors || ['#ff00ff'];
  const base = col(c[0]);
  const dark = c.length > 1 ? col(c[1]) : darken(base, 0.3);
  const light = c.length > 2 ? col(c[2]) : lighten(base, 0.3);
  const accent = c.length > 3 ? col(c[3]) : null;
  return { id, def, mask, base, dark, light, accent };
}

function renderCell(P, id, mask) {
  const Q = makeQ(id, mask);
  const fn = RENDERERS[Q.def.texture];
  if (fn) fn(Q, P);
  else { fill(P, Q.base); texDither(Q, P); }
  if (tileVariantCount(id) > 1) applyRim(Q, P);
}

// ---------------------------------------------------------------------------
// atlas
// ---------------------------------------------------------------------------

let atlas = null;
let built = false;

export function buildAtlas() {
  if (built) return atlas;
  if (typeof document === 'undefined' || !document.createElement) { built = true; return null; }
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) { built = true; return null; }
  ctx.imageSmoothingEnabled = false;

  const img = ctx.createImageData(ATLAS_W, ATLAS_H);
  const P = { d: img.data, W: ATLAS_W, ox: 0, oy: 0 };

  for (let id = 0; id < TILE_COUNT; id++) {
    const variants = tileVariantCount(id);
    for (let v = 0; v < variants; v++) {
      const idx = baseIndex[id] + v;
      P.ox = (idx % COLS) * CELL;
      P.oy = ((idx / COLS) | 0) * CELL;
      renderCell(P, id, v);
    }
  }

  ctx.putImageData(img, 0, 0);
  atlas = canvas;
  built = true;
  return atlas;
}

export function getAtlas() {
  if (!built) buildAtlas();
  return atlas;
}

export function drawTile(ctx, id, px, py, mask = 0) {
  if (!ctx) return;
  const a = getAtlas();
  if (!a) return;
  const idx = atlasIndex(id, mask);
  const sx = (idx % COLS) * CELL;
  const sy = ((idx / COLS) | 0) * CELL;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(a, sx, sy, CELL, CELL, px | 0, py | 0, CELL, CELL);
}
