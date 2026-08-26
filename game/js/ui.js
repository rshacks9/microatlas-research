// Shared drawing primitives: windows, text, bars, cursors, type badges.
import { GLYPH_W, GLYPH_H, GLYPH_SPACING, glyphFor, glyphCount } from './font.js';
import { TYPE_COLORS, TYPE_NAMES } from './types.js';

export const PAL = {
  ink: '#182028', paper: '#f8f4e8', shadow: '#5a6472', accent: '#3868b8',
  hpGood: '#48c058', hpWarn: '#f0c020', hpBad: '#e04038', frame: '#283848',
  frameLite: '#6888a8', dim: '#98a0ac', gold: '#e8c040',
};

export const LINE_H = GLYPH_H + 3;   // 10px baseline-to-baseline

// ---- text --------------------------------------------------------------
const FALLBACK_FONT = '7px "Courier New", ui-monospace, monospace';
const FALLBACK_W = 5;

export function charWidth(ch) {
  if (ch === ' ') return GLYPH_W + GLYPH_SPACING;
  return GLYPH_W + GLYPH_SPACING;
}

export function textWidth(text) {
  let w = 0;
  for (const ch of String(text)) w += charWidth(ch);
  return w > 0 ? w - GLYPH_SPACING : 0;
}

function drawGlyph(ctx, rows, x, y, color) {
  ctx.fillStyle = color;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let c = 0;
    while (c < row.length) {
      if (row[c] === '#') {
        let run = 1;
        while (c + run < row.length && row[c + run] === '#') run++;
        ctx.fillRect(x + c, y + r, run, 1);
        c += run;
      } else c++;
    }
  }
}

// opts: { color, shadow, max, mono }
export function drawText(ctx, text, x, y, opts = {}) {
  const color = opts.color || PAL.ink;
  const shadow = opts.shadow || null;
  const str = String(text == null ? '' : text);
  const haveFont = glyphCount() > 0;
  let cx = Math.round(x);
  const cy = Math.round(y);

  if (!haveFont) {
    ctx.save();
    ctx.font = FALLBACK_FONT;
    ctx.textBaseline = 'top';
    if (shadow) { ctx.fillStyle = shadow; ctx.fillText(str, cx + 1, cy + 1); }
    ctx.fillStyle = color;
    ctx.fillText(str, cx, cy);
    ctx.restore();
    return cx + str.length * FALLBACK_W;
  }

  for (const ch of str) {
    if (ch === ' ') { cx += charWidth(ch); continue; }
    const rows = glyphFor(ch);
    if (rows) {
      if (shadow) drawGlyph(ctx, rows, cx + 1, cy + 1, shadow);
      drawGlyph(ctx, rows, cx, cy, color);
    } else {
      ctx.save();
      ctx.font = FALLBACK_FONT;
      ctx.textBaseline = 'top';
      if (shadow) { ctx.fillStyle = shadow; ctx.fillText(ch, cx + 1, cy + 1); }
      ctx.fillStyle = color;
      ctx.fillText(ch, cx, cy);
      ctx.restore();
    }
    cx += charWidth(ch);
  }
  return cx;
}

export function wrapText(text, maxPx) {
  const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const trial = line ? line + ' ' + word : word;
    if (textWidth(trial) <= maxPx || !line) {
      line = trial;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

// ---- windows -----------------------------------------------------------
export function drawWindow(ctx, x, y, w, h, opts = {}) {
  const fill = opts.fill || PAL.paper;
  const frame = opts.frame || PAL.frame;
  const lite = opts.lite || PAL.frameLite;
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);

  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 2, y + 2, w, h);

  ctx.fillStyle = frame;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = lite;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);

  // clipped corners for a softer, more "console" look
  ctx.fillStyle = frame;
  ctx.fillRect(x, y, 1, 1);
  ctx.fillRect(x + w - 1, y, 1, 1);
  ctx.fillRect(x, y + h - 1, 1, 1);
  ctx.fillRect(x + w - 1, y + h - 1, 1, 1);
}

export function drawPanel(ctx, x, y, w, h, color) {
  ctx.fillStyle = color || 'rgba(24,32,40,0.82)';
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

// ---- bars --------------------------------------------------------------
export function drawBar(ctx, x, y, w, h, frac, color) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  frac = Math.max(0, Math.min(1, frac || 0));
  ctx.fillStyle = PAL.frame;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#20303c';
  ctx.fillRect(x, y, w, h);
  const fw = Math.max(frac > 0 ? 1 : 0, Math.round(w * frac));
  ctx.fillStyle = color || PAL.hpGood;
  ctx.fillRect(x, y, fw, h);
  if (h >= 3) {
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x, y, fw, 1);
  }
}

export function hpColor(cur, max) {
  const f = max > 0 ? cur / max : 0;
  if (f <= 0.2) return PAL.hpBad;
  if (f <= 0.5) return PAL.hpWarn;
  return PAL.hpGood;
}

export function drawHpBar(ctx, x, y, w, cur, max) {
  drawBar(ctx, x, y, w, 3, max > 0 ? cur / max : 0, hpColor(cur, max));
}

export function drawExpBar(ctx, x, y, w, frac) {
  drawBar(ctx, x, y, w, 2, frac, '#48a8e8');
}

// ---- cursor / misc -----------------------------------------------------
export function drawCursor(ctx, x, y, t = 0) {
  const bob = Math.sin((t || 0) * 8) > 0 ? 1 : 0;
  x = Math.round(x) + bob; y = Math.round(y);
  ctx.fillStyle = PAL.ink;
  for (let i = 0; i < 5; i++) {
    const half = Math.min(i, 4 - i);
    ctx.fillRect(x + i, y + 2 - half, 1, half * 2 + 1);
  }
}

// WCAG relative luminance of a hex colour; used to keep badge labels at
// >= 4.5:1 contrast against every TYPE_COLORS background.
function relLuminance(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  if (!isFinite(n)) return 0;
  const lin = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

export function drawTypeBadge(ctx, type, x, y) {
  const label = (TYPE_NAMES[type] || type || '').toUpperCase();
  const bg = TYPE_COLORS[type] || '#888';
  // Width follows the label (2px inset each side inside a 1px border) and is
  // returned so callers can lay out whatever follows the badge. The label
  // keeps a 1px field row above and below so glyphs never touch the border.
  const w = Math.max(12, textWidth(label) + 4);
  const bx = Math.round(x), by = Math.round(y);
  ctx.fillStyle = '#101820';
  ctx.fillRect(bx, by, w, 11);
  ctx.fillStyle = bg;
  ctx.fillRect(bx + 1, by + 1, w - 2, 9);
  // 0.19 is where contrast against ink and paper crosses over.
  const inkCol = relLuminance(bg) > 0.19 ? '#101820' : PAL.paper;
  drawText(ctx, label, bx + 2, by + 2, { color: inkCol });
  return w;
}

export function drawGenderless() { /* reserved */ }

// Centre helper
export function drawTextCentered(ctx, text, cx, y, opts = {}) {
  return drawText(ctx, text, Math.round(cx - textWidth(text) / 2), y, opts);
}

export function drawTextRight(ctx, text, rx, y, opts = {}) {
  return drawText(ctx, text, Math.round(rx - textWidth(text)), y, opts);
}
