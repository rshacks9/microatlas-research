// Boot, title screen, new-game flow, and the fixed-timestep run loop.
import { Game, W, H, pushScene, popScene, replaceScene, clearScenes, topScene,
         updateFade, renderFade, fade, clear } from './game.js';
import { initInput, beginFrame, updateInput, consume, Keys, setTouchVisible } from './input.js';
import { buildAtlas } from './tileset.js';
import { drawWindow, drawText, drawTextCentered, drawTextRight, drawCursor, PAL } from './ui.js';
import { drawSprite, hasSprite } from './sprites.js';
import { getSpecies, STARTERS } from './creatures.js';
import { generateWorld } from './worldgen.js';
import { makeCreature, displayName, addToParty } from './party.js';
import { S, resetState, setFlag } from './state.js';
import { Overworld, enterMap, player, holdControl, releaseControl } from './overworld.js';
import { say, ask } from './dialogue.js';
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

// ------------------------------------------------------------------ title scene
const Title = {
  opaque: true,
  t: 0,
  index: 0,
  items: [],
  enter() {
    this.t = 0;
    this.items = [{ label: 'New Journey', act: 'new' }];
    for (let i = 0; i < 3; i++) {
      if (hasSave(i)) {
        const s = slotSummary(i);
        this.items.push({ label: 'Continue — ' + s.name + '  ' + s.playtime, act: 'load', slot: i, sum: s });
      }
    }
    this.index = this.items.length > 1 ? 1 : 0;
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
      if (it.act === 'new') startNewGame();
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

    const bw = 170, bx = (W - bw) / 2, by = 78;
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
      drawWindow(ctx, cx, cy, cw, 44);
      drawText(ctx, 'Seals ' + s.badges + '/10', cx + 8, cy + 6, { color: PAL.gold });
      drawTextRight(ctx, 'Dex ' + s.dexCaught + '/34', cx + cw - 8, cy + 6, { color: PAL.accent });
      drawText(ctx, s.money + ' cr', cx + 8, cy + 16, { color: PAL.shadow });
      let px = cx + 8;
      for (const m of s.party.slice(0, 6)) {
        const sp = getSpecies(m.species);
        if (hasSprite(sp.sprite)) {
          ctx.save();
          ctx.beginPath(); ctx.rect(px, cy + 26, 14, 14); ctx.clip();
          drawSprite(ctx, sp.sprite, px - 9, cy + 17, { scale: 0.44, variant: !!m.variant });
          ctx.restore();
        }
        drawText(ctx, String(m.level), px + 1, cy + 36, { color: PAL.ink, shadow: PAL.paper });
        px += 17;
      }
    }
    drawTextCentered(ctx, 'Z / Enter to choose', W / 2, H - 18, { color: '#88a494' });
  },
};

// ------------------------------------------------------------------ new game
const STARTER_BLURB = {
  BLOOM: 'steady and patient', EMBER: 'fierce and restless', TIDE: 'quick and curious',
};

async function startNewGame() {
  clearScenes();
  pushScene(Loading, { text: 'Shaping the frontier...' });
  await frameBreak();

  const seed = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
  resetState(seed, 'Rowan');

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

  clearScenes();
  pushScene(Overworld);
  const st = S.world.start;
  enterMap('world', st.x, st.y, 'down');

  // No control until the starter exists. A step into a trainer's sight line
  // during the intro fired startBattle with an empty party and bricked the run.
  holdControl();
  try {
  await fade('in', 0.5);
  await say([
    'The frontier stretches out ahead of you, unmapped and unnamed.',
    'Somewhere out there are creatures nobody has catalogued yet.',
    'An old ranger meets you at the edge of town.',
  ]);
  await say('Ranger: Before you go wandering off, pick a companion. You will not last a day alone out there.');

  const options = STARTERS.map((id) => {
    const sp = getSpecies(id);
    return sp.name + ' (' + sp.types.map((t) => t.charAt(0) + t.slice(1).toLowerCase()).join('/') + ')';
  });
  let choice = -1;
  while (choice < 0) {
    choice = await ask('Which one will you take?', options);
    if (choice < 0) await say('Ranger: Take your time, but take one.');
  }

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
  // in the pause menu instead.
  await say('Ranger: Every settlement keeps a Warden. Beat all ten for their Seals — any order you like, but the far ones hit hard.');
  sfx('levelup');
  } finally {
    releaseControl();
  }
}

async function continueGame(slot) {
  clearScenes();
  pushScene(Loading, { text: 'Recovering your journey...' });
  await frameBreak();

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
