// Turn-based battle scene. Flow is written as an async coroutine that awaits
// primitives (msg / anim / menuSelect) which the fixed-timestep update() drives.
import { Game, W, H, pushScene, popScene, fade } from './game.js';
import { drawWindow, drawText, drawTextRight, drawTextCentered, drawHpBar, drawExpBar,
         drawCursor, wrapText, PAL, textWidth, drawTypeBadge } from './ui.js';
import { Keys, consume, pressed } from './input.js';
import { drawSprite, getSprite, spriteSize } from './sprites.js';
import { getSpecies, DEX_COUNT } from './creatures.js';
import { getMove } from './moves.js';
import { getItem, ITEMS } from './items.js';
import { effectiveness, matchupText, TYPE_COLORS } from './types.js';
import { statsFor, maxHp, damage, accuracyCheck, speedOf, catchChance, expGain,
         endOfTurnDamage, aiChooseMove, fleeChance, STRUGGLE, expToNext } from './battlecalc.js';
import { displayName, isFainted, giveExp, tryEvolve, evolveInto, learnMove, knowsMove,
         hasUsableMove, MOVE_SLOTS, buildTeam, firstHealthy, addToParty, partyWiped } from './party.js';
import { S, seeSpecies, addMoney, removeItem, itemCount, bagList, dexCaughtCount } from './state.js';
import { sfx, playBgm } from './audio.js';
import { rand } from './rng.js';

const STATUS_LABEL = { brn:'BRN', psn:'PSN', par:'PAR', slp:'SLP', frz:'FRZ' };
const STATUS_COLOR = { brn:'#e07038', psn:'#a050a8', par:'#e0c040', slp:'#8898a8', frz:'#78c8e0' };

// ---------------------------------------------------------------- scene
const B = {
  opaque: true,
  isBattle: true,   // lets the test probe identify this scene
  active: false,
  me: null, foe: null,
  isTrainer: false, trainerSpec: null, foeTeam: null, foeIndex: 0,
  resolve: null,
  result: null,
  runAttempts: 0,
  t: 0,

  // coroutine plumbing
  waiting: null,        // { kind, resolve, ... }
  // presentation
  text: '', textShown: 0, textDone: true,
  menu: null,           // { items, index, cols, title }
  anims: [],
  hpShown: { me: 1, foe: 1 },
  shake: { mag: 0, t: 0 },
  flash: 0,
  intro: 1,             // 1 -> 0 slide-in
  ballAnim: null,
  hideFoe: false, hideMe: false,
  faintMe: 0, faintFoe: 0,
  bg: null,
  // --- game feel ---
  hitstop: 0,               // freezes the whole battle briefly on impact
  popups: [],               // floating damage / effect numbers
  recoil: { me: 0, foe: 0 },// per-sprite knockback, decays
  lowHpWarned: false,
  danger: false,
  dangerBeat: 0,
};

function combatant(inst, side) {
  return {
    inst, side,
    stages: { atk:0, def:0, spa:0, spd:0, spe:0, acc:0, eva:0 },
    confused: 0,
    flinched: false,
    participated: false,
  };
}

// ---------------------------------------------------------------- primitives
function textSpeed() {
  const s = S.options && S.options.textSpeed;
  const base = [24, 44, 72, 9999][Math.max(0, Math.min(3, s === undefined ? 2 : s))];
  // Holding confirm fast-forwards. A wild battle is ~50 presses; without this
  // the most repeated interaction in the game is the most finger-punishing.
  return Keys.a ? base * 8 : base;
}

// Show a message. If wait is false it auto-advances after a short beat.
function msg(text, wait = true) {
  B.text = String(text == null ? '' : text);
  B.textShown = 0;
  B.textDone = false;
  return new Promise((res) => { B.waiting = { kind: wait ? 'msg' : 'msgauto', resolve: res, t: 0 }; });
}

function pause(sec) {
  return new Promise((res) => { B.waiting = { kind: 'pause', resolve: res, t: 0, dur: sec }; });
}

function menuSelect(items, opts = {}) {
  B.menu = {
    items, index: opts.index || 0, cols: opts.cols || 1,
    cancelable: opts.cancelable !== false, kind: opts.kind || 'main',
  };
  return new Promise((res) => { B.waiting = { kind: 'menu', resolve: res }; });
}

function anim(dur, fn) {
  return new Promise((res) => { B.anims.push({ t: 0, dur, fn, resolve: res }); });
}

function tweenHp(who, from, to, dur = 0.6) {
  return anim(dur, (p) => { B.hpShown[who] = from + (to - from) * p; });
}

// ---------------------------------------------------------------- update
B.update = function (dt) {
  B.t += dt;

  // Visual timers decay even during hit-stop. They MUST be updated before the
  // early return below: freezing the coroutine is the point, freezing the screen
  // flash is not. With the decay after the return, a crit set flash to 1, painted
  // an opaque white rect over the whole screen and held it for the full 160ms
  // freeze — so the best moment in the game rendered as a white void.
  if (B.flash > 0) B.flash = Math.max(0, B.flash - dt * 5.5);
  if (B.shake.t > 0) B.shake.t = Math.max(0, B.shake.t - dt);

  // Hit-stop: a few frozen frames on impact. The cheapest way to make a hit feel
  // like it connected — the coroutine and animations stop, so the frame of impact
  // actually registers.
  if (B.hitstop > 0) {
    B.hitstop -= dt;
    for (const p of B.popups) p.t += dt * 0.35;   // popups still drift, slowly
    return;
  }

  for (let i = B.popups.length - 1; i >= 0; i--) {
    const p = B.popups[i];
    p.t += dt;
    if (p.t >= p.life) B.popups.splice(i, 1);
  }
  B.recoil.me = Math.max(0, B.recoil.me - dt * 6);
  B.recoil.foe = Math.max(0, B.recoil.foe - dt * 6);

  // Low-HP warning: fires once per drop below 20%, so it reads as an alarm
  // rather than a constant nag.
  if (B.me && B.me.inst) {
    const f = B.me.inst.hp / Math.max(1, maxHp(B.me.inst));
    B.danger = f > 0 && f <= 0.2;
    if (B.danger) {
      // A single beep then silence gave the danger state no ongoing presence, so
      // a near-death turn felt the same as a comfortable one. Beat steadily while
      // it lasts, faster the closer to zero it gets.
      B.dangerBeat -= dt;
      if (B.dangerBeat <= 0) { sfx('error'); B.dangerBeat = 0.45 + f * 1.6; }
    } else {
      B.dangerBeat = 0;
    }
  }

  if (B.intro > 0) B.intro = Math.max(0, B.intro - dt * 1.8);

  // animations
  for (let i = B.anims.length - 1; i >= 0; i--) {
    const a = B.anims[i];
    a.t += dt;
    const p = Math.min(1, a.t / a.dur);
    try { a.fn(p); } catch (_) { /* never let an animation kill the battle */ }
    if (p >= 1) { B.anims.splice(i, 1); const r = a.resolve; if (r) r(); }
  }
  if (B.anims.length) return;   // animations block the coroutine

  const wr = B.waiting;
  if (!wr) return;

  if (wr.kind === 'msg' || wr.kind === 'msgauto') {
    if (!B.textDone) {
      B.textShown += textSpeed() * dt;
      if (B.textShown >= B.text.length) { B.textShown = B.text.length; B.textDone = true; wr.t = 0; }
      if (consume('a')) { B.textShown = B.text.length; B.textDone = true; wr.t = 0; }
      return;
    }
    wr.t += dt;
    if (wr.kind === 'msgauto') {
      if (wr.t > (Keys.a ? 0.08 : 0.5)) { B.waiting = null; wr.resolve(); }
      else if (consume('a') && wr.t > 0.12) { B.waiting = null; wr.resolve(); }
    } else if (consume('a') && wr.t > 0.06) {
      sfx('select');
      B.waiting = null; wr.resolve();
    }
    return;
  }

  if (wr.kind === 'pause') {
    wr.t += dt;
    if (wr.t >= wr.dur) { B.waiting = null; wr.resolve(); }
    return;
  }

  if (wr.kind === 'menu') {
    const m = B.menu;
    const n = m.items.length;
    if (!n) { B.waiting = null; B.menu = null; wr.resolve(-1); return; }
    const cols = Math.max(1, m.cols);
    let moved = false;
    if (consume('left'))  { m.index = (m.index - 1 + n) % n; moved = true; }
    if (consume('right')) { m.index = (m.index + 1) % n; moved = true; }
    if (consume('up'))    { m.index = (m.index - cols + n) % n; moved = true; }
    if (consume('down'))  { m.index = (m.index + cols) % n; moved = true; }
    if (moved) sfx('select');
    if (consume('a')) {
      const it = m.items[m.index];
      if (it && it.disabled) { sfx('error'); return; }
      sfx('select');
      const i = m.index; B.menu = null; B.waiting = null; wr.resolve(i);
      return;
    }
    if (m.cancelable && consume('b')) {
      sfx('cancel');
      B.menu = null; B.waiting = null; wr.resolve(-1);
    }
  }
};

// ---------------------------------------------------------------- render
function drawPlatform(ctx, cx, cy, rw, rh, color) {
  ctx.fillStyle = color;
  for (let y = -rh; y <= rh; y++) {
    const t = y / rh;
    const half = Math.round(rw * Math.sqrt(Math.max(0, 1 - t * t)));
    ctx.fillRect(Math.round(cx - half), Math.round(cy + y), half * 2, 1);
  }
}

function drawInfoBox(ctx, c, x, y, isPlayer) {
  const inst = c.inst;
  const sp = getSpecies(inst.species);
  const w = isPlayer ? 108 : 100;
  const h = isPlayer ? 34 : 28;
  drawWindow(ctx, x, y, w, h);
  const name = displayName(inst);
  drawText(ctx, name.length > 11 ? name.slice(0, 11) : name, x + 6, y + 5, { color: PAL.ink });
  drawTextRight(ctx, 'L' + inst.level, x + w - 6, y + 5, { color: PAL.ink });

  const shown = B.hpShown[isPlayer ? 'me' : 'foe'];
  const mx = maxHp(inst);
  const cur = Math.max(0, Math.round(mx * shown));
  drawText(ctx, 'HP', x + 6, y + 15, { color: PAL.accent });
  drawHpBar(ctx, x + 20, y + 17, w - 28, cur, mx);

  if (isPlayer) {
    drawTextRight(ctx, cur + '/' + mx, x + w - 6, y + 23, { color: PAL.ink });
    const e = expToNext(inst);
    drawExpBar(ctx, x + 6, y + 30, w - 12, e.frac);
  }
  if (!isPlayer) {
    // Without this the player cannot make a type decision without having already
    // memorised the dex entry for whatever just appeared.
    let bx = x + 2;
    for (const ty of sp.types) bx += drawTypeBadge(ctx, ty, bx, y + h + 2) + 3;
  }
  if (inst.status && STATUS_LABEL[inst.status]) {
    const lx = x + 6, ly = y + (isPlayer ? 23 : 20);
    ctx.fillStyle = STATUS_COLOR[inst.status];
    ctx.fillRect(lx, ly, 17, 8);
    drawText(ctx, STATUS_LABEL[inst.status], lx + 2, ly + 1, { color: '#101820' });
  }
}

B.render = function (ctx) {
  const sx = B.shake.t > 0 ? Math.round((Math.random() - 0.5) * B.shake.mag * 2) : 0;
  ctx.save();
  ctx.translate(sx, 0);

  // backdrop
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, B.bg ? B.bg[0] : '#88c8f0');
  g.addColorStop(0.62, B.bg ? B.bg[1] : '#c8e8b0');
  g.addColorStop(1, B.bg ? B.bg[2] : '#88b070');
  ctx.fillStyle = g;
  ctx.fillRect(-8, 0, W + 16, H);

  drawPlatform(ctx, 224, 92, 46, 11, 'rgba(90,140,70,.55)');
  drawPlatform(ctx, 82, 156, 56, 14, 'rgba(90,140,70,.55)');

  const introOff = Math.round(B.intro * 180);

  // foe
  if (!B.hideFoe && B.foe) {
    const key = getSpecies(B.foe.inst.species).sprite;
    const sz = spriteSize(key);
    const scale = 2;
    const kick = Math.round(B.recoil.foe * 6);
    const fx = 224 - (sz.w * scale) / 2 + introOff + kick;
    const fy = 92 - sz.h * scale + 10 - Math.round(Math.sin(B.t * 2) * 1.5) - Math.round(B.recoil.foe * 3);
    ctx.save();
    if (B.faintFoe > 0) { ctx.globalAlpha = Math.max(0, 1 - B.faintFoe); ctx.translate(0, B.faintFoe * 26); }
    drawSprite(ctx, key, fx, fy, { scale, variant: !!B.foe.inst.variant, silhouette: B.recoil.foe > 0.75, tint: '#ffffff' });
    ctx.restore();
  }

  // player creature (back view = flipped, larger)
  if (!B.hideMe && B.me) {
    const key = getSpecies(B.me.inst.species).sprite;
    const sz = spriteSize(key);
    const scale = 2.6;
    const kick = Math.round(B.recoil.me * 6);
    const mx = 82 - (sz.w * scale) / 2 - introOff - kick;
    const my = 156 - sz.h * scale + 14 + Math.round(B.recoil.me * 3);
    ctx.save();
    if (B.faintMe > 0) { ctx.globalAlpha = Math.max(0, 1 - B.faintMe); ctx.translate(0, B.faintMe * 30); }
    drawSprite(ctx, key, mx, my, { scale, flip: true, variant: !!B.me.inst.variant,
      silhouette: B.recoil.me > 0.75, tint: '#ffffff' });
    ctx.restore();
  }

  // capture ball animation
  if (B.ballAnim) {
    const a = B.ballAnim;
    drawSprite(ctx, a.key || 'ball_orb', a.x - 6, a.y - 6, {});
  }

  // floating damage numbers, drawn above the creatures but under the HUD
  for (const p of B.popups) {
    const k = Math.min(1, p.t / p.life);
    const rise = -Math.round(k * 22);
    const pop = k < 0.18 ? 1 + (0.18 - k) * 2.2 : 1;   // brief punch-out on spawn
    ctx.save();
    ctx.globalAlpha = k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1;
    const px = Math.round(p.x), py = Math.round(p.y + rise);
    if (p.big && pop > 1) {
      ctx.translate(px, py);
      ctx.scale(pop, pop);
      drawTextCentered(ctx, p.text, 0, 0, { color: p.color, shadow: '#101820' });
    } else {
      drawTextCentered(ctx, p.text, px, py, { color: p.color, shadow: '#101820' });
    }
    ctx.restore();
  }

  if (B.foe) drawInfoBox(ctx, B.foe, 8, 12, false);
  if (B.me) drawInfoBox(ctx, B.me, W - 116, H - 96, true);

  // message box
  drawWindow(ctx, 4, H - 54, W - 8, 50);
  const shownText = B.text.slice(0, Math.floor(B.textShown));
  const lines = wrapText(shownText, W - 28);
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    drawText(ctx, lines[i], 14, H - 44 + i * 11, { color: PAL.ink });
  }
  if (B.textDone && B.waiting && B.waiting.kind === 'msg' && Math.sin(B.t * 8) > 0) {
    drawText(ctx, '▼', W - 20, H - 18, { color: PAL.accent });
  }

  // menus
  if (B.menu) renderMenu(ctx, B.menu);

  if (B.danger) {
    // A red edge vignette, pulsing, so peril is visible and not only audible.
    const pulse = 0.16 + Math.abs(Math.sin(B.t * 5)) * 0.16;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#e04038';
    ctx.fillRect(0, 0, W, 3); ctx.fillRect(0, H - 3, W, 3);
    ctx.fillRect(0, 0, 3, H); ctx.fillRect(W - 3, 0, 3, H);
    ctx.restore();
  }

  if (B.flash > 0) {
    // Hard-capped: the screen must never go fully white, or the moment of impact
    // is hidden behind the effect meant to sell it.
    ctx.globalAlpha = Math.min(0.5, B.flash);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
};

function renderMenu(ctx, m) {
  if (m.kind === 'main') {
    const x = W - 106, y = H - 52, w = 102, h = 48;
    drawWindow(ctx, x, y, w, h);
    for (let i = 0; i < m.items.length; i++) {
      const col = i % 2, row = (i / 2) | 0;
      const ix = x + 12 + col * 46, iy = y + 8 + row * 16;
      drawText(ctx, m.items[i].label, ix, iy, { color: m.items[i].disabled ? PAL.dim : PAL.ink });
      if (i === m.index) drawCursor(ctx, ix - 9, iy, B.t);
    }
    return;
  }
  if (m.kind === 'moves') {
    drawWindow(ctx, 4, H - 54, W - 8, 50);
    const foeTypes = B.foe ? getSpecies(B.foe.inst.species).types : [];
    const known = !!(B.foe && S.dex.caught[B.foe.inst.species]);
    for (let i = 0; i < m.items.length; i++) {
      const col = i % 2, row = (i / 2) | 0;
      const ix = 20 + col * 108, iy = H - 46 + row * 13;
      const it = m.items[i];
      drawText(ctx, it.label, ix, iy, { color: it.disabled ? PAL.dim : PAL.ink });
      // Effectiveness hints, but only for species you have already caught —
      // knowing a matchup is a reward for collecting, not a freebie.
      if (known && it.move && it.move.power > 0) {
        const mult = effectiveness(it.move.type, foeTypes);
        if (mult !== 1) {
          const mark = mult > 1 ? '^' : (mult === 0 ? 'x' : 'v');
          const tint = mult > 1 ? '#48c058' : (mult === 0 ? '#e04038' : '#e0a040');
          drawText(ctx, mark, ix + 74, iy, { color: tint });
        }
      }
      if (i === m.index) drawCursor(ctx, ix - 9, iy, B.t);
    }
    const sel = m.items[m.index];
    if (sel && sel.move) {
      const mv = sel.move;
      drawWindow(ctx, W - 96, H - 106, 92, 50);
      drawTypeBadge(ctx, mv.type, W - 90, H - 100);
      drawText(ctx, 'PP ' + sel.pp + '/' + sel.ppMax, W - 90, H - 88, { color: PAL.ink });
      drawText(ctx, mv.power ? 'PWR ' + mv.power : 'STATUS', W - 90, H - 78, { color: PAL.ink });
      drawText(ctx, mv.accuracy ? 'ACC ' + mv.accuracy : 'ACC --', W - 90, H - 68, { color: PAL.ink });
    }
    return;
  }
  // generic list (bag / switch)
  const w = 150, h = Math.min(120, 20 + m.items.length * 12);
  const x = W - w - 6, y = 20;
  drawWindow(ctx, x, y, w, h);
  if (m.title) drawText(ctx, m.title, x + 8, y + 6, { color: PAL.accent });
  for (let i = 0; i < m.items.length; i++) {
    const iy = y + 18 + i * 12;
    if (iy > y + h - 12) break;
    drawText(ctx, m.items[i].label, x + 12, iy, { color: m.items[i].disabled ? PAL.dim : PAL.ink });
    if (i === m.index) drawCursor(ctx, x + 3, iy, B.t);
  }
}

// ---------------------------------------------------------------- helpers
const nameOf = (c) => (c.side === 'foe' && !B.isTrainer ? 'The wild ' + displayName(c.inst) : displayName(c.inst));

function setHpShown(who, c) { B.hpShown[who] = maxHp(c.inst) > 0 ? c.inst.hp / maxHp(c.inst) : 0; }

// meta: { crit, mult } — drives how hard the hit reads.
async function applyDamage(target, amount, meta = {}) {
  const who = target.side === 'foe' ? 'foe' : 'me';
  const mx = maxHp(target.inst);
  const before = mx > 0 ? target.inst.hp / mx : 0;
  const dealt = Math.max(0, amount | 0);
  target.inst.hp = Math.max(0, target.inst.hp - dealt);
  const after = mx > 0 ? target.inst.hp / mx : 0;

  const frac = dealt / Math.max(1, mx);
  const big = !!meta.crit || (meta.mult || 1) > 1 || frac > 0.35;

  B.shake.mag = Math.min(7, 2 + frac * 12 + (meta.crit ? 2 : 0));
  B.shake.t = big ? 0.3 : 0.2;
  B.hitstop = meta.crit ? 0.16 : big ? 0.11 : 0.06;
  B.recoil[who] = 1;

  const anchor = who === 'foe' ? { x: 224, y: 62 } : { x: 82, y: 122 };
  B.popups.push({
    text: '-' + dealt,
    x: anchor.x + (Math.random() * 16 - 8),
    y: anchor.y,
    t: 0, life: 0.85,
    color: meta.crit ? '#ffd23c' : (meta.mult || 1) > 1 ? '#ff8a3c' : '#ffffff',
    big,
  });

  await tweenHp(who, before, after, big ? 0.6 : 0.42);
}

async function applyHeal(target, amount) {
  const who = target.side === 'foe' ? 'foe' : 'me';
  const mx = maxHp(target.inst);
  const before = mx > 0 ? target.inst.hp / mx : 0;
  target.inst.hp = Math.min(mx, target.inst.hp + Math.max(0, amount | 0));
  const after = mx > 0 ? target.inst.hp / mx : 0;
  await tweenHp(who, before, after, 0.45);
}

const STAT_LABEL = { atk:'Attack', def:'Defence', spa:'Sp. Atk', spd:'Sp. Def', spe:'Speed', acc:'accuracy', eva:'evasion' };

async function applyStages(target, stat, delta) {
  const cur = target.stages[stat] || 0;
  const next = Math.max(-6, Math.min(6, cur + delta));
  if (next === cur) {
    await msg(nameOf(target) + "'s " + (STAT_LABEL[stat] || stat) + (delta > 0 ? " won't go higher!" : " won't go lower!"), false);
    return;
  }
  target.stages[stat] = next;
  const word = delta >= 2 ? 'sharply rose' : delta > 0 ? 'rose' : delta <= -2 ? 'harshly fell' : 'fell';
  await msg(nameOf(target) + "'s " + (STAT_LABEL[stat] || stat) + ' ' + word + '!', false);
}

async function applyStatus(target, status) {
  if (!status) return false;
  if (target.inst.status) {
    await msg(nameOf(target) + ' is already afflicted.', false);
    return false;
  }
  const types = getSpecies(target.inst.species).types;
  // Sensible immunities so status isn't strictly dominant.
  if ((status === 'brn' && types.includes('EMBER')) ||
      (status === 'frz' && types.includes('FROST')) ||
      (status === 'psn' && types.includes('TOXIN')) ||
      (status === 'par' && types.includes('SPARK'))) {
    await msg(nameOf(target) + ' is unaffected.', false);
    return false;
  }
  target.inst.status = status;
  if (status === 'slp') target.inst.sleepTurns = rand.range(1, 3);
  const line = {
    brn: ' was burned!', psn: ' was poisoned!', par: ' was paralysed!',
    slp: ' fell asleep!', frz: ' was frozen solid!',
  }[status] || ' was afflicted!';
  sfx('hit');
  await msg(nameOf(target) + line, false);
  return true;
}

// Returns false if the attacker cannot act this turn.
async function preMoveChecks(c) {
  const inst = c.inst;
  if (inst.status === 'frz') {
    if (rand.chance(0.2)) { inst.status = null; await msg(nameOf(c) + ' thawed out!', false); }
    else { await msg(nameOf(c) + ' is frozen solid!', false); return false; }
  }
  if (inst.status === 'slp') {
    inst.sleepTurns--;
    if (inst.sleepTurns <= 0) { inst.status = null; await msg(nameOf(c) + ' woke up!', false); }
    else { await msg(nameOf(c) + ' is fast asleep.', false); return false; }
  }
  if (c.flinched) { c.flinched = false; await msg(nameOf(c) + ' flinched!', false); return false; }
  if (inst.status === 'par' && rand.chance(0.25)) {
    await msg(nameOf(c) + ' is paralysed and cannot move!', false); return false;
  }
  if (c.confused > 0) {
    c.confused--;
    if (c.confused <= 0) {
      await msg(nameOf(c) + ' snapped out of confusion!', false);
    } else {
      await msg(nameOf(c) + ' is confused...', false);
      if (rand.chance(0.33)) {
        const self = Math.max(1, Math.floor(maxHp(inst) / 8));
        await msg('It hurt itself in its confusion!', false);
        await applyDamage(c, self);
        return false;
      }
    }
  }
  return true;
}

async function performMove(attacker, defender, moveSlot) {
  const mv = moveSlot === null ? STRUGGLE : getMove(moveSlot.id);
  if (moveSlot) moveSlot.pp = Math.max(0, moveSlot.pp - 1);

  await msg(nameOf(attacker) + ' used ' + mv.name + '!', false);

  if (!accuracyCheck(attacker, defender, mv)) {
    await msg('It missed!', false);
    return;
  }

  const ef = mv.effect;

  if (mv.category === 'status') {
    if (!ef) { await msg('But nothing happened.', false); return; }
    if (ef.kind === 'status') { await applyStatus(defender, ef.status); return; }
    if (ef.kind === 'stat') {
      const target = ef.target === 'self' ? attacker : defender;
      await applyStages(target, ef.stat, ef.stages);
      return;
    }
    if (ef.kind === 'heal') {
      const mx = maxHp(attacker.inst);
      if (attacker.inst.hp >= mx) { await msg('But its HP is already full!', false); return; }
      sfx('heal');
      await applyHeal(attacker, Math.floor(mx * (ef.frac || 0.5)));
      await msg(nameOf(attacker) + ' regained health!', false);
      return;
    }
    if (ef.kind === 'confuse') {
      if (defender.confused > 0) { await msg(nameOf(defender) + ' is already confused.', false); return; }
      defender.confused = rand.range(2, 5);
      await msg(nameOf(defender) + ' became confused!', false);
      return;
    }
    await msg('But nothing happened.', false);
    return;
  }

  // Damaging move
  const hits = (ef && ef.kind === 'multihit') ? rand.range(ef.min || 2, ef.max || 5) : 1;
  let total = 0, lastMult = 1, anyCrit = false;

  for (let i = 0; i < hits; i++) {
    if (defender.inst.hp <= 0) break;
    const r = damage(attacker, defender, mv);
    lastMult = r.mult;
    if (r.immune || r.mult === 0) {
      await msg("It doesn't affect " + displayName(defender.inst) + '...', false);
      return;
    }
    if (r.crit) anyCrit = true;
    total += r.dmg;
    B.flash = r.crit ? 0.55 : (r.mult > 1 ? 0.4 : 0.26);
    sfx(r.crit ? 'crit' : 'hit');
    await applyDamage(defender, r.dmg, { crit: r.crit, mult: r.mult });
  }

  if (hits > 1) await msg('Hit ' + hits + ' time' + (hits > 1 ? 's' : '') + '!', false);
  if (anyCrit) await msg('A critical hit!', false);
  const mt = matchupText(lastMult);
  if (mt) await msg(mt, false);

  if (defender.inst.hp <= 0) return;

  if (ef && ef.kind === 'drain' && total > 0) {
    const heal = Math.max(1, Math.floor(total * (ef.frac || 0.5)));
    await applyHeal(attacker, heal);
    await msg(nameOf(attacker) + ' drained energy!', false);
  }
  if (ef && ef.kind === 'recoil' && total > 0) {
    const rec = Math.max(1, Math.floor(total * (ef.frac || 0.33)));
    await msg(nameOf(attacker) + ' is hit by recoil!', false);
    await applyDamage(attacker, rec);
  }
  if (ef && ef.kind === 'status' && rand.chance((ef.chance || 100) / 100)) {
    await applyStatus(defender, ef.status);
  }
  if (ef && ef.kind === 'stat' && rand.chance((ef.chance || 100) / 100)) {
    const target = ef.target === 'self' ? attacker : defender;
    await applyStages(target, ef.stat, ef.stages);
  }
  if (ef && ef.kind === 'flinch' && rand.chance((ef.chance || 30) / 100)) {
    defender.flinched = true;
  }
  if (ef && ef.kind === 'confuse' && rand.chance((ef.chance || 100) / 100) && defender.confused <= 0) {
    defender.confused = rand.range(2, 5);
    await msg(nameOf(defender) + ' became confused!', false);
  }
}

async function endOfTurn(c) {
  if (c.inst.hp <= 0) return;
  const dmg = endOfTurnDamage(c.inst);
  if (dmg > 0) {
    await msg(nameOf(c) + (c.inst.status === 'brn' ? ' is hurt by its burn!' : ' is hurt by poison!'), false);
    await applyDamage(c, dmg);
  }
}

// ---------------------------------------------------------------- faint / exp
async function handleFoeFaint() {
  sfx('faint');
  await anim(0.6, (p) => { B.faintFoe = p; });
  await msg(nameOf(B.foe) + ' fainted!');
  B.hideFoe = true;
  B.faintFoe = 0;

  const participants = Math.max(1, S.party.filter((c) => c && c.__participated).length);
  const winnerLv = B.me && B.me.inst ? B.me.inst.level : 5;
  const gain = expGain(B.foe.inst, participants, B.isTrainer, winnerLv);

  // Wild battles used to pay nothing, so the only income in the game was ~16
  // one-shot town trainers. Paying out per wild win — scaled by the level of what
  // you beat, which is itself scaled by how far out you are — makes pushing into
  // dangerous ground the way you earn.
  if (!B.isTrainer) {
    const bounty = Math.max(6, Math.round(B.foe.inst.level * 4.5));
    addMoney(bounty);
    await msg('You collected ' + bounty + ' credits.', false);
  }
  for (const c of S.party) {
    if (!c || isFainted(c) || !c.__participated) continue;
    const res = giveExp(c, gain);
    if (res.gained > 0) await msg(displayName(c) + ' gained ' + res.gained + ' EXP!', false);
    for (const lv of res.leveled) {
      sfx('levelup');
      setHpShown('me', B.me);
      await msg(displayName(c) + ' grew to level ' + lv + '!');
    }
    for (const l of res.learned) {
      if (knowsMove(c, l.moveId)) continue;
      const mv = getMove(l.moveId);
      if (c.moves.length < MOVE_SLOTS) {
        learnMove(c, l.moveId, null);
        await msg(displayName(c) + ' learned ' + mv.name + '!');
      } else {
        await msg(displayName(c) + ' wants to learn ' + mv.name + '.');
        const items = c.moves.map((m) => ({ label: getMove(m.id).name }));
        items.push({ label: 'Skip' });
        const pick = await menuSelect(items, { kind: 'list', title: 'Forget which?', cancelable: true });
        if (pick >= 0 && pick < c.moves.length) {
          const old = getMove(c.moves[pick].id).name;
          learnMove(c, l.moveId, pick);
          await msg(displayName(c) + ' forgot ' + old + ' and learned ' + mv.name + '!');
        } else {
          await msg(displayName(c) + ' did not learn ' + mv.name + '.', false);
        }
      }
    }
    const evo = tryEvolve(c);
    if (evo) {
      const oldName = displayName(c);
      await msg('What? ' + oldName + ' is changing!');
      evolveInto(c, evo);
      sfx('levelup');
      setHpShown('me', B.me);
      await msg(oldName + ' evolved into ' + displayName(c) + '!');
    }
  }
}

async function handleMeFaint() {
  sfx('faint');
  await anim(0.6, (p) => { B.faintMe = p; });
  await msg(displayName(B.me.inst) + ' fainted!');
  B.hideMe = true;
  B.faintMe = 0;
}

// ---------------------------------------------------------------- switching
function switchableList() {
  return S.party.map((c, i) => ({
    label: displayName(c) + '  L' + c.level + '  ' + c.hp + '/' + maxHp(c),
    disabled: isFainted(c) || c === B.me.inst,
    index: i,
  }));
}

async function doSwitch(index, silent) {
  const inst = S.party[index];
  if (!inst || isFainted(inst)) return false;
  if (!silent) await msg('Come back, ' + displayName(B.me.inst) + '!', false);
  B.me = combatant(inst, 'player');
  inst.__participated = true;
  B.hideMe = false;
  setHpShown('me', B.me);
  await msg('Go, ' + displayName(inst) + '!', false);
  return true;
}

// ---------------------------------------------------------------- capture
async function throwBall(itemId) {
  const item = getItem(itemId);
  const rate = (item.effect && item.effect.rate) || 1;
  removeItem(itemId, 1);
  await msg(S.player.name + ' threw a ' + item.name + '!', false);

  const key = 'ball_' + itemId;
  B.ballAnim = { x: 90, y: 150, key: getSprite(key).width ? key : 'ball_orb' };
  await anim(0.5, (p) => {
    B.ballAnim.x = 90 + (224 - 90) * p;
    B.ballAnim.y = 150 - Math.sin(p * Math.PI) * 60 + (92 - 150) * p;
  });
  B.hideFoe = true;
  sfx('catch');

  const res = catchChance(B.foe.inst, rate, B.foe.inst.status);
  for (let i = 0; i < Math.min(3, res.shakes); i++) {
    sfx('shake');
    await anim(0.34, (p) => { B.ballAnim.x = 224 + Math.sin(p * Math.PI * 2) * 5; });
    await pause(0.12);
  }

  if (res.caught) {
    await pause(0.25);
    const caughtInst = B.foe.inst;
    const name = displayName(caughtInst);
    const isNew = !S.dex.caught[caughtInst.species];
    sfx('levelup');
    await msg('Gotcha! ' + name + ' was caught!');

    // Actually keep it. Without this the ball is spent, the message plays, and
    // the creature evaporates — the worst possible bug in a game about catching.
    caughtInst.ball = itemId;
    caughtInst.met = { level: caughtInst.level, where: caughtInst.met ? caughtInst.met.where : 'the wild' };
    const dest = addToParty(caughtInst);

    if (dest === 'box') {
      await msg(name + ' was sent to storage — your team is full.');
    } else if (dest === 'full') {
      await msg('There was nowhere to put ' + name + '. It slipped away!');
      B.ballAnim = null;
      return true;
    }
    if (isNew) {
      // Progress feedback on every new catch — the completion drive only works
      // if the player can see the gap closing.
      await msg(name + ' was added to your dex.  ' + dexCaughtCount() + '/' + DEX_COUNT + ' recorded.');
    }
    B.ballAnim = null;
    return true;
  }
  await msg(['Oh no! It broke free!', 'Argh! So close!', 'It escaped the ' + item.name + '!'][Math.min(2, res.shakes)], false);
  B.ballAnim = null;
  B.hideFoe = false;
  return false;
}

// ---------------------------------------------------------------- bag in battle
async function openBattleBag() {
  const ids = bagList().filter((id) => {
    const it = getItem(id);
    return it && it.inBattle !== false && it.kind !== 'key';
  });
  if (!ids.length) { await msg('You have nothing you can use.', false); return null; }
  const items = ids.map((id) => ({ label: getItem(id).name + '  x' + itemCount(id), id }));
  const pick = await menuSelect(items, { kind: 'list', title: 'Bag', cancelable: true });
  if (pick < 0) return null;
  return items[pick].id;
}

// ---------------------------------------------------------------- main flow
async function runBattle() {
  const foeName = displayName(B.foe.inst);
  if (B.isTrainer) {
    await msg((B.trainerSpec.name || 'A challenger') + ' wants to battle!');
    await msg((B.trainerSpec.name || 'They') + ' sent out ' + foeName + '!', false);
  } else {
    await msg('A wild ' + foeName + ' appeared!');
  }
  const firstSighting = !S.dex.seen[B.foe.inst.species];
  seeSpecies(B.foe.inst.species);
  if (firstSighting) {
    sfx('levelup');
    await msg('Your dex has no record of this one!');
  }
  if (B.foe.inst.variant) {
    // The payoff moment for the variable-ratio hook. Make it unmissable.
    for (let i = 0; i < 3; i++) { sfx('catch'); B.flash = 0.5; await pause(0.16); }
    await msg('This ' + foeName + ' has an unusual shimmer to it!');
  }
  await msg('Go, ' + displayName(B.me.inst) + '!', false);
  B.me.inst.__participated = true;

  for (let turn = 0; turn < 400; turn++) {
    // --- player action
    let playerAction = null;
    while (!playerAction) {
      const main = [
        { label: 'Fight' }, { label: 'Bag' },
        { label: 'Party' }, { label: B.isTrainer ? 'Forfeit' : 'Run' },
      ];
      const choice = await menuSelect(main, { kind: 'main', cols: 2, cancelable: false });

      if (choice === 0) {
        if (!hasUsableMove(B.me.inst)) {
          await msg(displayName(B.me.inst) + ' has no moves left!', false);
          playerAction = { kind: 'move', slot: null };
          break;
        }
        const items = B.me.inst.moves.map((m) => {
          const mv = getMove(m.id);
          return { label: mv.name, disabled: m.pp <= 0, move: mv, pp: m.pp, ppMax: m.ppMax };
        });
        const mi = await menuSelect(items, { kind: 'moves', cols: 2, cancelable: true });
        if (mi < 0) continue;
        if (B.me.inst.moves[mi].pp <= 0) { await msg('No PP left for that move!', false); continue; }
        playerAction = { kind: 'move', slot: B.me.inst.moves[mi] };
      } else if (choice === 1) {
        const id = await openBattleBag();
        if (!id) continue;
        const item = getItem(id);
        if (item.kind === 'ball') {
          if (B.isTrainer) { await msg("You can't catch another trainer's creature!", false); continue; }
          playerAction = { kind: 'ball', id };
        } else {
          const r = (await import('./items.js')).useItem(id, B.me.inst, 'battle');
          if (!r.ok) { await msg(r.message, false); continue; }
          if (r.consumed) removeItem(id, 1);
          setHpShown('me', B.me);
          await msg(r.message, false);
          playerAction = { kind: 'item' };
        }
      } else if (choice === 2) {
        const list = switchableList();
        if (!list.some((l) => !l.disabled)) { await msg('No one else can battle!', false); continue; }
        const pi = await menuSelect(list, { kind: 'list', title: 'Party', cancelable: true });
        if (pi < 0) continue;
        if (list[pi].disabled) { await msg("That one can't battle.", false); continue; }
        playerAction = { kind: 'switch', index: list[pi].index };
      } else {
        if (B.isTrainer) {
          await msg("You can't run from a trainer battle!", false);
          continue;
        }
        B.runAttempts++;
        if (rand.float() < fleeChance(B.me, B.foe, B.runAttempts)) {
          await msg('Got away safely!');
          return 'ran';
        }
        await msg("You couldn't get away!", false);
        playerAction = { kind: 'failrun' };
      }
    }

    // --- resolve
    if (playerAction.kind === 'ball') {
      const caught = await throwBall(playerAction.id);
      if (caught) return 'caught';
    } else if (playerAction.kind === 'switch') {
      await doSwitch(playerAction.index);
    }

    const foeSlotIndex = aiChooseMove(B.foe, B.me, B.isTrainer ? 2 : 1);
    const foeSlot = foeSlotIndex >= 0 ? B.foe.inst.moves[foeSlotIndex] : null;

    const playerMoves = playerAction.kind === 'move';
    let playerFirst;
    if (!playerMoves) playerFirst = true;
    else {
      const pPri = (playerAction.slot ? getMove(playerAction.slot.id).priority : 0) || 0;
      const fPri = (foeSlot ? getMove(foeSlot.id).priority : 0) || 0;
      if (pPri !== fPri) playerFirst = pPri > fPri;
      else {
        const ps = speedOf(B.me), fs = speedOf(B.foe);
        playerFirst = ps === fs ? rand.chance(0.5) : ps > fs;
      }
    }

    const acts = [];
    if (playerMoves) acts.push({ c: B.me, d: B.foe, slot: playerAction.slot, first: playerFirst });
    acts.push({ c: B.foe, d: B.me, slot: foeSlot, first: !playerFirst || !playerMoves ? !playerFirst : false });
    acts.sort((a, b) => (a.c === B.me ? (playerFirst ? -1 : 1) : (playerFirst ? 1 : -1)));

    for (const a of acts) {
      if (a.c.inst.hp <= 0 || a.d.inst.hp <= 0) continue;
      if (!(await preMoveChecks(a.c))) continue;
      await performMove(a.c, a.d, a.slot);

      if (B.foe.inst.hp <= 0) {
        await handleFoeFaint();
        if (B.isTrainer && B.foeTeam && B.foeIndex + 1 < B.foeTeam.length) {
          B.foeIndex++;
          B.foe = combatant(B.foeTeam[B.foeIndex], 'foe');
          B.hideFoe = false;
          setHpShown('foe', B.foe);
          seeSpecies(B.foe.inst.species);
          await msg((B.trainerSpec.name || 'They') + ' sent out ' + displayName(B.foe.inst) + '!', false);
          break;
        }
        return 'win';
      }
      if (B.me.inst.hp <= 0) {
        await handleMeFaint();
        const next = firstHealthy();
        if (next < 0) return 'lose';
        const list = switchableList();
        const pi = await menuSelect(list, { kind: 'list', title: 'Send out?', cancelable: false });
        const idx = (pi >= 0 && !list[pi].disabled) ? list[pi].index : next;
        await doSwitch(idx, true);
        break;
      }
    }

    if (B.foe.inst.hp > 0 && B.me.inst.hp > 0) {
      await endOfTurn(B.me);
      if (B.me.inst.hp <= 0) {
        await handleMeFaint();
        const next = firstHealthy();
        if (next < 0) return 'lose';
        await doSwitch(next, true);
      }
      await endOfTurn(B.foe);
      if (B.foe.inst.hp <= 0) {
        await handleFoeFaint();
        if (B.isTrainer && B.foeTeam && B.foeIndex + 1 < B.foeTeam.length) {
          B.foeIndex++;
          B.foe = combatant(B.foeTeam[B.foeIndex], 'foe');
          B.hideFoe = false;
          setHpShown('foe', B.foe);
          await msg((B.trainerSpec.name || 'They') + ' sent out ' + displayName(B.foe.inst) + '!', false);
        } else return 'win';
      }
    }

    if (S.party.every((c) => isFainted(c))) return 'lose';
  }
  return 'ran';
}

// ---------------------------------------------------------------- entry
B.enter = function (params) {
  B.active = true;
  B.t = 0;
  B.intro = 1;
  B.anims = [];
  B.waiting = null;
  B.menu = null;
  B.text = ''; B.textShown = 0; B.textDone = true;
  B.hideFoe = false; B.hideMe = false;
  B.faintMe = 0; B.faintFoe = 0;
  B.ballAnim = null;
  B.runAttempts = 0;
  B.flash = 0;
  B.hitstop = 0;
  B.popups = [];
  B.recoil = { me: 0, foe: 0 };
  B.lowHpWarned = false;
  B.danger = false;
  B.dangerBeat = 0;
  B.shake = { mag: 0, t: 0 };
  B.bg = params.bg || null;

  for (const c of S.party) if (c) c.__participated = false;

  B.isTrainer = !!params.trainer;
  B.trainerSpec = params.trainer || null;

  if (B.isTrainer) {
    B.foeTeam = buildTeam(params.trainer.team);
    if (!B.foeTeam.length) B.foeTeam = [buildTeam([{ species: 'mottlemouse', level: 5 }])[0]];
    B.foeIndex = 0;
    B.foe = combatant(B.foeTeam[0], 'foe');
  } else {
    B.foeTeam = null;
    B.foeIndex = 0;
    B.foe = combatant(params.wild, 'foe');
  }

  const idx = firstHealthy();
  B.me = combatant(S.party[idx >= 0 ? idx : 0], 'player');
  setHpShown('me', B.me);
  setHpShown('foe', B.foe);

  playBgm('battle');

  runBattle()
    .then(async (result) => {
      B.result = result;
      if (result === 'win') playBgm('victory');
      if (result === 'win' && B.isTrainer) {
        const prize = Math.max(0, (B.trainerSpec.prize | 0) || 200);
        await msg('You defeated ' + (B.trainerSpec.name || 'the challenger') + '!');
        addMoney(prize);
        await msg('You got ' + prize + ' credits!');
      }
      finish(result);
    })
    .catch((err) => {
      // A crash mid-battle must never strand the player in a dead scene.
      try { console.error('battle error', err); } catch (_) {}
      finish('ran');
    });
};

function finish(result) {
  B.active = false;
  const r = B.resolve;
  B.resolve = null;
  popScene(result);
  if (r) r(result);
}

B.exit = function () { B.active = false; B.menu = null; B.waiting = null; B.anims = []; };

export function startBattle(opts) {
  // A battle with nobody able to fight must never construct a scene around
  // undefined — B.enter would throw, leaving a dead black scene on the stack and
  // an unhandled rejection. Resolve as a loss and let the overworld's wipe
  // handling take it from there.
  if (partyWiped()) return Promise.resolve('lose');
  return new Promise((resolve) => {
    B.resolve = resolve;
    pushScene(B, opts || {});
  });
}

export const BattleScene = B;
