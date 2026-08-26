// Pause menu, party, bag, dex, world map, shop and save UI.
import { Game, W, H, pushScene, popScene, topScene } from './game.js';
import { drawWindow, drawText, drawTextRight, drawTextCentered, drawCursor, drawHpBar,
         drawExpBar, drawTypeBadge, wrapText, PAL, textWidth } from './ui.js';
import { consume, Keys, repeatEdge } from './input.js';
import { drawSprite, hasSprite } from './sprites.js';
import { getSpecies, allSpecies, DEX_COUNT } from './creatures.js';
import { getMove } from './moves.js';
import { getItem, useItem, shopStock, sellPrice } from './items.js';
import { maxHp, statsFor, expToNext } from './battlecalc.js';
import { displayName, isFainted, hpFrac, swapParty, nextMilestone } from './party.js';
import { S, bagList, itemCount, removeItem, addItem, spendMoney, addMoney,
         dexSeenCount, dexCaughtCount, dexVariantCount, clockString, playtimeString } from './state.js';
import { sfx } from './audio.js';
import { TYPE_COLORS, TYPE_NAMES } from './types.js';
import { say, ask } from './dialogue.js';

// ------------------------------------------------------------------ generic list scene
function makeListScene(cfg) {
  const sc = {
    opaque: cfg.opaque !== false,
    index: cfg.index || 0,
    scroll: 0,
    t: 0,
    resolve: null,
    items: cfg.items || [],
    enter(params) {
      this.t = 0;
      this.index = Math.max(0, Math.min(this.items.length - 1, this.index));
      // A non-zero starting index (e.g. the bag's sticky cursor) must be scrolled into view.
      const rows = cfg.rows || 8;
      if (this.index >= this.scroll + rows) this.scroll = Math.max(0, this.index - rows + 1);
      this.resolve = params && params.resolve;
    },
    update(dt) {
      this.t += dt;
      const n = this.items.length;
      if (!n) {
        if (consume('b') || consume('a')) this.close(-1);
        return;
      }
      let moved = false;
      // Edge OR auto-repeat, so holding a direction scrolls the list.
      if (consume('up') || repeatEdge('up', dt)) { this.index = (this.index - 1 + n) % n; moved = true; }
      if (consume('down') || repeatEdge('down', dt)) { this.index = (this.index + 1) % n; moved = true; }
      if (cfg.cols > 1) {
        if (consume('left') || repeatEdge('left', dt)) { this.index = (this.index - 1 + n) % n; moved = true; }
        if (consume('right') || repeatEdge('right', dt)) { this.index = (this.index + 1) % n; moved = true; }
      }
      if (moved) {
        sfx('select');
        const rows = cfg.rows || 8;
        if (this.index < this.scroll) this.scroll = this.index;
        if (this.index >= this.scroll + rows) this.scroll = this.index - rows + 1;
      }
      if (consume('a')) {
        const it = this.items[this.index];
        if (it && it.disabled) { sfx('error'); return; }
        sfx('select');
        if (cfg.onPick) { cfg.onPick(this.index, this); return; }
        this.close(this.index);
      }
      if (consume('b') && cfg.cancelable !== false) { sfx('cancel'); this.close(-1); }
    },
    render(ctx) { cfg.render(ctx, this); },
    close(result) {
      const r = this.resolve;
      this.resolve = null;
      popScene(result);
      if (r) r(result);
    },
  };
  return sc;
}

function openList(cfg) {
  const sc = makeListScene(cfg);
  return new Promise((resolve) => pushScene(sc, { resolve }));
}

function dim(ctx, alpha = 0.55) {
  ctx.fillStyle = 'rgba(8,12,18,' + alpha + ')';
  ctx.fillRect(0, 0, W, H);
}

// ------------------------------------------------------------------ pause menu
const PAUSE_ITEMS = [
  { label: 'Party', icon: 'icon_party' },
  { label: 'Bag', icon: 'icon_bag' },
  { label: 'Dex', icon: 'icon_dex' },
  { label: 'Map', icon: 'icon_map' },
  { label: 'Save', icon: 'icon_save' },
  { label: 'Options', icon: 'icon_options' },
  { label: 'Close', icon: null },
];

export function openPauseMenu() {
  const sc = makeListScene({
    items: PAUSE_ITEMS,
    opaque: false,
    async onPick(i, self) {
      const label = PAUSE_ITEMS[i].label;
      if (label === 'Close') { self.close(-1); return; }
      if (label === 'Party') { await openParty(); return; }
      if (label === 'Bag') { await openBag({ context: 'field' }); return; }
      if (label === 'Dex') { await openDex(); return; }
      if (label === 'Map') { await openWorldMap(S.world); return; }
      if (label === 'Save') { await openSaveMenu(); return; }
      if (label === 'Options') { await openOptions(); return; }
    },
    render(ctx, self) {
      const w = 92, h = PAUSE_ITEMS.length * 14 + 14;
      const x = W - w - 6, y = 6;
      drawWindow(ctx, x, y, w, h);
      for (let i = 0; i < PAUSE_ITEMS.length; i++) {
        const iy = y + 8 + i * 14;
        const it = PAUSE_ITEMS[i];
        if (it.icon && hasSprite(it.icon)) drawSprite(ctx, it.icon, x + 10, iy - 2, {});
        drawText(ctx, it.label, x + 26, iy, { color: PAL.ink });
        if (i === self.index) drawCursor(ctx, x + 2, iy, self.t);
      }
      // status strip
      drawWindow(ctx, 6, H - 34, 128, 28);
      drawText(ctx, S.player.name, 12, H - 28, { color: PAL.ink });
      drawText(ctx, S.player.money + ' cr', 12, H - 18, { color: PAL.accent });
      drawText(ctx, 'Seals ' + (S.badges | 0) + '/10', 62, H - 18, { color: PAL.gold });
      drawTextRight(ctx, clockString(), 128, H - 28, { color: PAL.shadow });
      drawTextRight(ctx, playtimeString(), 128, H - 18, { color: PAL.shadow });
    },
  });
  return new Promise((resolve) => pushScene(sc, { resolve }));
}

// ------------------------------------------------------------------ party
export function openParty(opts = {}) {
  const build = () => S.party.map((c, i) => ({ c, i, label: displayName(c) }));
  let items = build();
  let swapFrom = -1;

  const sc = makeListScene({
    items,
    rows: 6,
    cancelable: opts.cancelable !== false,
    async onPick(i, self) {
      if (opts.pick) { self.close(i); return; }
      const c = S.party[i];
      if (!c) return;
      const choice = await ask('What about ' + displayName(c) + '?', ['Summary', 'Move', 'Cancel']);
      if (choice === 0) {
        await openSummary(i);
      } else if (choice === 1) {
        if (swapFrom === -1) { swapFrom = i; }
        else { swapParty(swapFrom, i); swapFrom = -1; self.items = build(); }
      }
    },
    render(ctx, self) {
      ctx.fillStyle = '#243040';
      ctx.fillRect(0, 0, W, H);
      drawText(ctx, 'PARTY', 8, 6, { color: '#f0e8d8' });
      drawTextRight(ctx, S.party.length + '/6', W - 8, 6, { color: '#98a4b4' });

      if (!S.party.length) {
        drawTextCentered(ctx, 'You have no creatures.', W / 2, H / 2 - 4, { color: '#f0e8d8' });
        return;
      }

      for (let i = 0; i < S.party.length; i++) {
        const c = S.party[i];
        const y = 18 + i * 35;
        if (y > H - 22) break;
        const sel = i === self.index;
        drawWindow(ctx, 6, y, W - 12, 32, sel ? { fill: '#fff8e0' } : {});
        const sp = getSpecies(c.species);
        if (hasSprite(sp.sprite)) {
          ctx.save();
          ctx.beginPath(); ctx.rect(10, y + 1, 30, 30); ctx.clip();
          drawSprite(ctx, sp.sprite, 9, y - 1, { scale: 0.94, variant: !!c.variant });
          ctx.restore();
        }
        drawText(ctx, displayName(c) + (c.variant ? ' *' : ''), 44, y + 5, { color: c.variant ? PAL.gold : PAL.ink });
        drawText(ctx, 'L' + c.level, 44, y + 16, { color: PAL.ink });
        const mx = maxHp(c);
        drawHpBar(ctx, 74, y + 18, 90, c.hp, mx);
        drawTextRight(ctx, c.hp + '/' + mx, W - 16, y + 15, { color: isFainted(c) ? PAL.hpBad : PAL.ink });
        if (c.status) drawText(ctx, c.status.toUpperCase(), 44, y + 24, { color: PAL.hpWarn });
        // EXP bar plus what this creature is working toward, so progress toward the
        // next payoff is visible without opening a submenu.
        const e = expToNext(c);
        drawExpBar(ctx, 74, y + 26, 90, e.frac);
        const ms = nextMilestone(c);
        const tag = ms.kind === 'max' ? 'MAX'
          : ms.kind === 'evolve' ? (ms.levelsAway <= 1 ? 'evolves next level!' : ms.levelsAway + ' to evolve')
          : 'L' + ms.level + ' soon';
        drawTextRight(ctx, tag, W - 16, y + 24,
          { color: ms.kind === 'evolve' && ms.levelsAway <= 1 ? PAL.gold : PAL.dim });
        if (sel) drawCursor(ctx, 0, y + 12, self.t);
      }
      drawText(ctx, 'A: select    B: back', 8, H - 12, { color: '#98a4b4' });
    },
  });
  return new Promise((resolve) => pushScene(sc, { resolve }));
}

// ------------------------------------------------------------------ summary
function openSummary(index) {
  const sc = {
    opaque: true, t: 0, resolve: null, i: index,
    enter(p) { this.resolve = p && p.resolve; },
    update(dt) {
      this.t += dt;
      if (consume('left')) { this.i = (this.i - 1 + S.party.length) % S.party.length; sfx('select'); }
      if (consume('right')) { this.i = (this.i + 1) % S.party.length; sfx('select'); }
      if (consume('b') || consume('a')) {
        sfx('cancel');
        const r = this.resolve; this.resolve = null;
        popScene(-1); if (r) r(-1);
      }
    },
    render(ctx) {
      const c = S.party[this.i];
      ctx.fillStyle = '#243040';
      ctx.fillRect(0, 0, W, H);
      if (!c) return;
      const sp = getSpecies(c.species);

      drawWindow(ctx, 4, 4, 150, 92);
      if (hasSprite(sp.sprite)) drawSprite(ctx, sp.sprite, 10, 20, { scale: 2, variant: !!c.variant });
      drawText(ctx, displayName(c) + (c.variant ? ' *' : ''), 78, 10, { color: c.variant ? PAL.gold : PAL.ink });
      drawText(ctx, 'No. ' + String(sp.dexNo).padStart(3, '0'), 78, 22, { color: PAL.shadow });
      drawText(ctx, 'Level ' + c.level, 78, 34, { color: PAL.ink });
      let bx = 78;
      for (const t of sp.types) bx += drawTypeBadge(ctx, t, bx, 46) + 3;
      const mx = maxHp(c);
      drawText(ctx, 'HP ' + c.hp + '/' + mx, 78, 60, { color: PAL.ink });
      drawHpBar(ctx, 78, 70, 68, c.hp, mx);
      const e = expToNext(c);
      drawText(ctx, 'EXP', 78, 76, { color: PAL.shadow });
      drawExpBar(ctx, 98, 79, 48, e.frac);

      const st = statsFor(c);
      drawWindow(ctx, 158, 4, 158, 92);
      const rows = [['Attack', st.atk], ['Defence', st.def], ['Sp. Atk', st.spa], ['Sp. Def', st.spd], ['Speed', st.spe]];
      for (let i = 0; i < rows.length; i++) {
        drawText(ctx, rows[i][0], 166, 12 + i * 14, { color: PAL.ink });
        drawTextRight(ctx, String(rows[i][1]), 240, 12 + i * 14, { color: PAL.ink });
        const frac = Math.min(1, rows[i][1] / 200);
        ctx.fillStyle = '#20303c'; ctx.fillRect(246, 14 + i * 14, 62, 4);
        ctx.fillStyle = PAL.accent; ctx.fillRect(246, 14 + i * 14, Math.round(62 * frac), 4);
      }

      drawWindow(ctx, 4, 100, W - 8, 92);
      for (let i = 0; i < c.moves.length; i++) {
        const m = c.moves[i];
        const mv = getMove(m.id);
        const y = 106 + i * 21;
        drawTypeBadge(ctx, mv.type, 10, y);
        drawText(ctx, mv.name, 44, y + 1, { color: PAL.ink });
        drawTextRight(ctx, 'PP ' + m.pp + '/' + m.ppMax, W - 12, y + 1, { color: PAL.shadow });
        drawText(ctx, mv.desc || '', 44, y + 11, { color: PAL.shadow });
      }

      drawWindow(ctx, 4, 196, W - 8, 40);
      const lines = wrapText(sp.entry || '', W - 26);
      for (let i = 0; i < Math.min(3, lines.length); i++) {
        drawText(ctx, lines[i], 12, 202 + i * 10, { color: PAL.ink });
      }
      drawText(ctx, '< >  switch    B: back', 8, H - 9, { color: '#98a4b4' });
    },
  };
  return new Promise((resolve) => pushScene(sc, { resolve }));
}

// ------------------------------------------------------------------ bag
// Sticky cursor: remember the last selected bag index for this session so
// healing three creatures in a row does not restart from the top of the list.
let bagLastIndex = 0;

export function openBag(opts = {}) {
  const context = opts.context || 'field';
  const build = () => bagList()
    .filter((id) => {
      const it = getItem(id);
      if (context === 'battle') return it.inBattle !== false;
      return it.inField !== false;
    })
    .map((id) => ({ id, label: getItem(id).name, count: itemCount(id) }));

  let items = build();

  const sc = makeListScene({
    items,
    rows: 8,
    index: Math.max(0, Math.min(items.length - 1, bagLastIndex)),
    async onPick(i, self) {
      const entry = self.items[i];
      if (!entry) return;
      const it = getItem(entry.id);
      if (opts.pick) { self.close(entry.id); return; }

      if (it.kind === 'key') { await say(it.desc || 'An important item.'); return; }
      if (it.kind === 'ball') { await say('Balls can only be used in battle.'); return; }
      if (it.kind === 'repel') {
        removeItem(entry.id, 1);
        S.repelSteps = (it.effect && it.effect.steps) || 100;
        await say('A repellent scent spreads around you.');
        self.items = build();
        if (self.index >= self.items.length) self.index = Math.max(0, self.items.length - 1);
        return;
      }

      const pi = await openParty({ pick: true });
      if (pi < 0 || !S.party[pi]) return;
      const r = useItem(entry.id, S.party[pi], context);
      if (r.ok && r.consumed) removeItem(entry.id, 1);
      if (r.ok) sfx('heal'); else sfx('error');
      await say(r.message);
      self.items = build();
      if (self.index >= self.items.length) self.index = Math.max(0, self.items.length - 1);
    },
    render(ctx, self) {
      ctx.fillStyle = '#243040';
      ctx.fillRect(0, 0, W, H);
      drawText(ctx, 'BAG', 8, 6, { color: '#f0e8d8' });
      drawTextRight(ctx, S.player.money + ' cr', W - 8, 6, { color: PAL.gold });

      drawWindow(ctx, 6, 18, W - 12, 150);
      if (!self.items.length) {
        drawText(ctx, 'Your bag is empty.', 16, 28, { color: PAL.ink });
      }
      const rows = 8;
      for (let r = 0; r < rows; r++) {
        const i = self.scroll + r;
        if (i >= self.items.length) break;
        const e = self.items[i];
        const y = 26 + r * 16;
        drawText(ctx, e.label, 22, y, { color: PAL.ink });
        drawTextRight(ctx, 'x' + e.count, W - 20, y, { color: PAL.shadow });
        if (i === self.index) drawCursor(ctx, 12, y, self.t);
      }
      const cur = self.items[self.index];
      drawWindow(ctx, 6, 172, W - 12, 44);
      if (cur) {
        const lines = wrapText(getItem(cur.id).desc || '', W - 30);
        for (let i = 0; i < Math.min(3, lines.length); i++) {
          drawText(ctx, lines[i], 16, 180 + i * 11, { color: PAL.ink });
        }
      }
      drawText(ctx, 'A: use    B: back', 8, H - 12, { color: '#98a4b4' });
    },
  });
  const baseClose = sc.close;
  sc.close = function (result) { bagLastIndex = this.index; baseClose.call(this, result); };
  return new Promise((resolve) => pushScene(sc, { resolve }));
}

// ------------------------------------------------------------------ dex
export function openDex() {
  const all = allSpecies();
  const sc = makeListScene({
    items: all.map((s) => ({ label: s.name, sp: s })),
    rows: 9,
    onPick() { /* selection just moves the preview */ },
    render(ctx, self) {
      ctx.fillStyle = '#243040';
      ctx.fillRect(0, 0, W, H);
      drawText(ctx, 'FIELD DEX', 8, 6, { color: '#f0e8d8' });
      drawTextRight(ctx, 'seen ' + dexSeenCount() + '  caught ' + dexCaughtCount() + '/' + DEX_COUNT +
        '  rare ' + dexVariantCount() + '/' + DEX_COUNT, W - 8, 6, { color: '#98a4b4' });

      drawWindow(ctx, 6, 18, 156, 214);
      const rows = 9;
      for (let r = 0; r < rows; r++) {
        const i = self.scroll + r;
        if (i >= all.length) break;
        const s = all[i];
        const y = 26 + r * 22;
        const seen = !!S.dex.seen[s.id];
        const caught = !!S.dex.caught[s.id];
        drawText(ctx, String(s.dexNo).padStart(3, '0'), 20, y, { color: PAL.shadow });
        drawText(ctx, seen ? s.name : '-----', 44, y, { color: seen ? PAL.ink : PAL.dim });
        if (caught && hasSprite('ball_orb')) drawSprite(ctx, 'ball_orb', 130, y - 2, { scale: 0.7 });
        if (S.dex.variant && S.dex.variant[s.id]) drawText(ctx, '*', 142, y, { color: PAL.gold });
        if (i === self.index) drawCursor(ctx, 10, y, self.t);
      }

      const s = all[self.index];
      drawWindow(ctx, 166, 18, 148, 214);
      if (s && S.dex.seen[s.id]) {
        if (hasSprite(s.sprite)) {
          drawSprite(ctx, s.sprite, 206, 28, { scale: 2, variant: !!(S.dex.variant && S.dex.variant[s.id]) });
        }
        drawTextCentered(ctx, s.name, 240, 100, { color: PAL.ink });
        let bx = 186;
        for (const t of s.types) bx += drawTypeBadge(ctx, t, bx, 114) + 4;
        drawText(ctx, 'Ht ' + s.height + 'm', 176, 130, { color: PAL.shadow });
        drawText(ctx, 'Wt ' + s.weight + 'kg', 176, 141, { color: PAL.shadow });
        const lines = wrapText(s.entry || '', 132);
        for (let i = 0; i < Math.min(7, lines.length); i++) {
          drawText(ctx, lines[i], 176, 156 + i * 10, { color: PAL.ink });
        }
      } else {
        drawTextCentered(ctx, 'Not yet encountered', 240, 118, { color: PAL.dim });
      }
    },
  });
  return new Promise((resolve) => pushScene(sc, { resolve }));
}

// ------------------------------------------------------------------ world map
const BIOME_COLOR = {
  OCEAN: '#1c3a78', BEACH: '#e0cf9a', MEADOW: '#5aa044', FOREST: '#2e6b30', JUNGLE: '#2f7a3a',
  SWAMP: '#4c6a44', DESERT: '#e6d49c', SAVANNA: '#b4a45c', TUNDRA: '#a8bcae',
  MOUNTAIN: '#8a8578', PEAK: '#e8eef4',
};

// The region-map downsample survives close/reopen: rebuilding it per open cost a
// visible hitch on a phone (~215ms of per-pixel fillRect). Cached per seed and
// built through ImageData, which is one buffer write instead of 36,100 fillRects.
let regionMapCache = null;
let regionMapKey = '';

function buildRegionMap(world, size) {
  const key = (S.seed >>> 0) + ':' + world.map.w + 'x' + world.map.h + ':' + size;
  if (regionMapCache && regionMapKey === key) return regionMapCache;
  const mw = world.map.w, mh = world.map.h;
  const { BIOMES } = worldgenRef;
  const rgb = BIOMES.map((b) => {
    const hex = (BIOME_COLOR[b] || '#444444').replace('#', '');
    const h = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let py = 0; py < size; py++) {
    const ty = Math.min(mh - 1, Math.floor((py / size) * mh));
    for (let px = 0; px < size; px++) {
      const tx = Math.min(mw - 1, Math.floor((px / size) * mw));
      const col = rgb[world.biome ? world.biome[ty * mw + tx] : 2] || [68, 68, 68];
      const o = (py * size + px) * 4;
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Danger rings are seed-static (levelAt only depends on world.start), so they
  // are baked into the same cached canvas instead of redrawn every frame.
  drawDangerRings(g, world, size, mw, mh);
  regionMapCache = c;
  regionMapKey = key;
  return c;
}

// Level thresholds for the danger contours drawn on the region map.
const DANGER_LEVELS = [10, 20, 35, 50];

// Overlay translucent level-contour rings from worldgen's levelAt, each tagged
// 'L10' etc., so a player can see where danger rises before walking into it.
function drawDangerRings(g, world, size, mw, mh) {
  const lv = new Uint8Array(size * size);
  for (let py = 0; py < size; py++) {
    const ty = Math.min(mh - 1, Math.floor((py / size) * mh));
    for (let px = 0; px < size; px++) {
      const tx = Math.min(mw - 1, Math.floor((px / size) * mw));
      lv[py * size + px] = levelAt(world, tx, ty);
    }
  }
  // Contour pixels: at or past the threshold with a 4-neighbour below it.
  for (let b = 0; b < DANGER_LEVELS.length; b++) {
    const thr = DANGER_LEVELS[b];
    g.fillStyle = 'rgba(240,200,120,' + (0.22 + b * 0.06).toFixed(2) + ')';
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        if (lv[py * size + px] < thr) continue;
        const edge =
          (px > 0 && lv[py * size + px - 1] < thr) ||
          (px < size - 1 && lv[py * size + px + 1] < thr) ||
          (py > 0 && lv[(py - 1) * size + px] < thr) ||
          (py < size - 1 && lv[(py + 1) * size + px] < thr);
        if (edge) g.fillRect(px, py, 1, 1);
      }
    }
  }
  // Tags: walk outward from the start town along whichever direction has the
  // most room, labelling the first pixel at or past each band.
  const start = (world && world.start) || { x: mw >> 1, y: mh >> 1 };
  const spx = Math.max(0, Math.min(size - 1, Math.floor((start.x / mw) * size)));
  const spy = Math.max(0, Math.min(size - 1, Math.floor((start.y / mh) * size)));
  const dirs = [
    { dx: 0, dy: 1, room: size - 1 - spy },
    { dx: 0, dy: -1, room: spy },
    { dx: 1, dy: 0, room: size - 1 - spx },
    { dx: -1, dy: 0, room: spx },
  ].sort((a, b) => b.room - a.room);
  const dir = dirs[0];
  for (const thr of DANGER_LEVELS) {
    for (let k = 0; k <= dir.room; k++) {
      const px = spx + dir.dx * k, py = spy + dir.dy * k;
      if (lv[py * size + px] < thr) continue;
      const tag = 'L' + thr;
      const tw = textWidth(tag);
      const lx = Math.max(1, Math.min(size - tw - 2, px - (tw >> 1)));
      const ly = Math.max(1, Math.min(size - 10, py - 3));
      g.fillStyle = 'rgba(16,24,32,0.55)';
      g.fillRect(lx - 1, ly - 1, tw + 2, 9);
      drawText(g, tag, lx, ly, { color: '#f8dc8a' });
      break;
    }
  }
}

export function openWorldMap(world) {
  const sc = {
    opaque: true, t: 0, resolve: null, cache: null,
    enter(p) { this.resolve = p && p.resolve; this.cache = null; },
    update(dt) {
      this.t += dt;
      if (consume('b') || consume('a') || consume('start')) {
        sfx('cancel');
        const r = this.resolve; this.resolve = null;
        popScene(-1); if (r) r(-1);
      }
    },
    render(ctx) {
      ctx.fillStyle = '#141c24';
      ctx.fillRect(0, 0, W, H);
      drawText(ctx, 'REGION MAP', 8, 6, { color: '#f0e8d8' });

      if (!world || !world.map) {
        drawTextCentered(ctx, 'No map data.', W / 2, H / 2, { color: PAL.dim });
        return;
      }

      const mw = world.map.w, mh = world.map.h;
      const size = 190;
      const ox = (W - size) / 2, oy = 26;
      const step = Math.max(1, Math.floor(mw / size));

      if (!this.cache) this.cache = buildRegionMap(world, size);
      ctx.drawImage(this.cache, Math.round(ox), Math.round(oy));
      ctx.strokeStyle = '#5a6472';
      ctx.strokeRect(Math.round(ox) - 0.5, Math.round(oy) - 0.5, size + 1, size + 1);

      // towns
      for (const t of (world.towns || [])) {
        const px = ox + (t.x / mw) * size, py = oy + (t.y / mh) * size;
        ctx.fillStyle = '#f0e070';
        ctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 3, 3);
      }
      // shrines — optional; worldgen may not provide them yet
      const shrines = (world.shrines || (S.world && S.world.shrines));
      if (Array.isArray(shrines)) {
        ctx.fillStyle = PAL.gold || '#f0c020';
        for (const s of shrines) {
          if (!s) continue;
          const px = Math.round(ox + (s.x / mw) * size), py = Math.round(oy + (s.y / mh) * size);
          ctx.beginPath();
          ctx.moveTo(px, py - 3);
          ctx.lineTo(px + 3, py);
          ctx.lineTo(px, py + 3);
          ctx.lineTo(px - 3, py);
          ctx.closePath();
          ctx.fill();
        }
      }
      // player
      const ppx = ox + (S.player.x / mw) * size, ppy = oy + (S.player.y / mh) * size;
      if (Math.sin(this.t * 6) > -0.3) {
        ctx.fillStyle = '#e04038';
        ctx.fillRect(Math.round(ppx) - 2, Math.round(ppy) - 2, 5, 5);
        ctx.fillStyle = '#fff';
        ctx.fillRect(Math.round(ppx) - 1, Math.round(ppy) - 1, 3, 3);
      }
      drawText(ctx, 'You are here', 8, H - 24, { color: '#e04038' });
      drawText(ctx, 'Settlements', 8, H - 14, { color: '#f0e070' });
      if (Array.isArray(shrines) && shrines.length) {
        drawTextRight(ctx, 'Shrines', W - 8, H - 24, { color: PAL.gold || '#f0c020' });
      }
      drawTextRight(ctx, 'B: back', W - 8, H - 14, { color: '#98a4b4' });
    },
  };
  return new Promise((resolve) => pushScene(sc, { resolve }));
}

// worldgen is imported lazily so menus.js stays importable without a world
import * as worldgenRef from './worldgen.js';
import { levelAt } from './worldgen.js';

// ------------------------------------------------------------------ shop
export async function openShop(tier) {
  const stock = shopStock(tier || 1).filter((id) => getItem(id).id === id);

  const choice = await ask('How can I help?', ['Buy', 'Sell', 'Leave']);
  if (choice === 0) {
    await openBuy(stock);
  } else if (choice === 1) {
    await openSell();
  }
}

// Quantity row over the shop list: Left/Right adjusts 1..max (max already
// clamped by affordability or stock), A confirms, B cancels. Resolves the
// chosen quantity, or 0 on cancel. Total price updates live.
function openQuantity(cfg) {
  const max = Math.max(1, Math.min(9, cfg.max | 0));
  const sc = {
    opaque: false, t: 0, qty: 1, resolve: null,
    enter(p) { this.resolve = p && p.resolve; },
    update(dt) {
      this.t += dt;
      if (consume('left') || repeatEdge('left', dt)) {
        if (this.qty > 1) { this.qty--; sfx('select'); }
      }
      if (consume('right') || repeatEdge('right', dt)) {
        if (this.qty < max) { this.qty++; sfx('select'); }
      }
      if (consume('a')) { sfx('select'); this.close(this.qty); return; }
      if (consume('b')) { sfx('cancel'); this.close(0); }
    },
    render(ctx) {
      const wq = 180, hq = 46;
      const x = (W - wq) / 2, y = H - hq - 26;
      drawWindow(ctx, x, y, wq, hq);
      drawText(ctx, cfg.label, x + 10, y + 7, { color: PAL.ink });
      drawTextCentered(ctx, '< x' + this.qty + ' >', x + wq / 2, y + 19, { color: PAL.accent });
      drawTextRight(ctx, (cfg.unitPrice * this.qty) + ' cr', x + wq - 10, y + 32, { color: PAL.gold });
      drawText(ctx, 'A: ok   B: cancel', x + 10, y + 32, { color: PAL.shadow });
    },
    close(r) { const res = this.resolve; this.resolve = null; popScene(r); if (res) res(r); },
  };
  return new Promise((resolve) => pushScene(sc, { resolve }));
}

function openBuy(stock) {
  const sc = makeListScene({
    items: stock.map((id) => ({ id, label: getItem(id).name })),
    rows: 7,
    async onPick(i, self) {
      const id = self.items[i].id;
      const it = getItem(id);
      if (it.price <= 0) { await say('That one is not for sale.'); return; }
      if (S.player.money < it.price) { sfx('error'); await say('You cannot afford that.'); return; }
      const qty = await openQuantity({
        label: it.name,
        unitPrice: it.price,
        max: Math.floor(S.player.money / it.price),
      });
      if (qty <= 0) return;
      if (!spendMoney(it.price * qty)) { await say('You cannot afford that.'); return; }
      addItem(id, qty);
      sfx('select');
      // No receipt line: the money counter updating is the feedback.
    },
    render(ctx, self) {
      ctx.fillStyle = '#243040';
      ctx.fillRect(0, 0, W, H);
      drawText(ctx, 'SUPPLY SHOP', 8, 6, { color: '#f0e8d8' });
      drawTextRight(ctx, S.player.money + ' cr', W - 8, 6, { color: PAL.gold });
      drawWindow(ctx, 6, 18, W - 12, 132);
      for (let r = 0; r < 7; r++) {
        const i = self.scroll + r;
        if (i >= self.items.length) break;
        const it = getItem(self.items[i].id);
        const y = 26 + r * 17;
        drawText(ctx, it.name, 22, y, { color: PAL.ink });
        drawTextRight(ctx, it.price + ' cr', W - 20, y, { color: PAL.shadow });
        if (i === self.index) drawCursor(ctx, 12, y, self.t);
      }
      const cur = self.items[self.index];
      drawWindow(ctx, 6, 154, W - 12, 46);
      if (cur) {
        const lines = wrapText(getItem(cur.id).desc || '', W - 30);
        for (let i = 0; i < Math.min(3, lines.length); i++) {
          drawText(ctx, lines[i], 16, 162 + i * 11, { color: PAL.ink });
        }
      }
      drawText(ctx, 'A: buy    B: done', 8, H - 12, { color: '#98a4b4' });
    },
  });
  return new Promise((resolve) => pushScene(sc, { resolve }));
}

function openSell() {
  const build = () => bagList()
    .filter((id) => getItem(id).kind !== 'key' && sellPrice(id) > 0)
    .map((id) => ({ id, label: getItem(id).name }));

  const sc = makeListScene({
    items: build(),
    rows: 7,
    async onPick(i, self) {
      const entry = self.items[i];
      if (!entry) return;
      const price = sellPrice(entry.id);
      const qty = await openQuantity({
        label: getItem(entry.id).name,
        unitPrice: price,
        max: itemCount(entry.id),
      });
      if (qty <= 0) return;
      if (!removeItem(entry.id, qty)) return;
      addMoney(price * qty);
      sfx('select');
      self.items = build();
      if (self.index >= self.items.length) self.index = Math.max(0, self.items.length - 1);
    },
    render(ctx, self) {
      ctx.fillStyle = '#243040';
      ctx.fillRect(0, 0, W, H);
      drawText(ctx, 'SELL', 8, 6, { color: '#f0e8d8' });
      drawTextRight(ctx, S.player.money + ' cr', W - 8, 6, { color: PAL.gold });
      drawWindow(ctx, 6, 18, W - 12, 160);
      if (!self.items.length) drawText(ctx, 'Nothing to sell.', 22, 28, { color: PAL.ink });
      for (let r = 0; r < 7; r++) {
        const i = self.scroll + r;
        if (i >= self.items.length) break;
        const e = self.items[i];
        const y = 26 + r * 17;
        drawText(ctx, e.label, 22, y, { color: PAL.ink });
        drawTextRight(ctx, sellPrice(e.id) + ' cr', W - 20, y, { color: PAL.shadow });
        drawTextRight(ctx, 'x' + itemCount(e.id), W - 76, y, { color: PAL.dim });
        if (i === self.index) drawCursor(ctx, 12, y, self.t);
      }
      drawText(ctx, 'A: sell    B: done', 8, H - 12, { color: '#98a4b4' });
    },
  });
  return new Promise((resolve) => pushScene(sc, { resolve }));
}

// ------------------------------------------------------------------ save / options
export async function openSaveMenu() {
  const { saveGame, slotSummary } = await import('./save.js');
  const labels = [0, 1, 2].map((i) => {
    const s = slotSummary(i);
    return { label: 'Slot ' + (i + 1) + (s ? '  ' + s.name + ' ' + s.playtime : '  (empty)'), slot: i };
  });
  const pick = await openList({
    items: labels,
    render(ctx, self) {
      dim(ctx, 0.8);
      drawWindow(ctx, 30, 60, W - 60, 100);
      drawText(ctx, 'Record your journey', 40, 68, { color: PAL.accent });
      for (let i = 0; i < labels.length; i++) {
        const y = 88 + i * 18;
        drawText(ctx, labels[i].label, 48, y, { color: PAL.ink });
        if (i === self.index) drawCursor(ctx, 38, y, self.t);
      }
      drawText(ctx, 'B: cancel', 40, 144, { color: PAL.shadow });
    },
  });
  if (pick < 0) return;
  const ok = saveGame(labels[pick].slot);
  sfx(ok ? 'heal' : 'error');
  await say(ok ? 'Your journey has been recorded.'
               : 'Saving failed. Browser storage may be full or blocked.');
}

export async function openOptions() {
  const rows = () => [
    { label: 'Text speed: ' + ['Slow', 'Normal', 'Fast', 'Instant'][S.options.textSpeed] },
    { label: 'Music: ' + (S.options.music ? 'On' : 'Off') },
    { label: 'Sound: ' + (S.options.sfx ? 'On' : 'Off') },
    { label: 'Run: ' + (S.options.autoRun ? 'Always' : 'Hold Shift') },
    { label: 'Back' },
  ];
  const sc = makeListScene({
    items: rows(),
    async onPick(i, self) {
      const audio = await import('./audio.js');
      if (i === 0) S.options.textSpeed = (S.options.textSpeed + 1) % 4;
      else if (i === 1) { S.options.music = !S.options.music; audio.setMusicEnabled(S.options.music); }
      else if (i === 2) { S.options.sfx = !S.options.sfx; audio.setSfxEnabled(S.options.sfx); }
      else if (i === 3) { S.options.autoRun = !S.options.autoRun; }
      else { self.close(-1); return; }
      self.items = rows();
    },
    render(ctx, self) {
      dim(ctx, 0.8);
      drawWindow(ctx, 40, 64, W - 80, 100);
      drawText(ctx, 'OPTIONS', 50, 72, { color: PAL.accent });
      for (let i = 0; i < self.items.length; i++) {
        const y = 92 + i * 16;
        drawText(ctx, self.items[i].label, 60, y, { color: PAL.ink });
        if (i === self.index) drawCursor(ctx, 50, y, self.t);
      }
    },
  });
  return new Promise((resolve) => pushScene(sc, { resolve }));
}
