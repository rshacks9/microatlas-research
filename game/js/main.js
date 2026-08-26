// Boot, title screen, new-game flow, and the fixed-timestep run loop.
import { Game, W, H, pushScene, popScene, replaceScene, clearScenes, topScene,
         updateFade, renderFade, fade, clear } from './game.js';
import { initInput, beginFrame, updateInput, consume, Keys, setTouchVisible } from './input.js';
import { buildAtlas } from './tileset.js';
import { drawWindow, drawText, drawTextCentered, drawTextRight, drawCursor, drawTypeBadge,
         wrapText, textWidth, LINE_H, PAL } from './ui.js';
import { drawSprite, hasSprite, spriteSize } from './sprites.js';
import { getSpecies, STARTERS } from './creatures.js';
import { generateWorld } from './worldgen.js';
import { makeCreature, displayName, addToParty } from './party.js';
import { S, resetState, setFlag, getFlag, getRecord, updateRecord, seeSpecies,
         addMoney, addItem } from './state.js';
import { Overworld, enterMap, player, holdControl, releaseControl } from './overworld.js';
import { say } from './dialogue.js';
import { initAudio, playBgm, sfx, setMusicEnabled, setSfxEnabled } from './audio.js';
import { hasSave, loadGame, slotSummary } from './save.js';
import * as tilesRef from './tiles.js';

const FIXED = 1 / 60;
const MAX_FRAME = 0.25;

// ------------------------------------------------------------------ canvas
function setupCanvas() {
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;
  Game.canvas = canvas;
  Game.ctx = ctx;

  const resize = () => {
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const padH = touch ? 190 : 70;
    const availW = Math.max(160, window.innerWidth - 16);
    const availH = Math.max(120, window.innerHeight - padH);
    let scale = Math.min(availW / W, availH / H);
    // Integer scaling keeps pixels perfectly crisp, but only once there is room
    // for 2x or more. On a phone the width-limited scale is often ~1.2, and
    // flooring that to 1 threw away a fifth of the screen and left a dead gap.
    // Below 2x we take the fractional scale and let image-rendering:pixelated
    // keep it blocky.
    scale = scale >= 2 ? Math.floor(scale) : Math.max(0.5, scale)
    Game.scale = scale;
    canvas.style.width = Math.round(W * scale) + 'px';
    canvas.style.height = Math.round(H * scale) + 'px';
  };
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  return { canvas, ctx };
}

// ------------------------------------------------------------------ options persistence
// Options live under their own key: a New Journey resets S, and a save slot can
// be deleted, but neither may take the player's settings with them. Every
// storage access is guarded — private mode and disabled storage must be no-ops.
const OPTIONS_KEY = 'verdant.options';
let optionsOnDevice = false;   // true once the key is known to exist

function optionsStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    localStorage.setItem('__vf_probe_opts', '1');
    localStorage.removeItem('__vf_probe_opts');
    return localStorage;
  } catch (_) { return null; }   // private mode / disabled storage
}

// Applies the stored options onto S.options. Returns false when no usable
// stored copy exists; every field is range-checked before it is trusted.
function loadStoredOptions() {
  const st = optionsStorage();
  if (!st) return false;
  let text;
  try { text = st.getItem(OPTIONS_KEY); } catch (_) { return false; }
  if (!text || typeof text !== 'string' || text.length > 4096) return false;
  let o;
  try { o = JSON.parse(text); } catch (_) { return false; }
  if (!o || typeof o !== 'object') return false;
  const ts = Number(o.textSpeed);
  if (isFinite(ts)) S.options.textSpeed = Math.max(0, Math.min(3, Math.floor(ts)));
  if (typeof o.music === 'boolean') S.options.music = o.music;
  if (typeof o.sfx === 'boolean') S.options.sfx = o.sfx;
  if (typeof o.autoRun === 'boolean') S.options.autoRun = o.autoRun;
  return true;
}

function persistOptions() {
  const st = optionsStorage();
  if (!st) return false;
  try {
    st.setItem(OPTIONS_KEY, JSON.stringify({
      textSpeed: S.options.textSpeed | 0,
      music: !!S.options.music,
      sfx: !!S.options.sfx,
      autoRun: !!S.options.autoRun,
    }));
    optionsOnDevice = true;
    return true;
  } catch (_) { return false; }
}

// ------------------------------------------------------------------ control wording
// Key names are meaningless on a touch screen; wording must follow the control
// surface actually in use. pointer:coarse mirrors the pad-visibility rule in
// boot; ontouchstart is the fallback where matchMedia is missing.
function touchControls() {
  try {
    if (window.matchMedia) return window.matchMedia('(pointer: coarse)').matches;
  } catch (_) { /* fall through */ }
  return 'ontouchstart' in window;
}

// ------------------------------------------------------------------ title scene
const Title = {
  opaque: true,
  t: 0,
  index: 0,
  items: [],
  enter() {
    this.t = 0;
    this.items = [{ label: 'New Journey', act: 'new' }];
    // New Journey+ appears once the Verdant Trial has ever been finished: either
    // the device record says so, or the state loaded THIS session carries the
    // flag (a just-finished trial counts before the record round-trips storage).
    if (getRecord().trials > 0 || getFlag('trial_done')) {
      this.items.push({ label: 'New Journey+', act: 'newplus' });
    }
    for (let i = 0; i < 3; i++) {
      if (hasSave(i)) {
        const s = slotSummary(i);
        this.items.push({ label: 'Continue — ' + s.name + '  ' + s.playtime, act: 'load', slot: i, sum: s });
      }
    }
    // Default to the first Continue when one exists (Wave 5.5 behaviour); the
    // New Journey+ row must not steal that spot just by sitting above it.
    const firstLoad = this.items.findIndex((it) => it.act === 'load');
    this.index = firstLoad >= 0 ? firstLoad : 0;
    playBgm('title');
  },
  update(dt) {
    this.t += dt;
    const n = this.items.length;
    if (consume('up')) { this.index = (this.index - 1 + n) % n; sfx('select'); }
    if (consume('down')) { this.index = (this.index + 1) % n; sfx('select'); }
    if (consume('a') || consume('start')) {
      sfx('select');
      const it = this.items[this.index];
      if (it.act === 'new') startNewGame(false);
      else if (it.act === 'newplus') startNewGame(true);
      else continueGame(it.slot);
    }
  },
  render(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1a2c3c');
    g.addColorStop(0.55, '#2c4c50');
    g.addColorStop(1, '#3d6b45');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // parallax hills
    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = ['#2a4a38', '#356044', '#417a4e'][layer];
      const base = 150 + layer * 22;
      const amp = 14 - layer * 3;
      for (let x = 0; x < W; x++) {
        const y = base + Math.sin((x + this.t * (6 + layer * 4)) * 0.021 + layer) * amp;
        ctx.fillRect(x, Math.round(y), 1, H - y);
      }
    }

    // Creatures on the title. It was text on a gradient with nothing to look at and
    // no promise of what the game is about — the starters are the promise.
    const cast = STARTERS.map((id) => getSpecies(id).sprite);
    for (let i = 0; i < cast.length; i++) {
      if (!hasSprite(cast[i])) continue;
      const cx2 = W / 2 + (i - 1) * 62;
      const bob = Math.round(Math.sin(this.t * 1.6 + i * 1.9) * 3);
      const back = i !== 1;
      ctx.save();
      ctx.globalAlpha = back ? 0.75 : 1;
      drawSprite(ctx, cast[i], cx2 - (back ? 16 : 22), 150 + bob - (back ? 0 : 6),
                 { scale: back ? 1 : 1.4 });
      ctx.restore();
    }

    drawTextCentered(ctx, 'VERDANT FRONTIER', W / 2, 44, { color: '#f4ecd8', shadow: '#101820' });
    drawTextCentered(ctx, 'a wilderness that is never the same twice', W / 2, 60, { color: '#a8c4b0' });

    // Frontier Record strip: lifetime stats for a returning player. It lives in
    // a band across the very top of the 320x240 canvas — the menu starts at
    // y>=70 and the Continue card grows DOWNWARD from the menu, so nothing can
    // ever collide with it at any viewport (viewports only scale the canvas).
    const rec = getRecord();
    if (rec.journeys > 0) {
      ctx.fillStyle = 'rgba(16,24,32,0.55)';
      ctx.fillRect(0, 0, W, 24);
      ctx.fillStyle = 'rgba(136,164,148,0.35)';
      ctx.fillRect(0, 23, W, 1);
      const th = Math.floor(rec.totalPlaytime / 3600);
      const tm = Math.floor((rec.totalPlaytime % 3600) / 60);
      drawText(ctx, 'FRONTIER RECORD', 6, 3, { color: PAL.gold });
      drawTextRight(ctx, th + ':' + String(tm).padStart(2, '0'), W - 6, 3, { color: '#a8c4b0' });
      drawText(ctx, 'Journeys ' + rec.journeys + '  Trials ' + rec.trials, 6, 13, { color: '#a8c4b0' });
      drawTextRight(ctx, 'Dex ' + rec.bestDex + '/34  Seals ' + rec.bestSeals, W - 6, 13, { color: '#a8c4b0' });
    }

    // Five rows (New, New Journey+, three Continues) push the Continue card
    // into the bottom hint at the default y; lifting the whole block 8px keeps
    // every row, the card, and the hint clear of each other in the worst case.
    const bw = 170, bx = (W - bw) / 2, by = this.items.length >= 5 ? 70 : 78;
    drawWindow(ctx, bx, by, bw, 16 + this.items.length * 15);
    for (let i = 0; i < this.items.length; i++) {
      const y = by + 8 + i * 15;
      drawText(ctx, this.items[i].label, bx + 20, y, { color: PAL.ink });
      if (i === this.index) drawCursor(ctx, bx + 8, y, this.t);
    }
    // Show what the highlighted save actually contains. "Continue — Rowan 0:12"
    // gave a returning player nothing to reconnect to.
    const cur = this.items[this.index];
    if (cur && cur.sum) {
      const s = cur.sum;
      const cw = 190, cx = (W - cw) / 2, cy = by + 16 + this.items.length * 15 + 6;
      drawWindow(ctx, cx, cy, cw, 52);
      // Fixed columns: each stat owns its span, so no value width can ever run
      // one string into another. The Seal total is the generated town count;
      // the world is not built at the title, so the usual count stands in.
      const sealTotal = (S.world && S.world.towns ? S.world.towns.length : 10);
      drawText(ctx, 'Seals ' + s.badges + '/' + sealTotal, cx + 8, cy + 6, { color: PAL.gold });
      drawText(ctx, 'Dex ' + s.dexCaught + '/34', cx + 112, cy + 6, { color: PAL.accent });
      drawText(ctx, s.money + ' cr', cx + 8, cy + 16, { color: PAL.shadow });
      // Sprite row above, level row below: stacked in the sprite's own box the
      // level digits overwrote the sprite and the window frame.
      let px = cx + 8;
      for (const m of s.party.slice(0, 6)) {
        const sp = getSpecies(m.species);
        if (hasSprite(sp.sprite)) {
          // Scale the whole sprite into the 14px box; the old fixed offset put
          // most of it outside the clip, leaving an unreadable sliver.
          const sz = spriteSize(sp.sprite);
          const sc = 14 / Math.max(sz.w, sz.h);
          ctx.save();
          ctx.beginPath(); ctx.rect(px, cy + 26, 14, 14); ctx.clip();
          drawSprite(ctx, sp.sprite, px + (14 - sz.w * sc) / 2, cy + 26 + (14 - sz.h * sc) / 2,
                     { scale: sc, variant: !!m.variant });
          ctx.restore();
        }
        drawTextCentered(ctx, String(m.level), px + 7, cy + 42, { color: PAL.shadow });
        px += 19;
      }
    }
    drawTextCentered(ctx, touchControls() ? 'Tap A to choose' : 'Z / Enter to choose',
                     W / 2, H - 18, { color: '#88a494' });
  },
};

// ------------------------------------------------------------------ new game
const STARTER_BLURB = {
  BLOOM: 'steady and patient', EMBER: 'fierce and restless', TIDE: 'quick and curious',
};

// ------------------------------------------------------------------ starter pick
// The starter is the first real decision in the game, and a text list sold it
// short: you were asked to commit to a companion you had never seen. The pick is
// its own scene — the three stand on pedestals, and the info panel sits in the
// dialogue box's footprint so the eye stays where the ranger's text just was.
const PICK_XS = [62, 160, 258];
const PICK_TOP = 170;                              // pedestal surface; sprites stand on it
const PICK_PANEL = { x: 4, y: H - 52 - 4, w: W - 8, h: 52 };

const StarterPick = {
  opaque: true,
  __name: 'starterpick',
  t: 0,
  index: 1,
  confirm: false,
  confirmSel: 0,
  _resolve: null,
  _taps: null,
  _onTap: null,
  _fresh: true,

  enter(p) {
    this.t = 0;
    this.index = 1;
    this.confirm = false;
    this.confirmSel = 0;
    this._resolve = (p && p.resolve) || null;
    this._taps = [];
    this._fresh = true;
    // On phones the on-screen pad drives this scene through Keys like everything
    // else, but the creatures themselves are the natural touch targets, so direct
    // canvas taps are folded into the same three actions.
    const canvas = Game.canvas;
    if (canvas) {
      this._onTap = (e) => {
        const r = canvas.getBoundingClientRect();
        if (!r.width || !r.height) return;
        this._taps.push({ x: (e.clientX - r.left) * W / r.width,
                          y: (e.clientY - r.top) * H / r.height });
      };
      canvas.addEventListener('pointerdown', this._onTap);
    }
  },

  exit() {
    if (this._onTap && Game.canvas) Game.canvas.removeEventListener('pointerdown', this._onTap);
    this._onTap = null;
    // Resolve on exit, not on confirm, so a force-popped scene can never strand
    // the awaiting intro. The browsed index is always a valid pick.
    const r = this._resolve;
    this._resolve = null;
    if (r) r(this.index);
  },

  _move(d) {
    this.index = (this.index + d + STARTERS.length) % STARTERS.length;
    this.confirm = false;
    sfx('select');
  },
  _open() { this.confirm = true; this.confirmSel = 0; sfx('select'); },
  _accept() { sfx('select'); popScene(this.index); },
  _cancel() { this.confirm = false; sfx('cancel'); },

  // Hit box of a creature plus its pedestal, in canvas pixels.
  _boxFor(i) {
    const cx = PICK_XS[i];
    return { x: cx - 34, y: PICK_TOP - 72, w: 68, h: 86 };
  },
  _selBox() { return this._boxFor(this.index); },

  _confirmGeom() {
    const sp = getSpecies(STARTERS[this.index]);
    const label = 'Take ' + sp.name + '?';
    const w = Math.max(textWidth(label) + 24, 96);
    const rowY = 54 + 8 + LINE_H + 3;
    return { label, x: Math.round((W - w) / 2), y: 54, w,
             h: 8 + LINE_H + 3 + LINE_H * 2 + 5, rowY };
  },

  update(dt) {
    this.t += dt;
    // Skip the frame that pushed the scene so the edge that closed the last
    // textbox cannot leak in as an instant confirm.
    if (this._fresh) { this._fresh = false; return; }
    // A player mashing through the intro must SEE the choice before they can
    // commit it: every confirming input — key, tap, confirm dialog — is inert
    // for the first beats. Browsing stays live throughout.
    const locked = this.t < 0.35;

    const tap = this._taps.length ? this._taps.shift() : null;
    const inBox = (p, b) => p && p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h;

    if (this.confirm) {
      if (tap) {
        const g = this._confirmGeom();
        if (inBox(tap, { x: g.x, y: g.rowY - 2, w: g.w, h: LINE_H })) { if (!locked) this._accept(); return; }
        if (inBox(tap, { x: g.x, y: g.rowY - 2 + LINE_H, w: g.w, h: LINE_H })) { this._cancel(); return; }
        if (inBox(tap, this._selBox())) { if (!locked) this._accept(); return; }
        for (let i = 0; i < STARTERS.length; i++) {
          if (i !== this.index && inBox(tap, this._boxFor(i))) {
            this._cancel(); this.index = i; sfx('select'); return;
          }
        }
        this._cancel();
        return;
      }
      if (consume('a') || consume('start')) {
        if (locked) return;
        if (this.confirmSel === 0) this._accept();
        else this._cancel();
        return;
      }
      if (consume('b')) { this._cancel(); return; }
      if (consume('up') || consume('down')) { this.confirmSel = 1 - this.confirmSel; sfx('select'); return; }
      if (consume('left')) { this._move(-1); return; }
      if (consume('right')) { this._move(1); return; }
      return;
    }

    if (tap) {
      // A tap on any pedestal means THAT creature — routing unselected
      // pedestals through half-screen paging selected the visual opposite of
      // what was touched once wraparound got involved.
      for (let i = 0; i < STARTERS.length; i++) {
        if (inBox(tap, this._boxFor(i))) {
          if (i === this.index) { if (!locked) this._open(); }
          else { this.index = i; sfx('select'); }
          return;
        }
      }
      // Below the pedestals sits the info panel; reading it must not change
      // the selection. Only the open sky pages by canvas half.
      if (tap.y < PICK_TOP + 14) { if (tap.x < W / 2) this._move(-1); else this._move(1); }
      return;
    }
    if (consume('left')) { this._move(-1); return; }
    if (consume('right')) { this._move(1); return; }
    if (consume('a') || consume('start')) { if (!locked) this._open(); return; }
    consume('b');   // there is nothing to back out to; swallow so it cannot reach scenes below
  },

  render(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#16283a');
    g.addColorStop(0.6, '#25484a');
    g.addColorStop(1, '#2f5c3e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#20362c';
    ctx.fillRect(0, PICK_TOP + 2, W, H - PICK_TOP - 2);

    // The ranger's question carries over verbatim so the scene reads as part of
    // the same conversation, not a menu that interrupted it.
    drawTextCentered(ctx, 'Which one will you take?', W / 2, 16, { color: '#f4ecd8', shadow: '#101820' });

    const selSp = getSpecies(STARTERS[this.index]);

    for (let i = 0; i < STARTERS.length; i++) {
      const sp = getSpecies(STARTERS[i]);
      const cx = PICK_XS[i];
      const sel = i === this.index;

      ctx.fillStyle = '#101820';
      ctx.fillRect(cx - 26, PICK_TOP, 52, 10);
      ctx.fillStyle = sel ? '#6888a8' : '#3c4c58';
      ctx.fillRect(cx - 24, PICK_TOP, 48, 8);
      ctx.fillStyle = sel ? '#88a8c8' : '#4c5c68';
      ctx.fillRect(cx - 24, PICK_TOP, 48, 2);

      if (sel) {
        // soft glow so the active choice reads at a glance, even in a still frame
        ctx.save();
        ctx.globalAlpha = 0.10;
        ctx.fillStyle = '#f8f4e8';
        ctx.beginPath(); ctx.arc(cx, PICK_TOP - 28, 36, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx, PICK_TOP - 28, 26, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      if (hasSprite(sp.sprite)) {
        const sz = spriteSize(sp.sprite);
        const scale = sel ? 2 : 1;
        const bob = sel ? Math.round(Math.sin(this.t * 2.6) * 2.5) : 0;
        drawSprite(ctx, sp.sprite, cx - (sz.w * scale) / 2, PICK_TOP - sz.h * scale + bob,
                   { scale, alpha: sel ? 1 : 0.62 });
      }

      if (!sel) drawTextCentered(ctx, sp.name, cx, PICK_TOP - 46, { color: '#88a494' });

      if (sel && !this.confirm && Math.sin(this.t * 5) > -0.25) {
        const ay = PICK_TOP - 78;
        ctx.fillStyle = '#f4ecd8';
        for (let r = 0; r < 4; r++) ctx.fillRect(cx - 3 + r, ay + r, 7 - r * 2, 1);
      }
    }

    const P = PICK_PANEL;
    drawWindow(ctx, P.x, P.y, P.w, P.h);
    const nameEnd = drawText(ctx, selSp.name, P.x + 8, P.y + 6, { color: PAL.accent });
    let bx = nameEnd + 8;
    for (const ty of selSp.types) bx += drawTypeBadge(ctx, ty, bx, P.y + 5) + 3;
    const flavour = wrapText(selSp.entry || '', P.w - 16).slice(0, 2);
    for (let i = 0; i < flavour.length; i++) {
      drawText(ctx, flavour[i], P.x + 8, P.y + 18 + i * LINE_H, { color: PAL.ink });
    }
    drawTextRight(ctx, touchControls() ? 'Tap to choose' : 'Z to choose',
                  P.x + P.w - 8, P.y + P.h - 12, { color: PAL.dim });

    if (this.confirm) {
      ctx.fillStyle = 'rgba(16,24,32,0.45)';
      ctx.fillRect(0, 0, W, H);
      const cg = this._confirmGeom();
      drawWindow(ctx, cg.x, cg.y, cg.w, cg.h);
      drawText(ctx, cg.label, cg.x + 8, cg.y + 6, { color: PAL.ink });
      drawText(ctx, 'Yes', cg.x + 18, cg.rowY, { color: PAL.ink });
      drawText(ctx, 'No', cg.x + 18, cg.rowY + LINE_H, { color: PAL.ink });
      drawCursor(ctx, cg.x + 8, cg.rowY + this.confirmSel * LINE_H, this.t);
    }
  },
};

function pickStarter() {
  return new Promise((resolve) => pushScene(StarterPick, { resolve }));
}

async function startNewGame(plus = false) {
  clearScenes();
  pushScene(Loading, { text: plus ? 'The frontier re-forms...' : 'Shaping the frontier...' });
  await frameBreak();

  // New Journey+ carries the field notes: every dex SEEN entry present in this
  // session's state (a game loaded or played since boot). That is all main.js
  // can reach — it cannot read a slot's dex without loading the slot — so a
  // cold-booted NJ+ carries none, by design.
  const carrySeen = plus ? Object.keys(S.dex.seen) : [];

  const seed = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
  // resetState restores default options; the ones the player set must outlive
  // it, and outlive the page via their own key.
  const keepOpts = Object.assign({}, S.options);
  resetState(seed, 'Rowan');
  Object.assign(S.options, keepOpts);
  persistOptions();

  if (plus) {
    // The veteran's kit, on top of resetState's deliberately lean start
    // (600 cr, 3 orbs): +800 credits and +5 orbs. Seen entries are re-marked
    // AFTER resetState wiped the dex, so only the carried notes survive.
    for (const id of carrySeen) seeSpecies(id);
    addMoney(800);
    addItem('orb', 5);
  }

  try {
    S.world = generateWorld(seed);
  } catch (e) {
    try { console.error('worldgen failed', e); } catch (_) {}
    S.world = null;
  }
  if (!S.world || !S.world.map) {
    clearScenes();
    pushScene(Title);
    await say('The frontier failed to take shape. Try starting a new journey again.');
    return;
  }

  // One journey per NEW game actually begun: counted only after the world
  // exists (a failed generation bounces to the title and must not inflate the
  // record), and never on Continue, which does not pass through here. A New
  // Journey+ is still a journey.
  updateRecord({ adds: { journeys: 1 }, maxes: { lastSeed: seed } });

  clearScenes();
  pushScene(Overworld);
  const st = S.world.start;
  enterMap('world', st.x, st.y, 'down');

  // No control until the starter exists. A step into a trainer's sight line
  // during the intro fired startBattle with an empty party and bricked the run.
  holdControl();
  try {
  await fade('in', 0.5);
  // The NJ+ opening names what carried over so the kit and the notes never
  // read as a bug; the standard opening is untouched.
  if (plus) {
    await say([
      'The frontier re-forms. Your field notes travel with you.',
      'A veteran\'s kit is already packed: 800 credits and five spare orbs.',
      'An old ranger meets you at the edge of town.',
    ]);
  } else {
    await say([
      'The frontier stretches out ahead of you, unmapped and unnamed.',
      'Somewhere out there are creatures nobody has catalogued yet.',
      'An old ranger meets you at the edge of town.',
    ]);
  }
  await say('Ranger: Before you go wandering off, pick a companion. You will not last a day alone out there.');

  // The scene cannot be dismissed without confirming a pick, so no retry loop:
  // it always resolves 0..2.
  const choice = await pickStarter();

  const starterId = STARTERS[choice] || STARTERS[0];
  const sp = getSpecies(starterId);
  const starter = makeCreature(starterId, 5, { where: 'home' });
  addToParty(starter);
  // Remember the choice so the Seal milestones can hand over the lines you did
  // not take — without that the dex caps at 30 of 34 and can never be completed.
  setFlag('starter_' + starterId, true);

  await say('Ranger: ' + sp.name + ', then. A good pick — ' +
    (STARTER_BLURB[sp.types[0]] || 'a fine companion') + '.');
  await say('Ranger: Tall grass is where you will find wild ones. Weaken them first, then throw an orb.');
  // One line, not three. The opening is the most expensive place in the game to
  // spend the player's patience, so the goal is stated once and the detail lives
  // in the pause menu instead. The Seal count is the generated town count.
  const sealTotal = (S.world && S.world.towns ? S.world.towns.length : 10);
  await say('Ranger: Every settlement keeps a Warden. Beat all ' + sealTotal +
    ' for their Seals — any order you like, but the far ones hit hard.');
  sfx('levelup');
  } finally {
    releaseControl();
  }
}

async function continueGame(slot) {
  clearScenes();
  pushScene(Loading, { text: 'Recovering your journey...' });
  await frameBreak();

  // The save embeds an options copy, but the session's options are the current
  // truth whenever the device-level store exists; a save from before that store
  // existed seeds it instead, so migrating players keep their settings.
  const sessionOpts = optionsOnDevice ? Object.assign({}, S.options) : null;

  if (!loadGame(slot)) {
    clearScenes();
    pushScene(Title);
    await say('That record could not be read. It may be from a different version.');
    return;
  }

  try {
    S.world = generateWorld(S.seed);
  } catch (e) {
    try { console.error('worldgen failed on load', e); } catch (_) {}
    S.world = null;
  }
  if (!S.world || !S.world.map) {
    clearScenes();
    pushScene(Title);
    await say('The frontier could not be rebuilt from that record.');
    return;
  }

  if (sessionOpts) Object.assign(S.options, sessionOpts);
  persistOptions();

  setMusicEnabled(S.options.music);
  setSfxEnabled(S.options.sfx);

  clearScenes();
  pushScene(Overworld);

  // Interiors are regenerated, so returning straight into one is safe, but the
  // world is the reliable place to land if anything about the id looks off.
  const mapId = S.mapId && typeof S.mapId === 'string' ? S.mapId : 'world';
  try {
    enterMap(mapId, S.player.x, S.player.y, S.player.dir);
  } catch (_) {
    const st = S.world.start;
    enterMap('world', st.x, st.y, 'down');
  }
  await fade('in', 0.4);
}

const Loading = {
  opaque: true, t: 0, text: 'Loading...',
  enter(p) { this.t = 0; this.text = (p && p.text) || 'Loading...'; },
  update(dt) { this.t += dt; },
  render(ctx) {
    clear(ctx, '#101820');
    drawTextCentered(ctx, this.text, W / 2, H / 2 - 8, { color: '#f4ecd8' });
    const dots = '.'.repeat(1 + (Math.floor(this.t * 3) % 3));
    drawTextCentered(ctx, dots, W / 2, H / 2 + 6, { color: '#88a494' });
  },
};

function frameBreak() {
  return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
}

// ------------------------------------------------------------------ loop
let acc = 0;
let last = 0;
let running = false;

function frame(now) {
  requestAnimationFrame(frame);
  if (!last) last = now;
  let dt = (now - last) / 1000;
  last = now;
  if (!isFinite(dt) || dt < 0) dt = 0;
  if (dt > MAX_FRAME) dt = MAX_FRAME;   // a backgrounded tab must not fast-forward the game
  acc += dt;

  let steps = 0;
  while (acc >= FIXED && steps < 8) {
    beginFrame();
    Game.t += FIXED;
    updateFade(FIXED);
    const top = topScene();
    if (top && top.update) {
      try { top.update(FIXED); }
      catch (e) { reportError('update', e); }
    }
    updateInput();
    acc -= FIXED;
    steps++;
  }
  if (steps >= 8) acc = 0;

  const ctx = Game.ctx;
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;

  // Render from the lowest opaque scene upward.
  let base = Game.scenes.length - 1;
  while (base > 0 && Game.scenes[base] && Game.scenes[base].opaque === false) base--;
  clear(ctx, '#000');
  for (let i = base; i < Game.scenes.length; i++) {
    const sc = Game.scenes[i];
    if (sc && sc.render) {
      try { sc.render(ctx); }
      catch (e) { reportError('render', e); }
    }
  }
  renderFade(ctx);
}

let errorCount = 0;
function reportError(phase, e) {
  errorCount++;
  if (errorCount <= 12) {
    try { console.error('[' + phase + '] ' + (e && e.stack ? e.stack : e)); } catch (_) {}
  }
}

// ------------------------------------------------------------------ boot
function boot() {
  const { canvas } = setupCanvas();
  const touchRoot = document.getElementById('touch');
  initInput(canvas, touchRoot);

  const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  setTouchVisible(isTouch);

  // Stored options apply from the first frame; audio flags must match them
  // before the first gesture arms the audio graph.
  optionsOnDevice = loadStoredOptions();
  setMusicEnabled(S.options.music);
  setSfxEnabled(S.options.sfx);

  try { buildAtlas(); } catch (e) { reportError('atlas', e); }

  // Audio must start from a gesture; arm it on the first input of any kind.
  const arm = () => {
    try { initAudio(); playBgm(S.started ? 'overworld' : 'title'); } catch (_) {}
    window.removeEventListener('keydown', arm);
    window.removeEventListener('pointerdown', arm);
  };
  window.addEventListener('keydown', arm, { once: true });
  window.addEventListener('pointerdown', arm, { once: true });

  pushScene(Title);

  const bootEl = document.getElementById('boot');
  if (bootEl) {
    bootEl.classList.add('gone');
    setTimeout(() => bootEl.remove(), 500);
  }

  running = true;
  requestAnimationFrame(frame);

  // Test hooks for the headless harness.
  window.__ready = true;
  window.__probe = () => {
    const top = topScene();
    let scene = 'none';
    if (top === Title) scene = 'title';
    else if (top === Overworld) scene = 'overworld';
    else if (top === Loading) scene = 'loading';
    else if (top && top.__name) scene = top.__name;
    else if (Game.scenes.length > 1) scene = 'menu';
    if (top && top.isBattle) scene = 'battle';
    return {
      scene,
      sceneCount: Game.scenes.length,
      errors: errorCount,
      party: S.party.length,
      money: S.player.money,
      map: S.mapId,
      x: S.player.x, y: S.player.y,
      steps: S.player.steps,
      grassSteps: Overworld.grassSteps,
      encounterRolls: Overworld.encounterRolls,
      dexSeen: Object.keys(S.dex.seen).length,
      started: S.started,
      worldReady: !!(S.world && S.world.map),
    };
  };
  window.__game = { Game, S, enterMap, startNewGame,
    // Record seams for the headless probes: seed a record before the title
    // renders, and read it back after a run. Same functions the game uses.
    getRecord, updateRecord,
    // Menus must persist an option the moment it changes; until they own a
    // proper import seam this is the hook they (and tests) can call.
    persistOptions,
    isSolidTile: tilesRef.isSolid,
    overlayBlocksTile: tilesRef.overlayBlocks,
    isGrassTile: tilesRef.isGrass,
    // Tiles occupied by a blocking entity on the CURRENT map. Terrain alone is not
    // the game's collision rule — a Warden standing in a plaza never moves, so a
    // path planner that only knows tiles will walk into one forever.
    blockedTiles() {
      const out = [];
      const ents = (Overworld && Overworld.entities) || [];
      for (const e of ents) {
        if (!e || e.hidden) continue;
        if (e.blocking === false) continue;
        if (e.kind === 'item' || e.kind === 'sign' || e.kind === 'door') continue;
        out.push(e.x + ',' + e.y);
      }
      return out;
    } };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
