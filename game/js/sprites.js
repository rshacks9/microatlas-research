// Sprite registry + rasterizer. Pixel data lives in the spritedata_*.js modules.
import { CHAR_SPRITES } from './spritedata_chars.js';
import { CREATURE_SPRITES_A } from './spritedata_creatures_a.js';
import { CREATURE_SPRITES_B } from './spritedata_creatures_b.js';
import { CREATURE_SPRITES_C } from './spritedata_creatures_c.js';
import { UI_SPRITES } from './spritedata_ui.js';

export const KEY = '0123456789abcdefghijklmnopqrstuv';

// ---- shrine monument ----------------------------------------------------
// Static overworld landmark, same 16x24 record contract as the character
// sprites. Authored with role letters and compiled to KEY chars at load.
//   o outline, R stone, r stone lite, d stone shade, m moss, g carved sigil
const SHRINE_ROLES = 'oRrdmg';
const SHRINE_PAL = ['#202028', '#8e8e96', '#bcbcc2', '#606068', '#4a8c3c', '#e8c040'];
const SHRINE_ART = [
  '................',
  '................',
  '....oooooooo....',
  '..oorrrrrrrroo..',
  '..orrRRRRRRddo..',
  '...ooRRRRRRoo...',
  '....orRRRRdo....',
  '....orRRRRdo....',
  '....orRggRdo....',
  '....ogRRRRgo....',
  '....orRggRdo....',
  '....orRRRRdo....',
  '....orRdRRdo....',
  '....orRRdRdo....',
  '....orRRRddo....',
  '....omRRRRdo....',
  '....omRRRRd.....',
  '....omRRRRdo....',
  '...oomRRRRdoo...',
  '..ormmRRRRRddo..',
  '..orRmRRRRRddo..',
  '.oorRRRRRRRRdoo.',
  '.orRmRRRRRRRRdo.',
  '.oooooooooooooo.',
];
const SHRINE_SPRITE = {
  w: 16, h: 24, pal: SHRINE_PAL,
  rows: SHRINE_ART.map((r) => r.replace(/[^.]/g, (ch) => {
    const i = SHRINE_ROLES.indexOf(ch);
    if (i < 0) throw new Error('sprites: bad shrine role char "' + ch + '"');
    return KEY[i];
  })),
};

export const SPRITES = Object.assign(
  Object.create(null),
  CHAR_SPRITES, CREATURE_SPRITES_A, CREATURE_SPRITES_B, CREATURE_SPRITES_C, UI_SPRITES,
  // Entities resolve draw keys through walkKey() with a '<base>_down_0' final
  // fallback, so the monument registers under both its bare key and that one.
  { shrine: SHRINE_SPRITE, shrine_down_0: SHRINE_SPRITE }
);

const cache = new Map();
const flipCache = new Map();
const tintCache = new Map();

function makeCanvas(w, h) {
  const c = (typeof document !== 'undefined')
    ? document.createElement('canvas')
    : { width: w, height: h, getContext: () => null };
  c.width = w; c.height = h;
  return c;
}

// A magenta checker so a missing sprite is loud but never crashes.
function placeholder(w = 16, h = 16) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  if (!g) return c;
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      g.fillStyle = ((x + y) / 4) % 2 ? '#ff00ff' : '#301030';
      g.fillRect(x, y, 4, 4);
    }
  }
  return c;
}

export function validateSprite(data) {
  if (!data || !Array.isArray(data.rows) || !Array.isArray(data.pal)) return 'missing rows/pal';
  if (!data.w || !data.h) return 'missing w/h';
  if (data.rows.length !== data.h) return 'expected ' + data.h + ' rows, got ' + data.rows.length;
  for (let i = 0; i < data.rows.length; i++) {
    if (typeof data.rows[i] !== 'string') return 'row ' + i + ' is not a string';
    if (data.rows[i].length !== data.w) return 'row ' + i + ' width ' + data.rows[i].length + ' != ' + data.w;
  }
  return null;
}

function rasterize(data) {
  const c = makeCanvas(data.w, data.h);
  const g = c.getContext('2d');
  if (!g) return c;
  for (let y = 0; y < data.h; y++) {
    const row = data.rows[y];
    for (let x = 0; x < data.w; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ' || ch === undefined) continue;
      const idx = KEY.indexOf(ch);
      if (idx < 0) continue;
      const col = data.pal[idx];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

// ---- rare variant palettes ---------------------------------------------
// A variant sprite is the same pixel data with every palette colour hue-rotated.
// Doing it as a palette transform (rather than authoring 34 more sprites) means
// every creature, including ones added later, gets a variant for free.
const variantCache = new Map();

function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length < 6) return null;
  const n = parseInt(h.slice(0, 6), 16);
  if (!isFinite(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

// Rotate hue and nudge saturation so variants read as "wrong colour, same creature".
function shiftColor(hex, deg, satBoost) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, sat = 0;
  const d = max - min;
  if (d !== 0) {
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  h = (h + deg / 360) % 1;
  sat = Math.max(0, Math.min(1, sat * (satBoost || 1)));
  const hue2 = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (sat === 0) return rgbToHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
  const pp = 2 * l - q;
  return rgbToHex(hue2(pp, q, h + 1 / 3) * 255, hue2(pp, q, h) * 255, hue2(pp, q, h - 1 / 3) * 255);
}

export function getVariantSprite(key) {
  if (variantCache.has(key)) return variantCache.get(key);
  const data = SPRITES[key];
  let canvas;
  if (!data || validateSprite(data)) {
    canvas = placeholder(16, 16);
  } else {
    // Hue rotation is derived from the key so a given species always has the
    // same variant colours — a player can learn to recognise them.
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const deg = 100 + (h % 160);
    canvas = rasterize({ ...data, pal: data.pal.map((c) => shiftColor(c, deg, 1.15)) });
  }
  variantCache.set(key, canvas);
  return canvas;
}

const variantFlipCache = new Map();
export function getVariantFlipped(key) {
  if (variantFlipCache.has(key)) return variantFlipCache.get(key);
  const src = getVariantSprite(key);
  const c = makeCanvas(src.width, src.height);
  const g = c.getContext('2d');
  if (g) {
    g.imageSmoothingEnabled = false;
    g.translate(src.width, 0);
    g.scale(-1, 1);
    g.drawImage(src, 0, 0);
  }
  variantFlipCache.set(key, c);
  return c;
}

export function hasSprite(key) { return !!SPRITES[key]; }

export function getSprite(key) {
  if (cache.has(key)) return cache.get(key);
  const data = SPRITES[key];
  let canvas;
  if (!data || validateSprite(data)) {
    canvas = placeholder(data && data.w ? data.w : 16, data && data.h ? data.h : 16);
  } else {
    canvas = rasterize(data);
  }
  cache.set(key, canvas);
  return canvas;
}

export function getFlipped(key) {
  if (flipCache.has(key)) return flipCache.get(key);
  const src = getSprite(key);
  const c = makeCanvas(src.width, src.height);
  const g = c.getContext('2d');
  if (g) {
    g.imageSmoothingEnabled = false;
    g.translate(src.width, 0);
    g.scale(-1, 1);
    g.drawImage(src, 0, 0);
  }
  flipCache.set(key, c);
  return c;
}

// Solid-colour silhouette, used for the battle intro flash and fainting.
export function getTinted(key, color) {
  const ck = key + '|' + color;
  if (tintCache.has(ck)) return tintCache.get(ck);
  const src = getSprite(key);
  const c = makeCanvas(src.width, src.height);
  const g = c.getContext('2d');
  if (g) {
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
  }
  tintCache.set(ck, c);
  return c;
}

// opts: { flip, alpha, scale, tint, silhouette }
export function drawSprite(ctx, key, x, y, opts = {}) {
  const src = opts.silhouette && opts.tint
    ? getTinted(key, opts.tint)
    : opts.variant
      ? (opts.flip ? getVariantFlipped(key) : getVariantSprite(key))
      : (opts.flip ? getFlipped(key) : getSprite(key));
  if (!src || !src.width) return;
  const scale = opts.scale || 1;
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const prevAlpha = ctx.globalAlpha;
  if (opts.alpha !== undefined) ctx.globalAlpha = Math.max(0, Math.min(1, opts.alpha));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, Math.round(x), Math.round(y), w, h);
  ctx.globalAlpha = prevAlpha;
}

export function spriteSize(key) {
  const d = SPRITES[key];
  return d ? { w: d.w, h: d.h } : { w: 16, h: 16 };
}

// Walk-cycle frame key, e.g. walkKey('hero','left',1) -> 'hero_left_1'
export function walkKey(base, dir, frame) {
  return base + '_' + dir + '_' + (frame % 3);
}

export function spriteKeys() { return Object.keys(SPRITES); }
