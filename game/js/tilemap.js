// tilemap.js — GameMap: a thin, fast wrapper around a MapData record.
//
// Owns tile access (bounds-safe), O(1) warp/entity lookup indices, collision
// queries, and the culled tile renderer. DOM is touched ONLY inside render().
//
// MapData shape (see docs/CONTRACT.md):
//   { id, w, h, ground:Uint16Array, overlay:Uint16Array, biome, warps, entities,
//     spawn:{x,y}, indoor, bgm, name }

import {
  TILE, T, TILE_DEFS,
  isSolid, isGrass, isWater, isTall, isAutotile, isCounter,
  ledgeDir, encounterRate,
} from './tiles.js';
import { W as VIEW_W, H as VIEW_H } from './game.js';
import { getFlag } from './state.js';

// ---------------------------------------------------------------------------
// tileset.js is browser-only (it rasterizes a canvas atlas). It is pulled in
// lazily so this module stays importable in Node for headless tests and world
// generation. main.js imports + builds the atlas at boot, so by the time the
// first frame renders the dynamic import resolves from the module cache.
// Until then tiles fall back to their flat base colour.
// ---------------------------------------------------------------------------
let _drawTile = null;
let _tilesetTried = false;

function ensureTileset() {
  if (_drawTile || _tilesetTried) return;
  _tilesetTried = true;
  import('./tileset.js').then((m) => {
    if (m && typeof m.drawTile === 'function') _drawTile = m.drawTile;
  }).catch(() => { /* headless / not built yet — flat colours are used */ });
}

function fallbackTile(ctx, id, px, py) {
  const def = TILE_DEFS[id] || TILE_DEFS[T.VOID];
  const cols = (def && def.colors) || ['#000000'];
  ctx.fillStyle = cols[0] || '#000000';
  ctx.fillRect(px, py, TILE, TILE);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const key = (x, y) => x + ',' + y;

function intOr(v, fallback) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : fallback;
}

function toTileArray(src, len, fill) {
  if (src && typeof src.length === 'number' && src.length >= len) {
    // Already a typed array of the right size: adopt it (maps are mutated in place).
    if (src instanceof Uint16Array && src.length === len) return src;
    const out = new Uint16Array(len);
    for (let i = 0; i < len; i++) {
      const v = src[i];
      out[i] = Number.isFinite(v) ? (v & 0xffff) : fill;
    }
    return out;
  }
  const out = new Uint16Array(len);
  if (fill) out.fill(fill & 0xffff);
  return out;
}

// Entities whose kind is walk-through by default. Doors must be steppable or
// the warp beneath them can never fire.
const NONBLOCKING_KINDS = { door: true };

// ---------------------------------------------------------------------------
// GameMap
// ---------------------------------------------------------------------------
export class GameMap {
  constructor(data) {
    const d = (data && data.data && data.ground === undefined) ? data.data : (data || {});

    this.data    = d;
    this.id      = typeof d.id === 'string' ? d.id : 'map';
    this.name    = typeof d.name === 'string' ? d.name : '';
    this.indoor  = !!d.indoor;
    this.bgm     = typeof d.bgm === 'string' ? d.bgm : 'overworld';

    this._w = Math.max(0, intOr(d.w, 0));
    this._h = Math.max(0, intOr(d.h, 0));
    const len = this._w * this._h;

    this.ground  = toTileArray(d.ground, len, T.VOID);
    this.overlay = toTileArray(d.overlay, len, 0);
    this.biome   = d.biome && typeof d.biome.length === 'number' && d.biome.length >= len ? d.biome : null;

    this.spawn = (d.spawn && typeof d.spawn === 'object')
      ? { x: intOr(d.spawn.x, 0), y: intOr(d.spawn.y, 0) }
      : { x: 0, y: 0 };

    this.warps    = Array.isArray(d.warps) ? d.warps.slice() : [];
    this.entities = Array.isArray(d.entities) ? d.entities.slice() : [];

    // Keep the backing record pointing at the live arrays/lists so save.js and
    // worldgen.js see the same data the map is using.
    d.ground = this.ground;
    d.overlay = this.overlay;
    d.warps = this.warps;
    d.entities = this.entities;

    this._warpIdx = new Map();   // 'x,y' -> warp
    this._entIdx  = new Map();   // 'x,y' -> Entity[]
    this.reindex();
  }

  get w() { return this._w; }
  get h() { return this._h; }
  get pixelW() { return this._w * TILE; }
  get pixelH() { return this._h * TILE; }

  // -- indices --------------------------------------------------------------

  /** Rebuild both lookup indices from scratch. Cheap enough for a map load. */
  reindex() {
    this._warpIdx.clear();
    this._entIdx.clear();
    for (let i = 0; i < this.warps.length; i++) {
      const wp = this.warps[i];
      if (!wp) continue;
      const k = key(intOr(wp.x, -1), intOr(wp.y, -1));
      if (!this._warpIdx.has(k)) this._warpIdx.set(k, wp);
    }
    for (let i = 0; i < this.entities.length; i++) this._indexEntity(this.entities[i]);
    return this;
  }

  _indexEntity(e) {
    if (!e) return;
    const k = key(intOr(e.x, -1), intOr(e.y, -1));
    const list = this._entIdx.get(k);
    if (list) list.push(e);
    else this._entIdx.set(k, [e]);
  }

  _unindexEntity(e, atX, atY) {
    if (!e) return;
    const k = key(intOr(atX !== undefined ? atX : e.x, -1), intOr(atY !== undefined ? atY : e.y, -1));
    const list = this._entIdx.get(k);
    if (!list) return;
    const i = list.indexOf(e);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) this._entIdx.delete(k);
  }

  // -- tile access ----------------------------------------------------------

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this._w && y < this._h;
  }

  idx(x, y) {
    return y * this._w + x;
  }

  /** Ground tile id. T.VOID out of bounds — never throws, never undefined. */
  at(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!(tx >= 0 && ty >= 0 && tx < this._w && ty < this._h)) return T.VOID;
    const v = this.ground[ty * this._w + tx];
    return v === undefined ? T.VOID : v;
  }

  /** Overlay tile id. 0 (nothing) out of bounds. */
  overlayAt(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!(tx >= 0 && ty >= 0 && tx < this._w && ty < this._h)) return 0;
    const v = this.overlay[ty * this._w + tx];
    return v === undefined ? 0 : v;
  }

  setTile(x, y, id, layer = 'ground') {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!(tx >= 0 && ty >= 0 && tx < this._w && ty < this._h)) return false;
    const v = intOr(id, 0) & 0xffff;
    const arr = layer === 'overlay' ? this.overlay : this.ground;
    arr[ty * this._w + tx] = v;
    return true;
  }

  // -- queries --------------------------------------------------------------

  /** True when a live entity standing here blocks movement. */
  _entityBlocks(e) {
    if (!e) return false;
    if (e.blocking === false) return false;
    if (NONBLOCKING_KINDS[e.kind]) return false;
    // A sign tucked behind a shop/heal counter is talked to across the counter;
    // the counter tile itself already blocks, so the sign must not double up.
    if (e.kind === 'sign' && isCounter(this.at(e.x, e.y))) return false;
    return true;
  }

  solidAt(x, y) {
    if (isSolid(this.at(x, y))) return true;
    const e = this.entityAt(x, y);
    return e ? this._entityBlocks(e) : false;
  }

  grassAt(x, y) {
    return isGrass(this.at(x, y)) || isGrass(this.overlayAt(x, y));
  }

  waterAt(x, y) { return isWater(this.at(x, y)); }

  /** Ground OR overlay tile is "tall" — used to occlude the player's legs. */
  isTallAt(x, y) {
    return isTall(this.at(x, y)) || isTall(this.overlayAt(x, y));
  }

  ledgeAt(x, y) { return ledgeDir(this.at(x, y)); }

  encounterRateAt(x, y) {
    const g = encounterRate(this.at(x, y));
    return g > 0 ? g : encounterRate(this.overlayAt(x, y));
  }

  /** O(1). -> warp | null */
  warpAt(x, y) {
    const wp = this._warpIdx.get(key(Math.floor(x), Math.floor(y)));
    return wp === undefined ? null : wp;
  }

  /** O(1). -> Entity | null. Entities whose `flag` is set are invisible. */
  entityAt(x, y) {
    const list = this._entIdx.get(key(Math.floor(x), Math.floor(y)));
    if (!list) return null;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e && !(e.flag && getFlag(e.flag))) return e;
    }
    return null;
  }

  /** Every entity on this tile, flagged ones included. */
  entitiesAt(x, y) {
    const list = this._entIdx.get(key(Math.floor(x), Math.floor(y)));
    return list ? list.slice() : [];
  }

  /** Live (non-flagged) entities, in map order. */
  entityList() {
    const out = [];
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e && !(e.flag && getFlag(e.flag))) out.push(e);
    }
    return out;
  }

  isLive(e) { return !!e && !(e.flag && getFlag(e.flag)); }

  // -- mutation -------------------------------------------------------------

  addEntity(e) {
    if (!e || typeof e !== 'object') return null;
    e.x = intOr(e.x, 0);
    e.y = intOr(e.y, 0);
    this.entities.push(e);
    this._indexEntity(e);
    return e;
  }

  removeEntity(e) {
    if (!e) return false;
    const i = this.entities.indexOf(e);
    if (i >= 0) this.entities.splice(i, 1);
    this._unindexEntity(e);
    return i >= 0;
  }

  /** Move an entity and keep the index in sync (wandering NPCs). */
  moveEntity(e, x, y) {
    if (!e) return false;
    this._unindexEntity(e, e.x, e.y);
    e.x = intOr(x, e.x);
    e.y = intOr(y, e.y);
    this._indexEntity(e);
    return true;
  }

  addWarp(wp) {
    if (!wp || typeof wp !== 'object') return null;
    wp.x = intOr(wp.x, 0);
    wp.y = intOr(wp.y, 0);
    this.warps.push(wp);
    const k = key(wp.x, wp.y);
    if (!this._warpIdx.has(k)) this._warpIdx.set(k, wp);
    return wp;
  }

  removeWarp(wp) {
    if (!wp) return false;
    const i = this.warps.indexOf(wp);
    if (i >= 0) this.warps.splice(i, 1);
    const k = key(intOr(wp.x, -1), intOr(wp.y, -1));
    if (this._warpIdx.get(k) === wp) {
      this._warpIdx.delete(k);
      // Another warp may sit on the same tile — re-link it.
      for (let j = 0; j < this.warps.length; j++) {
        const o = this.warps[j];
        if (o && intOr(o.x, -1) === intOr(wp.x, -1) && intOr(o.y, -1) === intOr(wp.y, -1)) {
          this._warpIdx.set(k, o);
          break;
        }
      }
    }
    return i >= 0;
  }

  // -- autotiling -----------------------------------------------------------

  // All water reads as one kind so shorelines stay continuous across
  // deep/shallow/edge transitions. Out-of-bounds reads as "same" so the map
  // border never grows a phantom coastline.
  _kind(id) { return isWater(id) ? -1 : id; }

  /** 4-bit neighbour-differs mask: 1=N, 2=E, 4=S, 8=W. */
  neighbourMask(x, y, layer = 'ground') {
    const overlayLayer = layer === 'overlay';
    const arr = overlayLayer ? this.overlay : this.ground;
    const w = this._w, h = this._h;
    if (!(x >= 0 && y >= 0 && x < w && y < h)) return 0;
    const self = this._kind(arr[y * w + x]);
    let m = 0;
    if (y > 0     && this._kind(arr[(y - 1) * w + x]) !== self) m |= 1;
    if (x < w - 1 && this._kind(arr[y * w + x + 1]) !== self)   m |= 2;
    if (y < h - 1 && this._kind(arr[(y + 1) * w + x]) !== self) m |= 4;
    if (x > 0     && this._kind(arr[y * w + x - 1]) !== self)   m |= 8;
    return m;
  }

  // -- render ---------------------------------------------------------------

  /**
   * Draw one layer of the map, culled to the camera view + 1 tile of margin.
   * layer: 'ground' (draws everything) | 'overlay' (skips id 0).
   */
  render(ctx, cam, layer = 'ground') {
    if (!ctx) return;
    ensureTileset();

    const w = this._w, h = this._h;
    if (w <= 0 || h <= 0) return;

    const c = cam || {};
    let ox = c.ox, oy = c.oy;
    if (!Number.isFinite(ox)) ox = Number.isFinite(c.x) ? c.x : 0;
    if (!Number.isFinite(oy)) oy = Number.isFinite(c.y) ? c.y : 0;
    ox = Math.round(ox); oy = Math.round(oy);

    const x0 = Math.max(0, Math.floor(ox / TILE) - 1);
    const y0 = Math.max(0, Math.floor(oy / TILE) - 1);
    const x1 = Math.min(w - 1, Math.floor((ox + VIEW_W - 1) / TILE) + 1);
    const y1 = Math.min(h - 1, Math.floor((oy + VIEW_H - 1) / TILE) + 1);
    if (x1 < x0 || y1 < y0) return;

    const overlayLayer = layer === 'overlay';
    const arr = overlayLayer ? this.overlay : this.ground;
    const draw = _drawTile;

    for (let ty = y0; ty <= y1; ty++) {
      const row = ty * w;
      const py = ty * TILE - oy;
      for (let tx = x0; tx <= x1; tx++) {
        const id = arr[row + tx];
        if (overlayLayer && id === 0) continue;
        const px = tx * TILE - ox;
        if (draw) {
          const mask = isAutotile(id) ? this.neighbourMask(tx, ty, layer) : 0;
          draw(ctx, id, px, py, mask);
        } else {
          fallbackTile(ctx, id, px, py);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
/**
 * Build a blank MapData record (not a GameMap) ready to be stamped by
 * worldgen.js / towns.js and then wrapped: `new GameMap(makeEmptyMap(...))`.
 */
export function makeEmptyMap(id, w, h, fillTileId = T.GRASS) {
  const mw = Math.max(1, intOr(w, 1));
  const mh = Math.max(1, intOr(h, 1));
  const len = mw * mh;
  const ground = new Uint16Array(len);
  const fill = intOr(fillTileId, T.GRASS) & 0xffff;
  if (fill) ground.fill(fill);
  return {
    id: typeof id === 'string' ? id : 'map',
    w: mw,
    h: mh,
    ground,
    overlay: new Uint16Array(len),
    biome: null,
    warps: [],
    entities: [],
    spawn: { x: mw >> 1, y: mh >> 1 },
    indoor: false,
    bgm: 'overworld',
    name: '',
  };
}

export default GameMap;
