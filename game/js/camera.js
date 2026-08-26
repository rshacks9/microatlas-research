// camera.js — the 320x240 view camera: smooth follow, hard clamping, screen shake.
// No DOM, no top-level side effects. Importable in Node.
//
// Renderers should offset by cam.ox / cam.oy (integers, shake included):
//     ctx.drawImage(img, worldPx - cam.ox, worldPy - cam.oy);
// cam.x / cam.y are the same thing WITHOUT shake, also integers.

import { W, H, TILE } from './game.js';

const VIEW_W = Number.isFinite(W) && W > 0 ? W : 320;
const VIEW_H = Number.isFinite(H) && H > 0 ? H : 240;
const TS     = Number.isFinite(TILE) && TILE > 0 ? TILE : 16;

// Exponential damp base: factor = 1 - pow(SMOOTH, dt). Smaller = snappier.
const SMOOTH = 0.0001;
// Below this distance we snap, so the rounded output stops shimmering.
const SNAP_PX = 0.5;
// Ignore absurd frame deltas (tab was backgrounded, debugger paused, ...).
const MAX_DT = 0.25;

function fin(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// Pixel dimensions of a MapData / GameMap. Tolerates null and garbage.
function mapPixels(map) {
  if (!map || typeof map !== 'object') return { pw: 0, ph: 0 };
  const w = Math.floor(fin(map.w, 0));
  const h = Math.floor(fin(map.h, 0));
  return { pw: w > 0 ? w * TS : 0, ph: h > 0 ? h * TS : 0 };
}

// Clamp one axis of the view origin.
//   span <= 0  -> map size unknown; leave the value alone (but never NaN)
//   span < view -> map is smaller than the view: centre it (value goes negative)
function clampAxis(v, span, view) {
  const x = fin(v, 0);
  if (!(span > 0)) return x;
  const max = span - view;
  if (max <= 0) return max / 2;
  if (x < 0) return 0;
  if (x > max) return max;
  return x;
}

// Two incommensurate sines read a lot better than white noise at 60fps and
// keep the shake fully deterministic (no rng import needed).
function shakeWave(t, seedA, seedB) {
  return Math.sin(t * seedA) * 0.62 + Math.sin(t * seedB) * 0.38;
}

export function makeCamera(map) {
  const cam = {
    map: map && typeof map === 'object' ? map : null,

    // unrounded internal position — slow motion still accumulates here
    _x: 0, _y: 0,
    // target view origin (already clamped)
    _tx: 0, _ty: 0,
    // shake
    _shMag: 0, _shLeft: 0, _shDur: 0, _sx: 0, _sy: 0,
    _t: 0,

    get x() { return Math.round(this._x); },
    set x(v) { this._x = clampAxis(fin(v, this._x), mapPixels(this.map).pw, VIEW_W); },
    get y() { return Math.round(this._y); },
    set y(v) { this._y = clampAxis(fin(v, this._y), mapPixels(this.map).ph, VIEW_H); },

    // render offset INCLUDING shake
    get ox() { return Math.round(this._x + this._sx); },
    get oy() { return Math.round(this._y + this._sy); },

    // unrounded accessors, for anyone who wants sub-pixel truth
    get rawX() { return this._x; },
    get rawY() { return this._y; },
    get targetX() { return this._tx; },
    get targetY() { return this._ty; },
    get shakeX() { return this._sx; },
    get shakeY() { return this._sy; },
    get shaking() { return this._shLeft > 0; },

    // Aim the camera at a world pixel point (usually the player's centre).
    follow(px, py, instant) {
      const cx = fin(px, this._x + VIEW_W / 2);
      const cy = fin(py, this._y + VIEW_H / 2);
      const { pw, ph } = mapPixels(this.map);
      this._tx = clampAxis(cx - VIEW_W / 2, pw, VIEW_W);
      this._ty = clampAxis(cy - VIEW_H / 2, ph, VIEW_H);
      if (instant) {
        this._x = this._tx;
        this._y = this._ty;
      }
      return this;
    },

    // Alias: snap without smoothing.
    snap(px, py) { return this.follow(px, py, true); },

    shake(mag, dur) {
      const m = Math.max(0, fin(mag, 0));
      const d = Math.max(0, fin(dur, 0));
      if (m <= 0 || d <= 0) return this;
      // Keep whatever is left of an in-flight shake rather than cutting it off.
      const residual = this._shDur > 0 ? this._shMag * (this._shLeft / this._shDur) : 0;
      this._shMag = Math.max(m, residual);
      this._shDur = Math.max(d, this._shLeft);
      this._shLeft = this._shDur;
      return this;
    },

    stopShake() {
      this._shMag = 0; this._shLeft = 0; this._shDur = 0;
      this._sx = 0; this._sy = 0;
      return this;
    },

    update(dt) {
      const d = Math.min(MAX_DT, Math.max(0, fin(dt, 0)));
      this._t += d;

      // Framerate-independent exponential damp toward the target.
      if (d > 0) {
        const f = 1 - Math.pow(SMOOTH, d);
        let nx = this._x + (this._tx - this._x) * f;
        let ny = this._y + (this._ty - this._y) * f;
        if (!Number.isFinite(nx)) nx = this._tx;
        if (!Number.isFinite(ny)) ny = this._ty;
        if (Math.abs(this._tx - nx) < SNAP_PX) nx = this._tx;
        if (Math.abs(this._ty - ny) < SNAP_PX) ny = this._ty;
        this._x = nx;
        this._y = ny;
      }

      this.clampTo();

      // Linear decay to zero over the shake's duration.
      if (this._shLeft > 0) {
        this._shLeft = Math.max(0, this._shLeft - d);
        const k = this._shDur > 0 ? this._shLeft / this._shDur : 0;
        const amp = this._shMag * k;
        if (amp > 0.01) {
          this._sx = shakeWave(this._t, 61.7, 103.1) * amp;
          this._sy = shakeWave(this._t, 47.3, 89.9) * amp;
        } else {
          this.stopShake();
        }
        if (!Number.isFinite(this._sx)) this._sx = 0;
        if (!Number.isFinite(this._sy)) this._sy = 0;
      } else if (this._sx !== 0 || this._sy !== 0) {
        this._sx = 0; this._sy = 0;
      }

      return this;
    },

    // Re-clamp after a map change (or any external poking at x/y).
    clampTo(m) {
      if (m !== undefined) this.map = m && typeof m === 'object' ? m : null;
      const { pw, ph } = mapPixels(this.map);
      this._x  = clampAxis(this._x,  pw, VIEW_W);
      this._y  = clampAxis(this._y,  ph, VIEW_H);
      this._tx = clampAxis(this._tx, pw, VIEW_W);
      this._ty = clampAxis(this._ty, ph, VIEW_H);
      return this;
    },

    setMap(m) {
      this.map = m && typeof m === 'object' ? m : null;
      return this.clampTo();
    },

    // World pixel -> screen pixel, shake included.
    worldToScreen(px, py) {
      return { x: Math.round(fin(px, 0)) - this.ox, y: Math.round(fin(py, 0)) - this.oy };
    },

    // Inclusive tile range covering the view (plus a margin), for tilemap.render.
    tileBounds(margin = 1) {
      const m = Math.max(0, Math.floor(fin(margin, 1)));
      const { pw, ph } = mapPixels(this.map);
      const mw = pw > 0 ? Math.floor(pw / TS) : 0;
      const mh = ph > 0 ? Math.floor(ph / TS) : 0;
      const x0 = Math.floor(this.ox / TS) - m;
      const y0 = Math.floor(this.oy / TS) - m;
      const x1 = Math.floor((this.ox + VIEW_W - 1) / TS) + m;
      const y1 = Math.floor((this.oy + VIEW_H - 1) / TS) + m;
      return {
        x0: Math.max(0, x0),
        y0: Math.max(0, y0),
        x1: mw > 0 ? Math.min(mw - 1, x1) : x1,
        y1: mh > 0 ? Math.min(mh - 1, y1) : y1,
      };
    },
  };

  cam.clampTo();
  cam._tx = cam._x;
  cam._ty = cam._y;
  return cam;
}

export default makeCamera;
