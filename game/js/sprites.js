// Sprite registry + rasterizer. Pixel data lives in the spritedata_*.js modules.
import { CHAR_SPRITES } from './spritedata_chars.js';
import { CREATURE_SPRITES_A } from './spritedata_creatures_a.js';
import { CREATURE_SPRITES_B } from './spritedata_creatures_b.js';
import { CREATURE_SPRITES_C } from './spritedata_creatures_c.js';
import { UI_SPRITES } from './spritedata_ui.js';

export const KEY = '0123456789abcdefghijklmnopqrstuv';

export const SPRITES = Object.assign(
  Object.create(null),
  CHAR_SPRITES, CREATURE_SPRITES_A, CREATURE_SPRITES_B, CREATURE_SPRITES_C, UI_SPRITES
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
