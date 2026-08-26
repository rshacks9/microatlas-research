// 5x7 bitmap font. GLYPHS is populated by the font data module; ui.js falls back to
// ctx.fillText for any character missing here, so a partial font never breaks rendering.
export const GLYPH_W = 5, GLYPH_H = 7, GLYPH_SPACING = 1;

export const GLYPHS = Object.create(null);

export function glyphFor(ch) {
  const g = GLYPHS[ch];
  if (g) return g;
  const up = ch.toUpperCase();
  return GLYPHS[up] || null;
}

export function glyphCount() { return Object.keys(GLYPHS).length; }
