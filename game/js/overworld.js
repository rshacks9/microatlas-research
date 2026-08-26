// The overworld scene: grid movement, encounters, warps, interaction, trainer sight.
import { Game, W, H, pushScene, popScene, transition, fade } from './game.js';
import { TILE, T, isGrass, ledgeDir, isCounter } from './tiles.js';
import { GameMap } from './tilemap.js';
import { makeCamera } from './camera.js';
import { makeEntities, Entity, DELTA, OPPOSITE } from './entities.js';
import { drawSprite, hasSprite, walkKey } from './sprites.js';
import { generateWorld, biomeAt, levelAt, encounterTableFor } from './worldgen.js';
import { buildInterior } from './towns.js';
import { makeCreature, displayName, partyWiped, healParty, firstHealthy } from './party.js';
import { startBattle } from './battle.js';
import { say, ask, showBanner, updateBanner, renderBanner, isDialogueOpen } from './dialogue.js';
import { openPauseMenu, openShop } from './menus.js';
import { S, advanceTime, addItem, setFlag, getFlag, seeSpecies, spendMoney } from './state.js';
import { makeRng, rand } from './rng.js';
import { playBgm, sfx } from './audio.js';
import { drawText, drawWindow, PAL } from './ui.js';

const WALK_DUR = 0.16;
const RUN_DUR = 0.09;

export const player = {
  x: 0, y: 0, dir: 'down',
  fromX: 0, fromY: 0,
  moving: false, moveT: 0, moveDur: WALK_DUR,
  frame: 0, animT: 0,
  hopping: false, hopFrom: null,
  sprite: 'hero',
  get px() {
    if (!this.moving) return this.x * TILE;
    const p = Math.min(1, this.moveT / this.moveDur);
    return (this.fromX + (this.x - this.fromX) * p) * TILE;
  },
  get py() {
    if (!this.moving) return this.y * TILE;
    const p = Math.min(1, this.moveT / this.moveDur);
    return (this.fromY + (this.y - this.fromY) * p) * TILE;
  },
};

const O = {
  opaque: true,
  map: null,
  cam: null,
  entities: [],
  busy: false,          // true while a blocking sequence (battle, dialogue, warp) runs
  t: 0,
  stepsSinceEncounter: 0,
  pendingWatcher: null,
  returnPoint: null,    // where to drop the player when leaving an interior
  turnHold: 0,
};

// ---------------------------------------------------------------- map loading
function interiorSeed(mapId) {
  let h = S.seed >>> 0;
  for (let i = 0; i < mapId.length; i++) h = (Math.imul(h ^ mapId.charCodeAt(i), 0x01000193) >>> 0);
  return h >>> 0;
}

function buildMapData(mapId) {
  if (mapId === 'world') {
    if (!S.world) S.world = generateWorld(S.seed);
    return S.world.map;
  }
  if (S.interiors[mapId]) return S.interiors[mapId];

  const parts = String(mapId).split(':');
  let kind = 'house', index = 0;
  if (parts[0] === 'cave') { kind = 'cave'; index = parseInt(parts[1], 10) || 0; }
  else if (parts[0] === 'inside') { kind = parts[1] || 'house'; index = parseInt(parts[2], 10) || 0; }

  let data = null;
  try {
    data = buildInterior(kind, interiorSeed(mapId), index);
  } catch (e) {
    try { console.error('buildInterior failed for ' + mapId, e); } catch (_) {}
  }
  if (!data || !data.ground) data = emergencyRoom(mapId);
  data.id = mapId;
  S.interiors[mapId] = data;
  return data;
}

// If an interior fails to generate we still owe the player a room they can leave.
function emergencyRoom(mapId) {
  const w = 9, h = 7;
  const ground = new Uint16Array(w * h);
  const overlay = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      ground[y * w + x] = (y === 0 || x === 0 || x === w - 1) ? T.WALL_WOOD : T.FLOOR_WOOD;
    }
  }
  return {
    id: mapId, w, h, ground, overlay, biome: null,
    warps: [{ x: 4, y: h - 1, to: 'world' }],
    entities: [], spawn: { x: 4, y: h - 2 }, indoor: true, bgm: 'town', name: 'Inside',
  };
}

export function enterMap(mapId, x, y, dir) {
  const data = buildMapData(mapId);
  const map = new GameMap(data);
  map.playerAt = (tx, ty) => !player.moving && player.x === tx && player.y === ty;

  O.map = map;
  O.entities = map.entityList ? map.entityList().slice() : [];
  if (!O.entities.length && Array.isArray(data.entities)) {
    // tilemap keeps plain specs; wrap them so they animate and can be talked to.
    O.entities = makeEntities(data.entities);
  } else {
    O.entities = O.entities.map((e) => (e instanceof Entity ? e : new Entity(e)));
  }
  map.entities = O.entities;
  if (map.reindex) map.reindex();

  S.mapId = mapId;

  const sx = (x !== undefined && x !== null) ? x : (data.spawn ? data.spawn.x : 1);
  const sy = (y !== undefined && y !== null) ? y : (data.spawn ? data.spawn.y : 1);
  player.x = clampInt(sx, 0, map.w - 1);
  player.y = clampInt(sy, 0, map.h - 1);
  player.fromX = player.x; player.fromY = player.y;
  player.moving = false; player.moveT = 0; player.frame = 0;
  if (dir) player.dir = dir;
  S.player.x = player.x; S.player.y = player.y; S.player.dir = player.dir;

  // Never spawn the player inside a wall.
  if (map.solidAt(player.x, player.y)) {
    const spot = nearestOpen(map, player.x, player.y);
    player.x = spot.x; player.y = spot.y;
    player.fromX = spot.x; player.fromY = spot.y;
  }

  O.cam = makeCamera(map);
  O.cam.follow(player.px + TILE / 2, player.py + TILE / 2, true);
  O.stepsSinceEncounter = 0;
  O.busy = false;
  O.pendingWatcher = null;

  playBgm(data.bgm || (mapId === 'world' ? 'overworld' : 'town'));
  if (data.name) showBanner(data.name, 2.2);
  return map;
}

function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(Number(v) || 0))); }

function nearestOpen(map, x, y) {
  for (let r = 1; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
        if (!map.solidAt(nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return { x, y };
}

// ---------------------------------------------------------------- movement
function canEnter(nx, ny) {
  const map = O.map;
  if (!map) return false;
  if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) return false;
  if (map.solidAt(nx, ny)) return false;
  const e = map.entityAt ? map.entityAt(nx, ny) : null;
  if (e && e.blocking !== false && e.kind !== 'item' && !(e.flag && getFlag(e.flag))) return false;
  return true;
}

function startStep(dir, running) {
  const d = DELTA[dir];
  if (!d) return false;
  const nx = player.x + d[0], ny = player.y + d[1];

  // Ledge hop: only downward, only when approaching from above.
  const ledge = ledgeDir(O.map.at(nx, ny));
  if (ledge === 'down' && dir === 'down') {
    const lx = nx, ly = ny + 1;
    if (ly < O.map.h && !O.map.solidAt(lx, ly)) {
      player.fromX = player.x; player.fromY = player.y;
      player.x = lx; player.y = ly;
      player.moving = true; player.hopping = true;
      player.moveT = 0; player.moveDur = 0.28;
      sfx('bump');
      return true;
    }
  }

  if (!canEnter(nx, ny)) {
    player.dir = dir;
    sfx('bump');
    return false;
  }
  player.fromX = player.x; player.fromY = player.y;
  player.x = nx; player.y = ny;
  player.dir = dir;
  player.moving = true;
  player.hopping = false;
  player.moveT = 0;
  player.moveDur = running ? RUN_DUR : WALK_DUR;
  return true;
}

// ---------------------------------------------------------------- encounters
function currentBiome() {
  if (S.mapId === 'world' && S.world) return biomeAt(S.world, player.x, player.y);
  if (String(S.mapId).startsWith('cave')) return 'MOUNTAIN';
  return 'MEADOW';
}

function wildLevelHere() {
  if (S.mapId === 'world' && S.world) return levelAt(S.world, player.x, player.y);
  if (String(S.mapId).startsWith('cave')) return Math.max(4, Math.min(45, 8 + ((S.seed % 7) | 0)));
  return 3;
}

function rollEncounter() {
  const map = O.map;
  if (!map) return null;
  const tile = map.at(player.x, player.y);
  if (!isGrass(tile)) return null;
  if (S.repelSteps > 0) return null;

  const rate = map.encounterRateAt ? map.encounterRateAt(player.x, player.y) : 0.12;
  // A short grace period after a battle so you can walk out of a patch.
  if (O.stepsSinceEncounter < 3) return null;
  if (!rand.chance(rate)) return null;

  let table = [];
  try { table = encounterTableFor(currentBiome()) || []; } catch (_) { table = []; }
  if (!table.length) return null;

  let total = 0;
  for (const e of table) total += (e.weight || 1);
  let r = rand.float() * total;
  let pick = table[0];
  for (const e of table) { r -= (e.weight || 1); if (r <= 0) { pick = e; break; } }
  if (!pick || !pick.species) return null;

  const base = wildLevelHere();
  const lo = pick.minLvl !== undefined ? pick.minLvl : Math.max(2, base - 2);
  const hi = pick.maxLvl !== undefined ? pick.maxLvl : base + 1;
  const level = Math.max(2, Math.min(100, rand.range(Math.min(lo, hi), Math.max(lo, hi))));
  return makeCreature(pick.species, level, { where: currentBiome().toLowerCase() });
}

async function doWildBattle(wild) {
  O.busy = true;
  sfx('encounter');
  await fade('out', 0.35, '#000');
  const result = await startBattle({ wild });
  await afterBattle(result);
  O.busy = false;
}

async function afterBattle(result) {
  O.stepsSinceEncounter = 0;
  if (result === 'lose' || partyWiped()) {
    await fade('out', 0.4, '#000');
    await say(['You have no creatures able to battle!', 'You hurried back to the nearest recovery centre.']);
    healParty();
    respawnAtHome();
    await fade('in', 0.4);
    playBgm(O.map && O.map.data && O.map.data.bgm ? O.map.data.bgm : 'overworld');
    return;
  }
  await fade('in', 0.35);
  playBgm(S.mapId === 'world' ? 'overworld' : (String(S.mapId).startsWith('cave') ? 'cave' : 'town'));
}

function respawnAtHome() {
  const home = (S.world && S.world.start) ? S.world.start : { x: 8, y: 8 };
  enterMap('world', home.x, home.y, 'down');
}

// ---------------------------------------------------------------- interaction
function facingTile() {
  const d = DELTA[player.dir] || [0, 1];
  return { x: player.x + d[0], y: player.y + d[1] };
}

async function interact() {
  const map = O.map;
  const f = facingTile();
  let e = map.entityAt ? map.entityAt(f.x, f.y) : null;

  // Talk across a shop/heal counter.
  if (!e && isCounter(map.at(f.x, f.y))) {
    const d = DELTA[player.dir];
    e = map.entityAt ? map.entityAt(f.x + d[0], f.y + d[1]) : null;
  }

  if (e && !(e.flag && getFlag(e.flag))) {
    O.busy = true;
    try { await talkTo(e); } finally { O.busy = false; }
    return true;
  }

  const tile = map.at(f.x, f.y);
  if (tile === T.SIGN) {
    O.busy = true;
    await say('A weathered signpost. The paint has long since faded.');
    O.busy = false;
    return true;
  }
  return false;
}

async function talkTo(e) {
  if (e.facePoint) e.facePoint(player.x, player.y);
  e.frozen = true;
  try {
    if (e.kind === 'heal') {
      await say(['Welcome to the Recovery Centre.', 'Shall I restore your team to full health?']);
      const yes = await ask('Restore your team?', ['Yes', 'No']);
      if (yes === 0) {
        sfx('heal');
        healParty();
        await say('There you go — everyone is back on their feet.');
        const s = await ask('Record your journey here?', ['Save', 'Not now']);
        if (s === 0) {
          const { saveGame } = await import('./save.js');
          const ok = saveGame(0);
          await say(ok ? 'Your journey has been recorded.' : 'Something went wrong saving. Storage may be full or blocked.');
        }
      } else {
        await say('Come back any time.');
      }
      return;
    }
    if (e.kind === 'shop') {
      await say(['Welcome to the supply shop.', 'What can I get you?']);
      await openShop(e.tier || 1);
      return;
    }
    if (e.kind === 'item') {
      const id = e.itemId || 'potion';
      const { getItem } = await import('./items.js');
      addItem(id, 1);
      if (e.flag) setFlag(e.flag, true);
      sfx('heal');
      await say('You found a ' + getItem(id).name + '!');
      return;
    }
    if (e.kind === 'trainer' && !(e.flag && getFlag(e.flag))) {
      await startTrainerBattle(e);
      return;
    }
    const lines = (e.lines && e.lines.length) ? e.lines : ['...'];
    await say(lines, { speaker: e.name || undefined });
  } finally {
    e.frozen = false;
  }
}

async function startTrainerBattle(e) {
  sfx('encounter');
  await say((e.name ? e.name + ': ' : '') + (e.challenge || "Let's battle!"));
  await fade('out', 0.35, '#000');
  const result = await startBattle({ trainer: e });
  if (result === 'win' && e.flag) setFlag(e.flag, true);
  e.defeated = result === 'win';
  await afterBattle(result);
}

// ---------------------------------------------------------------- warps
async function doWarp(wp) {
  O.busy = true;
  try {
    sfx('open');
    await fade('out', 0.3, '#000');
    const target = wp.to || 'world';
    if (target === 'world') {
      const rp = O.returnPoint;
      if (rp) enterMap('world', rp.x, rp.y, 'down');
      else if (wp.tx !== undefined) enterMap('world', wp.tx, wp.ty, wp.dir || 'down');
      else respawnAtHome();
      O.returnPoint = null;
    } else {
      O.returnPoint = { x: player.x, y: player.y + 1 };
      enterMap(target, wp.tx, wp.ty, wp.dir || 'down');
    }
    await fade('in', 0.3);
  } finally {
    O.busy = false;
  }
}

// ---------------------------------------------------------------- scene
O.enter = function () {
  O.t = 0;
  O.busy = false;
};

O.resume = function () {
  O.busy = false;
};

O.update = function (dt) {
  O.t += dt;
  updateBanner(dt);
  if (!O.map || !O.cam) return;

  S.playtime += dt;
  advanceTime(dt * 0.5);   // a full in-game day is ~48 real minutes

  for (const e of O.entities) {
    if (e.update) e.update(dt, O.map);
  }

  if (!O.busy && !isDialogueOpen()) {
    handleInput(dt);
  }

  if (player.moving) {
    player.moveT += dt;
    player.animT += dt;
    if (player.animT > player.moveDur * 0.5) { player.animT = 0; player.frame = (player.frame + 1) % 3; }
    if (player.moveT >= player.moveDur) {
      player.moving = false;
      player.hopping = false;
      player.moveT = 0;
      player.frame = 0;
      player.fromX = player.x; player.fromY = player.y;
      onStepComplete();
    }
  }

  O.cam.follow(player.px + TILE / 2, player.py + TILE / 2);
  O.cam.update(dt);
};

function handleInput(dt) {
  const { Keys, consume, pressed } = inputRefs;

  if (consume('start')) { openPauseMenu(); return; }
  if (consume('a')) { interact(); return; }

  if (player.moving) return;

  const dir = Keys.up ? 'up' : Keys.down ? 'down' : Keys.left ? 'left' : Keys.right ? 'right' : null;
  if (!dir) { O.turnHold = 0; return; }

  // Tapping a new direction turns in place before committing to a step.
  if (player.dir !== dir && O.turnHold < 0.08) {
    player.dir = dir;
    O.turnHold += dt;
    return;
  }
  O.turnHold = 0;
  startStep(dir, Keys.run);
}

function onStepComplete() {
  S.player.x = player.x; S.player.y = player.y; S.player.dir = player.dir;
  S.player.steps++;
  O.stepsSinceEncounter++;
  if (S.repelSteps > 0) S.repelSteps--;

  const map = O.map;

  const wp = map.warpAt ? map.warpAt(player.x, player.y) : null;
  if (wp) { doWarp(wp); return; }

  const item = map.entityAt ? map.entityAt(player.x, player.y) : null;
  if (item && item.kind === 'item' && !(item.flag && getFlag(item.flag))) {
    O.busy = true;
    talkTo(item).finally(() => { O.busy = false; });
    return;
  }

  const watcher = findSighting();
  if (watcher) { triggerWatcher(watcher); return; }

  const wild = rollEncounter();
  if (wild) { doWildBattle(wild); }
}

function findSighting() {
  for (const e of O.entities) {
    if (e.kind !== 'trainer' || e.hidden || e.defeated) continue;
    if (e.flag && getFlag(e.flag)) continue;
    const d = e.seesPlayer ? e.seesPlayer(player.x, player.y, O.map) : 0;
    if (d > 0) return e;
  }
  return null;
}

async function triggerWatcher(e) {
  O.busy = true;
  try {
    sfx('error');
    await say('!', { speaker: e.name || 'Trainer' });
    // Walk the trainer up to the player.
    const d = DELTA[e.dir];
    let guard = 0;
    while (d && guard++ < 12) {
      const nx = e.x + d[0], ny = e.y + d[1];
      if (nx === player.x && ny === player.y) break;
      if (O.map.solidAt(nx, ny)) break;
      O.map.moveEntity(e, nx, ny);
      e.x = nx; e.y = ny;
      await waitSec(0.11);
    }
    e.facePoint(player.x, player.y);
    player.dir = OPPOSITE[e.dir] || player.dir;
    await startTrainerBattle(e);
  } finally {
    O.busy = false;
  }
}

function waitSec(s) { return new Promise((res) => setTimeout(res, s * 1000)); }

// ---------------------------------------------------------------- render
O.render = function (ctx) {
  const map = O.map, cam = O.cam;
  if (!map || !cam) {
    ctx.fillStyle = '#101820';
    ctx.fillRect(0, 0, W, H);
    return;
  }

  ctx.fillStyle = '#0d1418';
  ctx.fillRect(0, 0, W, H);

  map.render(ctx, cam, 'ground');

  // Y-sorted actor pass so things overlap correctly.
  const actors = [];
  for (const e of O.entities) {
    if (e.hidden) continue;
    actors.push({ y: e.py !== undefined ? e.py : e.y * TILE, draw: () => e.render(ctx, cam) });
  }
  actors.push({ y: player.py, draw: () => drawPlayer(ctx, cam) });
  actors.sort((a, b) => a.y - b.y);
  for (const a of actors) a.draw();

  map.render(ctx, cam, 'overlay');

  renderBanner(ctx);
  if (S.repelSteps > 0) {
    drawText(ctx, 'REPEL ' + S.repelSteps, 6, H - 12, { color: '#c8e0f0', shadow: '#101820' });
  }
};

function drawPlayer(ctx, cam) {
  const sx = Math.round(player.px - cam.ox);
  let sy = Math.round(player.py - cam.oy);
  if (player.hopping) {
    const p = Math.min(1, player.moveT / player.moveDur);
    sy -= Math.round(Math.sin(p * Math.PI) * 10);
  }

  if (hasSprite('shadow')) drawSprite(ctx, 'shadow', sx, sy + 16, { alpha: 0.45 });

  const dirWanted = player.dir;
  const hasRight = hasSprite(walkKey('hero', 'right', 0));
  const dir = (dirWanted === 'right' && !hasRight) ? 'left' : dirWanted;
  const flip = dir !== dirWanted;
  let key = walkKey('hero', dir, player.moving ? player.frame : 0);
  if (!hasSprite(key)) key = walkKey('hero', dir, 0);
  if (!hasSprite(key)) key = walkKey('hero', 'down', 0);

  const inTall = O.map.isTallAt && O.map.isTallAt(player.x, player.y) && !player.moving;
  if (inTall) {
    // Clip the lower third so the player reads as standing in the grass.
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx - 4, sy - 12, 24, 22);
    ctx.clip();
    drawSprite(ctx, key, sx, sy - 8, { flip });
    ctx.restore();
  } else {
    drawSprite(ctx, key, sx, sy - 8, { flip });
  }
}

// input is imported lazily to keep this module Node-importable for tests
import * as inputRefs from './input.js';

export const Overworld = O;
export default O;
